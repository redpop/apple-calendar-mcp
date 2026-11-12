// Hebt den npx-Pin des Plugins (plugin/.claude-plugin/plugin.json) auf eine veroeffentlichte Version.
//
// Das Plugin pinnt exakt (das Verzeichnis lehnt Spannen und @latest ab). Viele Nutzer haben in npm
// einen Cooldown (min-release-age): npm lehnt dann Versionen ab, die juenger sind, und npx faellt
// nicht auf eine aeltere zurueck. Deshalb folgt der Pin npm erst, wenn eine Version MIN_DAYS alt
// ist. Den Cooldown des Nutzers hebeln wir bewusst nicht aus.
//
//   node scripts/plugin-pin.mjs next [--min-days N]   gibt die naechste Pin-Version aus (oder nichts)
//   node scripts/plugin-pin.mjs apply <version>       schreibt den Pin; Umgebung und Einstellungen
//                                                     aus dem Manifest am Tag v<version>
//
// Laeuft im Workflow plugin-pin.yml, der daraus einen PR macht.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const NPM_NAME = '@redpop/apple-calendar-mcp'
const PLUGIN_FILE = 'plugin/.claude-plugin/plugin.json'
const SERVER = 'apple-calendar'
export const MIN_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

// Nur x.y.z; Vorabversionen pinnen wir nie.
const parse = (v) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null)
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/** Hoechste stabile Version ueber `current`, die mindestens `minDays` alt ist; sonst null. */
export function nextPin(time, current, now, minDays = MIN_DAYS) {
  const cur = parse(current)
  if (!cur) throw new Error(`current pin is not x.y.z: ${current}`)
  let best = null
  for (const [version, published] of Object.entries(time)) {
    const v = parse(version)
    if (!v || compare(v, cur) <= 0) continue
    if (now - Date.parse(published) < minDays * DAY_MS) continue
    if (!best || compare(v, parse(best)) > 0) best = version
  }
  return best
}

/**
 * Plugin mit Pin auf `version`. Umgebung und Einstellungen kommen aus dem Manifest dieser Version;
 * heute hat es keine, und dann fehlen beide Felder auch im Plugin.
 */
export function pinPlugin(plugin, version, manifest) {
  const { userConfig: _previous, ...rest } = plugin
  const server = { command: 'npx', args: ['-y', `${NPM_NAME}@${version}`] }
  const env = manifest.server?.mcp_config?.env
  if (env !== undefined) server.env = env
  const pinned = { ...rest, version, mcpServers: { [SERVER]: server } }
  if (manifest.user_config !== undefined) pinned.userConfig = manifest.user_config
  return pinned
}

// Nur als Skript ausfuehren, nicht beim Import aus den Tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, arg, value] = process.argv.slice(2)
  const plugin = JSON.parse(readFileSync(PLUGIN_FILE, 'utf8'))
  if (mode === 'next') {
    const minDays = arg === '--min-days' ? Number(value) : MIN_DAYS
    if (!Number.isInteger(minDays) || minDays < 0) throw new Error(`invalid --min-days: ${value}`)
    const time = JSON.parse(
      execFileSync('npm', ['view', NPM_NAME, 'time', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    )
    const next = nextPin(time, plugin.version, Date.now(), minDays)
    if (next) console.log(next)
  } else if (mode === 'apply' && parse(arg ?? '')) {
    const manifest = JSON.parse(execFileSync('git', ['show', `v${arg}:manifest.json`], { encoding: 'utf8' }))
    writeFileSync(PLUGIN_FILE, `${JSON.stringify(pinPlugin(plugin, arg, manifest), null, 2)}\n`)
    console.log(`Plugin pinned to ${arg}`)
  } else {
    console.error('usage: plugin-pin.mjs next [--min-days N] | apply <x.y.z>')
    process.exit(2)
  }
}
