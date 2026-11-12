# Troubleshooting

[← Back to README](../README.md)

**Look at stderr first.** The helper writes its diagnostics there — access
check, ready, errors — and the MCP server passes them through to its own
stderr, so they end up wherever your client keeps MCP logs. For Claude
Desktop that is `~/Library/Logs/Claude/mcp-server-apple-calendar.log`.

To see the same thing without a client, run the helper directly:

```bash
printf '{"id":1,"command":"list-calendars"}\n' | ./bin/calendar-helper serve
```

**`PERMISSION_TIMEOUT` vs. `PERMISSION_DENIED` — read the log to tell them
apart.** `serve` checks calendar access once at startup and waits up to 30
seconds for an answer. If nothing arrives in that window (typically: the
approval dialog never appeared, or appeared behind another window and
nobody clicked it) it exits with `PERMISSION_TIMEOUT` — "no answer came." If
you explicitly deny the dialog, or access was already denied before, it
exits with `PERMISSION_DENIED` — "the answer was no." These need different
fixes: a timeout usually means look for the dialog and click it, then ask
again; a denial means go fix the grant in System Settings. Distinguishing the two was what made the whole responsible-process
issue diagnosable in the first place — don't skip reading the log just
because both look like "it's not working."

**The two grant levels (macOS 14+), and the Options… trap.** Open
**System Settings → Privacy & Security → Calendars**. You should see an
entry named **calendar-helper** — this is expected; older versions of this
project showed *Terminal* or the client's name here instead, because the
grant used to belong to whichever app launched the helper. The helper now
claims its own permission identity at startup, so it gets its own entry.

You may see **several** entries named `calendar-helper`. That is also
expected: macOS tracks command-line tools per path, so a copy that ran from a
different location once has its own row. Only the one at
`~/Library/Application Support/apple-calendar-mcp/bin/` matters; the others
are leftovers and cannot be removed individually.

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

**The dialog reappears on every rebuild, or access is silently refused with
no dialog at all.** Expected with ad-hoc signing — see
[`docs/architecture.md`](./architecture.md) for why. Check which signing
path your build took:

```bash
codesign -dv "$HOME/Library/Application Support/apple-calendar-mcp/bin/calendar-helper"
```

`Identifier=io.github.apple-calendar-mcp.calendar-helper` is set either way.
What matters is whether a `TeamIdentifier` line is also present: if it is,
you're on the Developer ID path and the grant should survive rebuilds; if
there's no `TeamIdentifier` line (or it says `not set`), you're on ad-hoc
signing, and re-granting after every `./swift/build.sh` is expected
behavior, not a bug — get a Developer ID certificate if you want it to stop.

Developer ID signing also enables the hardened runtime, which demands the
`com.apple.security.personal-information.calendars` entitlement
(`swift/calendar-helper.entitlements`) before macOS will even consider a
calendar request — without it, the request is refused with no dialog at
all, even immediately after a `tccutil reset`. One easy-to-hit trap: the
entitlements plist must contain **no XML comments** — Apple's AMFI parser
rejects them with a syntax error, not a helpful message.

**`HELPER_MISSING` from the MCP server.** The binary isn't where the server
expects it. When installed from npm this shouldn't happen — reinstalling the
package restores it. When running from a clone, it means `./swift/build.sh`
was never run and `bin/calendar-helper` doesn't exist.

**`HELPER_CRASHED` on every call.** The helper starts and dies immediately.
Run it directly (see the top of this page) to see why on stderr. A common
cause after building from source is a binary that won't pass code signing
checks — `codesign --verify --strict bin/calendar-helper` will say so.

**The first call takes 20+ seconds, later ones are instant.** Normal. The
first call starts the helper, which sets up EventKit and checks calendar
access, waiting for you to answer the dialog. Everything after that is one
JSON line through a pipe.

**Claude Desktop doesn't show the tools.** With the `.mcpb`, check under
Settings → Extensions that "Apple Calendar" is installed and enabled. If you
also kept an `apple-calendar` entry in `claude_desktop_config.json`, remove
one of the two; both work, but two servers offer the same tools twice.

**Claude Desktop doesn't show the tools of a config entry, or your config
edits keep disappearing.** Check the entry in `claude_desktop_config.json`: for an npm
install the command is `npx` with `-y @redpop/apple-calendar-mcp`; for a
clone it is `node` with an absolute path to `dist/index.js`. If edits to the file keep reverting, you edited it while Claude
Desktop was still running — quit it first, then edit, then start it. Either
way, a full restart (quit, not just closed the window) is required after
any config change.

**An all-day event shows two reminders instead of one.** This is expected
if you also use another calendar app (e.g. BusyCal) against the same
calendar store — it is adding its own default alarm on top of the one this
server set. See "All-day events and the alarm rule" in
[`docs/tools.md`](./tools.md); it is not a bug in this server.

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

---

[← Back to README](../README.md)
