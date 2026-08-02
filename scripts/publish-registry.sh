#!/usr/bin/env bash
#
# Traegt diesen Server in die offizielle MCP Registry ein.
#
# Laeuft am Ende des Release-Workflows und laesst sich ueber den Workflow
# "MCP Registry" von Hand nachholen — der Eintrag haengt allein am bereits
# veroeffentlichten npm-Paket, nicht am Build. Genau deshalb ist er auch der
# letzte Schritt eines Release: schlaegt er fehl, sind npm-Paket und
# GitHub-Release trotzdem draussen.
#
# Setzt eine bestehende GitHub-OIDC-Anmeldung voraus (Actions mit
# `id-token: write`); lokal laeuft das Skript nicht.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="$(node -p "require('./package.json').version")"

# Haelt server.json mit package.json im Gleichklang. Der npm-"version"-Hook
# tut dasselbe beim Versionsbump; hier noch einmal, damit ein von Hand
# angelegter Tag nicht doch eine veraltete Version eintraegt.
node scripts/sync-server-json.mjs

# Die Registry begrenzt die Beschreibung auf 100 Zeichen und meldet einen
# Verstoss erst nach dem Hochladen. Hier abfangen, damit der Fehler nicht
# erst am Ende eines Release-Laufs auftaucht. tests/serverJson.test.ts
# prueft dasselbe schon beim Entwickeln.
node -e '
  const manifest = JSON.parse(require("node:fs").readFileSync("server.json", "utf8"));
  const length = manifest.description.length;
  if (length > 100) {
    console.error("server.json: description hat " + length + " Zeichen, erlaubt sind 100");
    process.exit(1);
  }
'

case "$(uname -s)/$(uname -m)" in
  Darwin/arm64) PUBLISHER="darwin_arm64" ;;
  Darwin/x86_64) PUBLISHER="darwin_amd64" ;;
  Linux/aarch64) PUBLISHER="linux_arm64" ;;
  Linux/x86_64) PUBLISHER="linux_amd64" ;;
  *) echo "Keine mcp-publisher-Variante fuer $(uname -s)/$(uname -m)" >&2; exit 1 ;;
esac

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

curl -fsSL "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_${PUBLISHER}.tar.gz" \
  | tar xz -C "$WORK_DIR" mcp-publisher

# GitHub-OIDC statt eines langlebigen Tokens: der Namensraum io.github.redpop
# wird ueber die Identitaet des Workflow-Laufs nachgewiesen.
"$WORK_DIR/mcp-publisher" login github-oidc
"$WORK_DIR/mcp-publisher" publish

echo "Eingetragen: Version $VERSION"
