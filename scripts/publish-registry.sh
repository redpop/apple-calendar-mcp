#!/bin/bash
# Traegt den Server in die offizielle MCP Registry ein.
#
# Letzter Schritt des Release-Workflows, von Hand nachzuholen ueber registry.yml. Der Eintrag
# verweist auf das npm-Paket und das .mcpb-Asset des GitHub-Release; die Registry prueft beide,
# deshalb erst nach npm und Release.
#
# Das .mcpb-Paket braucht seine echte Pruefsumme. Die eingecheckte server.json behaelt den
# Platzhalter; veroeffentlicht wird eine Kopie in einem Arbeitsverzeichnis mit fileSha256.
#
# Aufrufe:
#   publish-registry.sh [mcpb-path]          ohne Pfad: Asset des Release v<version> laden (GH_TOKEN)
#   publish-registry.sh --fill-only <mcpb> <out>   nur die Kopie mit Pruefsumme schreiben (Test)
#   publish-registry.sh --wait-npm-only <version>  nur auf die Version bei npm warten (Test)
#
# Setzt eine GitHub-OIDC-Anmeldung voraus (Actions mit id-token: write); lokal nur --fill-only.
set -euo pipefail

# Das Token kann Schreibrechte haben und gilt nur fuer den Download: node, npm, curl und mcp-publisher
# sehen es nicht. Es wird deshalb vor dem ersten Aufruf aus der Umgebung genommen und nur an gh
# weitergereicht, ueber die Umgebung einer Subshell, nie ueber argv (sonst zeigt es ps an).
DOWNLOAD_TOKEN="${GH_TOKEN:-}"
unset GH_TOKEN

REPO_ROOT="$(cd "$(/usr/bin/dirname "${BASH_SOURCE[0]}")/.." && /bin/pwd)"
cd "$REPO_ROOT"

# Gepinnt statt "latest", mit Pruefsummen je Plattform (unten): ein neues oder ausgetauschtes
# Release-Asset des Publishers soll keinen Release-Lauf aendern.
MCP_PUBLISHER_VERSION="v1.8.1"
PLACEHOLDER="0000000000000000000000000000000000000000000000000000000000000000"

PACKAGE_DIR="."
MCPB_NAME="apple-calendar-mcp"

# Schreibt server.json mit der Pruefsumme von <mcpb> nach <out> und bricht ab, wenn der
# Platzhalter danach noch drinsteht.
fill_sha() {
  local mcpb="$1" out="$2" sha
  sha="$(/usr/bin/shasum -a 256 "$mcpb" | /usr/bin/awk '{print $1}')"
  SHA="$sha" OUT="$out" SERVER="$PACKAGE_DIR/server.json" node -e '
    const fs = require("node:fs")
    const server = JSON.parse(fs.readFileSync(process.env.SERVER, "utf8"))
    for (const p of server.packages) if (p.registryType === "mcpb") p.fileSha256 = process.env.SHA
    fs.writeFileSync(process.env.OUT, JSON.stringify(server, null, 2) + "\n")
  '
  if /usr/bin/grep -q "$PLACEHOLDER" "$out"; then
    echo "publish-registry: fileSha256 placeholder is still in $out" >&2
    exit 1
  fi
}

# Wartet, bis npm die Version ausliefert. Ein neues Paket zeigt direkt nach dem Publish nur den
# Platzhalter 0.0.0-stage (beim ersten Release rund 70 s lang); die Registry lehnt den Eintrag
# solange mit "NPM package ... not found" ab.
wait_for_npm() {
  local version="$1" name deadline
  name="$(node -p "require('./$PACKAGE_DIR/package.json').name")"
  deadline=$((SECONDS + ${REGISTRY_NPM_WAIT_SECONDS:-600}))
  # Ohne Benutzerkonfiguration: die .npmrc des Release-Jobs traegt ein Token, das ab Trusted
  # Publishing leer ist. Lesen braucht keines.
  until [ "$(npm view --userconfig /dev/null "$name@$version" version 2>/dev/null)" = "$version" ]; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "publish-registry: $name@$version is not on npm after ${REGISTRY_NPM_WAIT_SECONDS:-600} s" >&2
      exit 1
    fi
    sleep "${REGISTRY_NPM_POLL_SECONDS:-15}"
  done
}

if [ "${1:-}" = "--wait-npm-only" ]; then
  if [ $# -ne 2 ]; then
    echo "usage: publish-registry.sh --wait-npm-only <version>" >&2
    exit 2
  fi
  wait_for_npm "$2"
  exit 0
fi

if [ "${1:-}" = "--fill-only" ]; then
  if [ $# -ne 3 ]; then
    echo "usage: publish-registry.sh --fill-only <mcpb> <out>" >&2
    exit 2
  fi
  fill_sha "$2" "$3"
  exit 0
fi

VERSION="$(node -p "require('./package.json').version")"
node scripts/sync-versions.mjs >/dev/null

# Die Registry begrenzt die Beschreibung auf 100 Zeichen und meldet das erst nach dem Hochladen.
# shellcheck disable=SC2016 # JavaScript-Template-String, kein Shell-Ausdruck
SERVER="$PACKAGE_DIR/server.json" node -e '
  const length = JSON.parse(require("node:fs").readFileSync(process.env.SERVER, "utf8")).description.length
  if (length > 100) { console.error(`server.json: description has ${length} characters, at most 100 are allowed`); process.exit(1) }
'

WORK_DIR="$(/usr/bin/mktemp -d "${RUNNER_TEMP:-/tmp}/registry.XXXXXX")"
trap '/bin/rm -rf "$WORK_DIR"' EXIT

wait_for_npm "$VERSION"

MCPB="${1:-}"
if [ -z "$MCPB" ]; then
  (
    if [ -n "$DOWNLOAD_TOKEN" ]; then export GH_TOKEN="$DOWNLOAD_TOKEN"; fi
    gh release download "v$VERSION" --pattern "$MCPB_NAME-$VERSION.mcpb" --dir "$WORK_DIR"
  )
  MCPB="$WORK_DIR/$MCPB_NAME-$VERSION.mcpb"
fi
unset DOWNLOAD_TOKEN
fill_sha "$MCPB" "$WORK_DIR/server.json"

case "$(/usr/bin/uname -s)/$(/usr/bin/uname -m)" in
  Darwin/arm64) PUBLISHER="darwin_arm64"; PUBLISHER_SHA256="e45e520892460732a4bdf37255576415d4a53ec171f8b913faf15bb1aef7cb77" ;;
  Darwin/x86_64) PUBLISHER="darwin_amd64"; PUBLISHER_SHA256="88126981225e7714fcc6b7a10cdba4a80ae5901e9740a8c06d0d5195c8bc294c" ;;
  Linux/aarch64) PUBLISHER="linux_arm64"; PUBLISHER_SHA256="8dd75a6cf6845688b5d4e46df58d3ca26d5c8d233bb0626606e1db82c5e883e4" ;;
  Linux/x86_64) PUBLISHER="linux_amd64"; PUBLISHER_SHA256="a06c9096dcb9727c13555b6be26c7effa707b01f06a4c561ba7a3635443cf2cc" ;;
  *) echo "publish-registry: no mcp-publisher build for $(/usr/bin/uname -s)/$(/usr/bin/uname -m)" >&2; exit 1 ;;
esac
curl -fsSL -o "$WORK_DIR/mcp-publisher.tar.gz" \
  "https://github.com/modelcontextprotocol/registry/releases/download/$MCP_PUBLISHER_VERSION/mcp-publisher_${PUBLISHER}.tar.gz"
ACTUAL_SHA256="$(/usr/bin/shasum -a 256 "$WORK_DIR/mcp-publisher.tar.gz" | /usr/bin/awk '{print $1}')"
if [ "$ACTUAL_SHA256" != "$PUBLISHER_SHA256" ]; then
  echo "publish-registry: mcp-publisher_${PUBLISHER}.tar.gz has checksum $ACTUAL_SHA256, expected $PUBLISHER_SHA256" >&2
  exit 1
fi
tar xzf "$WORK_DIR/mcp-publisher.tar.gz" -C "$WORK_DIR" mcp-publisher

# GitHub-OIDC statt eines langlebigen Tokens: der Namensraum io.github.redpop haengt an der
# Identitaet des Workflow-Laufs. publish liest server.json aus dem Arbeitsverzeichnis.
(cd "$WORK_DIR" && ./mcp-publisher login github-oidc && ./mcp-publisher publish)

echo "Published $MCPB_NAME version $VERSION to the MCP Registry."
