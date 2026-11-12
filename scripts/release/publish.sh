#!/bin/bash
# Veroeffentlicht npm-Paket und GitHub-Release.
# Wiederholbar nach einem Teilfehler: eine schon veroeffentlichte npm-Version wird uebersprungen.
# Ein vorhandenes Release wird nie ueberschrieben: leer bekommt es alle Assets, vollstaendig bleibt
# es, wie es ist, teilweise gefuellt bricht das Skript ab. Ein Re-Run baut neu, also mit anderen
# Bytes; Pruefsummen und Attestation gehoeren aber zu den Assets des ersten Laufs.
# Aufruf: publish.sh <tarball> <asset>...; braucht GH_TOKEN fuer gh.
set -euo pipefail

NPM_NAME="@redpop/apple-calendar-mcp"
SUMS="SHA256SUMS"

if [ $# -lt 2 ]; then
  echo "usage: publish.sh <tarball> <asset>..." >&2
  exit 2
fi
TARBALL="$1"
shift
VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"

# --- npm ---
PUBLISHED="$(npm view "$NPM_NAME@$VERSION" version 2>/dev/null || true)"
if [ "$PUBLISHED" = "$VERSION" ]; then
  echo "publish: $NPM_NAME@$VERSION is already on npm, skipping npm publish." >&2
else
  npm publish "$TARBALL" --provenance --access public
fi

# --- GitHub-Release mit Pruefsummen ---
ASSETS="$(/usr/bin/mktemp -d "${RUNNER_TEMP:-/tmp}/release-assets.XXXXXX")"
trap '/bin/rm -rf "$ASSETS"' EXIT
NAMES=()
for asset in "$@"; do
  /bin/cp "$asset" "$ASSETS/"
  NAMES+=("$(/usr/bin/basename "$asset")")
done
(cd "$ASSETS" && /usr/bin/shasum -a 256 "${NAMES[@]}" >"$SUMS")
NAMES+=("$SUMS")
FILES=()
for name in "${NAMES[@]}"; do FILES+=("$ASSETS/$name"); done

if EXISTING="$(gh release view "$TAG" --json assets --jq '.assets[].name' 2>/dev/null)"; then
  PRESENT=0
  for name in "${NAMES[@]}"; do
    if printf '%s\n' "$EXISTING" | /usr/bin/grep -qxF "$name"; then PRESENT=$((PRESENT + 1)); fi
  done
  if [ "$PRESENT" -eq "${#NAMES[@]}" ]; then
    echo "publish: release $TAG already has all assets, leaving it unchanged." >&2
  elif [ "$PRESENT" -eq 0 ]; then
    echo "publish: release $TAG exists without assets, uploading them." >&2
    gh release upload "$TAG" "${FILES[@]}"
  else
    echo "publish: release $TAG has some assets but not all; delete them from the release and re-run, so that all assets come from one build." >&2
    exit 1
  fi
else
  gh release create "$TAG" --verify-tag --title "$TAG" --generate-notes "${FILES[@]}"
fi
echo "Published $NPM_NAME $TAG."
