import type { McpServer } from '@modelcontextprotocol/server'
import type { HelperRunner } from '../helper.js'
import { updateEventInput, updateEventOutput } from '../schemas.js'
import { respond } from './respond.js'

export function registerUpdateEvent(server: McpServer, runner: HelperRunner): void {
  server.registerTool(
    'update_event',
    {
      description:
        'Changes an existing event. Only the fields you pass are changed; anything left out keeps its current value. Get eventIdentifier from list_events. For a recurring event, also pass occurrenceDate to name the instance and span to say how far the change reaches — this affects only that occurrence, future affects it and every later one. Read-only calendars are rejected. Alarms, if given, replace all existing ones.',
      inputSchema: updateEventInput,
      annotations: {
        title: 'Update event',
        readOnlyHint: false,
        // Ueberschreibt bestehende Werte — im Unterschied zu create_event,
        // das nur hinzufuegt. Clients trennen danach, ob sie vorher fragen.
        destructiveHint: true,
        // Zweimal dieselbe Aenderung fuehrt zwar zum selben Zustand, aber bei
        // span: future haengt das Ergebnis davon ab, welche Instanz gerade
        // die erste kuenftige ist. Nicht als idempotent versprechen.
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) =>
      respond(async () => {
        const raw = await runner.run('update-event', {
          eventIdentifier: input.eventIdentifier,
          occurrenceDate: input.occurrenceDate,
          span: input.span,
          title: input.title,
          start: input.start,
          end: input.end,
          allDay: input.allDay,
          location: input.location,
          notes: input.notes,
          url: input.url,
          alarmMinutesBefore: input.alarmMinutesBefore,
        })
        return updateEventOutput.parse(raw).event
      }),
  )
}
