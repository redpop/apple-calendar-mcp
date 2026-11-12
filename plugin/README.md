# Apple Calendar MCP

Lets Claude read, create, change and delete events in Apple Calendar on your Mac, and find free
time between them. macOS only.

Not affiliated with or endorsed by Apple.

## What it runs

The plugin starts one local MCP server, the npm package
[`@redpop/apple-calendar-mcp`](https://www.npmjs.com/package/@redpop/apple-calendar-mcp), pinned
to the plugin's version and started with `npx`. The package contains a small helper,
`calendar-helper`, signed with a Developer ID and notarized by Apple. The helper talks to
EventKit; the server answers six tools: `list_calendars`, `list_events`, `find_free_time`,
`create_event`, `update_event` and `delete_event`.

The plugin follows a new npm release after seven days, so an npm release cooldown
(`min-release-age`) of up to seven days does not block it. A longer cooldown blocks each new
plugin version until it ends.

It needs Node.js 20 or newer and runs in Claude Code on your Mac. It does not work in Cowork:
Cowork starts a plugin's local server inside its Linux virtual machine, away from Apple
Calendar. The Claude desktop chat ignores local servers from plugins. For both, use the
`.mcpb` bundle from the [GitHub releases](https://github.com/redpop/apple-calendar-mcp/releases).

## Set it up

Install the plugin in Claude Code:

```
/plugin install apple-calendar-mcp --marketplace redpop/apple-calendar-mcp
```

On the first tool call macOS asks whether **calendar-helper** may access your calendars. Allow
it, then make sure System Settings → Privacy & Security → Calendars → calendar-helper is set to
Full Access. The grant is bound to the helper's fixed install path, so it survives updates and
is shared with the `.mcpb` and any `npx` install on the same Mac.

## Changes need care

`create_event`, `update_event` and `delete_event` change your calendar, and there is no undo.
Claude Code asks before each call unless a mode approves tools on its own, such as auto mode or
skipping permissions. Do not choose "always allow" for these tools if you want to see every
change first.

## Privacy

Nothing leaves your Mac through the server: it has no telemetry and opens no network connection.
Tool results go only to Claude Code. Full policy:
<https://github.com/redpop/apple-calendar-mcp#privacy-policy>
