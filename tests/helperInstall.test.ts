import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureInstalledHelper, installedHelperPath } from '../src/helperInstall.js'

const cleanupDirs: string[] = []

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'install-'))
  cleanupDirs.push(dir)
  return dir
}

function writeBinary(path: string, content: string): string {
  writeFileSync(path, content, 'utf8')
  chmodSync(path, 0o755)
  return path
}

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

describe('installedHelperPath', () => {
  it('liegt unter Application Support, nicht im Paketverzeichnis', () => {
    const path = installedHelperPath()
    expect(path).toContain('Library/Application Support/apple-calendar-mcp')
    expect(path.endsWith('/calendar-helper')).toBe(true)
  })
})

describe('ensureInstalledHelper', () => {
  it('kopiert das Binary, wenn am Zielort noch nichts liegt', () => {
    const source = writeBinary(join(freshDir(), 'calendar-helper'), 'BINARY-V1')
    const installDir = join(freshDir(), 'bin')

    const used = ensureInstalledHelper(source, installDir)

    expect(used).toBe(join(installDir, 'calendar-helper'))
    expect(readFileSync(used, 'utf8')).toBe('BINARY-V1')
  })

  it('setzt das Ausfuehrbar-Bit', () => {
    const source = writeBinary(join(freshDir(), 'calendar-helper'), 'BINARY-V1')
    const installDir = join(freshDir(), 'bin')

    const used = ensureInstalledHelper(source, installDir)

    // 0o111 = ausfuehrbar fuer user/group/other; mindestens der Besitzer muss es sein.
    expect(statSync(used).mode & 0o100).toBe(0o100)
  })

  it('kopiert nicht erneut, wenn der Inhalt bereits uebereinstimmt', () => {
    const source = writeBinary(join(freshDir(), 'calendar-helper'), 'BINARY-V1')
    const installDir = join(freshDir(), 'bin')

    const first = ensureInstalledHelper(source, installDir)
    const mtimeAfterFirst = statSync(first).mtimeMs

    const second = ensureInstalledHelper(source, installDir)

    expect(second).toBe(first)
    // Ein erneutes Kopieren wuerde die mtime veraendern. Dass sie steht,
    // belegt: es wurde nur verglichen, nicht geschrieben.
    expect(statSync(second).mtimeMs).toBe(mtimeAfterFirst)
  })

  it('ersetzt das Ziel, wenn sich der Inhalt geaendert hat', () => {
    const sourceDir = freshDir()
    const source = writeBinary(join(sourceDir, 'calendar-helper'), 'BINARY-V1')
    const installDir = join(freshDir(), 'bin')

    ensureInstalledHelper(source, installDir)
    writeBinary(source, 'BINARY-V2-LAENGER')
    const used = ensureInstalledHelper(source, installDir)

    expect(readFileSync(used, 'utf8')).toBe('BINARY-V2-LAENGER')
  })

  it('erkennt eine Aenderung auch bei gleicher Dateigroesse', () => {
    const sourceDir = freshDir()
    const source = writeBinary(join(sourceDir, 'calendar-helper'), 'AAAA')
    const installDir = join(freshDir(), 'bin')

    ensureInstalledHelper(source, installDir)
    writeBinary(source, 'BBBB')
    const used = ensureInstalledHelper(source, installDir)

    // Ein Vergleich allein ueber die Groesse wuerde hier faelschlich
    // "unveraendert" melden und ein veraltetes Binary stehen lassen.
    expect(readFileSync(used, 'utf8')).toBe('BBBB')
  })

  it('legt das Zielverzeichnis an, wenn es fehlt', () => {
    const source = writeBinary(join(freshDir(), 'calendar-helper'), 'BINARY-V1')
    const installDir = join(freshDir(), 'tief', 'verschachtelt', 'bin')

    const used = ensureInstalledHelper(source, installDir)

    expect(existsSync(used)).toBe(true)
  })

  it('weicht auf den Quellpfad aus, wenn die Installation scheitert', () => {
    const source = writeBinary(join(freshDir(), 'calendar-helper'), 'BINARY-V1')
    // Eine Datei dort, wo ein Verzeichnis liegen muesste: mkdir scheitert.
    const blocked = join(freshDir(), 'blockiert')
    writeFileSync(blocked, 'kein Verzeichnis', 'utf8')

    const used = ensureInstalledHelper(source, join(blocked, 'bin'))

    // Lieber aus dem Paketverzeichnis starten als gar nicht — die
    // Berechtigung haengt dann zwar am wandernden Pfad, aber der Server
    // funktioniert.
    expect(used).toBe(source)
  })

  it('weicht auf den Quellpfad aus, wenn die Quelle fehlt', () => {
    const missing = join(freshDir(), 'gibt-es-nicht')
    const installDir = join(freshDir(), 'bin')

    const used = ensureInstalledHelper(missing, installDir)

    expect(used).toBe(missing)
    expect(existsSync(installDir)).toBe(false)
  })

  it('ueberschreibt ein vorhandenes Ziel, ohne es vorher zu loeschen', () => {
    const sourceDir = freshDir()
    const source = writeBinary(join(sourceDir, 'calendar-helper'), 'NEU')
    const installDir = join(freshDir(), 'bin')
    mkdirSync(installDir, { recursive: true })
    const target = writeBinary(join(installDir, 'calendar-helper'), 'ALT')

    ensureInstalledHelper(source, installDir)

    // Ein laufendes Binary laesst sich unter macOS nicht ueberschreiben
    // (ETXTBSY), ein Loeschen wuerde den TCC-Eintrag am Pfad gefaehrden.
    // Deshalb: nach temp schreiben und atomar umbenennen.
    expect(readFileSync(target, 'utf8')).toBe('NEU')
    // Keine Reste des Zwischenschritts.
    expect(existsSync(`${target}.tmp`)).toBe(false)
  })
})
