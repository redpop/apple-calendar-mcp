import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHelperRunner } from '../src/helper.js'
import { createSocketRunner } from '../src/socketRunner.js'

const cleanupDirs: string[] = []
let server: Server | undefined

/** Kurzes, garantiert unter der ~104-Byte sun_path-Grenze liegendes Temp-Verzeichnis. */
function freshSocketDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sock-'))
  cleanupDirs.push(dir)
  return dir
}

afterEach(() => {
  server?.close()
  server = undefined
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * Fake-Daemon, der das im Swift-Report dokumentierte Protokoll spricht:
 * eine Zeile rein, `onLine` entscheidet, was (und wie) zurückgeschrieben
 * wird. Bufferet und splittet selbst korrekt auf `\n`, genau wie der
 * echte Client es tun muss.
 */
function startFakeDaemon(path: string, onLine: (line: string, socket: Socket) => void): Promise<Server> {
  return new Promise((resolve, reject) => {
    const srv = createServer((socket) => {
      let buffer = ''
      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex)
          buffer = buffer.slice(newlineIndex + 1)
          onLine(line, socket)
          newlineIndex = buffer.indexOf('\n')
        }
      })
    })
    srv.on('error', reject)
    srv.listen(path, () => resolve(srv))
  })
}

describe('createSocketRunner', () => {
  it('loest mit dem result-Feld einer erfolgreichen Antwort auf', async () => {
    const dir = freshSocketDir()
    const path = join(dir, 'helper.sock')
    server = await startFakeDaemon(path, (_line, socket) => {
      socket.write(`${JSON.stringify({ ok: true, result: { calendars: [] } })}\n`)
    })
    const result = await createSocketRunner(path).run('list-calendars', {})
    expect(result).toEqual({ calendars: [] })
  })

  it('wandelt eine strukturierte Fehlerantwort in HelperError um', async () => {
    const dir = freshSocketDir()
    const path = join(dir, 'helper.sock')
    server = await startFakeDaemon(path, (_line, socket) => {
      socket.write(`${JSON.stringify({ ok: false, error: { code: 'CALENDAR_READONLY', message: 'Kalender X' } })}\n`)
    })
    await expect(createSocketRunner(path).run('create-event', {})).rejects.toMatchObject({
      code: 'CALENDAR_READONLY',
      message: 'Kalender X',
    })
  })

  it('meldet HELPER_CRASHED bei einer kaputten (nicht-JSON) Antwortzeile', async () => {
    const dir = freshSocketDir()
    const path = join(dir, 'helper.sock')
    server = await startFakeDaemon(path, (_line, socket) => {
      socket.write('das ist kein json\n')
    })
    await expect(createSocketRunner(path).run('list-events', {})).rejects.toMatchObject({ code: 'HELPER_CRASHED' })
  })

  it('meldet HELPER_TIMEOUT, wenn der Daemon nach Verbindungsaufbau schweigt', async () => {
    const dir = freshSocketDir()
    const path = join(dir, 'helper.sock')
    server = await startFakeDaemon(path, () => {
      // Bewusst keine Antwort — simuliert einen Daemon, der verbindet und dann schweigt.
    })
    await expect(createSocketRunner(path, 150).run('list-calendars', {})).rejects.toMatchObject({
      code: 'HELPER_TIMEOUT',
    })
  })

  it('setzt eine über zwei Chunks verteilte Antwortzeile korrekt zusammen', async () => {
    const dir = freshSocketDir()
    const path = join(dir, 'helper.sock')
    server = await startFakeDaemon(path, (_line, socket) => {
      const full = `${JSON.stringify({ ok: true, result: { ok: true } })}\n`
      const mid = Math.floor(full.length / 2)
      socket.write(full.slice(0, mid))
      setImmediate(() => socket.write(full.slice(mid)))
    })
    const result = await createSocketRunner(path).run('check-access', {})
    expect(result).toEqual({ ok: true })
  })

  it('meldet HELPER_MISSING (nicht SocketConnectError), wenn kein Socket lauscht', async () => {
    const dir = freshSocketDir()
    const path = join(dir, 'nichts-hoert-hier.sock')
    await expect(createSocketRunner(path).run('list-calendars', {})).rejects.toBeInstanceOf(Error)
    await expect(createSocketRunner(path).run('list-calendars', {})).rejects.toMatchObject({
      code: 'HELPER_MISSING',
    })
  })
})

describe('createHelperRunner Auswahl-Logik', () => {
  it('weicht auf spawn aus, wenn kein Socket vorhanden ist', async () => {
    const dir = freshSocketDir()
    const helperPath = join(dir, 'fake-helper')
    writeFileSync(helperPath, '#!/usr/bin/env bash\ncat > /dev/null; echo "{\\"ok\\":true}"\n')
    chmodSync(helperPath, 0o755)
    const missingSocket = join(dir, 'nope.sock')

    const result = await createHelperRunner(helperPath, missingSocket).run('list-calendars', {})
    expect(result).toEqual({ ok: true })
  })

  it('nutzt den Socket, wenn er erreichbar ist, und fasst das Spawn-Binary nie an', async () => {
    const dir = freshSocketDir()
    const path = join(dir, 'helper.sock')
    server = await startFakeDaemon(path, (_line, socket) => {
      socket.write(`${JSON.stringify({ ok: true, result: { via: 'socket' } })}\n`)
    })
    // Kein File an diesem Pfad — wuerde createHelperRunner doch spawnen,
    // schluege es mit HELPER_MISSING fehl statt mit dem Socket-Ergebnis.
    const helperPath = join(dir, 'sollte-nie-laufen')

    const result = await createHelperRunner(helperPath, path).run('list-calendars', {})
    expect(result).toEqual({ via: 'socket' })
  })

  it('reicht einen strukturierten Fehler vom Daemon direkt durch, ohne auf spawn auszuweichen', async () => {
    const dir = freshSocketDir()
    const path = join(dir, 'helper.sock')
    server = await startFakeDaemon(path, (_line, socket) => {
      socket.write(`${JSON.stringify({ ok: false, error: { code: 'PERMISSION_RESTRICTED', message: 'gesperrt' } })}\n`)
    })
    const helperPath = join(dir, 'sollte-auch-nie-laufen')

    await expect(createHelperRunner(helperPath, path).run('check-access', {})).rejects.toMatchObject({
      code: 'PERMISSION_RESTRICTED',
      message: 'gesperrt',
    })
  })
})
