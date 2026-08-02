# MCP tool reference

[← Back to README](../README.md)

The server exposes six tools, registered in `src/tools/`. All have
`openWorldHint: false`.

| Tool | `readOnlyHint` | `destructiveHint` | `idempotentHint` |
|---|---|---|---|
| `list_calendars` | true | — | true |
| `list_events` | true | — | true |
| `find_free_time` | true | — | true |
| `create_event` | false | **false** | false |
| `update_event` | false | **true** | false |
| `delete_event` | false | **true** | true |

These annotations are functional, not decorative: clients group tools by
them and decide what to confirm before running. `create_event` is not
destructive because it only ever adds; `update_event` overwrites existing
values and `delete_event` removes them. `delete_event` is idempotent —
deleted twice stays deleted.

## `list_calendars`

No input. Lists every configured calendar, including iCloud. Does not read
events — that's `list_events`.

## `list_events`

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

## `create_event`

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
this version (see "Scope" in [`docs/architecture.md`](./architecture.md)).

## `update_event`

Changes an existing event. Only the fields you pass are changed; anything
left out keeps its current value — a title change does not wipe the notes.

| Field | Type | Required | Notes |
|---|---|---|---|
| `eventIdentifier` | string | yes | From `list_events`. For a recurring event this names the *series* |
| `occurrenceDate` | ISO 8601 datetime with offset | for recurring events | The instance to change, exactly as returned by `list_events` |
| `span` | `this` \| `future` | for recurring events | How far the change reaches |
| `title` | string | no | Must not be empty if given |
| `start` / `end` | ISO 8601 datetime with offset | no | Same all-day normalisation as `create_event` |
| `allDay` | boolean | no | Converts between timed and all-day |
| `location` / `notes` / `url` | string | no | Replace the previous value |
| `alarmMinutesBefore` | integer array | no | **Replaces** all alarms; pass `[]` to remove them |

Read-only calendars are rejected with `CALENDAR_READONLY`. An unknown
identifier gives `EVENT_NOT_FOUND`.

Moving an event to a different calendar is deliberately not supported —
`calendarId` is not accepted here.

## `delete_event`

Deletes an event and returns it as it was, since afterwards it cannot be
looked up any more.

| Field | Type | Required | Notes |
|---|---|---|---|
| `eventIdentifier` | string | yes | From `list_events` |
| `occurrenceDate` | ISO 8601 datetime with offset | for recurring events | The instance to delete |
| `span` | `this` \| `future` | for recurring events | How far the deletion reaches |

Returns `{ deleted, span }`.

### The `span` rule

For recurring events, `span` is **required and has no default**. The
difference between "cancel this Tuesday" and "never again from now on" is
large and cannot be undone, so the server refuses to guess: omitting it
gives `INVALID_INPUT` with an explanation rather than a quiet `thisEvent`.

The two values map to EventKit's two spans:

| `span` | Effect |
|---|---|
| `this` | Only the occurrence named by `occurrenceDate` |
| `future` | That occurrence and every later one |

There is deliberately no `all`: EventKit cannot reach occurrences in the
past, and a name promising otherwise would be a lie.

`occurrenceDate` is required for the same reason — `eventIdentifier` alone
names the series, not one of its occurrences.

## `find_free_time`

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
| `bufferMinutes` | non-negative integer | no | Default `0`; free time to keep either side of each busy event |

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

### `bufferMinutes`

A gap wedged directly between two meetings is free on paper and unusable in
practice — no walk to the next room, no break, no overrunning the previous
call. `bufferMinutes` keeps that much time free on either side of every busy
event.

Two aspects are worth knowing, because both are easy to get wrong:

- **Working hours are not extended.** With `work` and a 30-minute buffer,
  09:00 stays 09:00 when nothing precedes it. The buffer only ever removes
  time, never adds it.
- **Events just outside the window still count.** A meeting ending at 08:45
  trims a window starting at 09:00 when the buffer is 30 minutes. To make
  that possible the server widens its own `list_events` query by the buffer
  on both sides; the returned slots stay within the window you asked for.

Buffers of adjacent events that overlap merge into one block rather than
being subtracted twice.

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

---

[← Back to README](../README.md)
