# Swipe to Skip for umingle

Chrome extension: swipe your hand to the right in front of your webcam and it skips to the next person on umingle.com. Hand tracking runs locally with MediaPipe; no video leaves your machine.

## Install (anyone)

1. Download the latest `swipe-to-skip-<version>.zip` from the [Releases page](https://github.com/JohnCarl-30/umingle-swipe-skip/releases/latest) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder.
4. Open umingle.com. A small panel appears with your camera preview.

Works in Chrome, Edge, Brave, and other Chromium browsers.

## Use

Two ways to skip (toggle each in the **Skip** tab):

- **👋 Swipe right** (your right — the dot moves right in the mirrored preview), quick and mostly horizontal.
- **👎 Thumbs down**, held for about half a second. A bar on the preview fills while you hold it.

A green "SKIP" flash confirms it; there's a 1 s cooldown. The extension presses both **Really?** and **Skip** for you, in whichever order umingle shows them.

- The switch in the top bar turns all gestures on/off; **Swipe sensitivity**: higher = shorter swipe needed.
- **Drag** the panel by its top bar to move it; the position is remembered.
- **–** minimizes the panel to just the status pill (detection keeps running).
- **Pick skip button**: if the panel says "No Skip button", click this, then click umingle's skip button once. It's remembered.

### Camera filters (what the other person sees)

Pick them in the panel's **Filters** tab; the preview shows the result and a "● LIVE FILTER" badge appears once umingle is using them.

- **Look** (Photo Booth-style): Sepia, B&W, Plastic, Comic, Pencil, Glow, Thermal, X-Ray, Vintage, Noir
- **Background**: Blur, Studio (plain backdrop)
- **Face**: 😎 Shades, 🐶 Dog (Snapchat-style ears + nose, from `static/filters/dog.png`), 💕 Lovestruck (floating hearts), 🐦 Dizzy (circling birds), and distortions — 👀 Bug Out, 🐿️ Chipmunk, 👽 Space Alien, 🌀 Nose Twirl, 🐸 Frog. Nothing covers the whole face.

The status line under the filters says "Filters live on umingle ✓" once umingle's camera is running. Choose filters **before** starting a chat, or reload umingle after changing them the first time. While a filter is on, umingle never receives your unfiltered camera: until the first filtered frame is ready it sends black, and if the tab is in the background it repeats the last filtered frame.

### If the camera fails

Click **Grant camera access** in the panel: it opens a tab where you allow the camera for the extension, then click **Retry camera**.

### Jumpscare (Scare tab)

Turn on **😱 Jumpscare** and pick when: **✋ Show a hand** (any hand in view for a moment) or **👋 Wave**. When the stranger does it, **they** get the scare: your video turns into the scare image (zoom, shake, red flashes) for ~1.6 s and a scream plays through your mic audio. Your own screen shows it only in the panel preview. 1 s minimum between scares.

- **▶ Test** previews it in the panel only (with sound on your speakers) — nothing is sent.
- **🖼 Image** / **🔊 Sound** load your own picture or audio file (max 4 MB each); otherwise it uses the bundled image and a scream generated in the browser.
- The scream is mixed straight into the mic audio frames, so it works even if umingle opened the mic before you clicked anything, and you can turn the jumpscare on mid-chat. You also hear it on your own speakers.
- Off by default.

## Develop

Written in TypeScript, bundled with esbuild.

```bash
npm install
npm run build        # build the unpacked extension into dist/ (load this folder in Chrome)
npm run watch        # rebuild on change
npm run check        # type-check + tests
npm run package      # build and zip into release/swipe-to-skip-<version>.zip
npm run fetch-model  # optional: bundle the MediaPipe models instead of downloading them at runtime
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
  hook/      runs in umingle's own page world at document_start
    index.ts    wraps getUserMedia so umingle's video can be replaced
    audio.ts    mixes the jumpscare scream into the outgoing mic audio frames
    frames.ts   picks raw vs filtered frame (never raw while filtering)
  detector/  runs in the extension iframe
    index.ts    camera, hand tracking, preview, panel UI, sends filtered frames
    swipe.ts    palm tracking → swipe-right detection
    models.ts   MediaPipe model loading
    filters/    looks (pixel effects), background (ImageSegmenter), face overlays + WebGL warps (FaceLandmarker)
    gestures.ts thumbs-down hold, stranger hand/wave detection
    scare-frame.ts jumpscare video frames
  shared/    message, storage and filter definitions
static/      manifest, detector.html/css, icons (copied into dist/)
tests/       vitest: swipe detection and skip flow on fake pages
```

### How it works

- The content script injects `detector.html` as a draggable iframe (`allow="camera"`) and, on a `swipe` message, clicks Really?/Skip. It finds buttons by your saved pick, then by label (Skip / Next / New / Start), then id/class names, else sends Esc.
- The detector runs MediaPipe HandLandmarker on each frame, tracks the palm centre, and fires when it travels right by ≥ ~24 % of the frame width within 500 ms without much vertical drift.
- Filters: the hook wraps `getUserMedia` and pipes umingle's camera track through a `MediaStreamTrackProcessor` → `MediaStreamTrackGenerator`. The detector renders the filtered frame (canvas filters, selfie segmentation, face landmarks) and sends it as an `ImageBitmap` over a private `MessageChannel`; the hook swaps it in for the raw frame.

## Privacy

See [PRIVACY.md](PRIVACY.md). Not affiliated with umingle.
