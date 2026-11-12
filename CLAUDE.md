# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

An MCP server exposing Apple Calendar on macOS to any client that speaks the protocol. Two halves: a Swift CLI wrapping EventKit, and a TypeScript MCP layer that drives it.

## Commands

```bash
npm test                                  # full vitest suite
npx vitest run tests/freeTime.test.ts     # one file
npx vitest run -t "ignoriert abgesagte"   # one test by name
npm run typecheck                         # tsc --noEmit (covers src/ and tests/)
npm run build                             # tsc -> dist/ (src/ only)
./swift/build.sh                          # compile + sign bin/calendar-helper (universal)
```

`build.sh` builds both `arm64` and `x86_64` against a macOS 14 deployment target and joins them with `lipo`. The binary ships inside the npm package, so an arm64-only build would be broken on Intel Macs — and only at the user's end, never at build time. Signing happens on the finished fat binary; `lipo` would invalidate per-slice signatures anyway.

After changing `swift/main.swift`, run `./swift/build.sh` and restart the client. There is no service to reinstall — the helper is a child process of the MCP server, so the next server start picks up the new binary.

After changing `src/`, run `npm run build` and restart the client; it loads `dist/index.js` once at startup.

`vitest.config.ts` pins `TZ=Europe/Berlin`. Several tests assert literal `+02:00` timestamps. Do not make those assertions timezone-agnostic — the offset is part of what they verify.

## The architecture constraint that explains everything

macOS attributes calendar (TCC) permission to the **responsible parent process**, not to the binary being executed. A GUI client like Claude Desktop declares no calendar usage description anywhere in its bundle, so any process it spawns is denied — silently, with no dialog and no entry in System Settings.

The helper escapes this by **disclaiming that responsibility at startup**. `reexecDisclaimed()` in `swift/main.swift` re-execs the process via `posix_spawn(POSIX_SPAWN_SETEXEC)` with `responsibility_spawnattrs_setdisclaim`, making the binary its own TCC-responsible process. macOS then reads the usage description from its embedded Info.plist and prompts under the name `calendar-helper`. This is the same private libSystem call Chromium uses for its helper processes; it is resolved through `dlsym`, so a future macOS dropping the symbol degrades to the old behaviour instead of failing to load.

Because the helper carries its own permission identity, it needs no service registration. It runs as a **long-lived child process** of the MCP server (`calendar-helper serve`), speaking NDJSON over stdin/stdout. Node never touches EventKit.

It is not, however, run from where the package puts it. `src/helperInstall.ts` copies it to `~/Library/Application Support/apple-calendar-mcp/bin/calendar-helper` before every helper start and spawns it from there, because the TCC grant is bound to the path (see Code signing). Copying goes through a `.tmp` file and `rename()`: a running binary cannot be overwritten on macOS (ETXTBSY), and deleting the target first would give up the very path the grant hangs on. Verified end to end — replacing the installed binary with a differently-hashed build produced no new prompt.

The copy is compared and refreshed before *every* spawn, not once per server start, because the `.mcpb` in Claude Desktop and an `npx` install in Claude Code may run different versions side by side and each replaces the installed copy with its own.

Consequences when working here:

- The process is long-lived on purpose. Process start, the disclaim re-exec, `EKEventStore` setup and the TCC check would otherwise be paid on *every* tool call. Measured on an M-series Mac with six calendars: **324 ms for the first call, 1 ms for each one after**. `src/stdioRunner.ts` starts it lazily on the first call, queues requests FIFO, and restarts it after a crash.
- Everything above `HelperRunner` is transport-agnostic. `src/tools/*.ts` and `tests/tools.test.ts` depend on that seam — keep the interface `run(command, payload): Promise<unknown>` intact.
- The first request after a start gets a longer deadline (35s) than later ones (10s), because `serve` waits up to 30s for the TCC answer and a human may need to click a dialog. The two deadlines belong together — changing one without the other breaks first-run setup.

`docs/architecture.md` has the full story, including the measurements behind each choice.

## Invariants that are easy to break

**stdout is protocol-only — on both legs.** Between client and Node it carries MCP messages; between Node and the helper it carries the NDJSON request/response lines. Logging goes to stderr on both sides. A stray `console.log` in `src/` corrupts the first leg; a stray `print()` in `swift/main.swift` corrupts the second. Use `serveLog()` in Swift, which writes to stderr.

**All-day end dates are normalised in both directions.** EventKit emits `23:59:59` of the last day for all-day events, but callers may send midnight of the following day. `inclusiveEndDay` in `swift/main.swift` maps both onto the same inclusive day, on the read *and* write path. Dropping either side produces off-by-one-day events.

**All-day alarms land on 09:00, not at the offset.** `alarmMinutesBefore` floors to whole days for all-day events, then targets 09:00 — matching Calendar.app, where `[1440]` means 09:00 the previous day. See `alarmOffset(minutesBefore:allDay:)`.

**`activityDomain` controls days and hours together** (`work`/`personal`/`unrestricted`); `workingHours` overrides only the hours. An earlier design had a separate `weekdaysOnly` flag, which permitted "weekdays only, but also 3 a.m." Nothing named `weekdaysOnly` belongs in this codebase.

**`src/freeTime.ts` is pure and has zero imports.** No clock reads, no I/O. That purity is why the project's real test coverage lives there rather than in Swift. Validation errors surface as `INVALID_INPUT` via a re-wrap in `src/tools/findFreeTime.ts`, so `freeTime.ts` itself stays dependency-free.

**Swift error contract:** success is JSON on stdout with exit 0; failure is `{"code":...,"message":...}` on stderr with exit 1. `src/errors.ts` maps every code to plain English. Adding a Swift error code means adding a message there too, otherwise it falls back to a generic sentence that tells the caller nothing.

## Dependencies worth knowing

`@modelcontextprotocol/server` **v2** — not the older `@modelcontextprotocol/sdk`. In v2, `registerTool`'s `inputSchema` is a complete `z.object({...})`, not a raw shape. zod is imported as `zod/v4`.

Tool `annotations` are functional: `readOnlyHint: true` is what lets a host run the three read tools without prompting per call. Behavioural guidance for the model belongs in the server's `instructions` (`src/index.ts`), never in tool descriptions, where it reads as prompt injection.

## Code signing

`swift/build.sh` uses a Developer ID certificate when one exists, otherwise ad-hoc. This is not cosmetic: ad-hoc binds the TCC grant to the code hash, so every rebuild silently invalidates it and macOS then refuses without showing a dialog. A Developer ID signature is what makes a grant survive rebuilds at all.

Developer ID signing happens only in CI (`release.yml`, `release-candidate.yml`, see `docs/releasing.md`), where `CODESIGN_IDENTITY` forces it so a missing certificate fails instead of falling back to ad-hoc. A local machine may have a Developer ID in its keychain that `build.sh` would pick on its own; agents build with `CODESIGN_IDENTITY="Apple Development: Martin Alker (6GT7DQZYME)" ./swift/build.sh` instead. Notarization uses the App Store Connect API key; the helper is a bare binary and cannot be stapled.

**What the grant binds to, measured in ACM-5:**

- **The code hash does not matter.** `bin/calendar-helper` was rebuilt twice after the grant (`9d2ab825…` → `f9fefabe…`) and kept working without a new prompt. Rebuilding in place is free.
- **The path does.** A *byte-identical* copy at a different path triggered a fresh permission dialog and got its own entry in System Settings. TCC tracks command-line tools per path — which is also why `tccutil reset Calendar <bundle-id>` fails with OSStatus -10814.

The consequence for distribution: a binary living under a version-dependent path (an npm cache directory, say) would re-prompt on **every update**. So the helper must be copied to a fixed location on first run and spawned from there — the same reasoning the old `launchagent/install.sh` gave. See ACM-1.

Untested: whether ad-hoc versus Developer ID changes any of this at a *known* path. The experiment that was meant to answer it varied path and signature at once, so it proved nothing.

Hardened runtime requires `swift/calendar-helper.entitlements`. That file must contain **no XML comments** — the AMFI parser rejects them with a syntax error.

`tccutil reset Calendar <bundle-id>` does not work for command-line tools (OSStatus -10814) — consistent with them not being addressed by bundle id at all. Only the blunt `tccutil reset Calendar` works, and it clears every app's calendar permission.

## Distribution

Three install paths share one helper path and therefore one calendar grant: the `.mcpb` attached to each GitHub release (Claude Desktop chat and Cowork), `npx -y @redpop/apple-calendar-mcp` (Claude Code and other clients), and the npm package itself. `manifest.json` describes the `.mcpb`; it has no `user_config` because the server reads no settings. `scripts/sync-versions.mjs` (the npm `version` hook) keeps `server.json` and `manifest.json` at the package version; `tests/manifest.test.ts` checks the manifest lists exactly the registered tools. The README's "Privacy Policy" section is linked from the manifest; keep its heading, the anchor is the URL.

## Scope

Six tools. `update_event` and `delete_event` were added in ACM-7, using the `eventIdentifier` plus `occurrenceDate` pair the data model had carried from the start — `eventIdentifier` alone names the series, not one occurrence.

**`span` has no default on recurring events, on purpose.** `this` versus `future` is the difference between cancelling one Tuesday and cancelling every one from now on, and it cannot be undone. Omitting it is `INVALID_INPUT`, not a quiet `thisEvent`. There is no `all` either: EventKit cannot reach past occurrences, so the name would promise more than it delivers.

Still out of scope: Reminders (`EKReminder`), invitations and attendees, moving an event between calendars, and any platform other than macOS.
