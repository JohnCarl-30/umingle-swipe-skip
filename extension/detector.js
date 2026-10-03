// Runs inside an extension-origin iframe injected into umingle.com.
// Watches the webcam with MediaPipe HandLandmarker and tells the parent page
// to skip when it sees the hand sweep to the right.
import { FilesetResolver, HandLandmarker } from './vendor/vision_bundle.mjs';

const LOCAL_MODEL = 'models/hand_landmarker.task';
const REMOTE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Sensitivity 1..5 -> how far (fraction of frame width) the palm must travel.
const MIN_DX_BY_SENSITIVITY = { 1: 0.38, 2: 0.30, 3: 0.24, 4: 0.18, 5: 0.13 };
const SWIPE = {
  windowMs: 500,    // the travel must happen within this time
  maxDyRatio: 0.7,  // vertical drift allowed, relative to horizontal travel
  cooldownMs: 1500, // ignore further swipes for this long after one fires
  lostMs: 250,      // forget the track if the hand vanishes this long
};
const PALM_POINTS = [0, 5, 9, 13, 17]; // wrist + finger bases: stable palm centre

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

const settings = { enabled: true, sensitivity: 3, collapsed: false };
const isGrantMode = new URLSearchParams(location.search).has('grant');

let landmarker = null;
let lastVideoTime = -1;
let history = [];
let lastSeen = 0;
let lastFire = 0;

// ---------- messaging with the content script ----------

function toParent(type, data = {}) {
  window.parent.postMessage({ source: 'swipe-skip', type, ...data }, '*');
}

function reportSize() {
  const panel = $('panel');
  toParent('resize', { width: panel.offsetWidth, height: panel.offsetHeight });
}

window.addEventListener('message', (e) => {
  if (e.source !== window.parent || e.data?.source !== 'swipe-skip-page') return;
  if (e.data.type === 'status') setStatus(e.data.text, e.data.state);
});

// ---------- UI ----------

function setStatus(text, state) {
  $('status').textContent = text;
  if (state) $('dot').className = `dot ${state}`;
}

function flash() {
  const el = $('flash');
  el.classList.add('show');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('show')));
}

async function loadSettings() {
  try {
    Object.assign(settings, await chrome.storage.local.get(['enabled', 'sensitivity', 'collapsed']));
  } catch { /* storage unavailable: keep defaults */ }
  $('enabled').checked = settings.enabled;
  $('sensitivity').value = settings.sensitivity;
  document.body.classList.toggle('collapsed', settings.collapsed);
  $('collapse').textContent = settings.collapsed ? '+' : '–';
}

function saveSetting(key, value) {
  settings[key] = value;
  chrome.storage.local.set({ [key]: value }).catch(() => {});
}

function wireUI() {
  $('enabled').addEventListener('change', (e) => {
    saveSetting('enabled', e.target.checked);
    history = [];
    if (landmarker) setStatus(e.target.checked ? 'Ready — swipe right' : 'Paused', e.target.checked ? 'ready' : 'off');
  });
  $('sensitivity').addEventListener('input', (e) => saveSetting('sensitivity', Number(e.target.value)));
  $('collapse').addEventListener('click', () => {
    saveSetting('collapsed', !settings.collapsed);
    document.body.classList.toggle('collapsed', settings.collapsed);
    $('collapse').textContent = settings.collapsed ? '+' : '–';
    reportSize();
  });
  $('pick').addEventListener('click', () => toParent('pick'));
  wireDrag();
  $('grant').addEventListener('click', () => {
    window.open(chrome.runtime.getURL('detector.html?grant=1'), '_blank');
    setStatus('Grant access, then retry', 'error');
    $('grant').textContent = 'Retry camera';
    $('grant').onclick = () => location.reload();
  });
}

// Drag the whole panel by its header. The iframe moves under the pointer, so
// we send screen-coordinate deltas and let the parent page reposition it.
function wireDrag() {
  const header = $('header');
  let last = null;
  header.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
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
    toParent('drag', { dx, dy });
  });
  const end = () => {
    if (!last) return;
    last = null;
    header.classList.remove('dragging');
    toParent('drag-end');
  };
  header.addEventListener('pointerup', end);
  header.addEventListener('pointercancel', end);
}

// ---------- camera + model ----------

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
}

async function modelPath() {
  const local = chrome.runtime.getURL(LOCAL_MODEL);
  try {
    const res = await fetch(local, { method: 'HEAD' });
    if (res.ok) return local;
  } catch { /* not bundled */ }
  return REMOTE_MODEL;
}

async function createLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(chrome.runtime.getURL('vendor/wasm'));
  const modelAssetPath = await modelPath();
  const options = (delegate) => ({
    baseOptions: { modelAssetPath, delegate },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: 0.6,
    minTrackingConfidence: 0.5,
  });
  try {
    return await HandLandmarker.createFromOptions(vision, options('GPU'));
  } catch {
    return await HandLandmarker.createFromOptions(vision, options('CPU'));
  }
}

// ---------- swipe detection ----------

// Coordinates are mirrored (x = 1 - raw) so "right" means the user's right,
// matching what they see in a selfie preview.
function palmCenter(landmarks) {
  let x = 0, y = 0;
  for (const i of PALM_POINTS) { x += landmarks[i].x; y += landmarks[i].y; }
  return { x: 1 - x / PALM_POINTS.length, y: y / PALM_POINTS.length };
}

function trackSwipe(p, t) {
  if (t - lastSeen > SWIPE.lostMs) history = [];
  lastSeen = t;
  history.push({ t, x: p.x, y: p.y });
  while (history.length && t - history[0].t > SWIPE.windowMs) history.shift();
  if (!settings.enabled || t - lastFire < SWIPE.cooldownMs) return false;

  const start = history.reduce((a, b) => (b.x < a.x ? b : a));
  const dx = p.x - start.x;
  const dy = Math.abs(p.y - start.y);
  const minDx = MIN_DX_BY_SENSITIVITY[settings.sensitivity] ?? MIN_DX_BY_SENSITIVITY[3];
  if (dx >= minDx && dy <= dx * SWIPE.maxDyRatio) {
    lastFire = t;
    history = [];
    return true;
  }
  return false;
}

// ---------- render loop ----------

function draw(landmarks, palm) {
  const { width: w, height: h } = canvas;
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, w, h);
  ctx.restore();

  if (history.length > 1) {
    ctx.strokeStyle = 'rgba(61, 220, 132, 0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    history.forEach((pt, i) => (i ? ctx.lineTo(pt.x * w, pt.y * h) : ctx.moveTo(pt.x * w, pt.y * h)));
    ctx.stroke();
  }
  if (landmarks) {
    ctx.fillStyle = '#fff';
    for (const l of landmarks) ctx.fillRect((1 - l.x) * w - 1, l.y * h - 1, 2, 2);
    ctx.fillStyle = '#3ddc84';
    ctx.beginPath();
    ctx.arc(palm.x * w, palm.y * h, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function loop() {
  requestAnimationFrame(loop);
  if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const now = performance.now();
  const result = landmarker.detectForVideo(video, now);
  const landmarks = result.landmarks?.[0];
  let palm = null;

  if (landmarks) {
    palm = palmCenter(landmarks);
    if (trackSwipe(palm, now)) {
      flash();
      toParent('swipe');
    }
  }
  if (settings.enabled) {
    $('dot').className = `dot ${landmarks ? 'hand' : 'ready'}`;
  }
  if (!settings.collapsed) draw(landmarks, palm);
}

// ---------- boot ----------

async function grantMode() {
  document.body.classList.add('grant-mode');
  $('grantPage').hidden = false;
  try {
    await startCamera();
    video.srcObject.getTracks().forEach((t) => t.stop());
    $('grantMsg').textContent = 'Camera access granted. You can close this tab and click "Retry camera" on umingle.';
  } catch (err) {
    $('grantMsg').textContent = `Camera access failed: ${err.name}. Allow the camera in the address bar and reload this tab.`;
  }
}

async function main() {
  await loadSettings();
  wireUI();
  reportSize();

  try {
    setStatus('Starting camera…', 'loading');
    await startCamera();
  } catch (err) {
    console.warn('[swipe-skip] camera error', err);
    setStatus(`Camera: ${err.name}`, 'error');
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

  setStatus(settings.enabled ? 'Ready — swipe right' : 'Paused', settings.enabled ? 'ready' : 'off');
  loop();
}

if (isGrantMode) grantMode(); else main();
