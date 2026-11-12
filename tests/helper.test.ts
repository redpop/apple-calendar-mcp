import { afterEach, describe, expect, it } from 'vitest'
import { createHelperRunner, packagedHelperPath, resolveHelperPath } from '../src/helper.js'

afterEach(() => {
  delete process.env.APPLE_CALENDAR_HELPER_PATH
})

describe('packagedHelperPath', () => {
  it('zeigt auf bin/calendar-helper im Paket', () => {
    expect(packagedHelperPath().endsWith('/bin/calendar-helper')).toBe(true)
  })
})

describe('resolveHelperPath', () => {
  it('bevorzugt die Umgebungsvariable', () => {
    process.env.APPLE_CALENDAR_HELPER_PATH = '/tmp/eigener-pfad'
    expect(resolveHelperPath()).toBe('/tmp/eigener-pfad')
  })

  // Ohne Override kopiert resolveHelperPath() das Binary an seinen festen
  // Installationsort — ein Schreibvorgang im Home-Verzeichnis, der in einer
  // Testsuite nichts zu suchen hat. Die Kopierlogik selbst ist in
  // tests/helperInstall.test.ts gegen temporaere Verzeichnisse abgedeckt.
})

describe('createHelperRunner', () => {
  // Der Pfad wird erst beim Start des Helpers aufgeloest, nicht beim
  // Erzeugen des Runners — sonst saehe ein spaeterer Start nicht die Kopie,
  // die eine parallel laufende andere Version inzwischen installiert hat.
  it('loest den Pfad erst beim ersten Aufruf auf', async () => {
    process.env.APPLE_CALENDAR_HELPER_PATH = '/tmp/gibt-es-nicht-beim-erzeugen'
    const runner = createHelperRunner()
    process.env.APPLE_CALENDAR_HELPER_PATH = '/tmp/gibt-es-nicht-beim-aufruf'
    try {
      await expect(runner.run('list-calendars', {})).rejects.toMatchObject({
        code: 'HELPER_MISSING',
        message: expect.stringContaining('/tmp/gibt-es-nicht-beim-aufruf') as unknown,
      })
    } finally {
      runner.stop()
    }
  })
})
