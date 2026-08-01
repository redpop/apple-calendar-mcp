import * as z from 'zod/v4'

/**
 * Bewusst keine strenge Regex: Date.parse deckt alle ISO-8601-Varianten ab,
 * die EventKit liefert, und die Fehlermeldung bleibt fuer Claude verstaendlich.
 */
const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message:
      'Muss ein ISO-8601-Zeitpunkt mit Zeitzonen-Offset sein, zum Beispiel 2026-08-05T10:00:00+02:00',
  })

const clockTime = z
  .string()
  .regex(/^\d{2}:\d{2}$/, 'Muss im Format HH:MM vorliegen, zum Beispiel 09:00')

// MARK: Tool-Eingaben

export const listCalendarsInput = z.object({})

export const listEventsInput = z.object({
  start: isoDateTime.describe('Beginn des Zeitraums, ISO 8601 mit Offset'),
  end: isoDateTime.describe('Ende des Zeitraums, ISO 8601 mit Offset'),
  calendarIds: z.array(z.string()).optional().describe('Nur diese Kalender; Standard: alle'),
  query: z.string().optional().describe('Freitextfilter auf Titel und Notizen'),
  maxResults: z
    .number()
    .int()
    .positive()
    .default(200)
    .describe('Obergrenze der zurückgegebenen Termine'),
})

export const createEventInput = z.object({
  title: z.string().min(1).describe('Titel des Termins'),
  start: isoDateTime.describe('Beginn, ISO 8601 mit Offset'),
  end: isoDateTime.describe('Ende, ISO 8601 mit Offset'),
  calendarId: z.string().optional().describe('Zielkalender; Standard: Standardkalender'),
  allDay: z
    .boolean()
    .default(false)
    .describe('Ganztägiger Termin. Bei true zählen nur die Kalendertage von start und end.'),
  location: z.string().optional().describe('Ortsangabe, wie sie in Calendar.app erscheint'),
  notes: z.string().optional().describe('Freitext-Notiz zum Termin'),
  url: z.string().optional().describe('Verknüpfte Adresse, zum Beispiel ein Meeting-Link'),
  alarmMinutesBefore: z
    .array(z.number().int().nonnegative())
    .optional()
    .describe(
      'Erinnerungen in Minuten vor Beginn. Bei ganztägigen Terminen auf ganze Tage abgerundet und auf 09:00 gelegt, wie in Calendar.app.',
    ),
})

export const findFreeTimeInput = z.object({
  start: isoDateTime.describe('Beginn des Suchfensters'),
  end: isoDateTime.describe('Ende des Suchfensters'),
  durationMinutes: z.number().int().positive().describe('Benötigte Dauer in Minuten'),
  calendarIds: z.array(z.string()).optional().describe('Diese Kalender gelten als belegt'),
  activityDomain: z
    .enum(['work', 'personal', 'unrestricted'])
    .default('work')
    .describe(
      'work: Mo–Fr 09:00–18:00. personal: alle Tage 09:00–18:00. unrestricted: alle Tage rund um die Uhr.',
    ),
  workingHours: z
    .object({ start: clockTime, end: clockTime })
    .optional()
    .describe('Überschreibt nur die Uhrzeiten der activityDomain, nicht die Tagesauswahl'),
  ignoreAllDay: z
    .boolean()
    .default(true)
    .describe('Ganztägige Termine zählen nicht als belegt'),
})

// MARK: Antworten der Swift-CLI

export const eventSchema = z.object({
  id: z.string(),
  eventIdentifier: z.string(),
  occurrenceDate: z.string(),
  calendarId: z.string(),
  calendarTitle: z.string(),
  title: z.string(),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  startDay: z.string().nullable(),
  endDay: z.string().nullable(),
  location: z.string().nullable(),
  notes: z.string().nullable(),
  url: z.string().nullable(),
  isRecurring: z.boolean(),
  status: z.string(),
})

export const calendarSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  source: z.string().nullable(),
  color: z.string().nullable(),
  allowsModifications: z.boolean(),
})

export const listCalendarsOutput = z.object({ calendars: z.array(calendarSchema) })

export const listEventsOutput = z.object({
  events: z.array(eventSchema),
  totalMatched: z.number(),
  truncated: z.boolean(),
})

export const createEventOutput = z.object({ event: eventSchema })

// MARK: Abgeleitete Typen

export type ListEventsInput = z.infer<typeof listEventsInput>
export type CreateEventInput = z.infer<typeof createEventInput>
export type FindFreeTimeInput = z.infer<typeof findFreeTimeInput>
export type CalendarEvent = z.infer<typeof eventSchema>
