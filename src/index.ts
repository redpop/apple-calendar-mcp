#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { createHelperRunner } from './helper.js'
import { registerTools } from './tools/index.js'

// `instructions` landet direkt in Claudes System-Prompt. Der richtige Ort fuer
// Hinweise, die fuer alle Tools gelten — in einzelnen Tool-Beschreibungen
// waeren sie fehl am Platz.
const server = new McpServer(
  { name: 'apple-calendar', version: '0.1.0' },
  {
    instructions: [
      'Kalender-IDs sind nicht ratbar: hole sie über list_calendars, bevor du calendarId oder calendarIds setzt.',
      'Alle Zeitangaben sind ISO 8601 mit Offset in der lokalen Zeitzone des Rechners.',
      'Ganztägige Termine tragen startDay und endDay als reine Datumsangaben; endDay meint den letzten enthaltenen Tag, nicht den Folgetag.',
      'Termine lassen sich derzeit nur anlegen, nicht ändern oder löschen.',
    ].join(' '),
  },
)

registerTools(server, createHelperRunner())

const transport = new StdioServerTransport()
await server.connect(transport)
