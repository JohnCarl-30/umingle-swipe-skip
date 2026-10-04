// Runs inside an extension-origin iframe injected into umingle.com.
// Watches the webcam with MediaPipe HandLandmarker and tells the parent page
// to skip when it sees the hand sweep to the right. Also renders camera
// filters and streams them to the page's camera hook.
import { HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import {
  BACKGROUNDS,
  COLOR_FILTERS,
  FACE_EFFECTS,
  filtersActive,
  type FilterSettings,
} from '../shared/filters';
import {
  FRAME_SOURCE,
  isHookConnect,
  isPageEnvelope,
  type DetectorToHook,
  type FrameMessage,
  type HookToDetector,
  type StatusState,
} from '../shared/messages';
import {
  FILTER_KEYS,
  loadSettings,
  saveSetting,
  type PanelTab,
  type ScareTrigger,
  type Sensitivity,
  type StoredSettings,
} from '../shared/storage';
import { FilterPipeline } from './filters/pipeline';
import { HoldDetector, isThumbsDown, WaveDetector } from './gestures';
import { modelPath, visionFileset, withGpuFallback } from './models';
import { ScareFrames } from './scare-frame';
import { palmCenter, SwipeDetector, type Point } from './swipe';
import { playBuffer, scareDuration, synthScream } from '../shared/scream';

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from detector.html`);
  return el as T;
}

const video = $<HTMLVideoElement>('video');
const canvas = $<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d')!;

const DETECTOR_KEYS = [
  'enabled', 'swipe', 'thumbsDown', 'sensitivity', 'collapsed', 'tab', 'scare', 'scareTrigger', 'scareVolume',
  ...FILTER_KEYS,
] as const;
type DetectorSettings = Pick<StoredSettings, (typeof DETECTOR_KEYS)[number]>;
const settings: DetectorSettings = {
  enabled: true,
  swipe: true,
  thumbsDown: true,
  sensitivity: 3,
  collapsed: false,
  tab: 'skip',
  scare: false,
  scareTrigger: 'hand',
  scareVolume: 0.8,
  colorFilter: 'none',
  background: 'none',
  faceEffect: 'none',
};
const swipe = new SwipeDetector();
const thumbsDown = new HoldDetector();
const pipeline = new FilterPipeline();
const isGrantMode = new URLSearchParams(location.search).has('grant');
const SKIP_COOLDOWN_MS = 1000; // across all gestures

let landmarker: HandLandmarker | null = null;
let cameraOk = false;
let lastVideoTime = -1;
let lastSkip = -Infinity;

// ---------- messaging with the content script ----------

function toParent(msg: FrameMessage): void {
  window.parent.postMessage({ source: FRAME_SOURCE, ...msg }, '*');
}

function reportSize(): void {
  const panel = $('panel');
  toParent({ type: 'resize', width: panel.offsetWidth, height: panel.offsetHeight });
}

// ---------- camera hook (umingle's page) ----------

let hookPort: MessagePort | null = null;
let hookActive = false; // umingle currently has a camera stream

function toHook(msg: DetectorToHook, transfer: Transferable[] = []): void {
  hookPort?.postMessage(msg, transfer);
}

/** Filtering is on only if we can actually produce frames. */
function sendMode(): void {
  toHook({ type: 'mode', filtering: cameraOk && (filtersActive(settings) || !!scare?.send) });
  updateFilterStatus();
}

function updateFilterStatus(text?: string): void {
  const el = $('filterStatus');
  const live = filtersActive(settings) && cameraOk && !!hookPort && hookActive;
  $('liveBadge').hidden = !live;
  if (text) el.textContent = text;
  else if (!filtersActive(settings)) el.textContent = '';
  else if (!cameraOk) el.textContent = 'Filters need the camera';
  else if (!hookPort) el.textContent = 'Waiting for umingle…';
  else if (!hookActive) el.textContent = 'Applies when your umingle camera starts';
  else el.textContent = 'Live on umingle ✓';
}

window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return;
  if (isPageEnvelope(e.data)) {
    const msg = e.data;
    if (msg.type === 'status') setStatus(msg.text, msg.state);
    else if (msg.type === 'stranger-frame') void watchStranger(msg.bitmap);
    else if (msg.type === 'stranger-video') {
      strangerVisible = msg.found;
      updateScareStatus();
    }
  } else if (isHookConnect(e.data) && e.ports[0]) {
    hookPort?.close();
    hookPort = e.ports[0];
    hookPort.onmessage = (m: MessageEvent<HookToDetector>) => {
      if (m.data.type === 'active') {
        hookActive = m.data.active;
        hookScream = m.data.scream;
        updateScareStatus();
        updateFilterStatus();
      }
    };
    sendMode();
    void sendScreamSound();
  }
});

// ---------- UI ----------

let pillTimer: ReturnType<typeof setTimeout> | undefined;

function setStatus(text: string, state?: StatusState): void {
  $('status').textContent = text;
  if (state) $('dot').className = `dot ${state}`;
  if (text.startsWith('Skipped')) {
    const pill = $('pill');
    pill.classList.add('skipped');
    clearTimeout(pillTimer);
    pillTimer = setTimeout(() => pill.classList.remove('skipped'), 1200);
  }
}

function flash(): void {
  const el = $('flash');
  el.classList.add('show');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('show')));
}

function applyCollapsed(): void {
  document.body.classList.toggle('collapsed', settings.collapsed);
  $('collapse').textContent = settings.collapsed ? '+' : '–';
  $('collapse').title = settings.collapsed ? 'Expand' : 'Minimize';
}

function readyText(): string {
  if (!settings.enabled) return 'Paused';
  if (settings.swipe && settings.thumbsDown) return 'Swipe → or 👎 to skip';
  if (settings.swipe) return 'Swipe right to skip';
  if (settings.thumbsDown) return 'Thumbs down 👎 to skip';
  return 'No gesture selected';
}

function showReady(): void {
  const on = settings.enabled && (settings.swipe || settings.thumbsDown);
  setStatus(readyText(), on ? 'ready' : 'off');
}

function selectTab(tab: PanelTab): void {
  settings.tab = tab;
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.tab')) {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
  }
  $('tab-skip').hidden = tab !== 'skip';
  $('tab-filters').hidden = tab !== 'filters';
  $('tab-scare').hidden = tab !== 'scare';
}

/** A row of single-choice chips bound to one filter setting. */
function fillChips<K extends keyof FilterSettings>(
  key: K,
  options: Record<FilterSettings[K], { label: string }>,
): void {
  const group = $(key);
  const render = (): void => {
    for (const chip of group.querySelectorAll<HTMLButtonElement>('.chip')) {
      chip.setAttribute('aria-pressed', String(chip.dataset.value === settings[key]));
    }
  };
  for (const [value, { label }] of Object.entries(options) as [string, { label: string }][]) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.dataset.value = value;
    chip.textContent = label;
    chip.addEventListener('click', () => {
      const v = value as FilterSettings[K];
      (settings as FilterSettings)[key] = v;
      saveSetting(key, v as StoredSettings[K]);
      render();
      pipeline.configure(settings);
      sendMode();
    });
    group.append(chip);
  }
  render();
}

/** An on/off chip bound to a boolean gesture setting. */
function toggleChip(key: 'swipe' | 'thumbsDown'): void {
  const chip = $<HTMLButtonElement>(key);
  const render = (): void => chip.setAttribute('aria-pressed', String(settings[key]));
  chip.addEventListener('click', () => {
    settings[key] = !settings[key];
    saveSetting(key, settings[key]);
    swipe.reset();
    thumbsDown.reset();
    render();
    if (landmarker) showReady();
  });
  render();
}

function wireUI(): void {
  const enabled = $<HTMLInputElement>('enabled');
  const sensitivity = $<HTMLInputElement>('sensitivity');
  enabled.checked = settings.enabled;
  sensitivity.value = String(settings.sensitivity);
  applyCollapsed();
  selectTab(settings.tab);

  enabled.addEventListener('change', () => {
    settings.enabled = enabled.checked;
    saveSetting('enabled', settings.enabled);
    swipe.reset();
    thumbsDown.reset();
    if (landmarker) showReady();
  });
  sensitivity.addEventListener('input', () => {
    settings.sensitivity = Number(sensitivity.value) as Sensitivity;
    swipe.sensitivity = settings.sensitivity;
    saveSetting('sensitivity', settings.sensitivity);
  });
  $('collapse').addEventListener('click', () => {
    settings.collapsed = !settings.collapsed;
    saveSetting('collapsed', settings.collapsed);
    applyCollapsed();
  });
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.tab')) {
    btn.addEventListener('click', () => {
      selectTab(btn.dataset.tab as PanelTab);
      saveSetting('tab', settings.tab);
    });
  }
  $('pick').addEventListener('click', () => toParent({ type: 'pick' }));

  toggleChip('swipe');
  toggleChip('thumbsDown');
  wireScare();
  fillChips('colorFilter', COLOR_FILTERS);
  fillChips('background', BACKGROUNDS);
  fillChips('faceEffect', FACE_EFFECTS);

  const grant = $<HTMLButtonElement>('grant');
  grant.addEventListener('click', () => {
    if (grant.dataset.retry) {
      location.reload();
      return;
    }
    window.open(chrome.runtime.getURL('detector.html?grant=1'), '_blank');
    setStatus('Grant access, then retry', 'error');
    grant.textContent = 'Retry camera';
    grant.dataset.retry = '1';
  });

  // Keep the iframe exactly as big as the panel, whatever changes its size.
  new ResizeObserver(reportSize).observe($('panel'));
  wireDrag();
}

// Drag the whole panel by its header. The iframe moves under the pointer, so
// we send screen-coordinate deltas and let the parent page reposition it.
function wireDrag(): void {
  const header = $('header');
  let last: Point | null = null;

  header.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as Element).closest('button, label')) return;
    last = { x: e.screenX, y: e.screenY };
    header.setPointerCapture(e.pointerId);
    header.classList.add('dragging');
  });
  header.addEventListener('pointermove', (e) => {
    if (!last) return;
    const dx = e.screenX - last.x;
    const dy = e.screenY - last.y;
    if (!dx && !dy) return;
    last = { x: e.screenX, y: e.screenY };
    toParent({ type: 'drag', dx, dy });
  });
  const end = (): void => {
    if (!last) return;
    last = null;
    header.classList.remove('dragging');
    toParent({ type: 'drag-end' });
  };
  header.addEventListener('pointerup', end);
  header.addEventListener('pointercancel', end);
}

// ---------- jumpscare: watch the stranger for a wave ----------

const wave = new WaveDetector();
// "Show a hand": any hand in view for a moment (short grace for flicker).
const handShown = new HoldDetector({ holdMs: 300, graceMs: 200, cooldownMs: 1000 });
let strangerLandmarker: Promise<HandLandmarker> | null = null;
let strangerVisible = false;
let lastStrangerFrame = -Infinity;
let strangerHand = false;

// ---------- the scare the stranger sees and hears ----------

const scareFrames = new ScareFrames();
let hookScream = false; // the hook can mix the scream into the outgoing audio
let customSound: { data: ArrayBuffer; ms: number } | null = null;
let previewAudio: AudioContext | null = null;
/** The scare in progress; `send` = going out to the stranger (vs. Test preview). */
let scare: { start: number; duration: number; send: boolean } | null = null;

async function loadScareAssets(): Promise<void> {
  const { scareImage, scareSound } = await loadSettings(['scareImage', 'scareSound']);
  await scareFrames.load(scareImage);
  customSound = null;
  if (scareSound) {
    try {
      const data = await (await fetch(scareSound)).arrayBuffer();
      previewAudio ??= new AudioContext();
      const decoded = await previewAudio.decodeAudioData(data.slice(0));
      customSound = { data, ms: decoded.duration * 1000 };
    } catch {
      updateScareStatus("Couldn't read that sound — using the default scream");
    }
  }
  void sendScreamSound();
}

/** Gives the hook the custom scream (if any) and the volume. */
async function sendScreamSound(): Promise<void> {
  const data = customSound ? customSound.data.slice(0) : null;
  toHook({ type: 'scream-sound', data, volume: settings.scareVolume }, data ? [data] : []);
}

function soundMs(): number {
  return customSound?.ms ?? 1700;
}

/** Starts a scare: to the stranger (`send`), or just in the panel preview (Test). */
async function startScare(send: boolean): Promise<void> {
  if (scare) return;
  scare = { start: performance.now(), duration: scareDuration(soundMs()), send };
  if (send) {
    sendMode(); // switch the outgoing video to scare frames
    toHook({ type: 'scream' });
  }
  // Also play it on your own speakers, so you hear the scare happen.
  try {
    previewAudio ??= new AudioContext();
    await previewAudio.resume();
    if (customSound) {
      const buf = await previewAudio.decodeAudioData(customSound.data.slice(0));
      playBuffer(previewAudio, previewAudio.destination, buf, settings.scareVolume);
    } else {
      synthScream(previewAudio, previewAudio.destination, settings.scareVolume);
    }
  } catch (err) {
    console.warn('[swipe-skip] could not play the scream locally', err);
  }
}

function endScare(): void {
  const wasSent = scare?.send;
  scare = null;
  if (wasSent) sendMode();
}

function updateScareStatus(text?: string): void {
  const el = $('scareStatus');
  if (text) el.textContent = text;
  else if (!settings.scare) el.textContent = 'Off';
  else if (hookActive && !hookScream) el.textContent = '⚠ Refresh umingle so they can hear the scream (video works)';
  else if (previewAudio && previewAudio.state !== 'running') el.textContent = 'Click the panel once so you can hear the scream too';
  else if (!strangerVisible) el.textContent = "Waiting for the stranger's video…";
  else if (settings.scareTrigger === 'hand') el.textContent = 'Watching for their hand ✋';
  else el.textContent = strangerHand ? 'Hand seen — waiting for a wave 👋' : 'Watching for a wave 👋';
}

/** Runs hand tracking on a snapshot of the stranger's video. */
async function watchStranger(bitmap: ImageBitmap): Promise<void> {
  try {
    if (!settings.scare) return;
    strangerLandmarker ??= (async () => {
      const vision = await visionFileset();
      const modelAssetPath = await modelPath('hand');
      return withGpuFallback((delegate) =>
        HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath, delegate },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        }),
      );
    })();
    const detector = await strangerLandmarker;
    const now = performance.now();
    if (now <= lastStrangerFrame) return; // VIDEO mode needs increasing timestamps
    lastStrangerFrame = now;
    const hands = detector.detectForVideo(bitmap, now).landmarks;
    if (strangerHand !== hands.length > 0) {
      strangerHand = hands.length > 0;
      updateScareStatus();
    }
    const fired =
      settings.scareTrigger === 'hand'
        ? handShown.update(hands.length > 0, now)
        : wave.update(hands[0], now) || (!!hands[1] && wave.update(hands[1], now));
    if (fired) {
      if (hookActive && cameraOk) {
        void startScare(true);
        updateScareStatus(settings.scareTrigger === 'hand' ? 'Hand! Scared them 😱' : 'They waved! Scared them 😱');
      } else {
        updateScareStatus('Triggered, but your umingle camera isn’t live');
      }
      setTimeout(() => updateScareStatus(), 2500);
    }
  } catch (err) {
    console.warn('[swipe-skip] stranger tracking failed', err);
  } finally {
    bitmap.close();
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // chrome.storage.local holds ~10 MB total

function wireScare(): void {
  const chip = $<HTMLButtonElement>('scare');
  const volume = $<HTMLInputElement>('scareVolume');
  const reset = $('scareReset');
  const render = (): void => chip.setAttribute('aria-pressed', String(settings.scare));
  render();
  volume.value = String(settings.scareVolume);
  updateScareStatus();

  void loadSettings(['scareImage', 'scareSound']).then(({ scareImage, scareSound }) => {
    reset.hidden = !scareImage && !scareSound;
  });

  const triggers = $('scareTrigger');
  const renderTrigger = (): void => {
    for (const b of triggers.querySelectorAll<HTMLButtonElement>('.chip')) {
      b.setAttribute('aria-pressed', String(b.dataset.value === settings.scareTrigger));
    }
  };
  renderTrigger();
  triggers.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('.chip');
    if (!b?.dataset.value) return;
    settings.scareTrigger = b.dataset.value as ScareTrigger;
    saveSetting('scareTrigger', settings.scareTrigger);
    wave.reset();
    handShown.reset();
    renderTrigger();
    updateScareStatus();
  });

  chip.addEventListener('click', () => {
    settings.scare = !settings.scare;
    saveSetting('scare', settings.scare);
    wave.reset();
    handShown.reset();
    render();
    updateScareStatus();
  });
  volume.addEventListener('change', () => {
    settings.scareVolume = Number(volume.value);
    saveSetting('scareVolume', settings.scareVolume);
    void sendScreamSound();
  });
  $('scareTest').addEventListener('click', () => void startScare(false));

  const upload = (input: HTMLInputElement, key: 'scareImage' | 'scareSound', label: string): void => {
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      if (file.size > MAX_UPLOAD_BYTES) {
        updateScareStatus(`${label} is too big (max 4 MB)`);
        return;
      }
      saveSetting(key, await readFileAsDataUrl(file));
      await loadScareAssets();
      reset.hidden = false;
      updateScareStatus(`${label} saved ✓ — press Test`);
    });
  };
  const imageFile = $<HTMLInputElement>('scareImageFile');
  const soundFile = $<HTMLInputElement>('scareSoundFile');
  upload(imageFile, 'scareImage', 'Image');
  upload(soundFile, 'scareSound', 'Sound');
  $('scareImageBtn').addEventListener('click', () => imageFile.click());
  $('scareSoundBtn').addEventListener('click', () => soundFile.click());
  reset.addEventListener('click', () => {
    saveSetting('scareImage', null);
    saveSetting('scareSound', null);
    setTimeout(() => void loadScareAssets(), 50);
    reset.hidden = true;
    updateScareStatus('Back to the default image & scream');
  });
}

// ---------- camera + model ----------

async function startCamera(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

async function createHandLandmarker(): Promise<HandLandmarker> {
  const vision = await visionFileset();
  const modelAssetPath = await modelPath('hand');
  return withGpuFallback((delegate) =>
    HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5,
    }),
  );
}

// ---------- render loop ----------

/** Preview: the filtered frame when filters are on, mirrored like a selfie view. */
function drawPreview(source: CanvasImageSource, landmarks: NormalizedLandmark[] | undefined, palm: Point | null): void {
  const { width: w, height: h } = canvas;
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(source, 0, 0, w, h);
  ctx.restore();

  const trail = swipe.trail;
  if (trail.length > 1) {
    ctx.strokeStyle = 'rgba(61, 220, 132, 0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    trail.forEach((pt, i) => (i ? ctx.lineTo(pt.x * w, pt.y * h) : ctx.moveTo(pt.x * w, pt.y * h)));
    ctx.stroke();
  }
  if (landmarks && palm) {
    ctx.fillStyle = '#fff';
    for (const l of landmarks) ctx.fillRect((1 - l.x) * w - 1, l.y * h - 1, 2, 2);
    ctx.fillStyle = '#3ddc84';
    ctx.beginPath();
    ctx.arc(palm.x * w, palm.y * h, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function detectGestures(landmarks: NormalizedLandmark[] | undefined, palm: Point | null, now: number): void {
  const swiped = settings.swipe && !!palm && swipe.update(palm, now);
  const thumbed = settings.thumbsDown && thumbsDown.update(!!landmarks && isThumbsDown(landmarks), now);

  const progress = settings.thumbsDown ? thumbsDown.progress(now) : 0;
  $('hold').classList.toggle('active', progress > 0);
  $('holdBar').style.width = `${progress * 100}%`;
  $('dot').className = `dot ${landmarks ? 'hand' : 'ready'}`;

  if ((swiped || thumbed) && now - lastSkip >= SKIP_COOLDOWN_MS) {
    lastSkip = now;
    swipe.reset();
    flash();
    toParent({ type: 'swipe' });
  }
}

function loop(): void {
  requestAnimationFrame(loop);
  if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const now = performance.now();

  // Gesture detection always runs on the raw camera.
  let landmarks: NormalizedLandmark[] | undefined;
  let palm: Point | null = null;
  if (landmarker) {
    landmarks = landmarker.detectForVideo(video, now).landmarks[0];
    if (landmarks) palm = palmCenter(landmarks);
    if (settings.enabled) detectGestures(landmarks, palm, now);
  }

  // A scare in progress replaces everything else (preview, and outgoing if sent).
  if (scare && now - scare.start > scare.duration) endScare();
  if (scare) {
    const frame = scareFrames.render(video.videoWidth || 640, video.videoHeight || 480, now - scare.start, scare.duration);
    if (!settings.collapsed) drawPreview(frame, undefined, null);
    if (scare.send && hookPort && hookActive) {
      const bitmap = frame.transferToImageBitmap();
      toHook({ type: 'frame', bitmap }, [bitmap]);
    }
    return;
  }

  const filtering = filtersActive(settings);
  const rendered = filtering && pipeline.render(video, now);
  if (!settings.collapsed) drawPreview(rendered ? pipeline.output : video, landmarks, palm);
  if (rendered && hookPort && hookActive) {
    const bitmap = pipeline.output.transferToImageBitmap();
    toHook({ type: 'frame', bitmap }, [bitmap]);
  }
}

// ---------- boot ----------

async function grantMode(): Promise<void> {
  document.body.classList.add('grant-mode');
  $('grantPage').hidden = false;
  const msg = $('grantMsg');
  try {
    const stream = await startCamera();
    stream.getTracks().forEach((t) => t.stop());
    msg.textContent = 'Camera access granted. You can close this tab and click "Retry camera" on umingle.';
  } catch (err) {
    msg.textContent = `Camera access failed: ${(err as Error).name}. Allow the camera in the address bar and reload this tab.`;
  }
}

async function main(): Promise<void> {
  Object.assign(settings, await loadSettings(DETECTOR_KEYS));
  swipe.sensitivity = settings.sensitivity;
  pipeline.onStatus = (text) => updateFilterStatus(text ?? undefined);
  wireUI();
  reportSize();

  try {
    setStatus('Starting camera…', 'loading');
    await startCamera();
    cameraOk = true;
  } catch (err) {
    console.warn('[swipe-skip] camera error', err);
    setStatus(`Camera: ${(err as Error).name}`, 'error');
    $('grant').hidden = false;
    sendMode(); // tells the hook to pass the real camera through
    reportSize();
    return;
  }

  pipeline.configure(settings);
  sendMode();
  void loadScareAssets();
  loop(); // filters and preview run while the hand model loads

  try {
    setStatus('Loading hand model…', 'loading');
    landmarker = await createHandLandmarker();
    showReady();
  } catch (err) {
    console.error('[swipe-skip] model error', err);
    setStatus('Hand model failed to load', 'error');
  }
}

void (isGrantMode ? grantMode() : main());
