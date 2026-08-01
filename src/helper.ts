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

        child.on('error', (error: Error) => {
          reject(new HelperError('HELPER_CRASHED', error.message))
        })

        child.on('close', (code) => {
          if (code === 0) {
            try {
              resolve(JSON.parse(stdout) as unknown)
            } catch {
              reject(new HelperError('HELPER_CRASHED', `Unlesbare Ausgabe: ${stdout.slice(0, 200)}`))
            }
            return
          }

          try {
            const parsed = JSON.parse(stderr.trim()) as { code?: string; message?: string }
            reject(new HelperError(parsed.code ?? 'HELPER_CRASHED', parsed.message ?? stderr.trim()))
          } catch {
            reject(new HelperError('HELPER_CRASHED', stderr.trim() || `Exit-Code ${String(code)}`))
          }
        })

        // Payload ueber stdin — vermeidet Escaping-Probleme bei Umlauten,
        // Anfuehrungszeichen und Zeilenumbruechen in Notizen.
        child.stdin.end(JSON.stringify(payload))
      })
    },
  }
}
