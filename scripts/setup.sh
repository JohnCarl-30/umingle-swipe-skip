#!/usr/bin/env bash
# Copies MediaPipe runtime files into the extension and downloads the hand model.
set -euo pipefail
cd "$(dirname "$0")/.."
M=node_modules/@mediapipe/tasks-vision
[ -d "$M" ] || npm install
mkdir -p extension/vendor/wasm extension/models
cp "$M/vision_bundle.mjs" extension/vendor/
cp "$M"/wasm/vision_wasm_internal.{js,wasm} "$M"/wasm/vision_wasm_nosimd_internal.{js,wasm} extension/vendor/wasm/
curl -fL -o extension/models/hand_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task \
  || echo "Model download failed — the extension will fetch it from Google at runtime instead."
echo "Done. Load the 'extension' folder in chrome://extensions (Developer mode → Load unpacked)."
