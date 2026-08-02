import type { McpServer } from '@modelcontextprotocol/server'
import { HelperError } from '../errors.js'
import { computeFreeSlots, toLocalISO, validateFreeTimeInput } from '../freeTime.js'
import type { HelperRunner } from '../helper.js'
import { findFreeTimeInput, listEventsOutput } from '../schemas.js'
import { respond } from './respond.js'

export function registerFindFreeTime(server: McpServer, runner: HelperRunner): void {
  server.registerTool(
    'find_free_time',
    {
      description:
        'Finds free slots of at least durationMinutes. activityDomain controls days and hours together: work means Mon-Fri 09:00-18:00, personal every day at the same hours, unrestricted every day around the clock. workingHours overrides only the hours. bufferMinutes keeps time free around each busy event, so a slot wedged between two meetings is not offered as usable. Returns the free gaps, not the busy events — use list_events for those. Creates nothing.',
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
          bufferMinutes: input.bufferMinutes,
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
        //
        // Das Abfragefenster waechst um den Puffer: Ein Termin, der kurz VOR
        // dem Suchfenster endet, laege sonst gar nicht in der Antwort, und
        // sein Puffer koennte den Fensteranfang nicht beschneiden — der
        // Server wuerde einen Slot vorschlagen, der unmittelbar an ein
        // Meeting grenzt. computeFreeSlots begrenzt die Ausgabe weiterhin auf
        // das urspruengliche Fenster, die zusaetzlichen Events wirken also
        // nur an den Raendern.
        // `?? 0` statt blossem Zugriff: zod setzt den Standardwert zwar beim
        // Parsen, aber ein fehlender Wert wuerde hier sonst NaN erzeugen und
        // ein "Invalid Date" an den Helper schicken — ein Fehlerbild, das
        // nichts mehr mit seiner Ursache zu tun hat.
        const bufferMs = (input.bufferMinutes ?? 0) * 60_000
        const raw = await runner.run('list-events', {
          start: toLocalISO(new Date(Date.parse(input.start) - bufferMs)),
          end: toLocalISO(new Date(Date.parse(input.end) + bufferMs)),
          calendarIds: input.calendarIds,
        })
        const { events } = listEventsOutput.parse(raw)
        return computeFreeSlots(events, freeTimeOptions)
      }),
  )
}
