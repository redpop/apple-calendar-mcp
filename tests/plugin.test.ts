import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
// @ts-expect-error: Skript ohne Typdeklaration, liegt ausserhalb von src/
import { MIN_DAYS, nextPin, pinPlugin } from '../scripts/plugin-pin.mjs'

// Das Plugin ist fuer Claude Code. Cowork startet den lokalen Server eines
// Plugins in seiner Linux-VM, fern von EventKit, und der Desktop-Chat
// ignoriert ihn; dort gilt die MCPB. Das Plugin startet denselben Server per
// npx und pinnt eine veroeffentlichte Version, der es erst nach MIN_DAYS Tagen
// folgt (scripts/plugin-pin.mjs).
const root = join(import.meta.dirname, '..')
const pluginDir = join(root, 'plugin')
const readJson = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'))

// Der Release-Kandidat setzt package.json auf x.y.z-rc.N; der Pin vergleicht nur mit x.y.z.
function releaseOf(version: string): string {
  return version.replace(/-.*$/, '')
}

describe('Claude plugin', () => {
  const pkg = readJson('package.json')
  const manifest = readJson('manifest.json')
  const plugin = readJson('plugin/.claude-plugin/plugin.json')

  test('metadata', () => {
    expect(plugin.name).toBe('apple-calendar-mcp')
    expect(plugin.license).toBe('MIT')
    expect(plugin.privacyPolicyUrl).toBe(manifest.privacy_policies[0])
    expect(plugin.repository).toBe('https://github.com/redpop/apple-calendar-mcp')
    expect(existsSync(join(pluginDir, plugin.icon))).toBe(true)
  })

  test('runs the published package at exactly its own version, not newer than package.json', () => {
    expect(Object.keys(plugin.mcpServers)).toEqual(['apple-calendar'])
    expect(plugin.mcpServers['apple-calendar']).toEqual({
      command: 'npx',
      args: ['-y', `@redpop/apple-calendar-mcp@${plugin.version}`],
    })
    // nextPin liefert die Plugin-Version nur, wenn sie ueber package.json liegt.
    expect(nextPin({ [plugin.version]: '2000-01-01T00:00:00Z' }, releaseOf(pkg.version), Date.now())).toBeNull()
  })

  test('has no settings, like the MCPB', () => {
    expect(plugin.userConfig).toBeUndefined()
    expect(manifest.user_config).toBeUndefined()
  })

  test('matches the MCPB released with the pinned version', () => {
    // Der Tag muss existieren: nur veroeffentlichte Versionen werden gepinnt (CI holt die Tags).
    const tagged = JSON.parse(
      execFileSync('git', ['show', `v${plugin.version}:manifest.json`], { cwd: root, encoding: 'utf8' }),
    )
    expect(pinPlugin(plugin, plugin.version, tagged)).toEqual(plugin)
  })

  test('marketplace lists the plugin folder', () => {
    const market = readJson('.claude-plugin/marketplace.json')
    expect(market.plugins).toEqual([expect.objectContaining({ name: plugin.name, source: './plugin' })])
  })

  test('folder passes the directory file rules', () => {
    // Kein bin/ (Cowork installiert sonst nicht), keine Paketquellen-Konfiguration, Dateien unter 256 KiB.
    const files = readdirSync(pluginDir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
    for (const f of files) {
      expect(f.name).not.toMatch(/^(\.DS_Store|\.npmrc|bunfig\.toml|uv\.toml)$/)
      expect(statSync(join(f.parentPath, f.name)).size, f.name).toBeLessThan(256 * 1024)
    }
    expect(existsSync(join(pluginDir, 'bin'))).toBe(false)
    const readme = readFileSync(join(pluginDir, 'README.md'), 'utf8').replace(/```[\s\S]*?```/g, '')
    expect(readme.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(40)
  })
})

describe('pinPlugin', () => {
  test('pins npx to the version and carries no env or settings when the manifest has none', () => {
    const pinned = pinPlugin({ name: 'x', version: '0.1.0' }, '0.4.0', { server: { mcp_config: {} } })
    expect(pinned).toEqual({
      name: 'x',
      version: '0.4.0',
      mcpServers: { 'apple-calendar': { command: 'npx', args: ['-y', '@redpop/apple-calendar-mcp@0.4.0'] } },
    })
  })

  test('takes env and settings from a manifest that has them', () => {
    const manifest = { server: { mcp_config: { env: { A: '${user_config.a}' } } }, user_config: { a: { type: 'string' } } }
    const pinned = pinPlugin({ name: 'x', version: '0.1.0' }, '0.4.0', manifest)
    expect(pinned.mcpServers['apple-calendar'].env).toEqual(manifest.server.mcp_config.env)
    expect(pinned.userConfig).toEqual(manifest.user_config)
  })
})

describe('plugin pin follows npm after a cooldown', () => {
  const now = Date.parse('2026-11-20T12:00:00Z')
  const daysAgo = (d: number) => new Date(now - d * 24 * 60 * 60 * 1000).toISOString()

  test('waits MIN_DAYS before following a release', () => {
    expect(MIN_DAYS).toBe(7)
    expect(nextPin({ '0.3.0': daysAgo(30), '0.4.0': daysAgo(6.9) }, '0.3.0', now)).toBeNull()
    expect(nextPin({ '0.3.0': daysAgo(30), '0.4.0': daysAgo(7) }, '0.3.0', now)).toBe('0.4.0')
  })

  test('takes the highest old-enough version, skipping a fresh one above it', () => {
    const time = { created: daysAgo(60), modified: daysAgo(1), '0.3.0': daysAgo(30), '0.3.1': daysAgo(9), '0.4.0': daysAgo(2) }
    expect(nextPin(time, '0.3.0', now)).toBe('0.3.1')
  })

  test('never pins a prerelease, an older version or the current one', () => {
    const time = { '0.2.0': daysAgo(40), '0.3.0': daysAgo(30), '0.4.0-rc.1': daysAgo(20), '0.10.0-beta': daysAgo(20) }
    expect(nextPin(time, '0.3.0', now)).toBeNull()
  })

  test('compares numerically, not as text', () => {
    expect(nextPin({ '0.9.0': daysAgo(30), '0.10.0': daysAgo(20) }, '0.9.0', now)).toBe('0.10.0')
  })

  test('honours a custom cooldown', () => {
    expect(nextPin({ '0.4.0': daysAgo(2) }, '0.3.0', now, 0)).toBe('0.4.0')
  })
})
