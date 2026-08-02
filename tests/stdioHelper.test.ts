import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HelperError } from '../src/errors.js'
import { createStdioRunner } from '../src/stdioRunner.js'

const cleanupDirs: string[] = []
const runners: { stop: () => void }[] = []

afterEach(() => {
  while (runners.length > 0) runners.pop()?.stop()
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * Fake-Helper, der dasselbe Zeilenprotokoll spricht wie `calendar-helper
 * serve`: eine JSON-Zeile rein, eine JSON-Zeile raus, `id` gespiegelt.
 *
 * Das Verhalten haengt am Kommando, damit ein einziges Skript alle Szenarien
 * abdeckt — insbesondere `echo-pid`, mit dem sich ueber die zurueckgemeldete
 * PID pruefen laesst, ob zwei Aufrufe wirklich denselben Prozess getroffen
 * haben.
 */
function writeFakeHelper(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stdio-'))
  cleanupDirs.push(dir)
  const path = join(dir, 'fake-helper')
  writeFileSync(
    path,
    `#!/usr/bin/env node
// Startmarker: belegt, DASS der Prozess ueberhaupt gestartet wurde.
require('node:fs').writeFileSync(${JSON.stringify(join(dir, 'started'))}, String(process.pid))

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index = buffer.indexOf('\\n')
  while (index !== -1) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    handle(JSON.parse(line))
    index = buffer.indexOf('\\n')
  }
})
process.stdin.on('end', () => process.exit(0))

function reply(object) {
  process.stdout.write(JSON.stringify(object) + '\\n')
}

function handle(request) {
  const id = request.id
  switch (request.command) {
    case 'echo-pid':
      reply({ id, ok: true, result: { pid: process.pid } })
      return
    case 'echo-payload':
      reply({ id, ok: true, result: request.payload })
      return
    case 'fail':
      reply({ id, ok: false, error: { code: 'CALENDAR_READONLY', message: 'Kalender ist schreibgeschuetzt' } })
      return
    case 'garbage':
      process.stdout.write('das ist kein JSON\\n')
      return
    case 'crash':
      process.exit(3)
      return
    case 'hang':
      return
    case 'slow':
      setTimeout(() => reply({ id, ok: true, result: 'spaet' }), 50)
      return
    default:
      reply({ id, ok: false, error: { code: 'INVALID_INPUT', message: 'Unbekannt: ' + request.command } })
  }
}
`,
    'utf8',
  )
  chmodSync(path, 0o755)
  return path
}

function startedMarker(helperPath: string): string {
  return join(helperPath, '..', 'started')
}

/** Kurze Fristen, damit ein Timeout-Test nicht 35 Sekunden dauert. */
const fastTimeouts = { firstRequestMs: 2_000, requestMs: 1_000 }

function makeRunner(helperPath: string): ReturnType<typeof createStdioRunner> {
  const runner = createStdioRunner(helperPath, fastTimeouts)
  runners.push(runner)
  return runner
}

describe('createStdioRunner', () => {
  it('startet den Helper erst beim ersten Aufruf, nicht bei der Konstruktion', async () => {
    const helper = writeFakeHelper()
    const runner = makeRunner(helper)

    expect(existsSync(startedMarker(helper))).toBe(false)

    await runner.run('echo-pid', {})
    expect(existsSync(startedMarker(helper))).toBe(true)
  })

  it('bedient zwei aufeinanderfolgende Aufrufe aus demselben Prozess', async () => {
    const runner = makeRunner(writeFakeHelper())

    const first = (await runner.run('echo-pid', {})) as { pid: number }
    const second = (await runner.run('echo-pid', {})) as { pid: number }

    expect(second.pid).toBe(first.pid)
  })

  it('ordnet nebenlaeufige Aufrufe der jeweils eigenen Antwort zu', async () => {
    const runner = makeRunner(writeFakeHelper())

    const [a, b, c] = await Promise.all([
      runner.run('echo-payload', { n: 1 }),
      runner.run('echo-payload', { n: 2 }),
      runner.run('echo-payload', { n: 3 }),
    ])

    expect(a).toEqual({ n: 1 })
    expect(b).toEqual({ n: 2 })
    expect(c).toEqual({ n: 3 })
  })

  it('reicht eine strukturierte Fehlerantwort als HelperError mit ihrem Code durch', async () => {
    const runner = makeRunner(writeFakeHelper())

    await expect(runner.run('fail', {})).rejects.toMatchObject({
      code: 'CALENDAR_READONLY',
    })
  })

  it('lehnt offene Anfragen mit HELPER_CRASHED ab, wenn der Helper stirbt', async () => {
    const runner = makeRunner(writeFakeHelper())

    await expect(runner.run('crash', {})).rejects.toMatchObject({
      code: 'HELPER_CRASHED',
    })
  })

  it('startet den Helper nach einem Absturz beim naechsten Aufruf neu', async () => {
    const runner = makeRunner(writeFakeHelper())

    const before = (await runner.run('echo-pid', {})) as { pid: number }
    await expect(runner.run('crash', {})).rejects.toBeInstanceOf(HelperError)

    const after = (await runner.run('echo-pid', {})) as { pid: number }
    expect(after.pid).not.toBe(before.pid)
  })

  it('meldet eine unlesbare Zeile als HELPER_CRASHED', async () => {
    const runner = makeRunner(writeFakeHelper())

    await expect(runner.run('garbage', {})).rejects.toMatchObject({
      code: 'HELPER_CRASHED',
    })
  })

  it('setzt eine Antwort zusammen, die ueber mehrere Chunks eintrifft', async () => {
    const runner = makeRunner(writeFakeHelper())

    // Deutlich groesser als ein Pipe-Chunk: die Antwortzeile kommt garantiert
    // in mehreren 'data'-Ereignissen an. Ohne korrektes Framing wuerde hier
    // eine halbe Zeile geparst — der Fehler, den ein kleiner Payload
    // zuverlaessig verdeckt. Umlaute sind bewusst dabei, damit ein Chunk auch
    // mitten in einem Mehrbyte-Zeichen enden kann.
    const payload = { notiz: 'Grüße äöüß '.repeat(20_000) }

    const result = (await runner.run('echo-payload', payload)) as { notiz: string }
    expect(result.notiz).toBe(payload.notiz)
  })

  it('meldet ein fehlendes Binary als HELPER_MISSING', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stdio-'))
    cleanupDirs.push(dir)
    const runner = makeRunner(join(dir, 'gibt-es-nicht'))

    await expect(runner.run('echo-pid', {})).rejects.toMatchObject({
      code: 'HELPER_MISSING',
    })
  })

  it('meldet ein zwischenzeitlich geloeschtes Binary als HELPER_MISSING', async () => {
    const helper = writeFakeHelper()
    const runner = makeRunner(helper)

    // Die existsSync-Pruefung und der spawn liegen auseinander. Verschwindet
    // die Datei dazwischen — etwa waehrend ein Update sie ersetzt — kam frueher
    // HELPER_CRASHED heraus, was den Leser in die falsche Richtung schickt.
    rmSync(helper, { force: true })

    await expect(runner.run('echo-pid', {})).rejects.toMatchObject({
      code: 'HELPER_MISSING',
    })
  })

  it('startet einen haengenden Helper nach wiederholten Timeouts neu', async () => {
    const helper = writeFakeHelper()
    const runner = makeRunner(helper)

    // Erst warm werden — vorher gilt die lange Frist, weil dort noch ein
    // Berechtigungsdialog offen sein koennte.
    const before = (await runner.run('echo-pid', {})) as { pid: number }

    // 'hang' antwortet nie. Zwei Timeouts in Folge muessen den Prozess
    // verwerfen, sonst laeuft jede weitere Anfrage ebenfalls ins Leere und nur
    // ein Neustart des Servers hilft.
    await expect(runner.run('hang', {})).rejects.toMatchObject({ code: 'HELPER_TIMEOUT' })
    await expect(runner.run('hang', {})).rejects.toMatchObject({ code: 'HELPER_TIMEOUT' })

    const after = (await runner.run('echo-pid', {})) as { pid: number }
    expect(after.pid).not.toBe(before.pid)
  }, 15_000)

  it('beendet den Helper, wenn der Runner gestoppt wird', async () => {
    const helper = writeFakeHelper()
    const runner = makeRunner(helper)

    const { pid } = (await runner.run('echo-pid', {})) as { pid: number }
    runner.stop()

    // Dem Kindprozess einen Moment zum Beenden lassen, dann pruefen: Signal 0
    // testet nur die Existenz, ohne etwas zu senden.
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(() => process.kill(pid, 0)).toThrow()
  })
})
