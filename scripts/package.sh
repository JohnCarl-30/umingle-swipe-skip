#!/usr/bin/env bash
# Builds and packages dist/ into release/swipe-to-skip-<version>.zip for the Chrome Web Store.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/build.mjs
VERSION=$(node -p "require('./static/manifest.json').version")
mkdir -p release
OUT="release/swipe-to-skip-$VERSION.zip"
rm -f "$OUT"
(cd dist && zip -qr -X "../$OUT" . -x '.*')
echo "Packaged $OUT ($(du -h "$OUT" | cut -f1))"
