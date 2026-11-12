import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { HelperError } from './errors.js'
import type { HelperRunner } from './helper.js'

/**
 * Fristen fuer eine Antwort des Hilfsprogramms.
 *
 * Die ERSTE Anfrage nach einem Start bekommt deutlich mehr Zeit: `serve`
 * prueft beim Hochfahren den Kalenderzugriff und wartet dabei bis zu 30
 * Sekunden auf die TCC-Antwort — bei der allerersten Nutzung muss dort ein
 * Mensch einen Systemdialog bestaetigen. Eine kurze Frist waere abgelaufen,
 * bevor er die Maus erreicht hat. Ist der Prozess erst einmal bereit, kostet
 * eine Anfrage nur noch eine Zeile durch eine Pipe.
 */
export interface StdioTimeouts {
  firstRequestMs: number
  requestMs: number
}

export const DEFAULT_TIMEOUTS: StdioTimeouts = {
  firstRequestMs: 35_000,
  requestMs: 10_000,
}

export interface StdioHelperRunner extends HelperRunner {
  /** Beendet das Hilfsprogramm und lehnt alles Offene ab. */
  stop(): void
}

interface PendingRequest {
  id: number
  resolve: (value: unknown) => void
  reject: (error: HelperError) => void
  timer: ReturnType<typeof setTimeout>
}

interface HelperResponse {
  id?: unknown
  ok?: unknown
  result?: unknown
  error?: { code?: string; message?: string }
}

/**
 * Haelt `calendar-helper serve` als langlebigen Kindprozess und spricht mit
 * ihm ueber NDJSON auf stdin/stdout.
 *
 * Warum langlebig und nicht ein Prozess pro Aufruf: Prozessstart,
 * Disclaim-Re-exec, Aufbau des EKEventStore und die TCC-Pruefung fallen sonst
 * bei JEDEM Tool-Aufruf erneut an. So zahlt man sie einmal.
 *
 * Der Helper arbeitet strikt sequenziell — eine Zeile rein, eine Zeile raus,
 * in Reihenfolge. Die mitgeschickte `id` waere dafuer nicht noetig; sie sorgt
 * aber dafuer, dass eine Desynchronisation als lauter Fehler auffliegt statt
 * als stille Vertauschung zweier Antworten.
 */
export function createStdioRunner(
  helperPath: string | (() => string),
  timeouts: StdioTimeouts = DEFAULT_TIMEOUTS,
): StdioHelperRunner {
  let child: ChildProcess | undefined
  /**
   * Pfad des laufenden (oder als naechstes zu startenden) Helpers.
   *
   * Als Funktion uebergeben, wird er vor JEDEM Start neu aufgeloest: Laufen
   * zwei Versionen des Servers parallel, ersetzt jede die installierte Kopie
   * durch ihre eigene (`ensureInstalledHelper`). Einmal beim Serverstart
   * aufgeloest, saehe ein spaeterer Start womoeglich den Helper der anderen
   * Version.
   */
  let currentPath: string | undefined
  function pathForNextStart(): string {
    if (child !== undefined && currentPath !== undefined) return currentPath
    currentPath = typeof helperPath === 'function' ? helperPath() : helperPath
    return currentPath
  }
  let buffer = ''
  let nextId = 1
  /** Hat der AKTUELLE Prozess schon einmal geantwortet? Steuert die Frist. */
  let isWarm = false
  /**
   * Timeouts in Folge auf einem bereits warmen Helper.
   *
   * Ein warmer Helper antwortet in etwa einer Millisekunde. Laeuft eine
   * Anfrage trotzdem in die Frist, steckt er fest — und ohne Neustart liefe
   * jede weitere Anfrage genauso ins Leere, bis jemand den Server neu startet.
   * Beim ERSTEN Aufruf gilt das nicht: dort wartet der Helper womoeglich noch
   * auf einen Systemdialog, den ein Mensch bestaetigen muss.
   */
  let consecutiveTimeouts = 0
  const MAX_CONSECUTIVE_TIMEOUTS = 2
  const pending: PendingRequest[] = []

  function rejectAllPending(error: HelperError): void {
    while (pending.length > 0) {
      const entry = pending.shift()
      if (entry === undefined) continue
      clearTimeout(entry.timer)
      entry.reject(error)
    }
  }

  /**
   * Trennt sich vom laufenden Prozess und lehnt alles Offene ab. Der naechste
   * Aufruf startet dadurch von selbst einen frischen Helper — es braucht
   * keine eigene Neustart-Logik.
   */
  function discardChild(error: HelperError): void {
    const previous = child
    child = undefined
    buffer = ''
    isWarm = false
    consecutiveTimeouts = 0
    rejectAllPending(error)
    if (previous !== undefined) {
      previous.removeAllListeners()
      previous.stdin?.end()
      previous.kill()
    }
  }

  function handleLine(line: string): void {
    let parsed: HelperResponse
    try {
      parsed = JSON.parse(line) as HelperResponse
    } catch {
      // Eine unlesbare Zeile heisst: die Leitung ist nicht mehr
      // vertrauenswuerdig. Welche Anfrage sie beantworten sollte, ist
      // unbekannt — also alles Offene ablehnen und neu anfangen, statt eine
      // moeglicherweise falsche Zuordnung zu raten.
      discardChild(new HelperError('HELPER_CRASHED', `Unreadable response from the helper: ${line.slice(0, 200)}`))
      return
    }

    // Ohne gespiegelte id gilt die Antwort der aeltesten offenen Anfrage —
    // das ist die Reihenfolge, in der der Helper ohnehin arbeitet.
    const index = typeof parsed.id === 'number' ? pending.findIndex((entry) => entry.id === parsed.id) : 0
    if (index === -1 || pending.length === 0) return // Antwort auf etwas, das nicht mehr offen ist (z. B. nach Timeout).

    const entry = pending.splice(index, 1)[0]
    if (entry === undefined) return
    clearTimeout(entry.timer)
    isWarm = true
    consecutiveTimeouts = 0

    if (parsed.ok === true) {
      entry.resolve(parsed.result)
      return
    }
    entry.reject(new HelperError(parsed.error?.code ?? 'HELPER_CRASHED', parsed.error?.message ?? 'Unbekannter Fehler'))
  }

  function ensureChild(path: string): ChildProcess {
    if (child !== undefined) return child

    // stderr geht unveraendert an den Elternprozess: dort landet die Diagnose
    // des Helpers, und der MCP-Server schreibt seine Logs ohnehin auf stderr.
    const started = spawn(path, ['serve'], { stdio: ['pipe', 'pipe', 'inherit'] })
    child = started
    isWarm = false

    started.stdout?.setEncoding('utf8')
    started.stdout?.on('data', (chunk: string) => {
      buffer += chunk
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (line.length > 0) handleLine(line)
        newlineIndex = buffer.indexOf('\n')
      }
    })

    // Ein Schreibfehler auf stdin (EPIPE, weil der Helper schon weg ist) darf
    // den MCP-Server nicht als unbehandelte Ausnahme mitreissen.
    started.stdin?.on('error', () => {
      /* 'exit' entscheidet, was mit den offenen Anfragen geschieht. */
    })

    started.on('error', (error: NodeJS.ErrnoException) => {
      // ENOENT heisst: das Binary war beim Start nicht da. Das als
      // "abgestuerzt" zu melden schickt den Leser in die falsche Richtung —
      // es ist derselbe Fall wie die existsSync-Pruefung, nur einen Moment
      // spaeter (etwa wenn ein Update die Datei gerade ersetzt).
      const code = error.code === 'ENOENT' ? 'HELPER_MISSING' : 'HELPER_CRASHED'
      discardChild(new HelperError(code, error.message))
    })

    started.on('exit', (code, signal) => {
      const reason = signal !== null ? `Signal ${signal}` : `Exit-Code ${String(code)}`
      discardChild(new HelperError('HELPER_CRASHED', `The helper exited (${reason}).`))
    })

    return started
  }

  return {
    run(command, payload) {
      return new Promise<unknown>((resolve, reject) => {
        const path = pathForNextStart()
        if (!existsSync(path)) {
          reject(new HelperError('HELPER_MISSING', path))
          return
        }

        const timeoutMs = isWarm ? timeouts.requestMs : timeouts.firstRequestMs
        const id = nextId++
        const entry: PendingRequest = {
          id,
          resolve,
          reject,
          timer: setTimeout(() => {
            const index = pending.findIndex((candidate) => candidate.id === id)
            if (index !== -1) pending.splice(index, 1)
            if (isWarm) {
              consecutiveTimeouts += 1
              if (consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
                discardChild(
                  new HelperError('HELPER_TIMEOUT', 'The helper stopped responding and was restarted.'),
                )
              }
            }
            reject(new HelperError('HELPER_TIMEOUT', `No response from the helper within ${String(timeoutMs)}ms.`))
          }, timeoutMs),
        }
        pending.push(entry)

        const current = ensureChild(path)
        current.stdin?.write(`${JSON.stringify({ id, command, payload })}\n`)
      })
    },

    stop() {
      discardChild(new HelperError('HELPER_CRASHED', 'The helper was shut down.'))
    },
  }
}
