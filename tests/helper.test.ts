import { afterEach, describe, expect, it } from 'vitest'
import { packagedHelperPath, resolveHelperPath } from '../src/helper.js'

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
