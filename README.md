# apple-calendar-mcp

A local [MCP](https://modelcontextprotocol.io) server that gives Claude (or any
other MCP client) read and write access to the macOS Calendar app, via
Apple's EventKit framework.

**macOS only, by design.** EventKit is a macOS/iOS framework with no
cross-platform equivalent, and the permission model (TCC) described below is
macOS-specific. There is no Windows or Linux support and none is planned.

The server runs entirely on your machine. It never talks to a network
service — every request goes straight to the local Calendar database through
a small Swift helper, reached over a Unix domain socket.

## Architecture

The project has three parts:

- **`swift/main.swift`** — a Swift command-line tool that wraps EventKit. Most
  of its subcommands (`check-access`, `list-calendars`, `list-events`,
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
signing otherwise. Most readers of this README will not have a Developer ID
certificate, so both paths matter — see "Granting calendar access" below for
what each implies in practice.

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

## Requirements

- macOS 14 (Sonoma) or newer — the permission APIs used here (full vs.
  add-only calendar access) were introduced in macOS 14.
- Node.js 20 or newer.
- Xcode **Command Line Tools** (`xcode-select --install`) to get the Swift
  compiler. A full Xcode installation is **not** required.

## Installation

```bash
npm install
npm run build
./swift/build.sh
bash launchagent/install.sh
```

`npm run build` compiles the TypeScript server to `dist/`. `./swift/build.sh`
compiles the Swift helper to `bin/calendar-helper`, signing it with a
Developer ID identity if one is installed and falling back to ad-hoc signing
otherwise (see "Why a LaunchAgent" above). `bash launchagent/install.sh`
copies that binary to a stable location outside the repo
(`~/Library/Application Support/apple-calendar-mcp/calendar-helper` — see
"Installed layout" below), writes and loads a LaunchAgent that runs it as
`calendar-helper serve`, and waits (up to 10 seconds) for its Unix socket to
appear.

On first install — or the first run after an ad-hoc-signed rebuild — macOS
shows a calendar-access dialog under the name **calendar-helper**. Approve
it (with "Full Access", not "Add Only" — see below). Once the script reports
the socket is up:

1. **Configure Claude Desktop** (see below), making sure Claude Desktop is
   quit while you edit its config file.
2. **Restart Claude Desktop.**

To remove the LaunchAgent again, run `bash launchagent/uninstall.sh`. It
unloads the service and deletes the plist and socket; it does **not** revoke
the calendar grant itself, since that's tied to the binary's code identity,
not to the LaunchAgent registration (see "Resetting calendar access" below).

**After changing the Swift source:** rerun `./swift/build.sh && bash
launchagent/install.sh`. With a Developer ID certificate, the existing grant
survives this — you won't be prompted again. With ad-hoc signing, expect a
fresh dialog every time, since the rebuilt binary has a new code hash.

## Granting calendar access (read this before configuring Claude Desktop)

### The two grant levels (macOS 14+)

Open **System Settings → Privacy & Security → Calendars**. You should see an
entry named **calendar-helper** — this is new; older versions of this
project showed *Terminal* or *Claude* here instead, because the grant used
to belong to whichever app launched the helper. Now that the helper runs
under `launchd`, it has its own entry.

macOS 14+ distinguishes two access levels for each app in that list. **The
on/off toggle next to the app's name does not expose this choice at all** —
you can have the toggle ON and still be stuck on the lower level. The level
lives one layer deeper, behind the **Options…** button ("Optionen …" in the
German settings pane, which is what you'll actually be looking at if macOS
is set to German) next to the app's entry. Clicking it opens a small dialog
offering exactly two choices:

- **"Add Only"** ("Zugriff nur zum Hinzufügen" in German) — the app can
  create events but cannot read existing ones. This server treats it the
  same as no access and returns a `PERMISSION_DENIED` error, because every
  one of this server's tools needs to read (even `create_event` needs to
  look up calendars first).
- **"Full Access"** ("Vollzugriff auf Kalender" in German) — required for
  everything this server does.

This is the single most common trap: a user sees the toggle already ON,
concludes access is granted, and doesn't think to look for a second,
separate control — then gets a confusing `PERMISSION_DENIED` from a tool
that appears to already have permission. If you get a permission error even
though you granted *something*, this is the first thing to check: open
**Options…** ("Optionen …") next to **calendar-helper**'s entry and confirm
"Full Access" / "Vollzugriff auf Kalender" is selected, not "Add Only".

### Why you will never see a dialog from Claude Desktop itself

This is deliberate, not a bug to work around: Claude Desktop cannot obtain
calendar access, under any configuration, because it declares no calendar
usage description in its app bundle. If you ever find yourself digging
through Claude Desktop's own entry in System Settings looking for a
calendar toggle, stop — it isn't there, and it never will be until Claude
Desktop's own `Info.plist` changes. The LaunchAgent exists specifically to
route around this; see "Why a LaunchAgent" above.

## Configuring Claude Desktop

Add the server to
`~/Library/Application Support/Claude/claude_desktop_config.json`:

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

Replace the path with the absolute path to `dist/index.js` in *your* clone
of this repository.

**Quit Claude Desktop before editing this file, not after.** Claude Desktop
rewrites `claude_desktop_config.json` on exit, so if it's still running
while you edit it, your changes get silently overwritten the next time it
quits. Quit it first (Cmd+Q), edit the file, then start Claude Desktop again
— it only reads this file on startup.

The MCP server itself talks to the calendar helper over the Unix socket
described above; it does not need calendar access itself, only permission to
connect to a local socket file, which every process has.

## CLI reference

Every command below is a standalone subcommand of `bin/calendar-helper`. The
first four are one-shot: a payload goes in on stdin as JSON, and the result
comes out on stdout as JSON. `serve`, covered last, is different — it's the
long-running daemon. These are useful for verifying the helper works before
wiring it into an MCP client, and for debugging — though under normal
operation you won't run any of them directly, since
`launchagent/install.sh` starts and manages `serve` for you.

### `check-access`

```bash
./bin/calendar-helper check-access
```

Requests calendar access if not yet decided, otherwise reports the current
status. Returns `{"status":"authorized"}` on success (exit 0), or a JSON
error on stderr (exit 1) otherwise.

### `list-calendars`

```bash
./bin/calendar-helper list-calendars
```

Lists every calendar configured in Calendar.app, including iCloud
calendars. Returns `{"calendars": [...]}`, each entry with `id`, `title`,
`type`, `source`, `color`, and `allowsModifications`.

### `list-events`

```bash
echo '{"start":"2026-08-01T00:00:00+02:00","end":"2026-08-31T23:59:59+02:00"}' \
  | ./bin/calendar-helper list-events
```

Returns `{"events": [...], "totalMatched": <n>, "truncated": <bool>}`.
Recurring events are expanded into individual instances (via
`EKEventStore.events(matching:)`, not custom expansion logic). Optional
fields: `calendarIds` (array, restrict to specific calendars), `query`
(case-insensitive substring match on title and notes), `maxResults`
(default 200 in the MCP layer; the CLI itself has no default and returns
everything unless `maxResults` is supplied).

Measured performance on real calendar data: querying a full month returned
in **0.081 s**, well inside the project's one-second target.

### `create-event`

```bash
echo '{"title":"Dentist","start":"2026-08-05T10:00:00+02:00","end":"2026-08-05T11:00:00+02:00","location":"Main St 1","notes":"Checkup","alarmMinutesBefore":[60,1440]}' \
  | ./bin/calendar-helper create-event
```

Creates a new event and returns `{"event": {...}}` in the same shape as
`list-events`. Without `calendarId`, the default calendar for new events is
used. Writing to a read-only calendar (for example a subscribed holiday
calendar) fails with `CALENDAR_READONLY`. See the all-day alarm rule below
for what happens with `allDay: true`.

### `serve`

```bash
./bin/calendar-helper serve [--socket /custom/path]
```

Not one-shot: runs as a long-lived daemon, listening on a Unix domain socket
(default `~/Library/Application Support/apple-calendar-mcp/helper.sock`,
overridable with `--socket`) and handling one JSON request per connection.
Before it starts listening, it checks calendar access once, waiting up to 30
seconds for a decision; if nothing arrives in that window it exits with
`PERMISSION_TIMEOUT` rather than hanging forever with no explanation. This
is what `launchagent/install.sh` registers as a LaunchAgent — see
"Why a LaunchAgent" above for why this exists as a daemon at all rather than
a one-shot command like the others.

## MCP tools

The server exposes four tools, registered in `src/tools/`. All four have
`openWorldHint: false`. The three read tools (`list_calendars`,
`list_events`, `find_free_time`) are `readOnlyHint: true` and idempotent;
`create_event` is not read-only, not idempotent (calling it twice creates
two events), and explicitly not destructive (it never modifies or deletes
existing events).

### `list_calendars`

No input. Lists every configured calendar, including iCloud. Does not read
events — that's `list_events`.

### `list_events`

Reads events in a time range. Input (from `src/schemas.ts`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `start` | ISO 8601 datetime with offset | yes | Start of the range |
| `end` | ISO 8601 datetime with offset | yes | End of the range |
| `calendarIds` | string array | no | Restrict to these calendars; default: all |
| `query` | string | no | Case-insensitive substring filter on title/notes |
| `maxResults` | positive integer | no | Default 200 |

Recurring events come back as individual instances. All-day events carry
extra `startDay` / `endDay` fields (see below). If more events matched than
`maxResults`, the response includes a plain-language note stating how many
of how many total are shown, rather than relying on the `truncated` boolean
alone — so a truncated list isn't mistaken for a complete one. This tool
changes nothing; it never creates, updates, or deletes.

### `create_event`

Creates a new event. Input:

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | string (non-empty) | yes | |
| `start` | ISO 8601 datetime with offset | yes | |
| `end` | ISO 8601 datetime with offset | yes | |
| `calendarId` | string | no | Default: the default calendar for new events |
| `allDay` | boolean | no | Default `false` |
| `location` | string | no | |
| `notes` | string | no | |
| `url` | string | no | |
| `alarmMinutesBefore` | array of non-negative integers | no | Minutes before `start`; see the all-day rule below for `allDay: true` |

Read-only calendars are rejected with a clear error. This tool never
modifies or deletes existing events — that capability does not exist in
this version (see "Scope" below).

### `find_free_time`

Finds free slots of at least `durationMinutes` length, computed purely in
TypeScript (`src/freeTime.ts`) from the events `list_events` returns — it
does not call a separate helper command. Input:

| Field | Type | Required | Notes |
|---|---|---|---|
| `start` | ISO 8601 datetime with offset | yes | Start of the search window |
| `end` | ISO 8601 datetime with offset | yes | End of the search window |
| `durationMinutes` | positive integer | yes | Required free duration |
| `calendarIds` | string array | no | Only these calendars count as busy |
| `activityDomain` | `work` \| `personal` \| `unrestricted` | no | Default `work`; see table below |
| `workingHours` | `{ start: "HH:MM", end: "HH:MM" }` | no | Overrides only the *hours* of `activityDomain`, not which days are eligible |
| `ignoreAllDay` | boolean | no | Default `true`; all-day events don't count as busy |

`activityDomain` controls both which days and which hours of the day are
considered:

| `activityDomain` | Days | Hours |
|---|---|---|
| `work` (default) | Monday–Friday | 09:00–18:00 |
| `personal` | every day | 09:00–18:00 |
| `unrestricted` | every day | 00:00–24:00 |

`workingHours` only ever replaces the hour range; it cannot be used to add
or remove days from a domain (e.g. you cannot use it to make `work` include
Saturdays — use `personal` or `unrestricted` for that).

This tool returns free gaps, not the busy events themselves (`list_events`
is for that), and it creates nothing.

## All-day events and the alarm rule

All-day events carry two extra fields not present on timed events:
`startDay` and `endDay`, both plain `YYYY-MM-DD` dates with no time or
offset. `endDay` is the **last included day**, not the day after — matching
how Calendar.app displays multi-day all-day events. On read, EventKit's own
raw `endDate` for all-day events is **`23:59:59` of that last included
day** — verified against this project's own captured live calendar data —
not midnight of the following day, as the near-universal half-open-range
convention might lead you to expect. On write (`create_event`), the server
accepts *either* form for `end` when `allDay` is `true`: the last included
day (e.g. `…T23:59:59`) or, defensively, midnight of the following day
(e.g. `…T00:00:00` of the next date). Both are normalised to the same
single all-day event. The server converts between the two internally so
callers never have to.

**Alarms on all-day events follow Calendar.app's convention, not a literal
minute countdown.** For a timed event, `alarmMinutesBefore: [15]` means
exactly 15 minutes before `start`. For an all-day event, the same field is
first floored to whole days and then anchored to **09:00 on the resulting
day** — exactly what Calendar.app itself does when you set "1 day before" on
an all-day event. Concretely:

- `alarmMinutesBefore: [1440]` on an all-day event means **09:00 the day
  before**, not midnight. (1440 minutes = 1 day, floored to 1, placed at
  09:00 the previous day.)
- `alarmMinutesBefore: [0]` or any value under 1440 rounds down to 0 days,
  i.e. **09:00 on the event's own day**.

If you want a reminder at a specific clock time other than 09:00 on an
all-day event, that isn't currently expressible through this tool — it
mirrors Calendar.app's own behavior exactly, including that limitation.

**Other calendar apps may add their own alarm on top of ours.**
`alarmMinutesBefore` controls only the alarm(s) this server explicitly sets
when it creates the event — nothing more. EventKit is a shared store: any
other calendar client reading from the same store can apply its own
"default alarm" rule to events it sees, including ones this server created.
For example, BusyCal has a setting (**Alarms → Automatically add an alarm
to → All-day events**) that, by default, adds a 09:00-same-day alarm to
every all-day event saved to the store — on top of whatever alarm this
server already added. So a call with `alarmMinutesBefore: [1440]` can
legitimately show **two** reminders in such an app: this server's 09:00
*the day before*, plus that app's own default 09:00 *the same day*. That is
the third-party client's own default alert firing independently, not a
duplicate-alarm bug in this server. If you see an unexpected extra
reminder, check that client's own alert/notification preferences before
assuming this server is at fault. (Worth noting: BusyCal's own default for
all-day events is likewise 09:00 — the same convention this server
implements, for the same reason: it matches what Calendar.app itself does.)

## Installed layout

The socket-serving binary is installed to
`~/Library/Application Support/apple-calendar-mcp/calendar-helper` —
deliberately outside the repo, copied there by `launchagent/install.sh`. This
is not just tidiness: a LaunchAgent that pointed at `bin/calendar-helper`
inside your checkout would break the moment you moved the project or ran `git
clean` on `bin/`. The LaunchAgent plist itself lives at
`~/Library/LaunchAgents/io.github.apple-calendar-mcp.helper.plist`, its log
at `~/Library/Logs/apple-calendar-mcp.log`, and the socket at
`~/Library/Application Support/apple-calendar-mcp/helper.sock` (mode `0600`,
owner-only — overridable on the Node side with the `APPLE_CALENDAR_SOCKET`
environment variable). None of this depends on where you cloned the repo.

## Troubleshooting

**The log is the first place to look.** Every message from the daemon —
started, waiting for calendar access, granted, listening, `serve` errors —
goes to `~/Library/Logs/apple-calendar-mcp.log`, because that's what
`launchagent/install.sh` points `StandardOutPath`/`StandardErrorPath` at.
`tail -f` it while you install or restart the service.

**`PERMISSION_TIMEOUT` vs. `PERMISSION_DENIED` — read the log to tell them
apart.** `serve` checks calendar access once at startup and waits up to 30
seconds for an answer. If nothing arrives in that window (typically: the
approval dialog never appeared, or appeared behind another window and
nobody clicked it) it exits with `PERMISSION_TIMEOUT` — "no answer came." If
you explicitly deny the dialog, or access was already denied before, it
exits with `PERMISSION_DENIED` — "the answer was no." These need different
fixes: a timeout usually means look for the dialog and click it (or restart
the LaunchAgent so it asks again); a denial means go fix the grant in System
Settings. Distinguishing the two was what made the whole responsible-process
issue diagnosable in the first place — don't skip reading the log just
because both look like "it's not working."

**The dialog reappears on every rebuild, or access is silently refused with
no dialog at all.** Expected with ad-hoc signing — see "Why a LaunchAgent"
above. Check which signing path your build took:

```bash
codesign -dv "$HOME/Library/Application Support/apple-calendar-mcp/calendar-helper"
```

`Identifier=io.github.apple-calendar-mcp.calendar-helper` is set either way.
What matters is whether a `TeamIdentifier` line is also present: if it is,
you're on the Developer ID path and the grant should survive rebuilds; if
there's no `TeamIdentifier` line (or it says `not set`), you're on ad-hoc
signing, and re-granting after every `./swift/build.sh` is expected
behavior, not a bug — get a Developer ID certificate if you want it to stop.

**`HELPER_MISSING` from the MCP server.** The Node layer couldn't reach the
socket *and* couldn't find a binary to spawn as a fallback. Either
`launchagent/install.sh` was never run (or the LaunchAgent isn't loaded —
check `launchctl print gui/$UID/io.github.apple-calendar-mcp.helper`), or,
for the spawn fallback specifically, `./swift/build.sh` was never run and
`bin/calendar-helper` doesn't exist in the repo. Note that even a working
spawn fallback only helps under a parent process that already holds the
grant (e.g. a terminal) — under Claude Desktop it will still fail with
`PERMISSION_DENIED`, because it hits exactly the problem this whole
LaunchAgent setup exists to avoid.

**Claude Desktop doesn't show the tools, or your config edits keep
disappearing.** Double-check the absolute path in
`claude_desktop_config.json` actually points at `dist/index.js` in this
checkout. If edits to the file keep reverting, you edited it while Claude
Desktop was still running — quit it first (see "Configuring Claude Desktop"
above), then edit, then start it. Either way, a full restart (quit, not just
closed the window) is required after any config change.

**`PERMISSION_DENIED` even though the toggle for calendar-helper is already
ON.** The toggle only means "some access," not "full access" — see "The two
grant levels" above. Open **Options…** ("Optionen …") next to
**calendar-helper**'s entry in System Settings → Privacy & Security →
Calendars and confirm it's set to "Full Access" / "Vollzugriff auf
Kalender", not "Add Only" / "Zugriff nur zum Hinzufügen".

**An all-day event shows two reminders instead of one.** This is expected
if you also use another calendar app (e.g. BusyCal) against the same
calendar store — it is adding its own default alarm on top of the one this
server set. See "All-day events and the alarm rule" above; it is not a bug
in this server.

**Resetting calendar access.** `tccutil reset Calendar
io.github.apple-calendar-mcp.calendar-helper` does not work — command-line
tools can't be targeted individually this way, so it fails with `No such
bundle identifier ... (OSStatus error -10814)` regardless of how the binary
is signed. The only reset available for a command-line tool is the blunt
one with no bundle ID argument at all:

```bash
tccutil reset Calendar
```

This clears calendar permission for **every** app on the system, not just
this one — there is no narrower option. Otherwise, use System Settings →
Privacy & Security → Calendars directly, and remove just the
**calendar-helper** entry.

## Scope

This version implements four tools: `list_calendars`, `list_events`,
`create_event`, and `find_free_time`. **`update_event` and `delete_event`
are deliberately not included** in this version — the data model has fields
that would support them later, but the operations themselves don't exist
yet. Also out of scope: Reminders (`EKReminder`), invitations/attendees,
querying other people's availability, and any platform other than macOS.

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

## License

MIT — see [`LICENSE`](./LICENSE).
