#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { createHelperRunner } from './helper.js'
import { registerTools } from './tools/index.js'

// `instructions` landet direkt im System-Prompt des Clients. Der richtige Ort
// fuer Hinweise, die fuer alle Tools gelten — in einzelnen Tool-Beschreibungen
// waeren sie fehl am Platz.
const server = new McpServer(
  { name: 'apple-calendar', version: '0.1.0' },
  {
    instructions: [
      'Calendar identifiers are not guessable: fetch them with list_calendars before setting calendarId or calendarIds.',
      'All timestamps are ISO 8601 with an offset, in the local timezone of the machine.',
      'All-day events carry startDay and endDay as plain dates; endDay means the last day included, not the day after.',
      'Events can currently only be created, not modified or deleted.',
    ].join(' '),
  },
)

const helper = createHelperRunner()
registerTools(server, helper)

// Der Helper laeuft als langlebiger Kindprozess. Endet dieser Server regulaer,
// schliesst Node dessen stdin und der Helper beendet sich beim EOF von selbst.
// Bei einem Signal raeumt Node die Pipes nicht mehr auf — dann bliebe ein
// verwaister Prozess mit offenem EventKit-Store zurueck.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    helper.stop()
    process.exit(0)
  })
}

const transport = new StdioServerTransport()
await server.connect(transport)
