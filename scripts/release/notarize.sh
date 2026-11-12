#!/bin/bash
# Notarisiert den Helper mit dem App-Store-Connect-API-Key (ACM-10, wie apple-mail-mcp D4).
# Die .p8 liegt nur waehrend dieses Skripts in $RUNNER_TEMP (umask 077) und wird per trap geloescht.
#
# Ein nacktes Binary laesst sich nicht stapeln; dafuer braeuchte es ein .app oder .pkg. Ein .app
# kommt nicht in Frage: Die Kalenderberechtigung haengt am Pfad des Binarys, und der aenderte sich
# damit. Ohne Stapling prueft Gatekeeper eine Datei mit Quarantaene-Markierung online.
# Aufruf: notarize.sh <binary> <zip-out>; <zip-out> ist das eingereichte ZIP (Release-Asset).
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: notarize.sh <binary> <zip-out>" >&2
  exit 2
fi
BINARY="$1"
ZIP_OUT="$2"

SCRIPT_DIR="$(cd "$(/usr/bin/dirname "${BASH_SOURCE[0]}")" && /bin/pwd)"
"$SCRIPT_DIR/require-env.sh" APPLE_API_KEY_BASE64 APPLE_API_KEY_ID APPLE_API_ISSUER_ID RUNNER_TEMP

P8="$RUNNER_TEMP/AuthKey-$$.p8"
trap '/bin/rm -f "$P8"' EXIT

(umask 077 && printf '%s' "$APPLE_API_KEY_BASE64" | /usr/bin/base64 --decode >"$P8")
AUTH=(--key "$P8" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER_ID")

/bin/rm -f "$ZIP_OUT"
/usr/bin/ditto -c -k --keepParent "$BINARY" "$ZIP_OUT"
# --timeout: ein Ausfall bei Apple soll den Lauf beenden statt bis zum Job-Timeout zu warten.
# notarytool endet bei "Invalid" je nach Version mit oder ohne Fehlercode; entscheidend ist der Status.
RESULT="$(/usr/bin/xcrun notarytool submit "$ZIP_OUT" "${AUTH[@]}" --wait --timeout 30m --output-format json || true)"
STATUS="$(printf '%s' "$RESULT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).status??""))}catch{}})')"
SUBMISSION="$(printf '%s' "$RESULT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).id??""))}catch{}})')"

if [ "$STATUS" != "Accepted" ]; then
  echo "notarize: submission ${SUBMISSION:-<none>} ended with status '${STATUS:-unknown}'." >&2
  if [ -n "$SUBMISSION" ]; then
    /usr/bin/xcrun notarytool log "$SUBMISSION" "${AUTH[@]}" >&2 || true
  else
    printf '%s\n' "$RESULT" >&2
  fi
  exit 1
fi

echo "Notarized $BINARY (submission $SUBMISSION)."
