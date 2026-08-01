import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { HelperError } from './errors.js'

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

export function createHelperRunner(helperPath: string = resolveHelperPath()): HelperRunner {
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
        // fail with EPIPE. Without this handler that throws as an uncaught
        // exception and takes down the whole process instead of rejecting.
        child.stdin.on('error', (error: Error) => {
          settleReject(new HelperError('HELPER_CRASHED', error.message))
        })

        child.on('error', (error: Error) => {
          settleReject(new HelperError('HELPER_CRASHED', error.message))
        })

        child.on('close', (code) => {
          if (code === 0) {
            try {
              settleResolve(JSON.parse(stdout) as unknown)
            } catch {
              settleReject(new HelperError('HELPER_CRASHED', `Unlesbare Ausgabe: ${stdout.slice(0, 200)}`))
            }
            return
          }

          try {
            const parsed = JSON.parse(stderr.trim()) as { code?: string; message?: string }
            settleReject(new HelperError(parsed.code ?? 'HELPER_CRASHED', parsed.message ?? stderr.trim()))
          } catch {
            settleReject(new HelperError('HELPER_CRASHED', stderr.trim() || `Exit-Code ${String(code)}`))
          }
        })

        // Payload ueber stdin — vermeidet Escaping-Probleme bei Umlauten,
        // Anfuehrungszeichen und Zeilenumbruechen in Notizen.
        child.stdin.end(JSON.stringify(payload))
      })
    },
  }
}
