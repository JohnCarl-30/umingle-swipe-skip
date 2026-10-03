#!/usr/bin/env bash
# Optional: downloads the hand model so builds bundle it instead of fetching it at runtime.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p models
curl -fL -o models/hand_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
echo "Saved models/hand_landmarker.task — run npm run build to bundle it."
