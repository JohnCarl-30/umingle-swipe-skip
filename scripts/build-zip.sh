#!/usr/bin/env bash
# Packages extension/ into dist/swipe-to-skip-<version>.zip for the Chrome Web Store.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./extension/manifest.json').version")
mkdir -p dist
OUT="dist/swipe-to-skip-$VERSION.zip"
rm -f "$OUT"
(cd extension && zip -qr -X "../$OUT" . -x '.*')
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
