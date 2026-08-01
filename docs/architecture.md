# Architecture

[← Back to README](../README.md)

## The three parts

- **`swift/main.swift`** — a Swift command-line tool that wraps EventKit.
  Most of its subcommands (`check-access`, `list-calendars`, `list-events`,
  `create-event`) are one-shot: invoked with a single subcommand and, where
  needed, a JSON payload on stdin, they print a JSON result to stdout on
  success (exit code 0) or a JSON error object `{"code": ..., "message":
  ...}` to stderr (exit code 1) on failure. The `serve` subcommand is
  different: it stays running as a long-lived daemon, listening on a Unix
  domain socket and handling one JSON request per connection in the same
  `{"command": ..., "payload": ...}` / `{"ok": ..., ...}` shape. Either way,
  it never touches stdout except for that one JSON reply, and it can only be
  invoked with hardcoded arguments — it has no other externally reachable
  behavior.
- **`launchagent/`** — install/uninstall scripts that register `calendar-helper
  serve` as a per-user LaunchAgent, so it starts automatically at login and
  is restarted if it dies. This is not an optional convenience layer; see
  "Why a LaunchAgent" below for why it's required.
- **`src/`** — a TypeScript MCP server that, for every tool call, connects to
  the helper's Unix socket (`src/socketRunner.ts`) and falls back to spawning
  the helper binary directly (`src/helper.ts`) only if the socket isn't
  reachable. It validates the helper's JSON with [Zod](https://zod.dev) and
  exposes four MCP tools to the client.

## Why a LaunchAgent, not a spawned child process

Earlier versions of this project spawned `bin/calendar-helper` as a child
process of the MCP server for every request. **That does not work under
Claude Desktop, and it cannot be made to work.** Two independent macOS
mechanisms rule it out:

**1. TCC grants calendar access to the responsible parent process, not to
the binary that actually calls EventKit.** When a sandboxed or unentitled
process asks for calendar access, macOS attributes the request to whichever
app is ultimately responsible for having launched it — and it looks up that
app's usage-description string to decide whether to even show a dialog.
Claude Desktop declares no calendar usage description anywhere in its app
bundle (verified by inspecting every `Info.plist` inside
`/Applications/Claude.app`). That means anything Claude Desktop spawns is
permanently denied calendar access: no dialog appears, no entry shows up in
System Settings, and there is no switch to flip — short of Anthropic adding
that usage description to Claude Desktop itself, there is nothing this
project can do about it from the child-process side. This was confirmed
directly: called from a Claude-Desktop-spawned child process, the binary
returns `PERMISSION_DENIED`; the very same process, going through the socket
instead, reaches all six calendars.

Running the helper under `launchd` instead sidesteps the problem entirely —
`launchd` is the helper's responsible process, so it gets its own TCC
identity. It asks for access under its own name and shows up as
`calendar-helper` in System Settings → Privacy & Security → Calendars, with
its own dialog and its own grant. The MCP server then reaches it as a client
over a Unix socket rather than launching it.

**2. Code signing determines whether the grant survives a rebuild.** With
ad-hoc signing (`codesign --sign -`), macOS binds the grant to the code
hash, which changes on every build — so a rebuilt binary looks like a
different, ungranted program, and macOS refuses it *silently*, without ever
offering a dialog. With a Developer ID certificate, the grant binds to
bundle ID + team ID instead, so it survives rebuilds and even a later
certificate renewal. `swift/build.sh` picks whichever is available: it uses
a Developer ID identity automatically if one is installed
(`security find-identity -v -p codesigning`), and falls back to ad-hoc
signing otherwise. Most readers of this project will not have a Developer ID
certificate, so both paths matter — see [`docs/troubleshooting.md`](./troubleshooting.md)
for what each implies in practice.

**3. Hardened runtime requires an explicit calendar entitlement.** Developer
ID signing, as used here, enables the hardened runtime (and notarization
would require it too). With hardened runtime on, macOS demands the
`com.apple.security.personal-information.calendars` entitlement before it
will even consider a calendar request — without it, the request is refused
with no dialog at all, even immediately after a `tccutil reset`.
`swift/calendar-helper.entitlements` declares exactly that one entitlement.
One easy-to-hit trap: the entitlements plist must contain **no XML
comments** — Apple's AMFI parser rejects them with a syntax error, not a
helpful message.

## The Unix socket

`launchd` starts `calendar-helper serve`, which listens on a Unix domain
socket at `~/Library/Application Support/apple-calendar-mcp/helper.sock`
(mode `0600`, owner-only), rather than exiting after a single call. The
TypeScript MCP server connects to that socket for every tool call
(`src/socketRunner.ts`) and only falls back to spawning the helper binary
directly (`src/helper.ts`) if the socket isn't reachable — a fallback that
only actually works when the MCP server's own parent process already holds
the calendar grant (e.g. a terminal), not under Claude Desktop. The socket
path can be overridden on the Node side with the `APPLE_CALENDAR_SOCKET`
environment variable, and on the Swift side with `--socket` (see
[`docs/cli.md`](./cli.md)).

Before it starts listening, `serve` checks calendar access once, waiting up
to 30 seconds for a decision; if nothing arrives in that window it exits
with `PERMISSION_TIMEOUT` rather than hanging forever with no explanation.

## Installed layout

The socket-serving binary is installed to
`~/Library/Application Support/apple-calendar-mcp/calendar-helper` —
deliberately outside the repo, copied there by `launchagent/install.sh`. This
is not just tidiness: a LaunchAgent that pointed at `bin/calendar-helper`
inside your checkout would break the moment you moved the project or ran `git
clean` on `bin/`. The LaunchAgent plist itself lives at
`~/Library/LaunchAgents/io.github.apple-calendar-mcp.helper.plist`, its log
at `~/Library/Logs/apple-calendar-mcp.log`, and the socket at
`~/Library/Application Support/apple-calendar-mcp/helper.sock`. None of this
depends on where you cloned the repo.

## Why free-slot computation lives in TypeScript

`find_free_time` computes free gaps purely in TypeScript
(`src/freeTime.ts`) from the events `list_events` returns — it does not call
a separate Swift helper command. EventKit's job is limited to fetching
events; everything about turning a list of busy events into a list of free
slots (working-hours windows, day-of-week filtering, gap arithmetic) is
ordinary logic with no dependency on EventKit or the Swift/TCC machinery, so
it lives on the TypeScript side where it's easier to test (see
`tests/freeTime.test.ts`) and doesn't need a live calendar or a granted TCC
permission to run in CI.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # compile TypeScript to dist/
npm run build:helper  # compile + sign the Swift helper (equivalent to ./swift/build.sh)
```

The test suite (`tests/`) covers the TypeScript layer only — schemas, the
free-time algorithm, error handling, and tool wiring — since the Swift
helper needs a real calendar and a live TCC grant that CI does not have.

## Scope

This version implements four tools: `list_calendars`, `list_events`,
`create_event`, and `find_free_time`. **`update_event` and `delete_event`
are deliberately not included** in this version — the data model has fields
that would support them later, but the operations themselves don't exist
yet. Also out of scope: Reminders (`EKReminder`), invitations/attendees,
querying other people's availability, and any platform other than macOS.

---

[← Back to README](../README.md)
