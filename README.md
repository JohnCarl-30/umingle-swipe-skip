# Swipe to Skip for umingle

Chrome extension: swipe your hand to the right in front of your webcam and it skips to the next person on umingle.com. Hand tracking runs locally with MediaPipe; no video leaves your machine.

## Install (anyone)

1. Download the latest `swipe-to-skip-<version>.zip` from the [Releases page](https://github.com/JohnCarl-30/umingle-swipe-skip/releases/latest) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder.
4. Open umingle.com. A small panel appears with your camera preview.

Works in Chrome, Edge, Brave, and other Chromium browsers.

## Use

- **Swipe right** (your right — the dot moves right in the mirrored preview), quick and mostly horizontal. A green "SKIP" flash confirms it; there's a 1.5 s cooldown. The extension presses both **Really?** and **Skip** for you, in whichever order umingle shows them.
- **Sensitivity** slider: higher = shorter swipe needed.
- **Drag** the panel by its top bar to move it; the position is remembered.
- **–** collapses the panel (detection keeps running).
- **Pick skip button**: if the panel says "No Skip button", click this, then click umingle's skip button once. It's remembered.

### If the camera fails

Click **Grant camera access** in the panel: it opens a tab where you allow the camera for the extension, then click **Retry camera**.

## Develop

```bash
npm run setup   # copy MediaPipe runtime into extension/ and try to download the hand model
npm run icons   # regenerate extension/icons
npm run build   # package extension/ into dist/swipe-to-skip-<version>.zip
```

If the model isn't bundled in `extension/models/`, the extension downloads it from Google on first load.

### How it works

- `content.js` injects `detector.html` as a draggable iframe (`allow="camera"`) and, on a `swipe` message, clicks Really?/Skip. It finds buttons by your saved pick, then by label (Skip / Next / New / Start), then id/class names, else sends Esc.
- `detector.js` runs MediaPipe HandLandmarker on each frame, tracks the palm centre, and fires when it travels right by ≥ ~24 % of the frame width within 500 ms without much vertical drift.

## Privacy

See [PRIVACY.md](PRIVACY.md). Not affiliated with umingle.
