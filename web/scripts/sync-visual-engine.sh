#!/usr/bin/env bash
# Re-vendor the visual engine from github.com/JayanshJ/study-visual-engine.
#
#   web/scripts/sync-visual-engine.sh [path-or-git-url]
#
# The engine is developed as a standalone Vite/ESM sandbox and copies in
# unchanged apart from ONE mechanical transform: its relative imports carry
# explicit `.js` extensions (correct for Node ESM, and what its own tests
# need), which Turbopack refuses to resolve to the neighbouring `.ts` file.
# We strip the extension on relative specifiers only.
#
# Keeping this a script rather than hand-edits means the next sync is one
# command and the diff stays reviewable.
set -euo pipefail

SRC="${1:-https://github.com/JayanshJ/study-visual-engine}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HERE/../lib/visual-engine"

WORK=""
if [[ "$SRC" == http*://* || "$SRC" == git@* ]]; then
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
  git clone --depth 1 --quiet "$SRC" "$WORK/repo"
  SRC="$WORK/repo"
fi

if [[ ! -d "$SRC/src/engine" ]]; then
  echo "no src/engine in $SRC" >&2
  exit 1
fi

# Keep our directory-scoped package.json (marks the folder ESM); replace the rest.
rm -rf "$DEST"/*.ts "$DEST"/packs "$DEST"/primitives
mkdir -p "$DEST"
cp -R "$SRC/src/engine/." "$DEST/"

# ./foo.js -> ./foo   (relative specifiers only; package imports are untouched).
# Covers both `from "./x.js"` and bare side-effect `import "./x.js"` — the packs
# self-register through the latter, so missing it breaks the whole registry.
find "$DEST" -name '*.ts' -print0 | xargs -0 sed -i '' -E \
  -e 's#(from ")(\.{1,2}/[^"]*)\.js"#\1\2"#g' \
  -e 's#(import ")(\.{1,2}/[^"]*)\.js"#\1\2"#g'

cat > "$DEST/package.json" <<'JSON'
{
  "//": "Vendored from github.com/JayanshJ/study-visual-engine by web/scripts/sync-visual-engine.sh. Do not hand-edit: changes belong upstream. 'type: module' scopes this directory to ESM because the engine is written as ESM while web/ is CJS.",
  "type": "module"
}
JSON

echo "synced -> $DEST"
echo "now run: npm run test:visual"
