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

Written in TypeScript, bundled with esbuild.

```bash
npm install
npm run build        # build the unpacked extension into dist/ (load this folder in Chrome)
npm run watch        # rebuild on change
npm run check        # type-check + tests
npm run package      # build and zip into release/swipe-to-skip-<version>.zip
npm run fetch-model  # optional: bundle the hand model instead of downloading it at runtime
npm run icons        # regenerate static/icons
```

```
src/
  content/   runs on umingle.com
    index.ts    wires the panel, messages, skip and pick
    panel.ts    draggable iframe that hosts the detector
    buttons.ts  finds Skip / Really? buttons by label and presses them
    skip.ts     Really?/Skip click sequence
    picker.ts   "Pick skip button" mode
  detector/  runs in the extension iframe
    index.ts    camera, MediaPipe HandLandmarker, preview, panel UI
    swipe.ts    palm tracking → swipe-right detection
  shared/    message and storage types
static/      manifest, detector.html/css, icons (copied into dist/)
tests/       vitest: swipe detection and skip flow on fake pages
```

### How it works

- The content script injects `detector.html` as a draggable iframe (`allow="camera"`) and, on a `swipe` message, clicks Really?/Skip. It finds buttons by your saved pick, then by label (Skip / Next / New / Start), then id/class names, else sends Esc.
- The detector runs MediaPipe HandLandmarker on each frame, tracks the palm centre, and fires when it travels right by ≥ ~24 % of the frame width within 500 ms without much vertical drift.

## Privacy

See [PRIVACY.md](PRIVACY.md). Not affiliated with umingle.
