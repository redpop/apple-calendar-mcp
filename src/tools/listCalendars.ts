import type { McpServer } from '@modelcontextprotocol/server'
import type { HelperRunner } from '../helper.js'
import { listCalendarsInput, listCalendarsOutput } from '../schemas.js'
import { respond } from './respond.js'

export function registerListCalendars(server: McpServer, runner: HelperRunner): void {
  server.registerTool(
    'list_calendars',
    {
      description:
        'Lists every calendar configured in macOS Calendar, including iCloud ones. Returns id, title, type, source, color and allowsModifications for each. Does not read events — list_events does that.',
      inputSchema: listCalendarsInput,
      annotations: {
        title: 'List calendars',
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
