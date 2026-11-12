#!/bin/bash
# Prueft das npm-Paket: erst die Dateiliste (Helper und dist/ vorhanden, unter bin/ nichts sonst),
# dann das echte Tarball entpackt, weil npm Dateirechte neu setzt: ausfuehrbar, gueltig signiert,
# gleicher CDHash wie das gepruefte Binary.
# Aufruf: verify-npm-pack.sh <expected-cdhash>. Gibt den Pfad des Tarballs auf stdout aus.
set -euo pipefail

if [ $# -ne 1 ] || [ -z "$1" ]; then
  echo "usage: verify-npm-pack.sh <expected-cdhash>" >&2
  exit 2
fi
EXPECTED_CDHASH="$1"
HELPER="bin/calendar-helper"
OUT_DIR="${RUNNER_TEMP:-$(/usr/bin/mktemp -d)}"

# --- Dateiliste ---
LISTING="$(npm pack --json --dry-run 2>/dev/null)"
printf '%s' "$LISTING" | HELPER="$HELPER" node -e '
let s = ""
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const helper = process.env.HELPER
  const files = new Set(JSON.parse(s)[0].files.map((f) => f.path))
  const required = [helper, "dist/index.js", "dist/helperInstall.js"]
  let ok = true
  for (const r of required) if (!files.has(r)) { console.error(`verify-npm-pack: missing ${r}`); ok = false }
  for (const f of files) {
    if (f.startsWith("bin/") && f !== helper) { console.error(`verify-npm-pack: unexpected file under bin/: ${f}`); ok = false }
  }
  process.exit(ok ? 0 : 1)
})'

# --- Echtes Tarball, entpackt geprueft ---
TARBALL_NAME="$(npm pack --json --pack-destination "$OUT_DIR" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s)[0].filename))')"
TARBALL="$OUT_DIR/$TARBALL_NAME"
UNPACK="$(/usr/bin/mktemp -d "$OUT_DIR/npm-unpack.XXXXXX")"
trap '/bin/rm -rf "$UNPACK"' EXIT
/usr/bin/tar -xzf "$TARBALL" -C "$UNPACK"
COPY="$UNPACK/package/$HELPER"

FAILED=0
if [ -L "$COPY" ] || [ ! -f "$COPY" ]; then
  echo "verify-npm-pack: unpacked helper is not a regular file" >&2
  exit 1
fi
[ -x "$COPY" ] || { echo "verify-npm-pack: unpacked helper is not executable" >&2; FAILED=1; }
/usr/bin/codesign --verify --strict "$COPY" 2>/dev/null || { echo "verify-npm-pack: unpacked helper fails codesign --verify --strict" >&2; FAILED=1; }
CDHASH="$(/usr/bin/codesign -dvvv "$COPY" 2>&1 | /usr/bin/sed -n 's/^CDHash=//p')"
[ "$CDHASH" = "$EXPECTED_CDHASH" ] || { echo "verify-npm-pack: unpacked CDHash '$CDHASH' differs from '$EXPECTED_CDHASH'" >&2; FAILED=1; }
[ "$FAILED" -eq 0 ] || exit 1

echo "$TARBALL"
