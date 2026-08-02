import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * server.json beschreibt den Server fuer die offizielle MCP Registry.
 *
 * Diese Datei wird sonst erst beim Release validiert — von der Registry
 * selbst, ganz am Ende eines Laufs, nachdem npm-Paket und GitHub-Release
 * bereits veroeffentlicht sind. Genau so ist v0.1.0 gescheitert: an einer
 * Beschreibung von 177 Zeichen bei erlaubten 100.
 *
 * Die Regeln stehen in
 * https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/
 */
function readJson(relative: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(`../${relative}`, import.meta.url))
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

interface ServerManifest {
  name: string
  title: string
  description: string
  version: string
  repository: { url: string; source: string }
  packages: { registryType: string; registryBaseUrl: string; identifier: string; version: string; transport: { type: string } }[]
}

const server = readJson('server.json') as unknown as ServerManifest
const pkg = readJson('package.json') as unknown as { name: string; version: string; mcpName: string }

describe('server.json', () => {
  it('haelt die Laengenbegrenzung der Registry fuer description ein', () => {
    expect(server.description.length).toBeLessThanOrEqual(100)
  })

  it('nennt einen Namen im GitHub-Namensraum', () => {
    // Bei GitHub-Authentifizierung muss der Name mit io.github.<user>/
    // beginnen, sonst weist die Registry ihn zurueck.
    expect(server.name).toMatch(/^io\.github\.[a-z0-9-]+\/[a-z0-9-]+$/)
  })

  it('stimmt mit dem mcpName in package.json ueberein', () => {
    // Der Eigentumsnachweis: Die Registry prueft, ob das npm-Paket dieses
    // Feld traegt. Weichen die beiden ab, schlaegt die Veroeffentlichung
    // mit einem wenig aussagekraeftigen Fehler fehl.
    expect(pkg.mcpName).toBe(server.name)
  })

  it('verweist auf genau das npm-Paket, das hier gebaut wird', () => {
    expect(server.packages).toHaveLength(1)
    expect(server.packages[0]?.identifier).toBe(pkg.name)
  })

  it('haelt die Versionen mit package.json im Gleichklang', () => {
    // Der Release-Workflow setzt beide aus package.json. Stimmen sie schon
    // im Repository, ist der Diff nach einem Lauf leer und man sieht sofort,
    // welche Version eingetragen wurde.
    expect(server.version).toBe(pkg.version)
    expect(server.packages[0]?.version).toBe(pkg.version)
  })

  it('nutzt eine von der Registry zugelassene Paketquelle', () => {
    // Nur bestimmte oeffentliche Registries sind erlaubt; Spiegel und
    // private Registries weist die offizielle Registry zurueck.
    expect(server.packages[0]?.registryType).toBe('npm')
    expect(server.packages[0]?.registryBaseUrl).toBe('https://registry.npmjs.org')
  })

  it('deklariert stdio als Transport', () => {
    expect(server.packages[0]?.transport.type).toBe('stdio')
  })

  it('zeigt auf das richtige Repository', () => {
    expect(server.repository.source).toBe('github')
    expect(server.repository.url).toBe('https://github.com/redpop/apple-calendar-mcp')
  })
})
