#!/bin/bash
# Prueft das Release-Binary, bevor es in npm-Paket, ZIP und MCPB geht.
# Alle Pruefungen laufen; jede fehlgeschlagene meldet "verify-helper: <check> failed" auf stderr.
# Bei Erfolg steht der CDHash auf stdout (fuer den Vergleich mit den entpackten Kopien).
#
# Ein nacktes Binary laesst sich notarisieren, aber nicht stapeln, und spctl bewertet es nicht wie
# eine App. Die Notarisierung prueft deshalb notarize.sh (Status "Accepted"), nicht dieses Skript.
# Aufruf: verify-helper.sh <binary>
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: verify-helper.sh <binary>" >&2
  exit 2
fi
BINARY="$1"
IDENTIFIER="io.github.apple-calendar-mcp.calendar-helper"
TEAM="4KTGF63CD2"
REQUIREMENT="identifier \"$IDENTIFIER\" and anchor apple generic and certificate leaf[subject.OU] = \"$TEAM\""

FAILED=0
fail() {
  echo "verify-helper: $1 failed" >&2
  FAILED=1
}

if [ -L "$BINARY" ] || [ ! -f "$BINARY" ]; then
  echo "verify-helper: $BINARY is not a regular file" >&2
  exit 1
fi
[ -x "$BINARY" ] || fail "executable bit"

ARCHS="$(/usr/bin/lipo -archs "$BINARY" 2>/dev/null || true)"
case " $ARCHS " in *" arm64 "*) ;; *) fail "lipo (arm64)" ;; esac
case " $ARCHS " in *" x86_64 "*) ;; *) fail "lipo (x86_64)" ;; esac

INFO="$(/usr/bin/codesign -dv --verbose=2 "$BINARY" 2>&1 || true)"
printf '%s\n' "$INFO" | /usr/bin/grep -qxF "Identifier=$IDENTIFIER" || fail "Identifier"
printf '%s\n' "$INFO" | /usr/bin/grep -q '^Authority=Developer ID Application:' || fail "Authority"
printf '%s\n' "$INFO" | /usr/bin/grep -qxF "TeamIdentifier=$TEAM" || fail "TeamIdentifier"
printf '%s\n' "$INFO" | /usr/bin/grep -q 'flags=0x10000(runtime)' || fail "hardened runtime flag"

# Ohne dieses Entitlement lehnt macOS den Kalenderzugriff unter Hardened Runtime ohne Dialog ab.
ENTITLEMENTS="$(/usr/bin/codesign -d --entitlements - --xml "$BINARY" 2>/dev/null || true)"
printf '%s' "$ENTITLEMENTS" | /usr/bin/grep -q 'com.apple.security.personal-information.calendars' || fail "calendar entitlement"

/usr/bin/codesign --verify --strict "$BINARY" 2>/dev/null || fail "codesign --verify --strict"
/usr/bin/codesign --verify -R="$REQUIREMENT" "$BINARY" 2>/dev/null || fail "release requirement"

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi
/usr/bin/codesign -dvvv "$BINARY" 2>&1 | /usr/bin/sed -n 's/^CDHash=//p'
