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

# Stabile Ad-hoc-Identitaet: ohne sie fragt macOS nach jedem Rebuild erneut
# nach der Kalenderberechtigung.
codesign --sign - --identifier "$BUNDLE_ID" --force "$BINARY"

echo "Gebaut und signiert: $BINARY"
