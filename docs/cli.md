# CLI reference

[← Back to README](../README.md)

Every command below is a standalone subcommand of `bin/calendar-helper`. The
first four are one-shot: a payload goes in on stdin as JSON, and the result
comes out on stdout as JSON. `serve`, covered last, is different — it's the
long-running daemon. These are useful for verifying the helper works before
wiring it into an MCP client, and for debugging — though under normal
operation you won't run any of them directly, since
`launchagent/install.sh` starts and manages `serve` for you.

## `check-access`

```bash
./bin/calendar-helper check-access
```

Requests calendar access if not yet decided, otherwise reports the current
status. Returns `{"status":"authorized"}` on success (exit 0), or a JSON
error on stderr (exit 1) otherwise.

## `list-calendars`

```bash
./bin/calendar-helper list-calendars
```

Lists every calendar configured in Calendar.app, including iCloud
calendars. Returns `{"calendars": [...]}`, each entry with `id`, `title`,
`type`, `source`, `color`, and `allowsModifications`.

## `list-events`

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

## `create-event`

```bash
echo '{"title":"Dentist","start":"2026-08-05T10:00:00+02:00","end":"2026-08-05T11:00:00+02:00","location":"Main St 1","notes":"Checkup","alarmMinutesBefore":[60,1440]}' \
  | ./bin/calendar-helper create-event
```

Creates a new event and returns `{"event": {...}}` in the same shape as
`list-events`. Without `calendarId`, the default calendar for new events is
used. Writing to a read-only calendar (for example a subscribed holiday
calendar) fails with `CALENDAR_READONLY`. See the all-day alarm rule in
[`docs/tools.md`](./tools.md) for what happens with `allDay: true`.

## `serve`

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
[`docs/architecture.md`](./architecture.md) for why this exists as a daemon
at all rather than a one-shot command like the others.

---

[← Back to README](../README.md)
