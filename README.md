# apple-calendar-mcp

A local [MCP](https://modelcontextprotocol.io) server that lets Claude read
and create events in Apple Calendar on macOS. **macOS only** — it uses
Apple's EventKit framework, which has no cross-platform equivalent.

## What Claude can do with it

- **List your calendars** — see every calendar configured in Calendar.app,
  including iCloud calendars.
- **List events** in a time range, with optional text search.
- **Create a new event** — title, time, location, notes, alarms, all-day or
  timed.
- **Find free time** — get open slots of a given length, restricted to
  working hours, personal hours, or any time at all.

Full details, including all parameters: [`docs/tools.md`](./docs/tools.md).

## Requirements

- macOS 14 (Sonoma) or newer
- Node.js 20 or newer
- Xcode **Command Line Tools** (`xcode-select --install`) — a full Xcode
  install is not needed

## Installation

Run these from the root of this repository, in order.

**1. Install and build.**

```bash
npm install
npm run build
./swift/build.sh
```

This installs the Node dependencies, compiles the TypeScript server to
`dist/`, and compiles + signs the Swift calendar helper to
`bin/calendar-helper`.

**2. Configure Claude Desktop.**

**Quit Claude Desktop first (Cmd+Q).** It rewrites its own config file on
exit, so editing it while Claude Desktop is still running gets your change
silently discarded.

Then add this to
`~/Library/Application Support/Claude/claude_desktop_config.json`,
replacing the path with the absolute path to `dist/index.js` in *this*
checkout:

```json
{
  "mcpServers": {
    "apple-calendar": {
      "command": "node",
      "args": ["/absolute/path/to/apple-calendar-mcp/dist/index.js"]
    }
  }
}
```

**3. Start Claude Desktop again.**

It only reads the config file on startup, so this is what picks up the new
server.

**4. Grant calendar access on first use.**

Ask Claude "what calendars do I have?". A system dialog appears, asking to
let **calendar-helper** access your calendar — not Claude, the helper itself.
Click **OK**, then open **System Settings → Privacy & Security → Calendars →
calendar-helper → Options…** and make sure **Full Access** is selected, not
"Add Only". Read-only access is not enough; the helper checks for full access
at startup.

There is no service to install and nothing to start beforehand. The helper is
launched on demand as a child process of the MCP server and makes itself
responsible for its own calendar permission, so it prompts under its own name
even though Claude Desktop started it.

## Did it work?

Ask again after granting access. It should list your calendars. If instead you
get a permission error or no tools appear, see
[`docs/troubleshooting.md`](./docs/troubleshooting.md).

## Updating after code changes

```bash
./swift/build.sh && npm run build
```

Then restart Claude Desktop — it loads `dist/index.js` once at startup.

With a Developer ID certificate, your calendar grant survives a rebuild.
Without one, expect a fresh permission dialog every time.

## Uninstalling

Remove the `apple-calendar` entry from
`~/Library/Application Support/Claude/claude_desktop_config.json` and restart
Claude Desktop. Nothing else is installed on your system.

This does not revoke the calendar grant itself — do that under **System
Settings → Privacy & Security → Calendars** if you want it gone too.

## Learn more

- [`docs/architecture.md`](./docs/architecture.md) — how the pieces fit
  together, and why a background service is required at all (the whole TCC
  permissions story).
- [`docs/tools.md`](./docs/tools.md) — full MCP tool reference: every
  parameter, defaults, and the all-day alarm rule.
- [`docs/cli.md`](./docs/cli.md) — the standalone `calendar-helper`
  command-line tool, useful for testing without an MCP client.
- [`docs/troubleshooting.md`](./docs/troubleshooting.md) — common errors and
  how to fix them.

## License

MIT — see [`LICENSE`](./LICENSE).
