import { readFileSync } from 'node:fs'
import type { McpServer } from '@modelcontextprotocol/server'
import { describe, expect, it } from 'vitest'
import type { HelperRunner } from '../src/helper.js'
import { registerTools } from '../src/tools/index.js'

const read = (name: string): string => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
const manifest = JSON.parse(read('manifest.json')) as Record<string, any>
const pkg = JSON.parse(read('package.json')) as { version: string; engines: { node: string } }

function registeredToolNames(): string[] {
  const names: string[] = []
  const server = { registerTool: (name: string) => names.push(name) } as unknown as McpServer
  const runner: HelperRunner = { run: () => Promise.resolve(undefined) }
  registerTools(server, runner)
  return names
}

describe('manifest.json', () => {
  it('carries the package version', () => {
    expect(manifest.version).toBe(pkg.version)
  })

  it('lists exactly the registered tools', () => {
    const listed = (manifest.tools as { name: string }[]).map((tool) => tool.name)
    expect(listed.sort()).toEqual(registeredToolNames().sort())
  })

  it('starts dist/index.js with node and passes no environment', () => {
    expect(manifest.server).toMatchObject({ type: 'node', entry_point: 'dist/index.js' })
    expect(manifest.server.mcp_config).toEqual({ command: 'node', args: ['${__dirname}/dist/index.js'] })
  })

  // Der Server liest keine Einstellungen. Ein Pflichtfeld hielte die
  // Erweiterung in Claude Desktop nach der Installation deaktiviert, und
  // APPLE_CALENDAR_HELPER_PATH ist nur fuer die Entwicklung gedacht.
  it('has no user_config', () => {
    expect(manifest.user_config).toBeUndefined()
  })

  it('links the privacy policy in the README', () => {
    expect(manifest.privacy_policies).toEqual(['https://github.com/redpop/apple-calendar-mcp#privacy-policy'])
  })

  it('runs on macOS with the Node versions the package accepts', () => {
    expect(manifest.compatibility.platforms).toEqual(['darwin'])
    expect(manifest.compatibility.runtimes.node).toBe(pkg.engines.node)
  })
})
