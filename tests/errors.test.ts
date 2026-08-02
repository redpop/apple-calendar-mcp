import { describe, expect, it } from 'vitest'
import { HelperError, describeError } from '../src/errors.js'

describe('describeError', () => {
  it('erklärt fehlende Berechtigung mit konkretem Handlungsschritt', () => {
    const message = describeError('PERMISSION_DENIED')
    expect(message).toContain('Privacy & Security')
  })

  it('verweist bei unbekanntem Kalender auf list_calendars', () => {
    expect(describeError('CALENDAR_NOT_FOUND')).toContain('list_calendars')
  })

  it('hängt Details an, wenn vorhanden', () => {
    const message = describeError('SAVE_FAILED', 'Datenbank gesperrt')
    expect(message).toContain('Datenbank gesperrt')
  })

  it('lässt Details weg, wenn sie leer sind', () => {
    expect(describeError('SAVE_FAILED', '')).not.toContain('Details')
  })

  it('fällt bei unbekanntem Code auf eine allgemeine Meldung zurück', () => {
    const message = describeError('VOELLIG_UNBEKANNT')
    expect(message).toContain('unexpected error')
  })

  it('gibt niemals einen Stacktrace zurück', () => {
    expect(describeError('PERMISSION_DENIED')).not.toContain('    at ')
  })
})

describe('HelperError', () => {
  it('trägt den Code als Eigenschaft', () => {
    const error = new HelperError('CALENDAR_READONLY', 'Kalender X')
    expect(error.code).toBe('CALENDAR_READONLY')
    expect(error).toBeInstanceOf(Error)
  })
})
