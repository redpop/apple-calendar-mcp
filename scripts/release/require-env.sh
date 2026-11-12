#!/bin/bash
# Bricht vor Build und Notarisierung ab, wenn ein Secret fehlt oder leer ist, und nennt seinen
# Namen (nie den Wert). Aufruf: require-env.sh NAME...
set -euo pipefail

for name in "$@"; do
  if [ -z "${!name:-}" ]; then
    echo "Missing secret: $name" >&2
    exit 1
  fi
done
