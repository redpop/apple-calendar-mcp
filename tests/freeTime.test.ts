import { describe, expect, it } from 'vitest'
import { computeFreeSlots, type BusyEvent, type FreeTimeOptions } from '../src/freeTime.js'

function busy(start: string, end: string, extra: Partial<BusyEvent> = {}): BusyEvent {
  return { start, end, allDay: false, status: 'confirmed', ...extra }
}

function options(overrides: Partial<FreeTimeOptions> = {}): FreeTimeOptions {
  return {
    start: '2026-08-03T00:00:00+02:00',
    end: '2026-08-03T23:59:59+02:00',
    durationMinutes: 60,
    activityDomain: 'work',
    ignoreAllDay: true,
    ...overrides,
  }
}

describe('computeFreeSlots — Grundfälle', () => {
  it('liefert das ganze Arbeitszeitfenster, wenn nichts belegt ist', () => {
    const slots = computeFreeSlots([], options())
    expect(slots).toHaveLength(1)
    expect(slots[0]?.start).toBe('2026-08-03T09:00:00+02:00')
    expect(slots[0]?.end).toBe('2026-08-03T18:00:00+02:00')
  })

  it('teilt das Fenster an einem belegten Termin', () => {
    const slots = computeFreeSlots(
      [busy('2026-08-03T12:00:00+02:00', '2026-08-03T13:00:00+02:00')],
      options(),
    )
    expect(slots).toHaveLength(2)
    expect(slots[0]?.end).toBe('2026-08-03T12:00:00+02:00')
    expect(slots[1]?.start).toBe('2026-08-03T13:00:00+02:00')
  })

  it('gibt nichts zurück, wenn das Fenster komplett belegt ist', () => {
    const slots = computeFreeSlots(
      [busy('2026-08-03T08:00:00+02:00', '2026-08-03T19:00:00+02:00')],
      options(),
    )
    expect(slots).toEqual([])
  })

  it('führt überlappende Termine zu einem Block zusammen', () => {
    const slots = computeFreeSlots(
      [
        busy('2026-08-03T10:00:00+02:00', '2026-08-03T12:00:00+02:00'),
        busy('2026-08-03T11:00:00+02:00', '2026-08-03T14:00:00+02:00'),
      ],
      options(),
    )
    expect(slots).toHaveLength(2)
    expect(slots[0]?.end).toBe('2026-08-03T10:00:00+02:00')
    expect(slots[1]?.start).toBe('2026-08-03T14:00:00+02:00')
  })

  it('behandelt lückenlos aneinandergrenzende Termine als einen Block', () => {
    const slots = computeFreeSlots(
      [
        busy('2026-08-03T10:00:00+02:00', '2026-08-03T11:00:00+02:00'),
        busy('2026-08-03T11:00:00+02:00', '2026-08-03T12:00:00+02:00'),
      ],
      options(),
    )
    expect(slots).toHaveLength(2)
    expect(slots[1]?.start).toBe('2026-08-03T12:00:00+02:00')
  })
})

describe('computeFreeSlots — Mindestdauer', () => {
  it('behält einen Slot, der exakt der Mindestdauer entspricht', () => {
    const slots = computeFreeSlots(
      [busy('2026-08-03T10:00:00+02:00', '2026-08-03T18:00:00+02:00')],
      options({ durationMinutes: 60 }),
    )
    expect(slots).toHaveLength(1)
    expect(slots[0]?.start).toBe('2026-08-03T09:00:00+02:00')
  })

  it('verwirft einen Slot, der eine Minute zu kurz ist', () => {
    const slots = computeFreeSlots(
      [busy('2026-08-03T09:59:00+02:00', '2026-08-03T18:00:00+02:00')],
      options({ durationMinutes: 60 }),
    )
    expect(slots).toEqual([])
  })
})

describe('computeFreeSlots — ganztägige und abgesagte Termine', () => {
  it('ignoriert ganztägige Termine bei ignoreAllDay', () => {
    const slots = computeFreeSlots(
      [busy('2026-08-03T00:00:00+02:00', '2026-08-03T23:59:59+02:00', { allDay: true })],
      options({ ignoreAllDay: true }),
    )
    expect(slots).toHaveLength(1)
  })

  it('wertet ganztägige Termine als belegt, wenn ignoreAllDay false ist', () => {
    const slots = computeFreeSlots(
      [busy('2026-08-03T00:00:00+02:00', '2026-08-03T23:59:59+02:00', { allDay: true })],
      options({ ignoreAllDay: false }),
    )
    expect(slots).toEqual([])
  })

  it('ignoriert abgesagte Termine immer', () => {
    const slots = computeFreeSlots(
      [busy('2026-08-03T09:00:00+02:00', '2026-08-03T18:00:00+02:00', { status: 'canceled' })],
      options(),
    )
    expect(slots).toHaveLength(1)
  })

  it('behandelt status "none" als belegt — das liefert reales EventKit für gewöhnliche Termine', () => {
    // Live-Kalenderdaten (.superpowers/events-august.json) zeigen "none" als
    // status-Wert für normale, nicht abgesagte Termine — nicht "confirmed".
    // Nur "canceled" darf Termine von "belegt" ausnehmen.
    const slots = computeFreeSlots(
      [busy('2026-08-03T08:00:00+02:00', '2026-08-03T19:00:00+02:00', { status: 'none' })],
      options(),
    )
    expect(slots).toEqual([])
  })
})

describe('computeFreeSlots — activityDomain', () => {
  const weekend = { start: '2026-08-08T00:00:00+02:00', end: '2026-08-09T23:59:59+02:00' }

  it('liefert bei work keine Slots am Wochenende', () => {
    expect(computeFreeSlots([], options({ ...weekend, activityDomain: 'work' }))).toEqual([])
  })

  it('liefert bei personal Slots am Wochenende', () => {
    const slots = computeFreeSlots([], options({ ...weekend, activityDomain: 'personal' }))
    expect(slots).toHaveLength(2)
    expect(slots[0]?.start).toBe('2026-08-08T09:00:00+02:00')
  })

  it('liefert bei unrestricted auch Nachtstunden', () => {
    const slots = computeFreeSlots(
      [],
      options({
        start: '2026-08-03T00:00:00+02:00',
        end: '2026-08-03T23:59:59+02:00',
        activityDomain: 'unrestricted',
      }),
    )
    expect(slots).toHaveLength(1)
    expect(slots[0]?.start).toBe('2026-08-03T00:00:00+02:00')
  })

  it('überschreibt mit workingHours nur die Uhrzeit, nicht die Tagesauswahl', () => {
    const weekendSlots = computeFreeSlots(
      [],
      options({ ...weekend, activityDomain: 'work', workingHours: { start: '20:00', end: '22:00' } }),
    )
    expect(weekendSlots).toEqual([])

    const weekdaySlots = computeFreeSlots(
      [],
      options({ activityDomain: 'work', workingHours: { start: '20:00', end: '22:00' } }),
    )
    expect(weekdaySlots).toHaveLength(1)
    expect(weekdaySlots[0]?.start).toBe('2026-08-03T20:00:00+02:00')
  })
})

describe('computeFreeSlots — mehrere Tage', () => {
  it('liefert für eine Arbeitswoche fünf Slots und überspringt das Wochenende', () => {
    const slots = computeFreeSlots(
      [],
      options({ start: '2026-08-03T00:00:00+02:00', end: '2026-08-09T23:59:59+02:00' }),
    )
    expect(slots).toHaveLength(5)
    expect(slots[0]?.start).toBe('2026-08-03T09:00:00+02:00')
    expect(slots[4]?.start).toBe('2026-08-07T09:00:00+02:00')
  })

  it('beschneidet das erste Fenster am Suchbeginn', () => {
    const slots = computeFreeSlots(
      [],
      options({ start: '2026-08-03T11:30:00+02:00', end: '2026-08-03T23:59:59+02:00' }),
    )
    expect(slots[0]?.start).toBe('2026-08-03T11:30:00+02:00')
  })

  it('gibt die Slots in zeitlicher Reihenfolge zurück', () => {
    const slots = computeFreeSlots(
      [busy('2026-08-04T12:00:00+02:00', '2026-08-04T13:00:00+02:00')],
      options({ start: '2026-08-03T00:00:00+02:00', end: '2026-08-05T23:59:59+02:00' }),
    )
    const starts = slots.map((slot) => slot.start)
    expect([...starts].sort()).toEqual(starts)
  })
})

describe('computeFreeSlots — ungültige Eingaben', () => {
  it('wirft, wenn end vor start liegt', () => {
    expect(() =>
      computeFreeSlots([], options({ start: '2026-08-05T00:00:00+02:00', end: '2026-08-03T00:00:00+02:00' })),
    ).toThrow()
  })

  it('wirft bei einer Dauer von null', () => {
    expect(() => computeFreeSlots([], options({ durationMinutes: 0 }))).toThrow()
  })

  it('wirft, wenn workingHours.end nicht nach workingHours.start liegt', () => {
    expect(() =>
      computeFreeSlots([], options({ workingHours: { start: '18:00', end: '09:00' } })),
    ).toThrow()
  })
})

describe('computeFreeSlots — bufferMinutes', () => {
  it('laesst das Ergebnis unveraendert, wenn der Puffer null ist', () => {
    const events = [busy('2026-08-03T12:00:00+02:00', '2026-08-03T13:00:00+02:00')]
    const ohne = computeFreeSlots(events, options())
    const mitNull = computeFreeSlots(events, options({ bufferMinutes: 0 }))
    expect(mitNull).toEqual(ohne)
  })

  it('verkleinert die Luecken um den Puffer auf beiden Seiten', () => {
    const slots = computeFreeSlots(
      [busy('2026-08-03T12:00:00+02:00', '2026-08-03T13:00:00+02:00')],
      options({ bufferMinutes: 15 }),
    )
    expect(slots).toHaveLength(2)
    expect(slots[0]?.end).toBe('2026-08-03T11:45:00+02:00')
    expect(slots[1]?.start).toBe('2026-08-03T13:15:00+02:00')
  })

  it('laesst eine Luecke ganz verschwinden, wenn der Puffer sie aufzehrt', () => {
    // Zwei Termine mit 60 Minuten Abstand; 40 Minuten Puffer auf jeder Seite
    // lassen 0 Minuten uebrig, gefordert ist eine Stunde.
    const slots = computeFreeSlots(
      [
        busy('2026-08-03T10:00:00+02:00', '2026-08-03T11:00:00+02:00'),
        busy('2026-08-03T12:00:00+02:00', '2026-08-03T13:00:00+02:00'),
      ],
      options({ bufferMinutes: 40, durationMinutes: 30 }),
    )
    const mittags = slots.find((slot) => slot.start.includes('T11:'))
    expect(mittags).toBeUndefined()
  })

  it('verschmilzt Termine, deren Puffer sich ueberlappen, statt doppelt abzuziehen', () => {
    // 30 Minuten Abstand, 20 Minuten Puffer: die aufgeweiteten Spans
    // ueberlappen sich und muessen zu einem Block werden. Ein doppelter Abzug
    // wuerde den Nachmittag faelschlich spaeter beginnen lassen.
    const slots = computeFreeSlots(
      [
        busy('2026-08-03T10:00:00+02:00', '2026-08-03T11:00:00+02:00'),
        busy('2026-08-03T11:30:00+02:00', '2026-08-03T12:30:00+02:00'),
      ],
      options({ bufferMinutes: 20, durationMinutes: 30 }),
    )
    expect(slots).toHaveLength(2)
    expect(slots[0]?.end).toBe('2026-08-03T09:40:00+02:00')
    expect(slots[1]?.start).toBe('2026-08-03T12:50:00+02:00')
  })

  it('dehnt das Arbeitszeitfenster nicht ueber seine Grenzen hinaus', () => {
    // Nichts liegt vor 09:00, also darf der Puffer den Fensteranfang nicht
    // nach vorn schieben — 09:00 bleibt 09:00.
    const slots = computeFreeSlots([], options({ bufferMinutes: 30 }))
    expect(slots).toHaveLength(1)
    expect(slots[0]?.start).toBe('2026-08-03T09:00:00+02:00')
    expect(slots[0]?.end).toBe('2026-08-03T18:00:00+02:00')
  })

  it('beschneidet den Fensteranfang, wenn ein Termin davor hineinragt', () => {
    // Ein Termin, der um 08:45 endet, liegt ausserhalb des Arbeitszeitfensters
    // — sein Puffer reicht aber hinein. Ohne diese Beruecksichtigung wuerde
    // ein Slot vorgeschlagen, der unmittelbar an ein Meeting grenzt.
    const slots = computeFreeSlots(
      [busy('2026-08-03T08:00:00+02:00', '2026-08-03T08:45:00+02:00')],
      options({ bufferMinutes: 30 }),
    )
    expect(slots).toHaveLength(1)
    expect(slots[0]?.start).toBe('2026-08-03T09:15:00+02:00')
  })

  it('erzeugt keinen Puffer um ganztaegige Termine, die ignoriert werden', () => {
    const slots = computeFreeSlots(
      [busy('2026-08-03T00:00:00+02:00', '2026-08-03T23:59:59+02:00', { allDay: true })],
      options({ bufferMinutes: 60, ignoreAllDay: true }),
    )
    expect(slots).toHaveLength(1)
    expect(slots[0]?.start).toBe('2026-08-03T09:00:00+02:00')
  })

  it('erzeugt keinen Puffer um abgesagte Termine', () => {
    const slots = computeFreeSlots(
      [busy('2026-08-03T12:00:00+02:00', '2026-08-03T13:00:00+02:00', { status: 'canceled' })],
      options({ bufferMinutes: 60 }),
    )
    expect(slots).toHaveLength(1)
  })
})
