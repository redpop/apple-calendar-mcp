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
  it('registriert genau die sechs Tools der Spezifikation', () => {
    const { server } = buildServer(() => ({}))
    expect(Object.keys(registeredTools(server)).sort()).toEqual([
      'create_event',
      'delete_event',
      'find_free_time',
      'list_calendars',
      'list_events',
      'update_event',
    ])
  })

  it('markiert nur die loeschenden Tools als destruktiv', () => {
    const { server } = buildServer(() => ({}))
    const tools = registeredTools(server)

    // create_event legt nur an; update_event ueberschreibt bestehende Werte
    // und delete_event entfernt sie. Genau nach dieser Unterscheidung
    // gruppieren Clients ihre Rueckfragen — sie darf nicht verwaessern.
    expect(tools['create_event']?.annotations?.['destructiveHint']).toBe(false)
    expect(tools['update_event']?.annotations?.['destructiveHint']).toBe(true)
    expect(tools['delete_event']?.annotations?.['destructiveHint']).toBe(true)
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

  it('erklärt alle Tools als nicht netzwerkgebunden', () => {
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

    expect(result.content[0].text).not.toContain('Showing')
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

  it('fragt ohne Puffer genau das Suchfenster ab', async () => {
    const { server, calls } = buildServer(() => ({ events: [], totalMatched: 0, truncated: false }))
    const tool = registeredTools(server)['find_free_time']

    await tool?.callback({
      start: '2026-08-03T00:00:00+02:00',
      end: '2026-08-03T23:59:59+02:00',
      durationMinutes: 60,
      activityDomain: 'work',
      ignoreAllDay: true,
    })

    // Ohne bufferMinutes darf kein NaN-Datum entstehen: zod setzt den
    // Standardwert zwar beim Parsen, aber der Callback muss auch ohne ihn
    // etwas Gueltiges an den Helper schicken.
    expect(calls[0]?.payload['start']).toBe('2026-08-03T00:00:00+02:00')
    expect(calls[0]?.payload['end']).toBe('2026-08-03T23:59:59+02:00')
  })

  it('weitet das Abfragefenster um den Puffer auf', async () => {
    const { server, calls } = buildServer(() => ({ events: [], totalMatched: 0, truncated: false }))
    const tool = registeredTools(server)['find_free_time']

    await tool?.callback({
      start: '2026-08-03T09:00:00+02:00',
      end: '2026-08-03T18:00:00+02:00',
      durationMinutes: 60,
      activityDomain: 'work',
      ignoreAllDay: true,
      bufferMinutes: 30,
    })

    // Ein Termin, der um 08:45 endet, liegt ausserhalb des Suchfensters, sein
    // Puffer reicht aber hinein. Ohne erweiterte Abfrage waere er gar nicht
    // in der Antwort und koennte den Fensteranfang nicht beschneiden.
    expect(calls[0]?.payload['start']).toBe('2026-08-03T08:30:00+02:00')
    expect(calls[0]?.payload['end']).toBe('2026-08-03T18:30:00+02:00')
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
    expect(result.content[0].text).toContain('invalid')
    expect(result.content[0].text).not.toContain('unexpected error')
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
    expect(result.content[0].text).toContain('Privacy & Security')
    expect(result.content[0].text).not.toContain('    at ')
  })

  it('fängt auch unerwartete Fehler ab', async () => {
    const { server } = buildServer(() => {
      throw new Error('irgendwas ganz anderes')
    })
    const tool = registeredTools(server)['list_calendars']

    const result = await tool?.callback({})

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('unexpected error')
  })

  it('meldet eine Antwort der CLI, die nicht zum Schema passt, als Fehler', async () => {
    const { server } = buildServer(() => ({ unerwartet: true }))
    const tool = registeredTools(server)['list_calendars']

    const result = await tool?.callback({})

    expect(result.isError).toBe(true)
  })
})

describe('update_event', () => {
  it('reicht nur die uebergebenen Felder an die CLI weiter', async () => {
    const { server, calls } = buildServer(() => ({ event: sampleEvent }))
    const tool = registeredTools(server)['update_event']

    await tool?.callback({
      eventIdentifier: 'ABC',
      title: 'Zahnarzt verschoben',
    })

    expect(calls[0]?.command).toBe('update-event')
    expect(calls[0]?.payload['title']).toBe('Zahnarzt verschoben')
    // Ein weggelassenes Feld heisst "unveraendert lassen", nicht "leeren".
    // Als undefined durchgereicht, faellt es beim JSON-Kodieren weg und die
    // Swift-Seite fasst es nicht an.
    expect(calls[0]?.payload['notes']).toBeUndefined()
    expect(calls[0]?.payload['start']).toBeUndefined()
  })

  it('reicht occurrenceDate und span fuer Wiederholungstermine durch', async () => {
    const { server, calls } = buildServer(() => ({ event: sampleEvent }))
    const tool = registeredTools(server)['update_event']

    await tool?.callback({
      eventIdentifier: 'ABC',
      occurrenceDate: '2026-08-05T10:00:00+02:00',
      span: 'future',
      location: 'Praxis Nord',
    })

    expect(calls[0]?.payload['occurrenceDate']).toBe('2026-08-05T10:00:00+02:00')
    expect(calls[0]?.payload['span']).toBe('future')
  })

  it('gibt den geaenderten Termin zurueck', async () => {
    const { server } = buildServer(() => ({
      event: { ...sampleEvent, title: 'Neuer Titel' },
    }))
    const tool = registeredTools(server)['update_event']

    const result = await tool?.callback({ eventIdentifier: 'ABC', title: 'Neuer Titel' })

    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('Neuer Titel')
  })

  it('meldet einen unbekannten Termin verstaendlich', async () => {
    const { server } = buildServer(() => {
      throw new HelperError('EVENT_NOT_FOUND', 'nope')
    })
    const tool = registeredTools(server)['update_event']

    const result = await tool?.callback({ eventIdentifier: 'weg' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('list_events')
  })
})

describe('delete_event', () => {
  it('reicht Kennung und span an die CLI weiter', async () => {
    const { server, calls } = buildServer(() => ({ deleted: sampleEvent, span: 'this' }))
    const tool = registeredTools(server)['delete_event']

    await tool?.callback({
      eventIdentifier: 'ABC',
      occurrenceDate: '2026-08-05T10:00:00+02:00',
      span: 'this',
    })

    expect(calls[0]?.command).toBe('delete-event')
    expect(calls[0]?.payload['eventIdentifier']).toBe('ABC')
    expect(calls[0]?.payload['span']).toBe('this')
  })

  it('gibt den geloeschten Termin samt Weite zurueck', async () => {
    const { server } = buildServer(() => ({ deleted: sampleEvent, span: 'future' }))
    const tool = registeredTools(server)['delete_event']

    const result = await tool?.callback({ eventIdentifier: 'ABC', span: 'future' })

    // Was verschwunden ist, muss in der Antwort stehen — danach laesst es
    // sich nicht mehr nachschlagen.
    expect(result.content[0].text).toContain('Zahnarzt')
    expect(result.content[0].text).toContain('future')
  })

  it('reicht einen schreibgeschuetzten Kalender als Klartext durch', async () => {
    const { server } = buildServer(() => {
      throw new HelperError('CALENDAR_READONLY', 'Feiertage')
    })
    const tool = registeredTools(server)['delete_event']

    const result = await tool?.callback({ eventIdentifier: 'ABC' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('read-only')
  })
})
