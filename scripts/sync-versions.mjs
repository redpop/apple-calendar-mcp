// Haelt alle Versionsangaben mit package.json im Gleichklang.
//
// Die Version steht ausser in package.json noch in server.json (Server, beide
// Pakete und die URL des MCPB-Assets) und in manifest.json.
// tests/serverJson.test.ts und tests/manifest.test.ts melden eine Abweichung,
// dieses Skript verhindert sie. Das Plugin folgt npm bewusst spaeter und
// getrennt (scripts/plugin-pin.mjs).
//
// Laeuft als npm-"version"-Hook, also zwischen Versionsbump und Commit, und im
// Release-Workflow (dort prueft scripts/release/check-tag.sh, dass es nichts
// mehr aendert).
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const path = (name) => fileURLToPath(new URL(name, root))
const readJson = (name) => JSON.parse(readFileSync(path(name), 'utf8'))
const writeJson = (name, value) => writeFileSync(path(name), `${JSON.stringify(value, null, 2)}\n`)

const { version } = readJson('package.json')

const server = readJson('server.json')
server.version = version
for (const entry of server.packages) {
  entry.version = version
  if (entry.registryType === 'mcpb') {
    entry.identifier = `https://github.com/redpop/apple-calendar-mcp/releases/download/v${version}/apple-calendar-mcp-${version}.mcpb`
  }
}
writeJson('server.json', server)

const manifest = readJson('manifest.json')
manifest.version = version
writeJson('manifest.json', manifest)

console.log(`server.json und manifest.json auf ${version} gesetzt`)
