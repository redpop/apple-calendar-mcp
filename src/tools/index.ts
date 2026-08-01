import type { McpServer } from '@modelcontextprotocol/server'
import type { HelperRunner } from '../helper.js'
import { registerCreateEvent } from './createEvent.js'
import { registerFindFreeTime } from './findFreeTime.js'
import { registerListCalendars } from './listCalendars.js'
import { registerListEvents } from './listEvents.js'

export function registerTools(server: McpServer, runner: HelperRunner): void {
  registerListCalendars(server, runner)
  registerListEvents(server, runner)
  registerCreateEvent(server, runner)
  registerFindFreeTime(server, runner)
}
