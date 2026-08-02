# Architecture

[← Back to README](../README.md)

## The two parts

- **`swift/main.swift`** — a Swift command-line tool wrapping EventKit. Its
  one-shot subcommands (`check-access`, `list-calendars`, `list-events`,
  `create-event`, `update-event`, `delete-event`) take a JSON payload on stdin
  and print a JSON result to
  stdout on success (exit 0), or `{"code": ..., "message": ...}` to stderr on
  failure (exit 1). The `serve` subcommand stays running instead and handles
  one JSON line per request on stdin, answering on stdout in the same
  `{"command": ..., "payload": ...}` / `{"ok": ..., ...}` shape. Either way
  it writes nothing to stdout but those replies.
- **`src/`** — a TypeScript MCP server that keeps one `calendar-helper serve`
  process running and talks to it over its stdin and stdout
  (`src/stdioRunner.ts`). It validates the helper's JSON with
  [Zod](https://zod.dev) and exposes six MCP tools.

There is no third part. Earlier versions had a LaunchAgent and a Unix socket;
both are gone, and the reason they existed is worth understanding, because it
still shapes everything else.

## The permission problem

macOS grants calendar access to the **responsible parent process**, not to
the binary that calls EventKit. When an unentitled process asks for access,
the system attributes the request to whichever app is ultimately responsible
for launching it, and looks up *that* app's usage-description string to
decide whether to even show a dialog.

A GUI client like Claude Desktop declares no calendar usage description
anywhere in its bundle. So anything it spawns is denied: no dialog, no entry
in System Settings, no switch to flip. Verified directly — called from a
process the client started, the helper returned `PERMISSION_DENIED`; the same
binary invoked from a terminal reached all six calendars.

This is not a niche problem. Comparable MCP calendar servers hit it too, and
their documented workaround is to tell users to launch their client from a
terminal so the terminal's own grant is inherited.

## How the helper escapes it

At startup, before touching EventKit, the helper **disclaims the
responsibility it inherited** and re-executes itself:

```swift
posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETEXEC))
responsibility_spawnattrs_setdisclaim(&attributes, 1)
posix_spawn(&pid, executable, nil, &attributes, &arguments, &environment)
```

`POSIX_SPAWN_SETEXEC` replaces the process image in place, so no extra
process appears and stdio, exit codes and signals pass through untouched.
`responsibility_spawnattrs_setdisclaim` drops the parent's TCC
responsibility, which makes the binary its own responsible process. macOS
then reads the usage description from *its* embedded `Info.plist` and prompts
under the name `calendar-helper`.

An environment marker (`CALENDAR_HELPER_DISCLAIMED`) breaks what would
otherwise be an infinite re-exec loop.

`responsibility_spawnattrs_setdisclaim` is private libSystem API, available
since macOS 10.14 — the same call Chromium uses to make its helper processes
self-responsible. It is resolved through `dlsym` at runtime rather than
linked, so a future macOS dropping the symbol degrades to the old, broken
behaviour instead of failing to load.

One grant obtained this way covers every MCP client on the machine.

## One long-lived process, not one per request

The helper could be spawned per tool call. It isn't, because process start,
the disclaim re-exec, `EKEventStore` setup and the TCC check would then be
paid every single time. Measured on an M-series Mac with six calendars:

| | |
|---|---|
| first call | 324 ms |
| every call after | 1 ms |

`src/stdioRunner.ts` starts the helper lazily on the first tool call — not at
server startup, so the permission dialog appears when someone actually asks
about their calendar rather than when they open their client. Requests are
queued FIFO and carry an `id` the helper mirrors back; the serve loop is
strictly sequential, so the id isn't needed for correlation, but it turns a
desynchronisation into a loud failure instead of silently swapped answers.

When the MCP server exits, Node closes the helper's stdin, the helper sees
EOF and exits. If it crashes, pending requests are rejected with
`HELPER_CRASHED` and the next call starts a fresh one.

The first request after a start gets a 35-second deadline, later ones 10
seconds. `serve` waits up to 30 seconds for the TCC answer at startup, and a
human may need to click a dialog in that window. **The two deadlines belong
together** — changing one without the other breaks first-run setup.

## Where the helper runs from

Not from the package directory. `src/helperInstall.ts` copies it to
`~/Library/Application Support/apple-calendar-mcp/bin/calendar-helper` on
first use and spawns it from there.

The reason is measurable: **macOS binds a command-line tool's calendar grant
to its path.** A byte-identical copy at a different path triggers a fresh
permission dialog and gets its own entry in System Settings. The code hash,
by contrast, is irrelevant — the binary here was rebuilt twice after being
granted access and kept working.

Since npm unpacks packages under version-dependent paths, running the helper
from where npm put it would prompt again on every update. A fixed path avoids
that entirely.

Copying goes through a `.tmp` file and `rename()`. A running binary cannot be
overwritten on macOS (ETXTBSY), and deleting the target first would briefly
give up the very path the grant hangs on; `rename()` replaces only the
directory entry, and an already-running process keeps its old inode.

If any of that fails, the packaged path is used instead — the grant then
follows the moving path and updates re-prompt, but the server works.

## Code signing

`swift/build.sh` uses a Developer ID certificate when one is installed and
falls back to ad-hoc signing otherwise. The difference matters:

- **Ad-hoc** binds the grant to the code hash, which changes on every build.
  A rebuilt binary looks like a different, ungranted program, and macOS
  refuses it *silently*, without offering a dialog.
- **Developer ID** survives rebuilds. Released binaries are signed this way,
  which is why an update never costs a second permission dialog.

Developer ID signing enables the hardened runtime, and with it macOS demands
the `com.apple.security.personal-information.calendars` entitlement before it
will consider a calendar request at all — without it the request is refused
with no dialog, even right after a `tccutil reset`.
`swift/calendar-helper.entitlements` declares exactly that.

One easy trap: that entitlements plist must contain **no XML comments**.
Apple's AMFI parser rejects them with a syntax error rather than anything
helpful.

## Universal binary

The helper ships inside the npm package, so it is built for both `arm64` and
`x86_64` against a macOS 14 deployment target and joined with `lipo`. An
arm64-only build would break on Intel Macs — and only at the user's end,
never at build time. Signing happens on the finished fat binary, since `lipo`
would invalidate per-slice signatures anyway. CI asserts both architectures
are present on every pull request.

## Why free-slot computation lives in TypeScript

`find_free_time` computes free gaps purely in TypeScript (`src/freeTime.ts`)
from the events `list_events` returns. EventKit's job is limited to fetching
events; turning a list of busy events into a list of free slots is ordinary
arithmetic with no dependency on EventKit or the TCC machinery.

That module has zero imports and reads no clock, which is why the project's
real test coverage lives there rather than in Swift — it runs in CI with no
calendar and no permission.

## Development

```bash
npm run typecheck     # tsc --noEmit
npm test              # vitest run
npm run build         # compile TypeScript to dist/
npm run build:helper  # compile + sign the Swift helper (universal)
```

The test suite covers the TypeScript layer — schemas, the free-time
algorithm, error handling, tool wiring, the stdio transport and the install
path. The Swift helper needs a real calendar and a live TCC grant, which CI
does not have.

Note that stdout carries protocol on **both** legs: MCP messages between
client and Node, NDJSON between Node and the helper. A stray `console.log` in
`src/` corrupts the first; a stray `print()` in `swift/main.swift` corrupts
the second. Use `serveLog()` in Swift, which writes to stderr.

## Scope

Six tools: `list_calendars`, `list_events`, `create_event`, `update_event`,
`delete_event`, `find_free_time`.

The two writing tools arrived later than the rest, using the `eventIdentifier`
plus `occurrenceDate` pair the data model had carried from the start —
`eventIdentifier` alone names a recurring *series*, not one occurrence.

`span` has no default on recurring events, deliberately. "Cancel this Tuesday"
and "cancel every one from now on" cannot be undone, so omitting it is
`INVALID_INPUT` rather than a quiet `thisEvent`. There is no `all` either:
EventKit cannot reach occurrences in the past, so the name would promise more
than it delivers.

Also out of scope: Reminders (`EKReminder`), invitations and attendees,
querying other people's availability, moving an event between calendars, and
any platform other than macOS.

---

[← Back to README](../README.md)
