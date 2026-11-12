# apple-calendar-mcp

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant
read, create, change and delete events in Apple Calendar — and work out
when you actually have time.

**macOS only.** It talks to EventKit, Apple's own calendar framework, which
has no cross-platform equivalent.

```bash
claude mcp add apple-calendar -- npx -y @redpop/apple-calendar-mcp
```

In Claude Desktop and Cowork, install the `.mcpb` bundle from the
[latest release](https://github.com/redpop/apple-calendar-mcp/releases/latest)
instead; see [Setup](#setup).

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

It can also keep a buffer around each meeting, because a gap wedged directly
between two calls is free on paper and useless in practice.

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
<summary><strong>Claude Desktop and Cowork</strong></summary>

Download `apple-calendar-mcp-<version>.mcpb` from the
[latest release](https://github.com/redpop/apple-calendar-mcp/releases/latest)
and open it. Claude Desktop installs the extension with its description and
icon; there are no settings to fill in. Desktop runs the extension on your
Mac and makes it available in Cowork too.

If you added the server to `claude_desktop_config.json` before, remove that
`apple-calendar` entry after installing the extension (quit Claude Desktop
with Cmd+Q first, it rewrites the file on exit). Your calendar grant carries
over: both run the same helper from the same place.

Each release lists `SHA256SUMS` and carries build provenance attestations for
the `.mcpb` and `calendar-helper.zip`.

</details>

<details open>
<summary><strong>Claude Code</strong></summary>

As a plugin, which follows each release after seven days:

```
/plugin install apple-calendar-mcp --marketplace redpop/apple-calendar-mcp
```

Or directly, always at the newest version:

```bash
claude mcp add apple-calendar -- npx -y @redpop/apple-calendar-mcp
```

The plugin works only in Claude Code. Cowork starts a plugin's local server
inside its Linux virtual machine, away from Apple Calendar, and the Claude
desktop chat ignores local servers from plugins. Use the `.mcpb` for both.

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

## Approving changes

`create_event`, `update_event` and `delete_event` change your calendar, and
there is no undo. They are not marked read-only, so a client that asks before
tool calls asks before these — but only in a mode that asks.

In Claude Desktop and Cowork, the **Auto** mode does not ask: Claude creates,
changes and deletes events without a prompt, even when the tool is set to
"Needs approval". Only **Manual** asks before each change. Pick Manual if you
want to confirm every change. In Claude Code, modes that approve tools on
their own, such as auto mode or skipping permissions, have the same effect.

The three read tools (`list_calendars`, `list_events`, `find_free_time`) are
marked read-only and never change anything.

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

With the `.mcpb`, open the bundle of the new release; Claude Desktop keeps
the extension enabled. The Claude Code plugin moves to a new release
seven days after it is on npm, so an npm release cooldown of up to seven days
does not block it. With `npx` and no version in the command, the next
client start may pick up the new version; to fetch it right away:

```bash
npx -y @redpop/apple-calendar-mcp@latest
```

Your calendar grant survives updates: the helper is installed to a fixed
path, and macOS binds the grant to that path rather than to the binary's
contents.

## Uninstalling

Remove the extension in Claude Desktop (Settings → Extensions), or the
`apple-calendar` entry from your client's MCP configuration, and restart the
client. Then delete the installed helper:

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

## Privacy Policy

This policy covers the server and its helper, as published on npm, in the
GitHub releases (including the `.mcpb` bundle) and in the MCP Registry.

### What is collected

Nothing is collected by the author or by any service. The server has no
telemetry, analytics or crash reporting, and neither the server nor the
helper opens a network connection.

On your Mac, the helper reads what a tool call asks for through EventKit,
Apple's calendar framework: the list of calendars, and events in the date
range of the request, with title, time, location, notes, URL, status and
whether the event repeats. It does not read attendees, invitations or
reminders.

### How it is used and stored

Data is read only when your AI client calls a tool, and the result goes back
only to that client. `create_event`, `update_event` and `delete_event` change
your calendar exactly as the call says; macOS then syncs the change like any
other edit in Calendar, for example to iCloud.

The server stores no calendar data. The only file it writes is a copy of the
helper at
`~/Library/Application Support/apple-calendar-mcp/bin/calendar-helper`,
because the calendar permission is bound to that path. Error messages go to
stderr; your client decides whether it keeps them in its logs.

### Sharing with third parties

The server shares nothing with anyone. What your AI client does with a tool
result is covered by the client's and the model provider's privacy policies:
a cloud-hosted model receives the results the client sends it. Installing or
updating through npm or `npx` downloads the package from the npm registry,
under npm's terms; the `.mcpb` comes from GitHub, under GitHub's terms.

### Retention

The server keeps nothing between calls. The helper copy stays until you
delete `~/Library/Application Support/apple-calendar-mcp/`. The calendar
permission stays in System Settings until you switch it off there.

### Contact

Questions about this policy: open an issue at
<https://github.com/redpop/apple-calendar-mcp/issues>.

## License

MIT — see [`LICENSE`](./LICENSE).
