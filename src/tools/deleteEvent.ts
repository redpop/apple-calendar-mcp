import type { McpServer } from '@modelcontextprotocol/server'
import type { HelperRunner } from '../helper.js'
import { deleteEventInput, deleteEventOutput } from '../schemas.js'
import { respond } from './respond.js'

export function registerDeleteEvent(server: McpServer, runner: HelperRunner): void {
  server.registerTool(
    'delete_event',
    {
      description:
        'Deletes an event. Get eventIdentifier from list_events. For a recurring event, also pass occurrenceDate to name the instance and span to say how far the deletion reaches — this removes only that occurrence, future removes it and every later one. There is no undo, and span is not optional for recurring events for that reason. Read-only calendars are rejected. Returns the event as it was before deletion.',
      inputSchema: deleteEventInput,
      annotations: {
        title: 'Delete event',
        readOnlyHint: false,
        destructiveHint: true,
        // Zweimal geloescht bleibt geloescht — der zweite Aufruf meldet
        // EVENT_NOT_FOUND, richtet aber nichts weiter an.
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) =>
      respond(async () => {
        const raw = await runner.run('delete-event', {
          eventIdentifier: input.eventIdentifier,
          occurrenceDate: input.occurrenceDate,
          span: input.span,
        })
        return deleteEventOutput.parse(raw)
      }),
  )
}
