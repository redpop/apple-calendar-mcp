#!/usr/bin/env bash
#
# Richtet calendar-helper als LaunchAgent ein.
#
# Warum das noetig ist: macOS ordnet die Kalenderberechtigung dem
# verantwortlichen ELTERNPROZESS zu, nicht dem aufgerufenen Programm.
# Claude Desktop deklariert in seinem App-Bundle keinerlei Kalender-
# Verwendungszweck, deshalb bleibt jeder Prozess, den es startet, dauerhaft
# ausgesperrt - auch dieser Helper.
#
# Wird der Helper dagegen von launchd gestartet, erhaelt er eine EIGENE
# TCC-Identitaet: Er fragt unter seinem eigenen Namen nach Zugriff und
# erscheint danach als "calendar-helper" in den Systemeinstellungen.
# Der MCP-Server spricht ihn dann ueber einen Unix-Socket an, statt ihn
# selbst zu starten.
#
set -euo pipefail

LABEL="io.github.apple-calendar-mcp.helper"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/apple-calendar-mcp.log"
SOCKET="$HOME/Library/Application Support/apple-calendar-mcp/helper.sock"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BINARY="$REPO_ROOT/bin/calendar-helper"

if [ ! -x "$BINARY" ]; then
  echo "FEHLER: $BINARY fehlt oder ist nicht ausfuehrbar." >&2
  echo "Bitte zuerst bauen:  ./swift/build.sh" >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$BINARY</string>
    <string>serve</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <!-- Neustart, falls der Dienst stirbt. ThrottleInterval bremst die
       Wiederholung, falls der Start dauerhaft scheitert (z. B. weil die
       Kalenderberechtigung fehlt) - dann steht der Grund im Log. -->
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>60</integer>

  <!-- Nur in einer grafischen Anmeldesitzung: TCC-Dialoge brauchen sie. -->
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>

  <!-- Ohne ProcessType stuft launchd den Dienst als Hintergrundjob ein, und
       ein Hintergrundjob darf keinen TCC-Dialog anzeigen: die Anfrage bleibt
       schlicht unbeantwortet. Praktisch beobachtet - mit "Interactive" kam
       der Dialog, ohne kam PERMISSION_TIMEOUT ohne jede Rueckmeldung. -->
  <key>ProcessType</key>
  <string>Interactive</string>

  <key>StandardErrorPath</key>
  <string>$LOG</string>
  <key>StandardOutPath</key>
  <string>$LOG</string>
</dict>
</plist>
EOF

echo "LaunchAgent geschrieben: $PLIST"

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"
echo "Geladen. Warte auf den Socket ..."

for _ in $(seq 1 20); do
  [ -S "$SOCKET" ] && break
  sleep 0.5
done

echo
if [ -S "$SOCKET" ]; then
  echo "ERFOLG: Der Dienst laeuft, Socket bereit unter"
  echo "  $SOCKET"
  echo
  echo "Claude Desktop kann den Kalender jetzt ueber diesen Dienst erreichen."
  echo "Bitte Claude Desktop einmal neu starten (Cmd+Q, dann oeffnen)."
else
  echo "Der Socket ist nicht erschienen. Letzte Zeilen aus dem Log:"
  echo "  $LOG"
  echo "---"
  tail -20 "$LOG" 2>/dev/null || echo "(Log ist leer)"
  echo "---"
  echo
  echo "Haeufigste Ursache: die Kalenderberechtigung wurde noch nicht erteilt."
  echo "Beim ersten Start erscheint ein Dialog von \"calendar-helper\"."
  echo "Bitte dort \"Vollen Zugriff erlauben\" waehlen und dieses Skript erneut"
  echo "ausfuehren. Ein bereits vorhandener Eintrag laesst sich unter"
  echo "Systemeinstellungen > Datenschutz & Sicherheit > Kalender pruefen -"
  echo "er muss ueber \"Optionen ...\" auf \"Vollzugriff\" stehen."
  exit 1
fi
