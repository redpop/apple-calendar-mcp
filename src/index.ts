#!/usr/bin/env node
import { createRequire } from 'node:module'
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { createHelperRunner } from './helper.js'
import { registerTools } from './tools/index.js'

// `instructions` landet direkt im System-Prompt des Clients. Der richtige Ort
// fuer Hinweise, die fuer alle Tools gelten — in einzelnen Tool-Beschreibungen
// waeren sie fehl am Platz.
// Version aus package.json, nicht als Literal: Sie stand hier auf 0.1.0,
// waehrend das Paket schon 0.1.1 war — ein Client, der die Serverversion
// anzeigt oder protokolliert, haette also gelogen. Das faellt sonst niemandem
// auf, weil nichts danach fehlschlaegt.
const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

const server = new McpServer(
  { name: 'apple-calendar', version },
  {
    instructions: [
      'Calendar identifiers are not guessable: fetch them with list_calendars before setting calendarId or calendarIds.',
      'All timestamps are ISO 8601 with an offset, in the local timezone of the machine.',
      'All-day events carry startDay and endDay as plain dates; endDay means the last day included, not the day after.',
      'Changing or deleting a recurring event needs both occurrenceDate and span: this affects one occurrence, future affects it and every later one. There is no undo.',
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
