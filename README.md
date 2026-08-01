# apple-calendar-mcp

A local [MCP](https://modelcontextprotocol.io) server that gives Claude (or any
other MCP client) read and write access to the macOS Calendar app, via
Apple's EventKit framework.

**macOS only, by design.** EventKit is a macOS/iOS framework with no
cross-platform equivalent, and the permission model (TCC) described below is
macOS-specific. There is no Windows or Linux support and none is planned.

The server runs entirely on your machine. It never talks to a network
service — every request goes straight to the local Calendar database through
a small Swift helper binary.

## Architecture

The project has two layers:

- **`swift/main.swift`** — a Swift command-line tool that wraps EventKit. It
  is invoked once per request ("one-shot" process model, not a long-running
  daemon) with a single subcommand and, where needed, a JSON payload on
  stdin. It prints a JSON result to stdout on success (exit code 0) or a
  JSON error object `{"code": ..., "message": ...}` to stderr (exit code 1)
  on failure. It never touches stdout except for that one JSON reply, and it
  can only be called with hardcoded arguments — it has no other externally
  reachable behavior.
- **`src/`** — a TypeScript MCP server that spawns the Swift helper as a
  child process for every tool call, validates its JSON with
  [Zod](https://zod.dev), and exposes four MCP tools to the client.

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
npm run build:helper
```

`npm run build` compiles the TypeScript server to `dist/`. `npm run
build:helper` compiles and ad-hoc-signs the Swift helper to
`bin/calendar-helper` (see `swift/build.sh`).

## Granting calendar access (read this before configuring Claude Desktop)

This is the section most likely to trip you up, so read it in full before
wiring the server into Claude Desktop.

### Step 1: trigger the permission dialog from your own terminal

Run this from your own interactive Terminal (or iTerm) window — not from a
background process, a script runner, or anything without a visible window:

```bash
./bin/calendar-helper check-access
```

On the first run, macOS shows the calendar-access dialog. Approve it. On
success you get:

```json
{"status":"authorized"}
```

on stdout with exit code 0. If you deny it, or if it was already denied
earlier, you get a JSON error on stderr (`PERMISSION_DENIED` or
`PERMISSION_RESTRICTED`) and exit code 1.

**Why do this first, and from your own terminal?** macOS's privacy system
(TCC) grants calendar access to the *responsible parent process* — the app
that ultimately launched the helper — not to the helper binary itself. If
you run `check-access` from your interactive Terminal first, the grant
attaches to Terminal. If a background or non-interactive process makes the
first request, macOS can silently refuse it without ever showing a dialog —
and that refusal then sticks, forcing you to reset it before trying again.
Doing this step manually, first, in a normal terminal session sidesteps that
trap entirely.

### Step 2: understand the two grant levels (macOS 14+)

Open **System Settings → Privacy & Security → Calendars**. You will **not**
see an entry named `calendar-helper` there — you will see *Terminal*
(or *iTerm*, or later, *Claude*), because, as above, the grant belongs to the
parent process, not the helper binary. Do not go looking for the helper's
own name in this list; it will never appear.

macOS 14+ distinguishes two access levels for each app in that list. **The
on/off toggle next to the app's name does not expose this choice at all** —
you can have the toggle ON and still be stuck on the lower level. The level
lives one layer deeper, behind the **Options…** button ("Optionen …" in the
German settings pane, which is what you'll actually be looking at if macOS
is set to German) next to the app's entry. Clicking it opens a small dialog
offering exactly two choices:

- **"Add Only"** ("Zugriff nur zum Hinzufügen" in German) — the app can
  create events but cannot read existing ones. The helper reports this as
  `writeOnly` in older builds; the current build treats it the same as no
  access and returns a `PERMISSION_DENIED` error, because every one of this
  server's tools needs to read (even `create_event` needs to look up
  calendars first).
- **"Full Access"** ("Vollzugriff auf Kalender" in German) — required for
  everything this server does.

This is the single most common trap: a user sees the toggle already ON,
concludes access is granted, and doesn't think to look for a second,
separate control — then gets a confusing `PERMISSION_DENIED` from a tool
that appears to already have permission. If you get a permission error even
though you granted *something*, this is the first thing to check: open
**Options…** ("Optionen …") next to the relevant app's entry and confirm
"Full Access" / "Vollzugriff auf Kalender" is selected, not "Add Only".

### Step 3: Claude Desktop needs its own, separate grant

Permission granted to Terminal does **not** carry over to Claude Desktop.
Once you launch the server from Claude Desktop, macOS will prompt again (or,
if `check-access` was already run once from Terminal so the binary is
signed and known, you may need to open **System Settings → Privacy &
Security → Calendars** and grant access to *Claude* explicitly). Running
`check-access` from your own terminal first, as in Step 1, is still the
right order of operations — it lets you confirm the helper itself works
before adding Claude Desktop's process boundary into the mix.

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
of this repository. Then **restart Claude Desktop** — it only reads this
file on startup.

## CLI reference

Every command is a standalone subcommand of `bin/calendar-helper`. Payloads
go in on stdin as JSON; the result comes out on stdout as JSON. These are
useful for verifying the helper works before wiring it into an MCP client,
and for debugging.

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
how Calendar.app displays multi-day all-day events, and *not* matching
EventKit's raw `endDate`, which is midnight of the following day. The server
converts between the two internally so callers never have to.

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

## Troubleshooting

**The permission dialog reappears after every rebuild.** The ad-hoc code
signature is missing, or the bundle identifier changed between builds.
Check with:

```bash
codesign -dv bin/calendar-helper
```

You should see `Identifier=io.github.apple-calendar-mcp.calendar-helper`.
`swift/build.sh` signs the binary with a fixed identifier specifically so
that TCC's grant survives rebuilds; if this doesn't match, rerun `npm run
build:helper` and check the script hasn't been edited.

**`HELPER_MISSING` error.** `npm run build:helper` was never run, or
`bin/calendar-helper` was deleted. Run it (see Installation above).

**Claude Desktop doesn't show the tools.** Double-check the absolute path
in `claude_desktop_config.json` actually points at `dist/index.js` in this
checkout, and that you fully restarted Claude Desktop (quit, not just
closed the window) after editing the config.

**Access denied in Claude Desktop even though Terminal has it.** See "Claude
Desktop needs its own, separate grant" above — grant Claude access
independently under System Settings → Privacy & Security → Calendars.

**`PERMISSION_DENIED` even though the toggle for Terminal/Claude is already
ON.** The toggle only means "some access," not "full access" — see "Step 2:
understand the two grant levels" above. Open **Options…** ("Optionen …")
next to that app's entry in System Settings → Privacy & Security →
Calendars and confirm it's set to "Full Access" / "Vollzugriff auf
Kalender", not "Add Only" / "Zugriff nur zum Hinzufügen".

**An all-day event shows two reminders instead of one.** This is expected
if you also use another calendar app (e.g. BusyCal) against the same
calendar store — it is adding its own default alarm on top of the one this
server set. See "All-day events and the alarm rule" above; it is not a bug
in this server.

**Do not try `tccutil reset Calendar io.github.apple-calendar-mcp.calendar-helper`.**
It fails with `No such bundle identifier ... (OSStatus error -10814)`,
because — as above — the grant belongs to the parent process (Terminal /
Claude), not to this bundle identifier. If you need to reset access, reset
it for the parent app instead (e.g. `tccutil reset Calendar
com.apple.Terminal`), or use System Settings directly.

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
npm run build:helper  # compile + ad-hoc-sign the Swift helper
```

The test suite (`tests/`) covers the TypeScript layer only — schemas, the
free-time algorithm, error handling, and tool wiring — since the Swift
helper needs a real calendar and a live TCC grant that CI does not have.

## License

MIT — see [`LICENSE`](./LICENSE).
