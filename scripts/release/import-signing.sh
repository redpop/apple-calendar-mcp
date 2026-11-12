#!/bin/bash
# Importiert das Developer-ID-Zertifikat in einen temporaeren Schluesselbund (ACM-10, wie apple-mail-mcp D4).
# Die .p12 liegt nur waehrend dieses Skripts in $RUNNER_TEMP (umask 077) und wird per trap geloescht.
# Den Schluesselbund entfernt cleanup-keychain.sh in einem Schritt mit "if: always()".
# Schreibt RELEASE_KEYCHAIN gleich nach dem Anlegen nach $GITHUB_ENV.
set -euo pipefail

SCRIPT_DIR="$(cd "$(/usr/bin/dirname "${BASH_SOURCE[0]}")" && /bin/pwd)"
"$SCRIPT_DIR/require-env.sh" APPLE_CERTIFICATE_BASE64 APPLE_CERTIFICATE_PASSWORD RUNNER_TEMP

IDENTITY="Developer ID Application: Martin Alker (4KTGF63CD2)"
P12="$RUNNER_TEMP/signing-$$.p12"
KEYCHAIN="$RUNNER_TEMP/release.keychain-db"
trap '/bin/rm -f "$P12"' EXIT

# Nur die Schluesseldatei mit 077; das Bundle soll spaeter normale Rechte bekommen.
(umask 077 && printf '%s' "$APPLE_CERTIFICATE_BASE64" | /usr/bin/base64 --decode >"$P12")

KEYCHAIN_PASSWORD="$(/usr/bin/uuidgen)"
/usr/bin/security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
# Sofort bekanntgeben, damit cleanup-keychain.sh den Bund auch nach einem Abbruch weiter unten loescht.
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "RELEASE_KEYCHAIN=$KEYCHAIN" >>"$GITHUB_ENV"
fi
/usr/bin/security set-keychain-settings -lut 21600 "$KEYCHAIN"
/usr/bin/security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
/usr/bin/security import "$P12" -k "$KEYCHAIN" -f pkcs12 -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
/bin/rm -f "$P12"
/usr/bin/security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null

# Bisherige Suchliste merken (cleanup-keychain.sh stellt sie wieder her), neuen Bund voranstellen.
/usr/bin/security list-keychains -d user | /usr/bin/sed -e 's/^ *"//' -e 's/"$//' >"$RUNNER_TEMP/keychains-before.txt"
PREVIOUS=()
while IFS= read -r line; do [ -n "$line" ] && PREVIOUS+=("$line"); done <"$RUNNER_TEMP/keychains-before.txt"
/usr/bin/security list-keychains -d user -s "$KEYCHAIN" ${PREVIOUS[@]+"${PREVIOUS[@]}"}

# Genau eine passende Identitaet, sonst signiert build.sh womoeglich mit etwas anderem oder gar nicht.
COUNT="$(/usr/bin/security find-identity -v -p codesigning "$KEYCHAIN" | /usr/bin/grep -c "\"$IDENTITY\"" || true)"
if [ "$COUNT" != "1" ]; then
  echo "import-signing: expected exactly one '$IDENTITY' identity in the keychain, found $COUNT." >&2
  exit 1
fi

echo "Imported $IDENTITY into a temporary keychain."
