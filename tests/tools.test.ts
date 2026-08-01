import { McpServer } from '@modelcontextprotocol/server'
import { describe, expect, it } from 'vitest'
import { HelperError } from '../src/errors.js'
import type { HelperRunner } from '../src/helper.js'
import { registerTools } from '../src/tools/index.js'

interface Call {
  command: string
  payload: Record<string, unknown>
}

function fakeRunner(
  responder: (command: string, payload: Record<string, unknown>) => unknown,
): { runner: HelperRunner; calls: Call[] } {
  const calls: Call[] = []
  const runner: HelperRunner = {
    run(command, payload) {
      calls.push({ command, payload })
      try {
        return Promise.resolve(responder(command, payload))
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)))
      }
    },
  }
  return { runner, calls }
}

const sampleEvent = {
  id: 'ABC::2026-08-05T10:00:00+02:00',
  eventIdentifier: 'ABC',
  occurrenceDate: '2026-08-05T10:00:00+02:00',
  calendarId: 'DEF',
  calendarTitle: 'Privat',
  title: 'Zahnarzt',
  start: '2026-08-05T10:00:00+02:00',
  end: '2026-08-05T11:00:00+02:00',
  allDay: false,
  startDay: null,
  endDay: null,
  location: null,
  notes: null,
  url: null,
  isRecurring: false,
  status: 'confirmed',
}

function buildServer(responder: (command: string, payload: Record<string, unknown>) => unknown) {
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  const { runner, calls } = fakeRunner(responder)
  registerTools(server, runner)
  return { server, calls }
}

// Adapted accessor: the installed @modelcontextprotocol/server (2.0.0) still
// exposes `_registeredTools`, but the per-tool entry stores the callback
// under `handler`, not `callback` as the task brief assumed. Verified by
// reading node_modules/@modelcontextprotocol/server/dist/mcp-*.mjs
// (`_createRegisteredTool`), which builds `{ ..., handler, executor, ... }`.
// Only this test-side accessor is adapted; no implementation code changes.
function registeredTools(server: McpServer): Record<string, { callback: Function; annotations?: Record<string, unknown> }> {
  const raw = (
    server as unknown as {
      _registeredTools: Record<string, { handler: Function; annotations?: Record<string, unknown> }>
    }
  )._registeredTools
  return Object.fromEntries(
    Object.entries(raw).map(([name, tool]) => [
      name,
      { callback: tool.handler, annotations: tool.annotations },
    ]),
  )
}

describe('registerTools', () => {
  it('registriert genau die vier Tools der Spezifikation', () => {
    const { server } = buildServer(() => ({}))
    expect(Object.keys(registeredTools(server)).sort()).toEqual([
      'create_event',
      'find_free_time',
      'list_calendars',
      'list_events',
    ])
  })

  it('markiert alle Lesetools als readOnly, damit sie ohne Rückfrage laufen dürfen', () => {
    const { server } = buildServer(() => ({}))
    const tools = registeredTools(server)
    for (const name of ['list_calendars', 'list_events', 'find_free_time']) {
      expect(tools[name]?.annotations?.['readOnlyHint'], name).toBe(true)
    }
  })

  it('markiert create_event als schreibend, aber nicht destruktiv', () => {
    const { server } = buildServer(() => ({}))
    const annotations = registeredTools(server)['create_event']?.annotations
    expect(annotations?.['readOnlyHint']).toBe(false)
    expect(annotations?.['destructiveHint']).toBe(false)
    expect(annotations?.['idempotentHint']).toBe(false)
  })

  it('erklärt alle vier Tools als nicht netzwerkgebunden', () => {
    const { server } = buildServer(() => ({}))
    const tools = registeredTools(server)
    for (const name of Object.keys(tools)) {
      expect(tools[name]?.annotations?.['openWorldHint'], name).toBe(false)
    }
  })
})

describe('list_events', () => {
  it('reicht Zeitraum und Limit an die CLI weiter', async () => {
    const { server, calls } = buildServer(() => ({
      events: [sampleEvent],
      totalMatched: 1,
      truncated: false,
    }))
    const tool = registeredTools(server)['list_events']

    const result = await tool?.callback({
      start: '2026-08-01T00:00:00+02:00',
      end: '2026-08-31T23:59:59+02:00',
      maxResults: 200,
    })

    expect(calls[0]?.command).toBe('list-events')
    expect(calls[0]?.payload['maxResults']).toBe(200)
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('Zahnarzt')
  })
})

describe('list_events — Abschneiden', () => {
  it('ergänzt einen lesbaren Hinweis, wenn die Liste gekürzt wurde', async () => {
    const { server } = buildServer(() => ({
      events: [sampleEvent],
      totalMatched: 847,
      truncated: true,
    }))
    const tool = registeredTools(server)['list_events']

    const result = await tool?.callback({
      start: '2026-08-01T00:00:00+02:00',
      end: '2026-08-31T23:59:59+02:00',
      maxResults: 1,
    })

    expect(result.content[0].text).toContain('847')
    expect(result.content[0].text).toContain('maxResults')
  })

  it('ergänzt keinen Hinweis, wenn nichts gekürzt wurde', async () => {
    const { server } = buildServer(() => ({
      events: [sampleEvent],
      totalMatched: 1,
      truncated: false,
    }))
    const tool = registeredTools(server)['list_events']

    const result = await tool?.callback({
      start: '2026-08-01T00:00:00+02:00',
      end: '2026-08-31T23:59:59+02:00',
      maxResults: 200,
    })

    expect(result.content[0].text).not.toContain('hinweis')
  })
})

describe('find_free_time', () => {
  it('berechnet Slots aus den Events der CLI', async () => {
    const { server, calls } = buildServer(() => ({
      events: [
        { ...sampleEvent, start: '2026-08-03T12:00:00+02:00', end: '2026-08-03T13:00:00+02:00' },
      ],
      totalMatched: 1,
      truncated: false,
    }))
    const tool = registeredTools(server)['find_free_time']

    const result = await tool?.callback({
      start: '2026-08-03T00:00:00+02:00',
      end: '2026-08-03T23:59:59+02:00',
      durationMinutes: 60,
      activityDomain: 'work',
      ignoreAllDay: true,
    })

    expect(calls[0]?.command).toBe('list-events')
    // Ohne Limit — fuer korrekte Slots werden alle Events gebraucht.
    expect(calls[0]?.payload['maxResults']).toBeUndefined()
    const slots = JSON.parse(result.content[0].text) as Array<{ start: string }>
    expect(slots).toHaveLength(2)
    expect(slots[0]?.start).toBe('2026-08-03T09:00:00+02:00')
  })

  it('meldet eine ungültige workingHours-Reihenfolge als INVALID_INPUT statt als generischen Fehler, ohne den Helper aufzurufen', async () => {
    const { server, calls } = buildServer(() => ({
      events: [],
      totalMatched: 0,
      truncated: false,
    }))
    const tool = registeredTools(server)['find_free_time']

    const result = await tool?.callback({
      start: '2026-08-03T00:00:00+02:00',
      end: '2026-08-03T23:59:59+02:00',
      durationMinutes: 60,
      activityDomain: 'work',
      workingHours: { start: '18:00', end: '09:00' },
      ignoreAllDay: true,
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('ungültig')
    expect(result.content[0].text).not.toContain('unerwarteter Fehler')
    expect(calls).toHaveLength(0)
  })
})

describe('Fehlerbehandlung', () => {
  it('übersetzt HelperError in eine verständliche Meldung mit isError', async () => {
    const { server } = buildServer(() => {
      throw new HelperError('PERMISSION_DENIED', 'nope')
    })
    const tool = registeredTools(server)['list_calendars']

    const result = await tool?.callback({})

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Datenschutz & Sicherheit')
    expect(result.content[0].text).not.toContain('    at ')
  })

  it('fängt auch unerwartete Fehler ab', async () => {
    const { server } = buildServer(() => {
      throw new Error('irgendwas ganz anderes')
    })
    const tool = registeredTools(server)['list_calendars']

    const result = await tool?.callback({})

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('unerwarteter Fehler')
  })

  it('meldet eine Antwort der CLI, die nicht zum Schema passt, als Fehler', async () => {
    const { server } = buildServer(() => ({ unerwartet: true }))
    const tool = registeredTools(server)['list_calendars']

    const result = await tool?.callback({})

    expect(result.isError).toBe(true)
  })
})
