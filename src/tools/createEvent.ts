import type { McpServer } from '@modelcontextprotocol/server'
import type { HelperRunner } from '../helper.js'
import { createEventInput, createEventOutput } from '../schemas.js'
import { respond } from './respond.js'

export function registerCreateEvent(server: McpServer, runner: HelperRunner): void {
  server.registerTool(
    'create_event',
    {
      description:
        'Creates a new event. Without calendarId the default calendar is used. Read-only calendars are rejected. For all-day events, alarms are floored to whole days and placed at 09:00, matching Calendar.app.',
      inputSchema: createEventInput,
      annotations: {
        title: 'Create event',
        readOnlyHint: false,
        // Legt ausschliesslich neu an; ueberschreibt und loescht nichts.
        destructiveHint: false,
        // Zweimal aufgerufen entstehen zwei Termine.
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) =>
      respond(async () => {
        const raw = await runner.run('create-event', {
          title: input.title,
          start: input.start,
          end: input.end,
          calendarId: input.calendarId,
          allDay: input.allDay,
          location: input.location,
          notes: input.notes,
          url: input.url,
          alarmMinutesBefore: input.alarmMinutesBefore,
        })
        return createEventOutput.parse(raw).event
      }),
  )
}
