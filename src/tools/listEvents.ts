import type { McpServer } from '@modelcontextprotocol/server'
import type { HelperRunner } from '../helper.js'
import { listEventsInput, listEventsOutput } from '../schemas.js'
import { respond } from './respond.js'

export function registerListEvents(server: McpServer, runner: HelperRunner): void {
  server.registerTool(
    'list_events',
    {
      description:
        'Liest Termine in einem Zeitraum. Wiederholungstermine werden als einzelne Instanzen zurückgegeben. Ganztägige Termine tragen zusätzlich startDay und endDay als reine Datumsangaben, wobei endDay den letzten enthaltenen Tag meint. Ändert nichts. Für freie Zeitfenster statt belegter Termine ist find_free_time zuständig.',
      inputSchema: listEventsInput,
      annotations: {
        title: 'Termine lesen',
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
          hinweis: `Es werden ${String(parsed.events.length)} von ${String(parsed.totalMatched)} Terminen gezeigt. Grenze den Zeitraum ein, nutze query oder erhöhe maxResults.`,
        }
      }),
  )
}
