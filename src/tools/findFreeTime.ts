import type { McpServer } from '@modelcontextprotocol/server'
import { computeFreeSlots } from '../freeTime.js'
import type { HelperRunner } from '../helper.js'
import { findFreeTimeInput, listEventsOutput } from '../schemas.js'
import { respond } from './respond.js'

export function registerFindFreeTime(server: McpServer, runner: HelperRunner): void {
  server.registerTool(
    'find_free_time',
    {
      description:
        'Findet freie Zeitfenster von mindestens durationMinutes Länge. activityDomain steuert Tage und Uhrzeiten gemeinsam: work bedeutet Mo bis Fr von 09:00 bis 18:00, personal alle Tage zu denselben Zeiten, unrestricted alle Tage rund um die Uhr. workingHours überschreibt nur die Uhrzeiten. Liefert freie Lücken, nicht die belegten Termine — für die ist list_events zuständig. Legt nichts an.',
      inputSchema: findFreeTimeInput,
      annotations: {
        title: 'Freie Zeit finden',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) =>
      respond(async () => {
        // Bewusst ohne maxResults: fuer korrekte Slots werden alle Events des
        // Fensters gebraucht, nicht nur die ersten N.
        const raw = await runner.run('list-events', {
          start: input.start,
          end: input.end,
          calendarIds: input.calendarIds,
        })
        const { events } = listEventsOutput.parse(raw)
        return computeFreeSlots(events, {
          start: input.start,
          end: input.end,
          durationMinutes: input.durationMinutes,
          activityDomain: input.activityDomain,
          workingHours: input.workingHours,
          ignoreAllDay: input.ignoreAllDay,
        })
      }),
  )
}
