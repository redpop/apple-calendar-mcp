import type { McpServer } from '@modelcontextprotocol/server'
import type { HelperRunner } from '../helper.js'
import { createEventInput, createEventOutput } from '../schemas.js'
import { respond } from './respond.js'

export function registerCreateEvent(server: McpServer, runner: HelperRunner): void {
  server.registerTool(
    'create_event',
    {
      description:
        'Legt einen neuen Termin an. Ohne calendarId wird der Standardkalender verwendet. Schreibgeschützte Kalender werden abgelehnt. Bei ganztägigen Terminen werden Erinnerungen auf ganze Tage abgerundet und wie in Calendar.app auf 09:00 gelegt. Ändert oder löscht keine bestehenden Termine — beides ist derzeit nicht möglich.',
      inputSchema: createEventInput,
      annotations: {
        title: 'Termin anlegen',
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
