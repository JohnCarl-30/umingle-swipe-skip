// Runs inside an extension-origin iframe injected into umingle.com.
// Watches the webcam with MediaPipe HandLandmarker and tells the parent page
// to skip when it sees the hand sweep to the right.
import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { FRAME_SOURCE, isPageEnvelope, type FrameMessage, type StatusState } from '../shared/messages';
import { loadSettings, saveSetting, type Sensitivity, type StoredSettings } from '../shared/storage';
import { palmCenter, SwipeDetector, type Point } from './swipe';

const LOCAL_MODEL = 'models/hand_landmarker.task';
const REMOTE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from detector.html`);
  return el as T;
}

const video = $<HTMLVideoElement>('video');
const canvas = $<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d')!;

const settings: Pick<StoredSettings, 'enabled' | 'sensitivity' | 'collapsed'> = {
  enabled: true,
  sensitivity: 3,
  collapsed: false,
};
const swipe = new SwipeDetector();
const isGrantMode = new URLSearchParams(location.search).has('grant');

let landmarker: HandLandmarker | null = null;
let lastVideoTime = -1;

// ---------- messaging with the content script ----------

function toParent(msg: FrameMessage): void {
  window.parent.postMessage({ source: FRAME_SOURCE, ...msg }, '*');
}

function reportSize(): void {
  const panel = $('panel');
  toParent({ type: 'resize', width: panel.offsetWidth, height: panel.offsetHeight });
}

window.addEventListener('message', (e) => {
  if (e.source !== window.parent || !isPageEnvelope(e.data)) return;
  setStatus(e.data.text, e.data.state);
});

// ---------- UI ----------

function setStatus(text: string, state?: StatusState): void {
  $('status').textContent = text;
  if (state) $('dot').className = `dot ${state}`;
}

function flash(): void {
  const el = $('flash');
  el.classList.add('show');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('show')));
}

function applyCollapsed(): void {
  document.body.classList.toggle('collapsed', settings.collapsed);
  $('collapse').textContent = settings.collapsed ? '+' : '–';
}

function showReady(): void {
  setStatus(settings.enabled ? 'Ready — swipe right' : 'Paused', settings.enabled ? 'ready' : 'off');
}

function wireUI(): void {
  const enabled = $<HTMLInputElement>('enabled');
  const sensitivity = $<HTMLInputElement>('sensitivity');
  enabled.checked = settings.enabled;
  sensitivity.value = String(settings.sensitivity);
  applyCollapsed();

  enabled.addEventListener('change', () => {
    settings.enabled = enabled.checked;
    saveSetting('enabled', settings.enabled);
    swipe.reset();
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
    reportSize();
  });
  $('pick').addEventListener('click', () => toParent({ type: 'pick' }));

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

  wireDrag();
}

// Drag the whole panel by its header. The iframe moves under the pointer, so
// we send screen-coordinate deltas and let the parent page reposition it.
function wireDrag(): void {
  const header = $('header');
  let last: Point | null = null;

  header.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as Element).closest('button')) return;
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

async function modelPath(): Promise<string> {
  const local = chrome.runtime.getURL(LOCAL_MODEL);
  try {
    const res = await fetch(local, { method: 'HEAD' });
    if (res.ok) return local;
  } catch {
    /* not bundled */
  }
  return REMOTE_MODEL;
}

async function createLandmarker(): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(chrome.runtime.getURL('vendor/wasm'));
  const modelAssetPath = await modelPath();
  const create = (delegate: 'GPU' | 'CPU') =>
    HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
  try {
    return await create('GPU');
  } catch {
    return await create('CPU');
  }
}

// ---------- render loop ----------

function draw(landmarks: NormalizedLandmark[] | undefined, palm: Point | null): void {
  const { width: w, height: h } = canvas;
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, w, h);
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

function loop(detector: HandLandmarker): void {
  requestAnimationFrame(() => loop(detector));
  if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const now = performance.now();
  const landmarks = detector.detectForVideo(video, now).landmarks[0];
  let palm: Point | null = null;

  if (landmarks) {
    palm = palmCenter(landmarks);
    if (settings.enabled && swipe.update(palm, now)) {
      flash();
      toParent({ type: 'swipe' });
    }
  }
  if (settings.enabled) $('dot').className = `dot ${landmarks ? 'hand' : 'ready'}`;
  if (!settings.collapsed) draw(landmarks, palm);
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
  Object.assign(settings, await loadSettings(['enabled', 'sensitivity', 'collapsed']));
  swipe.sensitivity = settings.sensitivity;
  wireUI();
  reportSize();

  try {
    setStatus('Starting camera…', 'loading');
    await startCamera();
  } catch (err) {
    console.warn('[swipe-skip] camera error', err);
    setStatus(`Camera: ${(err as Error).name}`, 'error');
    $('grant').hidden = false;
    reportSize();
    return;
  }

  try {
    setStatus('Loading hand model…', 'loading');
    landmarker = await createLandmarker();
  } catch (err) {
    console.error('[swipe-skip] model error', err);
    setStatus('Hand model failed to load', 'error');
    return;
  }

  showReady();
  loop(landmarker);
}

void (isGrantMode ? grantMode() : main());
