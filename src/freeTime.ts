export type ActivityDomain = 'work' | 'personal' | 'unrestricted'

export interface WorkingHours {
  start: string
  end: string
}

export interface BusyEvent {
  start: string
  end: string
  allDay: boolean
  status: string
}

export interface FreeSlot {
  start: string
  end: string
}

export interface FreeTimeOptions {
  start: string
  end: string
  durationMinutes: number
  activityDomain: ActivityDomain
  workingHours?: WorkingHours | undefined
  ignoreAllDay: boolean
}

interface Span {
  start: number
  end: number
}

/** Wochentage nach Date#getDay: 0 = Sonntag. Zeiten in Minuten seit Mitternacht. */
const DOMAIN_PROFILES: Record<ActivityDomain, { days: number[]; from: number; to: number }> = {
  work: { days: [1, 2, 3, 4, 5], from: 9 * 60, to: 18 * 60 },
  personal: { days: [0, 1, 2, 3, 4, 5, 6], from: 9 * 60, to: 18 * 60 },
  unrestricted: { days: [0, 1, 2, 3, 4, 5, 6], from: 0, to: 24 * 60 },
}

/** ISO 8601 mit lokalem Offset — nicht UTC, damit Claude die Zeitzone sieht. */
export function toLocalISO(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  return (
    `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  )
}

function parseClock(value: string, field: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (match === null) {
    throw new Error(`${field} muss im Format HH:MM vorliegen, war: ${value}`)
  }
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const total = hours * 60 + minutes
  if (minutes > 59 || total > 24 * 60) {
    throw new Error(`${field} liegt außerhalb eines Tages: ${value}`)
  }
  return total
}

function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start)
  const merged: Span[] = []
  for (const span of sorted) {
    const last = merged[merged.length - 1]
    if (last !== undefined && span.start <= last.end) {
      last.end = Math.max(last.end, span.end)
    } else {
      merged.push({ ...span })
    }
  }
  return merged
}

function subtractBusy(window: Span, busy: Span[]): Span[] {
  const free: Span[] = []
  let cursor = window.start
  for (const span of busy) {
    if (span.end <= cursor) continue
    if (span.start >= window.end) break
    if (span.start > cursor) {
      free.push({ start: cursor, end: Math.min(span.start, window.end) })
    }
    cursor = Math.max(cursor, span.end)
    if (cursor >= window.end) break
  }
  if (cursor < window.end) {
    free.push({ start: cursor, end: window.end })
  }
  return free
}

function dayWindows(rangeStart: Date, rangeEnd: Date, options: FreeTimeOptions): Span[] {
  const profile = DOMAIN_PROFILES[options.activityDomain]
  const from =
    options.workingHours !== undefined
      ? parseClock(options.workingHours.start, 'workingHours.start')
      : profile.from
  const to =
    options.workingHours !== undefined
      ? parseClock(options.workingHours.end, 'workingHours.end')
      : profile.to

  if (to <= from) {
    throw new Error('workingHours.end muss nach workingHours.start liegen.')
  }

  const windows: Span[] = []
  const limit = rangeEnd.getTime()
  const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate())

  while (cursor.getTime() <= limit) {
    if (profile.days.includes(cursor.getDay())) {
      const year = cursor.getFullYear()
      const month = cursor.getMonth()
      const day = cursor.getDate()
      // Stunde 24 normalisiert JavaScript zu 00:00 des Folgetages.
      const windowStart = new Date(year, month, day, Math.floor(from / 60), from % 60).getTime()
      const windowEnd = new Date(year, month, day, Math.floor(to / 60), to % 60).getTime()
      const clippedStart = Math.max(windowStart, rangeStart.getTime())
      const clippedEnd = Math.min(windowEnd, limit)
      if (clippedEnd > clippedStart) {
        windows.push({ start: clippedStart, end: clippedEnd })
      }
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return windows
}

/**
 * Berechnet freie Zeitfenster. Pur: keine Kalender-, Datei- oder Netzwerkzugriffe,
 * damit die Logik ohne EventKit und ohne TCC-Berechtigung testbar bleibt.
 */
export function computeFreeSlots(events: BusyEvent[], options: FreeTimeOptions): FreeSlot[] {
  const rangeStart = new Date(options.start)
  const rangeEnd = new Date(options.end)

  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
    throw new Error('start und end müssen gültige ISO-8601-Zeitpunkte sein.')
  }
  if (rangeEnd.getTime() <= rangeStart.getTime()) {
    throw new Error('end muss nach start liegen.')
  }
  if (options.durationMinutes <= 0) {
    throw new Error('durationMinutes muss größer als null sein.')
  }

  const busy = mergeSpans(
    events
      .filter((event) => event.status !== 'canceled')
      .filter((event) => !(options.ignoreAllDay && event.allDay))
      .map((event) => ({ start: Date.parse(event.start), end: Date.parse(event.end) }))
      .filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end) && span.end > span.start),
  )

  const minimum = options.durationMinutes * 60_000
  const found: Span[] = []

  for (const window of dayWindows(rangeStart, rangeEnd, options)) {
    for (const slot of subtractBusy(window, busy)) {
      if (slot.end - slot.start >= minimum) {
        found.push(slot)
      }
    }
  }

  return found
    .sort((a, b) => a.start - b.start)
    .map((span) => ({
      start: toLocalISO(new Date(span.start)),
      end: toLocalISO(new Date(span.end)),
    }))
}
