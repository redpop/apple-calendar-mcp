import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { HelperError } from '../src/errors.js'
import { createSpawnRunner, resolveHelperPath } from '../src/helper.js'

let directory: string

function writeFakeHelper(name: string, script: string): string {
  const path = join(directory, name)
  writeFileSync(path, `#!/usr/bin/env bash\n${script}\n`)
  chmodSync(path, 0o755)
  return path
}

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'helper-test-'))
})

describe('createSpawnRunner', () => {
  it('reicht die Payload über stdin und liest JSON von stdout', async () => {
    const path = writeFakeHelper('echo-helper', 'cat > /dev/null; echo "{\\"ok\\":true}"')
    const result = await createSpawnRunner(path).run('list-calendars', {})
    expect(result).toEqual({ ok: true })
  })

  it('übergibt das Kommando als erstes Argument', async () => {
    const path = writeFakeHelper('arg-helper', 'cat > /dev/null; echo "{\\"command\\":\\"$1\\"}"')
    const result = await createSpawnRunner(path).run('list-events', {})
    expect(result).toEqual({ command: 'list-events' })
  })

  it('überträgt Umlaute unbeschädigt über stdin', async () => {
    const path = writeFakeHelper('stdin-helper', 'cat')
    const result = await createSpawnRunner(path).run('create-event', { notes: 'Grüße äöüß' })
    expect(result).toEqual({ notes: 'Grüße äöüß' })
  })

  it('wandelt strukturierte stderr-Fehler in HelperError um', async () => {
    const path = writeFakeHelper(
      'fail-helper',
      'cat > /dev/null; echo "{\\"code\\":\\"CALENDAR_READONLY\\",\\"message\\":\\"Kalender X\\"}" >&2; exit 1',
    )
    await expect(createSpawnRunner(path).run('create-event', {})).rejects.toMatchObject({
      code: 'CALENDAR_READONLY',
      message: 'Kalender X',
    })
  })

  it('meldet HELPER_CRASHED, wenn stderr kein JSON enthält', async () => {
    const path = writeFakeHelper('garbage-helper', 'cat > /dev/null; echo "Segmentation fault" >&2; exit 139')
    await expect(createSpawnRunner(path).run('list-events', {})).rejects.toMatchObject({
      code: 'HELPER_CRASHED',
    })
  })

  it('meldet HELPER_CRASHED, wenn stdout kein JSON enthält', async () => {
    const path = writeFakeHelper('noise-helper', 'cat > /dev/null; echo "kein json"')
    await expect(createSpawnRunner(path).run('list-events', {})).rejects.toMatchObject({
      code: 'HELPER_CRASHED',
    })
  })

  it('meldet HELPER_MISSING, wenn das Binary fehlt', async () => {
    const runner = createSpawnRunner(join(directory, 'existiert-nicht'))
    await expect(runner.run('list-calendars', {})).rejects.toBeInstanceOf(HelperError)
    await expect(runner.run('list-calendars', {})).rejects.toMatchObject({ code: 'HELPER_MISSING' })
  })

  it('loest auf, wenn der Helper trotz fehlgeschlagenem stdin-Schreiben gueltige JSON-Ausgabe liefert', async () => {
    // Kein "cat" hier — der Helper liest stdin nie und beendet sich sofort,
    // wie es check-access, list-calendars und der unbekannte-Kommando-Pfad
    // im echten Swift-Binary tun. Ein EPIPE beim stdin-Schreiben darf ein
    // echtes, gueltiges Ergebnis nicht verdraengen — sonst wuerde ein
    // gültiges PERMISSION_DENIED von list-calendars im Race-Fall faelschlich
    // als "Hilfsprogramm unerwartet beendet (EPIPE)" gemeldet.
    const path = writeFakeHelper('no-stdin-read-helper', 'echo "{\\"ok\\":true}"; exit 0')
    const largePayload = { notes: 'x'.repeat(2_000_000) }
    const result = await createSpawnRunner(path).run('check-access', largePayload)
    expect(result).toEqual({ ok: true })
  })

  it('crasht den Prozess nicht, wenn stdin ungelesen bleibt und der Helper ohne verwertbares Ergebnis endet', async () => {
    // Derselbe unlesbare-stdin-Fall wie oben, aber ohne gueltige Ausgabe: das
    // war die urspruengliche kritische Erkenntnis, fuer die dieser
    // Error-Handler existiert — ein ungefangenes EPIPE hier wuerde den
    // gesamten Node-Prozess mit einer uncaught exception beenden statt nur
    // dieses Promise abzulehnen.
    const path = writeFakeHelper('no-stdin-no-output-helper', 'exit 1')
    const largePayload = { notes: 'x'.repeat(2_000_000) }
    await expect(createSpawnRunner(path).run('check-access', largePayload)).rejects.toBeInstanceOf(HelperError)
  })

  it('meldet einen HelperError, wenn spawn selbst fehlschlaegt (nicht ausfuehrbar)', async () => {
    const path = join(directory, 'not-executable-helper')
    writeFileSync(path, '#!/usr/bin/env bash\necho "{}"\n')
    chmodSync(path, 0o644)
    await expect(createSpawnRunner(path).run('list-calendars', {})).rejects.toBeInstanceOf(HelperError)
    await expect(createSpawnRunner(path).run('list-calendars', {})).rejects.toMatchObject({
      code: expect.any(String),
    })
  })
})

describe('resolveHelperPath', () => {
  it('bevorzugt die Umgebungsvariable', () => {
    process.env.APPLE_CALENDAR_HELPER_PATH = '/tmp/eigener-pfad'
    expect(resolveHelperPath()).toBe('/tmp/eigener-pfad')
    delete process.env.APPLE_CALENDAR_HELPER_PATH
  })

  it('zeigt ohne Override auf bin/calendar-helper im Paket', () => {
    delete process.env.APPLE_CALENDAR_HELPER_PATH
    expect(resolveHelperPath().endsWith('/bin/calendar-helper')).toBe(true)
  })
})
