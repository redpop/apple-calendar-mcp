#!/bin/bash
# Raeumt nach dem Signieren auf, auch nach einem Fehler ("if: always()"): temporaerer
# Schluesselbund weg, Suchliste wie vorher, keine Schluesseldateien in $RUNNER_TEMP.
# Endet immer mit 0, auch wenn nichts aufzuraeumen ist.
set -uo pipefail

if [ -n "${RELEASE_KEYCHAIN:-}" ] && [ -e "$RELEASE_KEYCHAIN" ]; then
  /usr/bin/security delete-keychain "$RELEASE_KEYCHAIN" || true
fi

if [ -n "${RUNNER_TEMP:-}" ]; then
  if [ -f "$RUNNER_TEMP/keychains-before.txt" ]; then
    PREVIOUS=()
    while IFS= read -r line; do [ -n "$line" ] && PREVIOUS+=("$line"); done <"$RUNNER_TEMP/keychains-before.txt"
    /usr/bin/security list-keychains -d user -s ${PREVIOUS[@]+"${PREVIOUS[@]}"} || true
    /bin/rm -f "$RUNNER_TEMP/keychains-before.txt"
  fi
  /bin/rm -f "$RUNNER_TEMP"/*.p12 "$RUNNER_TEMP"/*.p8
fi
exit 0
