# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A local MCP server exposing Apple Calendar to Claude on macOS. Two halves: a Swift CLI wrapping EventKit, and a TypeScript MCP layer that drives it.

## Commands

```bash
npm test                                  # full vitest suite
npx vitest run tests/freeTime.test.ts     # one file
npx vitest run -t "ignoriert abgesagte"   # one test by name
npm run typecheck                         # tsc --noEmit (covers src/ and tests/)
npm run build                             # tsc -> dist/ (src/ only)
./swift/build.sh                          # compile + sign bin/calendar-helper
bash launchagent/install.sh               # install/restart the daemon
bash launchagent/uninstall.sh             # remove it
```

After changing `swift/main.swift` you must run **both** `./swift/build.sh` and `launchagent/install.sh` — the latter copies the binary to its install location and restarts the daemon. Building alone leaves the old daemon running.

After changing `src/`, run `npm run build` and restart Claude Desktop; it loads `dist/index.js` once at startup.

`vitest.config.ts` pins `TZ=Europe/Berlin`. Several tests assert literal `+02:00` timestamps. Do not make those assertions timezone-agnostic — the offset is part of what they verify.

## The architecture constraint that explains everything

macOS attributes calendar (TCC) permission to the **responsible parent process**, not to the binary being executed. Claude Desktop declares no calendar usage description anywhere in its bundle, so any process it spawns is permanently denied — silently, with no dialog and no entry in System Settings.

Therefore the helper is **not spawned per request**. It runs as a LaunchAgent under its own TCC identity, and the Node layer reaches it over a Unix socket at `~/Library/Application Support/apple-calendar-mcp/helper.sock`. Node never touches EventKit; it writes bytes to a socket owned by a process that holds the grant.

Consequences when working here:

- `createHelperRunner()` prefers the socket and falls back to spawning the binary. The spawn path still works where the parent holds the grant (a terminal), which is why both transports exist and both are tested.
- Everything above `HelperRunner` is transport-agnostic. `src/tools/*.ts` and `tests/tools.test.ts` depend on that seam — keep the interface `run(command, payload): Promise<unknown>` intact.
- Running `./bin/calendar-helper list-calendars` from an agent session will fail with `PERMISSION_DENIED`. That is expected, not a bug. Verify Swift changes by reading them, or ask the human to run them in their terminal.

`docs/architecture.md` has the full story.

## Invariants that are easy to break

**stdout is protocol-only.** The MCP server writes nothing to stdout but MCP messages. Logging goes to stderr. A stray `console.log` in `src/` corrupts the protocol.

**All-day end dates are normalised in both directions.** EventKit emits `23:59:59` of the last day for all-day events, but callers may send midnight of the following day. `inclusiveEndDay` in `swift/main.swift` maps both onto the same inclusive day, on the read *and* write path. Dropping either side produces off-by-one-day events.

**All-day alarms land on 09:00, not at the offset.** `alarmMinutesBefore` floors to whole days for all-day events, then targets 09:00 — matching Calendar.app, where `[1440]` means 09:00 the previous day. See `alarmOffset(minutesBefore:allDay:)`.

**`activityDomain` controls days and hours together** (`work`/`personal`/`unrestricted`); `workingHours` overrides only the hours. An earlier design had a separate `weekdaysOnly` flag, which permitted "weekdays only, but also 3 a.m." Nothing named `weekdaysOnly` belongs in this codebase.

**`src/freeTime.ts` is pure and has zero imports.** No clock reads, no I/O. That purity is why the project's real test coverage lives there rather than in Swift. Validation errors surface as `INVALID_INPUT` via a re-wrap in `src/tools/findFreeTime.ts`, so `freeTime.ts` itself stays dependency-free.

**Swift error contract:** success is JSON on stdout with exit 0; failure is `{"code":...,"message":...}` on stderr with exit 1. `src/errors.ts` maps every code to German plain language. Adding a Swift error code means adding a message there too.

## Dependencies worth knowing

`@modelcontextprotocol/server` **v2** — not the older `@modelcontextprotocol/sdk`. In v2, `registerTool`'s `inputSchema` is a complete `z.object({...})`, not a raw shape. zod is imported as `zod/v4`.

Tool `annotations` are functional: `readOnlyHint: true` is what lets a host run the three read tools without prompting per call. Behavioural guidance for Claude belongs in the server's `instructions` (`src/index.ts`), never in tool descriptions, where it reads as prompt injection.

## Code signing

`swift/build.sh` uses a Developer ID certificate when one exists, otherwise ad-hoc. This is not cosmetic: with a Developer ID the TCC grant binds to bundle id + team id and survives rebuilds; ad-hoc binds it to the code hash, so every rebuild silently invalidates it and macOS then refuses without showing a dialog.

Hardened runtime requires `swift/calendar-helper.entitlements`. That file must contain **no XML comments** — the AMFI parser rejects them with a syntax error.

`tccutil reset Calendar <bundle-id>` does not work for command-line tools (OSStatus -10814). Only the blunt `tccutil reset Calendar` works, and it clears every app's calendar permission.

## Scope

v1 deliberately has no `update_event` or `delete_event`. The data model carries `eventIdentifier` plus `occurrenceDate` so they can be added without restructuring, since `eventIdentifier` alone is not unique across recurring instances.
