import { fileURLToPath } from 'node:url'
import { createStdioRunner, type StdioHelperRunner } from './stdioRunner.js'

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
 * Es gibt genau einen Transport: `calendar-helper serve` laeuft als
 * langlebiger Kindprozess und spricht NDJSON ueber stdin/stdout.
 *
 * Frueher gab es hier eine Fallunterscheidung zwischen einem Unix-Socket zu
 * einem LaunchAgent und einem Spawn pro Aufruf. Beides ist entfallen, seit
 * der Helper sich beim Start selbst TCC-verantwortlich macht: Er braucht
 * keine eigene Anmeldung beim System mehr, um eine eigene Berechtigungs-
 * identitaet zu haben. Damit gibt es auch nichts mehr, worauf ausgewichen
 * werden koennte — und keinen Installationsschritt vor dem ersten Start.
 */
export function createHelperRunner(helperPath: string = resolveHelperPath()): StdioHelperRunner {
  return createStdioRunner(helperPath)
}
