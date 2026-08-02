# CLI reference

[← Back to README](../README.md)

Every command below is a standalone subcommand of `bin/calendar-helper`. The
first four are one-shot: a payload goes in on stdin as JSON, and the result
comes out on stdout as JSON. `serve`, covered last, is different — it stays
running and answers many requests.

These are useful for checking the helper works before wiring it into an MCP
client, and for debugging. Under normal operation you never run them
yourself: the MCP server starts `serve` on the first tool call and keeps it
for as long as it runs.

Note that the installed copy the MCP server actually uses lives at
`~/Library/Application Support/apple-calendar-mcp/bin/calendar-helper`, not
in `bin/` — see [`docs/architecture.md`](./architecture.md) for why.

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
./bin/calendar-helper serve
```

Not one-shot: reads one JSON request per line from stdin and writes one JSON
response per line to stdout, until stdin closes. This is what the MCP server
runs.

```bash
printf '{"id":1,"command":"list-calendars"}\n' | ./bin/calendar-helper serve
```

Requests take the shape `{"id": ..., "command": ..., "payload": {...}}`,
where `id` is optional and mirrored back. Responses are
`{"ok": true, "result": ...}` or `{"ok": false, "error": {"code": ...,
"message": ...}}`.

Before answering anything it checks calendar access once, waiting up to 30
seconds for a decision; if nothing arrives in that window it exits with
`PERMISSION_TIMEOUT` rather than hanging silently. Diagnostics go to stderr —
stdout carries nothing but responses, since the MCP server parses it.

Set `CALENDAR_HELPER_DEBUG=1` to also see a line when the process re-executes
itself to claim its own calendar permission. See
[`docs/architecture.md`](./architecture.md) for what that is about.

---

[← Back to README](../README.md)
