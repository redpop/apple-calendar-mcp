import { describe, expect, it } from 'vitest'
import { resolveHelperPath } from '../src/helper.js'

describe('resolveHelperPath', () => {
  it('bevorzugt die Umgebungsvariable', () => {
    process.env.APPLE_CALENDAR_HELPER_PATH = '/tmp/eigener-pfad'
    expect(resolveHelperPath()).toBe('/tmp/eigener-pfad')
    delete process.env.APPLE_CALENDAR_HELPER_PATH
  })

  it('zeigt ohne Override auf bin/calendar-helper im Paket', () => {
    delete process.env.APPLE_CALENDAR_HELPER_PATH
    expect(resolveHelperPath().endsWith('/bin/calendar-helper')).toBe(true)
  })
})
