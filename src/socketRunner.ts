import { createConnection } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { HelperError } from './errors.js'
import type { HelperRunner } from './helper.js'

/**
 * Zeit, die einer Antwort auf der Socket-Leitung eingeraeumt wird, nachdem
 * die Verbindung stand und die Anfrage geschrieben wurde. Der Daemon ist ein
 * lokaler, single-threaded Unix-Socket-Server ohne Netzwerk-Latenz — 10s ist
 * grosszuegig genug fuer eine list-events-Anfrage ueber einen groesseren
 * Zeitraum, aber kurz genug, dass ein haengender Tool-Aufruf nicht ewig
 * blockiert, wenn der Daemon (aus welchem Grund auch immer) nie antwortet.
 */
export const SOCKET_TIMEOUT_MS = 10_000

export function resolveSocketPath(): string {
  const override = process.env.APPLE_CALENDAR_SOCKET
  if (override !== undefined && override.length > 0) return override
  return join(homedir(), 'Library', 'Application Support', 'apple-calendar-mcp', 'helper.sock')
}

/**
 * Wird geworfen, wenn die Socket-Verbindung selbst nicht zustande kam (kein
 * Socket-File, niemand hoert, keine Berechtigung, Pfad zu lang, ...). Das ist
 * bewusst kein HelperError: createHelperRunner() nutzt genau diese
 * Unterscheidung, um zwischen "Socket nicht nutzbar -> auf spawn ausweichen"
 * und "Socket nutzbar, aber die Anfrage ist fehlgeschlagen -> Fehler direkt
 * durchreichen" zu unterscheiden. Ausserhalb dieses Moduls und helper.ts
 * sollte dieser Typ nie sichtbar werden — createSocketRunner faengt ihn ab
 * und wandelt ihn in einen HelperError um.
 */
export class SocketConnectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SocketConnectError'
  }
}

interface DaemonResponse {
  ok: boolean
  result?: unknown
  error?: { code?: string; message?: string }
}

function parseResponseLine(line: string): DaemonResponse {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    throw new HelperError('HELPER_CRASHED', `Unlesbare Antwort vom Hilfsprogramm: ${line.slice(0, 200)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || !('ok' in parsed)) {
    throw new HelperError('HELPER_CRASHED', `Unerwartete Antwort vom Hilfsprogramm: ${line.slice(0, 200)}`)
  }
  return parsed as DaemonResponse
}

/**
 * Baut fuer genau eine Anfrage eine eigene Verbindung auf, schreibt eine
 * Zeile, liest eine Zeile zurueck und schliesst die Verbindung wieder — der
 * Daemon erlaubt zwar mehrere Anfragen pro Verbindung, aber "eine Anfrage,
 * eine Antwort, fertig" ist fuer den seltenen, nicht nebenlaeufigen
 * MCP-Tool-Aufruf einfacher und robuster als eine gepoolte, langlebige
 * Verbindung mit Anfragen-Warteschlange.
 *
 * Lehnt mit SocketConnectError ab, wenn die Verbindung selbst nicht zustande
 * kommt (vor dem 'connect'-Event). Jeder Fehler danach — Timeout, kaputte
 * Zeile, abgebrochene Verbindung, strukturierter Fehler vom Daemon — lehnt
 * mit HelperError ab, denn ab diesem Punkt hat der Daemon geantwortet (oder
 * haette es tun sollen) und ein Ausweichen auf spawn wuerde eine
 * moeglicherweise nebenwirkungsbehaftete Anfrage (z. B. create-event)
 * doppelt ausloesen.
 */
export function runSocketRequest(
  socketPath: string,
  command: string,
  payload: Record<string, unknown>,
  timeoutMs: number = SOCKET_TIMEOUT_MS,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false
    let connected = false
    let buffer = ''
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined

    const socket = createConnection(socketPath)

    const cleanup = (): void => {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
      socket.removeAllListeners()
      socket.destroy()
    }

    const settleResolve = (value: unknown): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const settleReject = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (!connected) {
        settleReject(new SocketConnectError(error.message))
        return
      }
      settleReject(new HelperError('HELPER_CRASHED', error.message))
    })

    socket.on('connect', () => {
      connected = true
      timeoutHandle = setTimeout(() => {
        settleReject(new HelperError('HELPER_TIMEOUT', `Keine Antwort vom Hilfsprogramm innerhalb von ${String(timeoutMs)}ms.`))
      }, timeoutMs)
      socket.write(`${JSON.stringify({ command, payload })}\n`)
    })

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex === -1) return // Zeile noch nicht vollstaendig — auf weitere Chunks warten.
      const line = buffer.slice(0, newlineIndex)
      try {
        const response = parseResponseLine(line)
        if (response.ok) {
          settleResolve(response.result)
        } else {
          settleReject(new HelperError(response.error?.code ?? 'HELPER_CRASHED', response.error?.message ?? 'Unbekannter Fehler'))
        }
      } catch (error) {
        settleReject(error as HelperError)
      }
    })

    socket.on('close', () => {
      settleReject(new HelperError('HELPER_CRASHED', 'Verbindung zum Hilfsprogramm wurde ohne Antwort beendet.'))
    })
  })
}

/**
 * Reiner Socket-Transport: verbindet sich, sendet eine Anfrage, liest eine
 * Antwort. Im Unterschied zur Auswahl-Logik in createHelperRunner() weicht
 * dieser Runner bei einem nicht nutzbaren Socket nicht auf spawn aus —
 * jeder Fehlschlag, auch ein Verbindungsfehler, kommt als HelperError an.
 */
export function createSocketRunner(socketPath: string = resolveSocketPath(), timeoutMs: number = SOCKET_TIMEOUT_MS): HelperRunner {
  return {
    async run(command, payload) {
      try {
        return await runSocketRequest(socketPath, command, payload, timeoutMs)
      } catch (error) {
        if (error instanceof SocketConnectError) {
          throw new HelperError('HELPER_MISSING', `Socket nicht erreichbar (${socketPath}): ${error.message}`)
        }
        throw error
      }
    },
  }
}
