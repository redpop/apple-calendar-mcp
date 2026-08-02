# apple-calendar-mcp

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant
read and create events in Apple Calendar — and work out when you actually
have time.

**macOS only.** It talks to EventKit, Apple's own calendar framework, which
has no cross-platform equivalent.

```bash
claude mcp add apple-calendar -- npx -y @redpop/apple-calendar-mcp
```

No Xcode, no Swift toolchain, no repository clone. The signed helper binary
ships inside the package.

## What it does

Most calendar integrations answer *what is on my calendar*. This one also
answers **when am I free**:

```
"Find me two hours for deep work this week, outside meetings"
"When could I fit a 30-minute call with someone in Berlin?"
"Book focus time Thursday morning"
```

`find_free_time` returns the open gaps, not the busy blocks. It understands
that "work" means weekdays during working hours, that "personal" means any
day, and that all-day events usually shouldn't count as busy.

Alongside that, the usual: list calendars, read events in a range with
optional text search, create, update and delete events with location, notes,
alarms, all-day or timed. Recurring events come back as individual
occurrences, not as the master event — a detail AppleScript-based servers
routinely get wrong.

Changing or deleting an occurrence of a recurring event requires saying
explicitly whether you mean just that one or every later one too. There is
no default for that, because "cancel this Tuesday" and "never again" are not
the kind of thing to guess at.

Full parameter reference: [`docs/tools.md`](./docs/tools.md).

## Requirements

- macOS 14 (Sonoma) or newer
- Node.js 20 or newer

Nothing else. Building from source additionally needs Xcode Command Line
Tools, but installing from npm does not.

## Setup

**1. Add the server to your client.**

<details open>
<summary><strong>Claude Code</strong></summary>

```bash
claude mcp add apple-calendar -- npx -y @redpop/apple-calendar-mcp
```

</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

Quit Claude Desktop first (Cmd+Q) — it rewrites its config on exit, so
editing while it runs discards your change. Then add to
`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "apple-calendar": {
      "command": "npx",
      "args": ["-y", "@redpop/apple-calendar-mcp"]
    }
  }
}
```

</details>

<details>
<summary><strong>Cursor, Windsurf, Zed and other MCP clients</strong></summary>

Any client that speaks MCP over stdio works. The command is `npx`, the
arguments are `-y @redpop/apple-calendar-mcp`, and no environment variables
are needed.

</details>

**2. Grant calendar access on first use.**

Ask your assistant *"what calendars do I have?"*. A system dialog appears
asking to let **calendar-helper** — not your assistant, the helper itself —
access your calendar.

Confirm it, then open **System Settings → Privacy & Security → Calendars →
calendar-helper → Options…** and make sure **Full Access** is selected, not
"Add Only". Read-only access is not enough; the helper checks for full access
at startup.

This one dialog is the only manual step, and no package format can take it
away. It appears once and survives updates.

## Why the dialog says "calendar-helper"

macOS grants calendar permission to the *responsible parent process*, not to
the program actually asking. An AI client that declares no calendar usage in
its bundle therefore locks out everything it starts — silently, with no
dialog and no entry in System Settings. Several MCP calendar servers work
around this by telling you to launch your client from a terminal.

This one doesn't need that. The helper disclaims that inherited
responsibility at startup and becomes its own permission identity, so macOS
reads the usage description from *its* bundle and prompts under its own name.
One grant then covers every client on the machine.

The full story: [`docs/architecture.md`](./docs/architecture.md).

## Updating

```bash
npx -y @redpop/apple-calendar-mcp@latest
```

Your calendar grant survives updates: the helper is installed to a fixed
path, and macOS binds the grant to that path rather than to the binary's
contents.

## Uninstalling

Remove the `apple-calendar` entry from your client's MCP configuration and
restart it. Then delete the helper and its permission:

```bash
rm -rf ~/Library/Application\ Support/apple-calendar-mcp
```

The entry under **System Settings → Privacy & Security → Calendars** stays
behind — macOS keeps those even when the binary is gone. Switch it off there
if you want it revoked.

## Building from source

```bash
git clone https://github.com/redpop/apple-calendar-mcp.git
cd apple-calendar-mcp
npm install && npm run build && ./swift/build.sh
```

Then point your client at `dist/index.js` with `node` instead of using `npx`.
Without a Developer ID certificate the helper is signed ad-hoc, and macOS
then ties the calendar grant to the exact build — expect a new permission
dialog after every rebuild.

## Learn more

- [`docs/architecture.md`](./docs/architecture.md) — how the two halves fit
  together and the whole TCC permission story
- [`docs/tools.md`](./docs/tools.md) — every tool parameter, defaults, and
  the all-day alarm rule
- [`docs/cli.md`](./docs/cli.md) — the standalone `calendar-helper` command,
  useful for testing without an MCP client
- [`docs/troubleshooting.md`](./docs/troubleshooting.md) — common errors and
  how to fix them

## Privacy

Everything runs locally. Calendar data goes from EventKit to the helper to
the MCP server to your client, and nowhere else. There is no network code in
this project.

## License

MIT — see [`LICENSE`](./LICENSE).
