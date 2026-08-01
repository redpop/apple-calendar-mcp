#!/usr/bin/env bash
#
# Entfernt den calendar-helper LaunchAgent wieder.
#
# Die erteilte Kalenderberechtigung bleibt davon unberuehrt - sie haengt an
# der Code-Identitaet des Binaries, nicht am LaunchAgent. Zum Widerrufen:
# Systemeinstellungen > Datenschutz & Sicherheit > Kalender.
#
set -euo pipefail

LABEL="io.github.apple-calendar-mcp.helper"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SOCKET="$HOME/Library/Application Support/apple-calendar-mcp/helper.sock"

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null && echo "Dienst entladen." || echo "Dienst lief nicht."
rm -f "$PLIST" && echo "LaunchAgent entfernt: $PLIST"
rm -f "$SOCKET" && echo "Socket entfernt."

echo
echo "Fertig. Der MCP-Server faellt jetzt wieder darauf zurueck, das Binary"
echo "direkt zu starten - das funktioniert nur dort, wo der Elternprozess"
echo "selbst Kalenderzugriff hat (z. B. im Terminal), nicht in Claude Desktop."
