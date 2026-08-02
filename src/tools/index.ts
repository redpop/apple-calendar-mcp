import type { McpServer } from '@modelcontextprotocol/server'
import type { HelperRunner } from '../helper.js'
import { registerCreateEvent } from './createEvent.js'
import { registerDeleteEvent } from './deleteEvent.js'
import { registerFindFreeTime } from './findFreeTime.js'
import { registerListCalendars } from './listCalendars.js'
import { registerListEvents } from './listEvents.js'
import { registerUpdateEvent } from './updateEvent.js'

export function registerTools(server: McpServer, runner: HelperRunner): void {
  registerListCalendars(server, runner)
  registerListEvents(server, runner)
  registerCreateEvent(server, runner)
  registerUpdateEvent(server, runner)
  registerDeleteEvent(server, runner)
  registerFindFreeTime(server, runner)
}
