import type { McpServer } from '@modelcontextprotocol/server'
import { HelperError } from '../errors.js'
import { computeFreeSlots, validateFreeTimeInput } from '../freeTime.js'
import type { HelperRunner } from '../helper.js'
import { findFreeTimeInput, listEventsOutput } from '../schemas.js'
import { respond } from './respond.js'

export function registerFindFreeTime(server: McpServer, runner: HelperRunner): void {
  server.registerTool(
    'find_free_time',
    {
      description:
        'Finds free slots of at least durationMinutes. activityDomain controls days and hours together: work means Mon-Fri 09:00-18:00, personal every day at the same hours, unrestricted every day around the clock. workingHours overrides only the hours. Returns the free gaps, not the busy events — use list_events for those. Creates nothing.',
      inputSchema: findFreeTimeInput,
      annotations: {
        title: 'Find free time',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) =>
      respond(async () => {
        const freeTimeOptions = {
          start: input.start,
          end: input.end,
          durationMinutes: input.durationMinutes,
          activityDomain: input.activityDomain,
          workingHours: input.workingHours,
          ignoreAllDay: input.ignoreAllDay,
        }

        // Validieren, bevor der Helper gestartet wird: eine ungültige
        // Eingabe (z. B. workingHours.end vor workingHours.start) soll nicht
        // erst einen Subprozess starten und den ganzen Kalender lesen, bevor
        // sie als Fehler auffällt.
        const validationError = validateFreeTimeInput(freeTimeOptions)
        if (validationError !== undefined) {
          throw new HelperError('INVALID_INPUT', validationError)
        }

        // Bewusst ohne maxResults: fuer korrekte Slots werden alle Events des
        // Fensters gebraucht, nicht nur die ersten N.
        const raw = await runner.run('list-events', {
          start: input.start,
          end: input.end,
          calendarIds: input.calendarIds,
        })
        const { events } = listEventsOutput.parse(raw)
        return computeFreeSlots(events, freeTimeOptions)
      }),
  )
}
