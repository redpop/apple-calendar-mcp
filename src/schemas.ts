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
  bufferMinutes: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe(
      'Free time to keep before and after each busy event, in minutes. Use this when a slot pressed directly between two meetings would not actually be usable.',
    ),
})

/**
 * Wie weit eine Aenderung an einem Wiederholungstermin reicht.
 *
 * EventKit kennt nur diese zwei Weiten. Ein "alle, auch vergangene" gibt es
 * nicht — deshalb `future` statt `all`, damit der Name nicht mehr verspricht,
 * als das System kann.
 */
const eventSpan = z
  .enum(['this', 'future'])
  .describe(
    "How far the change reaches on a recurring event. 'this' affects only the occurrence named by occurrenceDate; 'future' affects that occurrence and every later one. Required for recurring events, ignored otherwise.",
  )

/** Identifiziert einen Termin — bei Serien braucht es beide Felder. */
const eventTarget = {
  eventIdentifier: z
    .string()
    .min(1)
    .describe('Identifier of the event, from list_events. For a recurring event this names the series, not one occurrence.'),
  occurrenceDate: z
    .string()
    .optional()
    .describe('The occurrenceDate of the specific instance, exactly as returned by list_events. Required for recurring events.'),
  span: eventSpan.optional(),
}

export const updateEventInput = z.object({
  ...eventTarget,
  // Alle Felder optional: ein weggelassenes Feld bleibt unveraendert, es
  // wird nicht geleert.
  title: z.string().min(1).optional().describe('New title'),
  start: isoDateTime.optional().describe('New start, ISO 8601 with offset'),
  end: isoDateTime.optional().describe('New end, ISO 8601 with offset'),
  allDay: z.boolean().optional().describe('Turn the event into an all-day event, or back'),
  location: z.string().optional().describe('New location'),
  notes: z.string().optional().describe('New notes, replacing the previous ones'),
  url: z.string().optional().describe('New associated URL'),
  alarmMinutesBefore: z
    .array(z.number().int().nonnegative())
    .optional()
    .describe('Replaces all existing alarms. Pass an empty array to remove them.'),
})

export const deleteEventInput = z.object(eventTarget)

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

export const updateEventOutput = z.object({ event: eventSchema })

export const deleteEventOutput = z.object({
  deleted: eventSchema,
  span: z.enum(['this', 'future']),
})

// MARK: Abgeleitete Typen

export type ListEventsInput = z.infer<typeof listEventsInput>
export type CreateEventInput = z.infer<typeof createEventInput>
export type FindFreeTimeInput = z.infer<typeof findFreeTimeInput>
export type UpdateEventInput = z.infer<typeof updateEventInput>
export type DeleteEventInput = z.infer<typeof deleteEventInput>
export type CalendarEvent = z.infer<typeof eventSchema>
