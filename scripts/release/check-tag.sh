#!/bin/bash
# Der Tag passt zur Version, sie ist keine Vorabversion, alle Versionsangaben sind synchron, und der
# ausgecheckte Commit (der Tag) liegt auf main. Braucht origin/main (checkout mit fetch-depth: 0).
# Aufruf: check-tag.sh <tag>
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: check-tag.sh <tag>" >&2
  exit 2
fi
TAG="$1"
VERSION="$(node -p "require('./package.json').version")"

if [ "${TAG#v}" != "$VERSION" ]; then
  echo "check-tag: tag $TAG does not match package.json version $VERSION." >&2
  exit 1
fi

# Vorabversionen gehen nur ueber release-candidate.yml: npm publish ohne --tag machte sie zu "latest".
case "$VERSION" in
  *-*)
    echo "check-tag: $VERSION is a prerelease version; use the release candidate workflow instead of a tag." >&2
    exit 1 ;;
esac

VERSION_FILES=(server.json manifest.json)
for file in "${VERSION_FILES[@]}"; do
  if [ ! -e "$file" ]; then
    echo "check-tag: version file $file is missing." >&2
    exit 1
  fi
done

node scripts/sync-versions.mjs 2>/dev/null
# Mit --untracked-files=normal: auch eine Datei, die das Skript erst neu angelegt hat, ist eine Abweichung.
CHANGED="$(/usr/bin/git status --porcelain --untracked-files=normal)"
if [ -n "$CHANGED" ]; then
  echo "check-tag: version files are out of sync with package.json; run npm version or the sync script and commit:" >&2
  printf '%s\n' "$CHANGED" >&2
  exit 1
fi

if ! /usr/bin/git merge-base --is-ancestor HEAD origin/main; then
  echo "check-tag: $TAG ($(/usr/bin/git rev-parse --short HEAD)) is not on main." >&2
  exit 1
fi
echo "Tag $TAG matches version $VERSION and is on main."
