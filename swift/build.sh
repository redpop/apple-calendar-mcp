#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../bin"
BINARY="$OUT_DIR/calendar-helper"
BUNDLE_ID="io.github.apple-calendar-mcp.calendar-helper"

mkdir -p "$OUT_DIR"

# Deployment-Target: macOS 14 ist das Minimum, das der Code ohnehin verlangt
# (requestFullAccessToEvents und der #available-Guard in main.swift). Es
# explizit anzugeben ist noetig, sobald fuer eine fremde Architektur gebaut
# wird — und haelt gleichzeitig fest, wogegen gebaut wurde, statt es von der
# gerade installierten SDK-Version abhaengen zu lassen.
DEPLOYMENT_TARGET="14.0"

# Universal, nicht nur fuer die laufende Architektur: Das Binary wird als Teil
# des npm-Pakets ausgeliefert und muss dort auch auf Intel-Macs laufen. Ein
# Paket, das nur arm64 enthaelt, waere auf aelteren Geraeten schlicht kaputt —
# und zwar erst beim Nutzer, nicht beim Bauen.
build_slice() {
  local arch="$1"
  local output="$2"
  swiftc "$SCRIPT_DIR/main.swift" \
    -O \
    -target "${arch}-apple-macosx${DEPLOYMENT_TARGET}" \
    -o "$output" \
    -Xlinker -sectcreate \
    -Xlinker __TEXT \
    -Xlinker __info_plist \
    -Xlinker "$SCRIPT_DIR/Info.plist"
}

SLICE_DIR="$(mktemp -d)"
trap 'rm -rf "$SLICE_DIR"' EXIT

build_slice arm64 "$SLICE_DIR/calendar-helper-arm64"
build_slice x86_64 "$SLICE_DIR/calendar-helper-x86_64"

# Signiert wird erst das fertige Fat Binary: lipo wuerde eine Signatur der
# einzelnen Slices ohnehin ungueltig machen.
lipo -create \
  "$SLICE_DIR/calendar-helper-arm64" \
  "$SLICE_DIR/calendar-helper-x86_64" \
  -output "$BINARY"

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
