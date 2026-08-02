import * as z from 'zod/v4'

/**
 * Bewusst keine strenge Regex: Date.parse deckt alle ISO-8601-Varianten ab,
 * die EventKit liefert, und die Fehlermeldung bleibt verstaendlich.
 */
const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message:
      'Must be an ISO 8601 timestamp with a timezone offset, for example 2026-08-05T10:00:00+02:00',
  })

const clockTime = z
  .string()
  .regex(/^\d{2}:\d{2}$/, 'Must be in HH:MM format, for example 09:00')

// MARK: Tool-Eingaben

export const listCalendarsInput = z.object({})

export const listEventsInput = z.object({
  start: isoDateTime.describe('Start of the range, ISO 8601 with offset'),
  end: isoDateTime.describe('End of the range, ISO 8601 with offset'),
  calendarIds: z.array(z.string()).optional().describe('Restrict to these calendars. Defaults to all of them.'),
  query: z.string().optional().describe('Free-text filter applied to titles and notes'),
  maxResults: z
    .number()
    .int()
    .positive()
    .default(200)
    .describe('Maximum number of events to return'),
})

export const createEventInput = z.object({
  title: z.string().min(1).describe('Title of the event'),
  start: isoDateTime.describe('Start, ISO 8601 with offset'),
  end: isoDateTime.describe(
    'End, ISO 8601 with offset. For all-day events (allDay: true) both common conventions are accepted and normalised to the same day: the last day included (…T23:59:59) or midnight of the following day (…T00:00:00 of the next date).',
  ),
  calendarId: z.string().optional().describe('Calendar to create the event in. Defaults to the system default calendar.'),
  allDay: z
    .boolean()
    .default(false)
    .describe('All-day event. When true, only the calendar days of start and end are used.'),
  location: z.string().optional().describe('Location, as shown in Calendar.app'),
  notes: z.string().optional().describe('Free-text note attached to the event'),
  url: z.string().optional().describe('Associated URL, for example a meeting link'),
  alarmMinutesBefore: z
    .array(z.number().int().nonnegative())
    .optional()
    .describe(
      'Alarms in minutes before the start. For all-day events these are floored to whole days and placed at 09:00, matching Calendar.app.',
    ),
})

export const findFreeTimeInput = z.object({
  start: isoDateTime.describe('Start of the search window'),
  end: isoDateTime.describe('End of the search window'),
  durationMinutes: z.number().int().positive().describe('Required duration in minutes'),
  calendarIds: z.array(z.string()).optional().describe('Treat these calendars as busy. Defaults to all of them.'),
  activityDomain: z
    .enum(['work', 'personal', 'unrestricted'])
    .default('work')
    .describe(
      'work: Mon-Fri 09:00-18:00. personal: every day 09:00-18:00. unrestricted: every day, around the clock.',
    ),
  workingHours: z
    .object({ start: clockTime, end: clockTime })
    .optional()
    .describe('Overrides only the hours of the activityDomain, not which days it covers'),
  ignoreAllDay: z
    .boolean()
    .default(true)
    .describe('All-day events do not count as busy'),
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
