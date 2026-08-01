import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { HelperError } from './errors.js'
import { resolveSocketPath, runSocketRequest, SOCKET_TIMEOUT_MS, SocketConnectError } from './socketRunner.js'

export interface HelperRunner {
  run(command: string, payload: Record<string, unknown>): Promise<unknown>
}

/**
 * Loest den Pfad zum Swift-Binary auf. Ohne Override liegt es relativ zum
 * Paket-Root — kein benutzerspezifischer Pfad im Repo.
 */
export function resolveHelperPath(): string {
  const override = process.env.APPLE_CALENDAR_HELPER_PATH
  if (override !== undefined && override.length > 0) return override
  return fileURLToPath(new URL('../bin/calendar-helper', import.meta.url))
}

/**
 * Reiner Spawn-Transport: startet das Swift-Binary als Kindprozess je
 * Aufruf. Funktioniert nur, wenn der Elternprozess selbst die
 * Kalender-Berechtigung haelt (z. B. ein Terminal) — unter Claude Desktop
 * liefert er zuverlaessig PERMISSION_DENIED, weil die Berechtigung dem
 * verantwortlichen Elternprozess zugeordnet wird, nicht dem Binary. Bleibt
 * unveraendert gegenueber dem Verhalten vor der Socket-Umstellung.
 */
export function createSpawnRunner(helperPath: string = resolveHelperPath()): HelperRunner {
  return {
    run(command, payload) {
      return new Promise((resolve, reject) => {
        if (!existsSync(helperPath)) {
          reject(new HelperError('HELPER_MISSING', helperPath))
          return
        }

        // Node emits both 'error' and 'close' for some spawn failures; only the
        // first settle may win, otherwise a second reject()/resolve() would be a
        // silent no-op today but a foot-gun for future edits.
        let settled = false
        const settleResolve = (value: unknown): void => {
          if (settled) return
          settled = true
          resolve(value)
        }
        const settleReject = (error: HelperError): void => {
          if (settled) return
          settled = true
          reject(error)
        }

        const child = spawn(helperPath, [command], { stdio: ['pipe', 'pipe', 'pipe'] })
        let stdout = ''
        let stderr = ''

        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', (chunk: string) => {
          stdout += chunk
        })
        child.stderr.on('data', (chunk: string) => {
          stderr += chunk
        })

        // Helpers that exit before reading stdin (check-access, list-calendars,
        // and the unknown-command path all do this) can make the stdin write
        // fail with EPIPE. Without a handler that throws as an uncaught
        // exception and takes down the whole process. We must not settle on
        // it directly, though: check-access and list-calendars never read
        // stdin at all, so their pipe is *always* unread, and the write can
        // lose the race against the child already having exited with a real,
        // meaningful result (e.g. a genuine PERMISSION_DENIED). Recording the
        // error and letting 'close' decide means a valid result still wins;
        // this recorded error is only used as a fallback if 'close' itself
        // yields nothing better.
        let stdinError: HelperError | undefined
        child.stdin.on('error', (error: Error) => {
          stdinError = new HelperError('HELPER_CRASHED', error.message)
        })

        child.on('error', (error: Error) => {
          settleReject(new HelperError('HELPER_CRASHED', error.message))
        })

        child.on('close', (code) => {
          if (code === 0) {
            try {
              settleResolve(JSON.parse(stdout) as unknown)
            } catch {
              settleReject(stdinError ?? new HelperError('HELPER_CRASHED', `Unlesbare Ausgabe: ${stdout.slice(0, 200)}`))
            }
            return
          }

          try {
            const parsed = JSON.parse(stderr.trim()) as { code?: string; message?: string }
            settleReject(new HelperError(parsed.code ?? 'HELPER_CRASHED', parsed.message ?? stderr.trim()))
          } catch {
            settleReject(stdinError ?? new HelperError('HELPER_CRASHED', stderr.trim() || `Exit-Code ${String(code)}`))
          }
        })

        // Payload ueber stdin — vermeidet Escaping-Probleme bei Umlauten,
        // Anfuehrungszeichen und Zeilenumbruechen in Notizen.
        child.stdin.end(JSON.stringify(payload))
      })
    },
  }
}

/**
 * Waehlt den Transport pro Aufruf neu, statt einmalig bei der Konstruktion:
 * ein Socket-Verbindungsversuch schlaegt fehl, ohne einen Prozess zu
 * belasten (kein Listener/keine Datei -> sofortiges ENOENT/ECONNREFUSED),
 * also ist der Preis eines Versuchs pro Aufruf vernachlaessigbar gegenueber
 * dem Risiko, sich einmalig fuer spawn zu entscheiden und dabei stecken zu
 * bleiben: startet der Agent-Host (und damit dieser Prozess) vor dem
 * LaunchAgent-Daemon, wuerde eine Einmal-Entscheidung fuer immer auf spawn
 * ausweichen — also fuer immer PERMISSION_DENIED unter Claude Desktop
 * liefern, obwohl der Daemon kurz danach laengst lauscht. Pro-Aufruf-Auswahl
 * erholt sich davon beim naechsten Tool-Aufruf von selbst, ganz ohne
 * Neustart-Logik.
 *
 * Sobald eine Socket-Verbindung zustande kommt, wird sie nicht mehr
 * verlassen: ein Timeout, eine kaputte Zeile oder ein strukturierter Fehler
 * vom Daemon werden direkt durchgereicht statt auf spawn auszuweichen — ein
 * Doppel-Versuch nach erfolgreichem Verbindungsaufbau koennte eine
 * nebenwirkungsbehaftete Anfrage (z. B. create-event) zweimal ausloesen.
 */
export function createHelperRunner(
  helperPath: string = resolveHelperPath(),
  socketPath: string = resolveSocketPath(),
): HelperRunner {
  const spawnRunner = createSpawnRunner(helperPath)
  return {
    async run(command, payload) {
      try {
        return await runSocketRequest(socketPath, command, payload, SOCKET_TIMEOUT_MS)
      } catch (error) {
        if (error instanceof SocketConnectError) {
          return spawnRunner.run(command, payload)
        }
        throw error
      }
    },
  }
}
