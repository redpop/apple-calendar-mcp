#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../bin"
BINARY="$OUT_DIR/calendar-helper"
BUNDLE_ID="io.github.apple-calendar-mcp.calendar-helper"

mkdir -p "$OUT_DIR"

swiftc "$SCRIPT_DIR/main.swift" \
  -O \
  -o "$BINARY" \
  -Xlinker -sectcreate \
  -Xlinker __TEXT \
  -Xlinker __info_plist \
  -Xlinker "$SCRIPT_DIR/Info.plist"

# Signatur: Die Kalenderberechtigung (TCC) haengt an der Code-Identitaet.
#
# Mit einem Developer-ID-Zertifikat bindet macOS sie an Bundle-ID + Team-ID.
# Sie ueberlebt dann jeden Rebuild - und sogar eine spaetere Erneuerung des
# Zertifikats.
#
# Ohne Zertifikat bleibt nur die Ad-hoc-Signatur. Die bindet an den
# Code-Fingerabdruck (CDHash), und der aendert sich bei JEDEM Neubau: die
# Berechtigung muss danach erneut erteilt werden. Praktisch bestaetigt -
# TCC verweigert dann sogar stillschweigend, ohne Dialog.
#
# CODESIGN_IDENTITY erzwingt eine bestimmte Identitaet; sonst wird eine
# vorhandene Developer ID automatisch verwendet.
IDENTITY="${CODESIGN_IDENTITY:-}"
if [ -z "$IDENTITY" ]; then
  IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null \
    | grep "Developer ID Application" \
    | head -1 \
    | sed -E 's/.*"(.*)".*/\1/') || true
fi

if [ -n "$IDENTITY" ]; then
  # Hardened Runtime verlangt das Kalender-Entitlement - ohne es lehnt macOS
  # den Zugriff ohne jeden Dialog ab.
  codesign --sign "$IDENTITY" \
    --identifier "$BUNDLE_ID" \
    --options runtime \
    --entitlements "$SCRIPT_DIR/calendar-helper.entitlements" \
    --force \
    "$BINARY"
  echo "Gebaut und signiert mit: $IDENTITY"
  echo "  -> Kalenderberechtigung ueberlebt kuenftige Rebuilds."
else
  codesign --sign - --identifier "$BUNDLE_ID" --force "$BINARY"
  echo "Gebaut und ad-hoc signiert (kein Developer-ID-Zertifikat gefunden)."
  echo "  -> Nach jedem Rebuild muss die Kalenderberechtigung neu erteilt werden."
fi

echo "Binary: $BINARY"
