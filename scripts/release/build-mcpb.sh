#!/bin/bash
# Baut die .mcpb und prueft sie entpackt: Helper ausfuehrbar, gueltig signiert, gleicher CDHash wie
# das gepruefte Binary, nichts sonst unter bin/, keine Symlinks.
#
# Braucht MCPB_VERSION (im Workflow gepinnt), dist/ (npm run build) und bin/calendar-helper.
# Aufruf: build-mcpb.sh <helper-cdhash>
# Schreibt nach $RUNNER_TEMP/out und gibt den Pfad der .mcpb auf stdout aus.
set -euo pipefail

if [ $# -ne 1 ] || [ -z "$1" ]; then
  echo "usage: build-mcpb.sh <helper-cdhash>" >&2
  exit 2
fi
EXPECTED_CDHASH="$1"
HELPER="bin/calendar-helper"
NAME="apple-calendar-mcp"

SCRIPT_DIR="$(cd "$(/usr/bin/dirname "${BASH_SOURCE[0]}")" && /bin/pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && /bin/pwd)"
"$SCRIPT_DIR/require-env.sh" MCPB_VERSION

VERSION="$(node -p "require('$ROOT/package.json').version")"
TEMP_BASE="${RUNNER_TEMP:-$(/usr/bin/mktemp -d)}"
OUT_DIR="$TEMP_BASE/out"
STAGING="$TEMP_BASE/mcpb"
UNPACK="$(/usr/bin/mktemp -d "$TEMP_BASE/mcpb-unpack.XXXXXX")"
MCPB_UNPACK="$(/usr/bin/mktemp -d "$TEMP_BASE/mcpb-cli-unpack.XXXXXX")"
trap '/bin/rm -rf "$UNPACK" "$MCPB_UNPACK"' EXIT

# --- Staging: nur, was zur Laufzeit gebraucht wird; der Helper per ditto (Signatur, Rechte) ---
/bin/rm -rf "$STAGING"
/bin/mkdir -p "$STAGING/bin"
/usr/bin/ditto "$ROOT/dist" "$STAGING/dist"
/usr/bin/ditto "$ROOT/$HELPER" "$STAGING/$HELPER"
for f in manifest.json icon.png README.md LICENSE package.json package-lock.json; do
  /bin/cp "$ROOT/$f" "$STAGING/$f"
done
(cd "$STAGING" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >&2)

/bin/mkdir -p "$OUT_DIR"
MCPB="$(cd "$OUT_DIR" && /bin/pwd)/$NAME-$VERSION.mcpb"
/bin/rm -f "$MCPB"
npx -y "@anthropic-ai/mcpb@$MCPB_VERSION" pack "$STAGING" "$MCPB" >&2

# --- Pruefen am entpackten Archiv ---
# unzip statt ditto: mcpb speichert die Rechte ohne Dateityp-Bits ("?rwxr-xr-x"), ditto verwirft sie
# dann und das Binary verliert das x-Bit. unzip uebernimmt sie, wie die Entpacker der Clients.
/usr/bin/unzip -q "$MCPB" -d "$UNPACK"
# Zweite Kopie mit mcpb unpack, das die gespeicherten Rechte per chmod setzt wie die Clients.
npx -y "@anthropic-ai/mcpb@$MCPB_VERSION" unpack "$MCPB" "$MCPB_UNPACK" >&2

FAILED=0
fail() {
  echo "build-mcpb: $1" >&2
  FAILED=1
}
for DIR in "$UNPACK" "$MCPB_UNPACK"; do
  COPY="$DIR/$HELPER"
  if [ -L "$COPY" ] || [ ! -f "$COPY" ]; then
    fail "$COPY is not a regular file"
    continue
  fi
  [ -x "$COPY" ] || fail "$COPY is not executable"
  /usr/bin/codesign --verify --strict "$COPY" 2>/dev/null || fail "$COPY fails codesign --verify --strict"
  CDHASH="$(/usr/bin/codesign -dvvv "$COPY" 2>&1 | /usr/bin/sed -n 's/^CDHash=//p')"
  [ "$CDHASH" = "$EXPECTED_CDHASH" ] || fail "CDHash of $COPY '$CDHASH' differs from '$EXPECTED_CDHASH'"
  OTHERS="$(/bin/ls -A "$DIR/bin" | /usr/bin/grep -vxF calendar-helper || true)"
  [ -z "$OTHERS" ] || fail "unexpected entries beside the helper in $DIR/bin: $OTHERS"
  LINKS="$(/usr/bin/find "$DIR" -type l)"
  [ -z "$LINKS" ] || fail "symlinks in the unpacked .mcpb: $LINKS"
  [ -f "$DIR/dist/index.js" ] || fail "$DIR/dist/index.js is missing"
  [ -d "$DIR/node_modules/@modelcontextprotocol/server" ] || fail "$DIR/node_modules lacks @modelcontextprotocol/server"
done
[ "$FAILED" -eq 0 ] || exit 1

echo "$MCPB"
