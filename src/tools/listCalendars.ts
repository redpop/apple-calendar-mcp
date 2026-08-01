import type { McpServer } from '@modelcontextprotocol/server'
import type { HelperRunner } from '../helper.js'
import { listCalendarsInput, listCalendarsOutput } from '../schemas.js'
import { respond } from './respond.js'

export function registerListCalendars(server: McpServer, runner: HelperRunner): void {
  server.registerTool(
    'list_calendars',
    {
      description:
        'Listet alle im macOS-Kalender konfigurierten Kalender auf, inklusive iCloud. Liefert je Kalender id, title, type, source, color und allowsModifications. Liest keine Termine — dafür ist list_events zuständig.',
      inputSchema: listCalendarsInput,
      annotations: {
        title: 'Kalender auflisten',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () =>
      respond(async () => {
        const raw = await runner.run('list-calendars', {})
        return listCalendarsOutput.parse(raw).calendars
      }),
  )
}
