import type { McpServer } from '@modelcontextprotocol/server'
import type { HelperRunner } from '../helper.js'
import { listEventsInput, listEventsOutput } from '../schemas.js'
import { respond } from './respond.js'

export function registerListEvents(server: McpServer, runner: HelperRunner): void {
  server.registerTool(
    'list_events',
    {
      description:
        'Reads events in a date range. Recurring events are returned as individual occurrences. All-day events additionally carry startDay and endDay as plain dates, where endDay means the last day included. Changes nothing. For free gaps rather than busy events, use find_free_time.',
      inputSchema: listEventsInput,
      annotations: {
        title: 'Read events',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) =>
      respond(async () => {
        const raw = await runner.run('list-events', {
          start: input.start,
          end: input.end,
          calendarIds: input.calendarIds,
          query: input.query,
          maxResults: input.maxResults,
        })
        const parsed = listEventsOutput.parse(raw)
        if (!parsed.truncated) return parsed
        // Ein Klartextsatz wirkt zuverlaessiger als ein blosses Boolean-Feld:
        // sonst besteht die Gefahr, eine abgeschnittene Liste als vollstaendig
        // zu behandeln.
        return {
          ...parsed,
          note: `Showing ${String(parsed.events.length)} of ${String(parsed.totalMatched)} events. Narrow the date range, use query, or raise maxResults.`,
        }
      }),
  )
}
