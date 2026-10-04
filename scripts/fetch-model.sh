#!/usr/bin/env bash
# Optional: downloads the MediaPipe models so builds bundle them instead of
# fetching them from Google at runtime.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p models
GCS=https://storage.googleapis.com/mediapipe-models
curl -fL -o models/hand_landmarker.task "$GCS/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
curl -fL -o models/face_landmarker.task "$GCS/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
curl -fL -o models/selfie_segmenter.tflite "$GCS/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite"
echo "Saved models/ — run npm run build to bundle them."
