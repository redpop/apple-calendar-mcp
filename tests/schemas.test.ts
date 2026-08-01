import { describe, expect, it } from 'vitest'
import {
  createEventInput,
  findFreeTimeInput,
  listEventsInput,
  listEventsOutput,
} from '../src/schemas.js'

describe('listEventsInput', () => {
  it('akzeptiert ISO-Zeitpunkte mit Offset und setzt maxResults auf 200', () => {
    const parsed = listEventsInput.parse({
      start: '2026-08-01T00:00:00+02:00',
      end: '2026-08-31T23:59:59+02:00',
    })
    expect(parsed.maxResults).toBe(200)
  })

  it('lehnt unlesbare Datumsangaben ab', () => {
    expect(() =>
      listEventsInput.parse({ start: 'irgendwann', end: '2026-08-31T23:59:59+02:00' }),
    ).toThrow()
  })

  it('lehnt maxResults von null ab', () => {
    expect(() =>
      listEventsInput.parse({
        start: '2026-08-01T00:00:00+02:00',
        end: '2026-08-31T23:59:59+02:00',
        maxResults: 0,
      }),
    ).toThrow()
  })
})

describe('createEventInput', () => {
  it('setzt allDay standardmäßig auf false', () => {
    const parsed = createEventInput.parse({
      title: 'Zahnarzt',
      start: '2026-08-05T10:00:00+02:00',
      end: '2026-08-05T11:00:00+02:00',
    })
    expect(parsed.allDay).toBe(false)
  })

  it('lehnt einen leeren Titel ab', () => {
    expect(() =>
      createEventInput.parse({
        title: '',
        start: '2026-08-05T10:00:00+02:00',
        end: '2026-08-05T11:00:00+02:00',
      }),
    ).toThrow()
  })

  it('lehnt negative Alarmangaben ab', () => {
    expect(() =>
      createEventInput.parse({
        title: 'Test',
        start: '2026-08-05T10:00:00+02:00',
        end: '2026-08-05T11:00:00+02:00',
        alarmMinutesBefore: [-5],
      }),
    ).toThrow()
  })
})

describe('findFreeTimeInput', () => {
  it('setzt activityDomain auf work und ignoreAllDay auf true', () => {
    const parsed = findFreeTimeInput.parse({
      start: '2026-08-03T00:00:00+02:00',
      end: '2026-08-07T23:59:59+02:00',
      durationMinutes: 120,
    })
    expect(parsed.activityDomain).toBe('work')
    expect(parsed.ignoreAllDay).toBe(true)
  })

  it('lehnt eine unbekannte activityDomain ab', () => {
    expect(() =>
      findFreeTimeInput.parse({
        start: '2026-08-03T00:00:00+02:00',
        end: '2026-08-07T23:59:59+02:00',
        durationMinutes: 120,
        activityDomain: 'nachts',
      }),
    ).toThrow()
  })

  it('lehnt Arbeitszeiten im falschen Format ab', () => {
    expect(() =>
      findFreeTimeInput.parse({
        start: '2026-08-03T00:00:00+02:00',
        end: '2026-08-07T23:59:59+02:00',
        durationMinutes: 120,
        workingHours: { start: '9:00', end: '18:00' },
      }),
    ).toThrow()
  })
})

describe('listEventsOutput', () => {
  it('validiert eine vollständige Helper-Antwort', () => {
    const parsed = listEventsOutput.parse({
      events: [
        {
          id: 'ABC::2026-08-05T10:00:00+02:00',
          eventIdentifier: 'ABC',
          occurrenceDate: '2026-08-05T10:00:00+02:00',
          calendarId: 'DEF',
          calendarTitle: 'Privat',
          title: 'Zahnarzt',
          start: '2026-08-05T10:00:00+02:00',
          end: '2026-08-05T11:00:00+02:00',
          allDay: false,
          startDay: null,
          endDay: null,
          location: null,
          notes: null,
          url: null,
          isRecurring: false,
          status: 'confirmed',
        },
      ],
      totalMatched: 1,
      truncated: false,
    })
    expect(parsed.events).toHaveLength(1)
  })

  it('lehnt eine Antwort ohne truncated-Flag ab', () => {
    expect(() => listEventsOutput.parse({ events: [], totalMatched: 0 })).toThrow()
  })
})
