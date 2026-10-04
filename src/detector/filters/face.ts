// Face effects drawn from MediaPipe FaceLandmarker landmarks (478 points).

import type { Landmark, Point } from '../swipe';
import type { DogSprites, Sprite } from './sprites';

// Eye corners (from the subject's point of view, in raw camera coordinates).
const RIGHT_EYE = [33, 133];
const LEFT_EYE = [362, 263];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FaceGeometry {
  box: Box;           // bounding box of all landmarks, in pixels
  center: Point;
  rightEye: Point;
  leftEye: Point;
  eyeDistance: number;
  angle: number;      // head roll in radians (0 = level)
}

const mid = (lms: readonly Landmark[], [a, b]: number[], w: number, h: number): Point => ({
  x: ((lms[a].x + lms[b].x) / 2) * w,
  y: ((lms[a].y + lms[b].y) / 2) * h,
});

export function faceGeometry(lms: readonly Landmark[], width: number, height: number): FaceGeometry {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of lms) {
    minX = Math.min(minX, l.x);
    maxX = Math.max(maxX, l.x);
    minY = Math.min(minY, l.y);
    maxY = Math.max(maxY, l.y);
  }
  const box = { x: minX * width, y: minY * height, w: (maxX - minX) * width, h: (maxY - minY) * height };
  const rightEye = mid(lms, RIGHT_EYE, width, height);
  const leftEye = mid(lms, LEFT_EYE, width, height);
  return {
    box,
    center: { x: box.x + box.w / 2, y: box.y + box.h / 2 },
    rightEye,
    leftEye,
    eyeDistance: Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y),
    angle: Math.atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x),
  };
}

type Ctx = OffscreenCanvasRenderingContext2D;

export function drawSunglasses(ctx: Ctx, g: FaceGeometry): void {
  const d = g.eyeDistance;
  const lensW = d * 0.78;
  const lensH = d * 0.5;
  ctx.save();
  ctx.translate((g.rightEye.x + g.leftEye.x) / 2, (g.rightEye.y + g.leftEye.y) / 2);
  ctx.rotate(g.angle);
  const grad = ctx.createLinearGradient(0, -lensH / 2, 0, lensH / 2);
  grad.addColorStop(0, '#2a2a33');
  grad.addColorStop(1, '#050507');
  ctx.fillStyle = grad;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = Math.max(2, d * 0.06);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.roundRect(side * (d / 2) - lensW / 2, -lensH / 2, lensW, lensH, lensH * 0.35);
    ctx.fill();
    ctx.stroke();
  }
  // bridge
  ctx.beginPath();
  ctx.moveTo(-d / 2 + lensW / 2, -lensH * 0.15);
  ctx.quadraticCurveTo(0, -lensH * 0.4, d / 2 - lensW / 2, -lensH * 0.15);
  ctx.stroke();
  // glare
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * (d / 2) - lensW * 0.18, -lensH * 0.15, lensW * 0.18, lensH * 0.12, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** The point a little above the top of the head, and the head's width. */
function crown(g: FaceGeometry): { top: Point; width: number } {
  return { top: { x: g.center.x, y: g.box.y - g.box.h * 0.12 }, width: g.box.w };
}

function heart(ctx: Ctx, x: number, y: number, size: number): void {
  const s = size / 2;
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.7, y - s * 1.2, x, y - s * 0.45);
  ctx.bezierCurveTo(x + s * 0.7, y - s * 1.2, x + s * 1.4, y - s * 0.1, x, y + s * 0.9);
  ctx.fill();
}

/** 💕 Lovestruck: hearts drifting up and fading above the head. `t` in ms. */
export function drawHearts(ctx: Ctx, g: FaceGeometry, t: number): void {
  const { top, width } = crown(g);
  const n = 7;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const phase = ((t / 2200 + i / n) % 1 + 1) % 1; // 0..1 lifetime
    const x = top.x + (i / (n - 1) - 0.5) * width * 1.2 + Math.sin(t / 400 + i) * width * 0.04;
    const size = width * (0.15 + 0.06 * Math.sin(i * 1.7));
    // Rise from forehead level to just above the head; never off the frame.
    const y = Math.max(size * 0.6, top.y + g.box.h * 0.12 - phase * g.box.h * 0.35);
    ctx.globalAlpha = Math.sin(phase * Math.PI) * 0.9;
    ctx.fillStyle = i % 2 ? '#ff6f9c' : '#ff3d7f';
    heart(ctx, x, y, size);
  }
  ctx.restore();
}

function bird(ctx: Ctx, x: number, y: number, size: number, flap: number, facing: 1 | -1): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing, 1);
  ctx.fillStyle = '#4aa3ff';
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.55, size * 0.32, 0, 0, Math.PI * 2); // body
  ctx.fill();
  ctx.beginPath();
  ctx.arc(size * 0.45, -size * 0.18, size * 0.22, 0, Math.PI * 2); // head
  ctx.fill();
  ctx.fillStyle = '#2b78d6';
  ctx.beginPath(); // wing
  ctx.ellipse(-size * 0.05, -size * 0.1, size * 0.35, size * 0.14, -0.6 + flap, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffb020';
  ctx.beginPath(); // beak
  ctx.moveTo(size * 0.64, -size * 0.2);
  ctx.lineTo(size * 0.85, -size * 0.14);
  ctx.lineTo(size * 0.62, -size * 0.08);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(size * 0.5, -size * 0.24, size * 0.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 🐦 Dizzy: little birds circling above the head. `t` in ms. */
export function drawBirds(ctx: Ctx, g: FaceGeometry, t: number): void {
  const { top, width } = crown(g);
  const n = 4;
  const birds = Array.from({ length: n }, (_, i) => {
    const a = t / 700 + (i / n) * Math.PI * 2;
    return { a, depth: Math.sin(a) }; // depth > 0 = in front
  }).sort((p, q) => p.depth - q.depth);
  for (const { a, depth } of birds) {
    const x = top.x + Math.cos(a) * width * 0.6;
    const size = width * 0.18 * (0.8 + 0.25 * (depth + 1) / 2);
    const y = Math.max(size * 0.5, top.y + g.box.h * 0.04 + depth * g.box.h * 0.06);
    ctx.globalAlpha = 0.75 + 0.25 * (depth + 1) / 2;
    bird(ctx, x, y, size, Math.sin(t / 60 + a) * 0.5, Math.sin(a) > 0 ? -1 : 1);
  }
  ctx.globalAlpha = 1;
}

// ---------- 🐶 Dog (ears + nose), Snapchat-style ----------

const FOREHEAD_TOP = 10;
const FACE_RIGHT = 234;
const FACE_LEFT = 454;
const NOSE_TIP = 1;

const lmPx = (lms: readonly Landmark[], i: number, w: number, h: number): Point => ({ x: lms[i].x * w, y: lms[i].y * h });

/** One floppy ear, drawn hanging down from (0,0); `side` mirrors it. */
function dogEar(ctx: Ctx, size: number, side: 1 | -1): void {
  ctx.save();
  ctx.scale(side, 1);
  const outer = new Path2D();
  outer.moveTo(-size * 0.2, -size * 0.05);
  outer.bezierCurveTo(size * 0.25, -size * 0.35, size * 0.75, -size * 0.1, size * 0.62, size * 0.45);
  outer.bezierCurveTo(size * 0.55, size * 0.85, size * 0.15, size * 0.95, size * 0.02, size * 0.7);
  outer.bezierCurveTo(-size * 0.1, size * 0.45, -size * 0.25, size * 0.2, -size * 0.2, -size * 0.05);
  const fur = ctx.createLinearGradient(0, -size * 0.3, 0, size * 0.9);
  fur.addColorStop(0, '#b07a43');
  fur.addColorStop(1, '#7c4e24');
  ctx.fillStyle = fur;
  ctx.fill(outer);
  const inner = new Path2D();
  inner.moveTo(size * 0.05, size * 0.05);
  inner.bezierCurveTo(size * 0.3, -size * 0.05, size * 0.45, size * 0.2, size * 0.38, size * 0.5);
  inner.bezierCurveTo(size * 0.3, size * 0.7, size * 0.12, size * 0.6, size * 0.08, size * 0.4);
  inner.closePath();
  ctx.fillStyle = '#e9a7a2';
  ctx.fill(inner);
  ctx.restore();
}

function dogNose(ctx: Ctx, size: number): void {
  // Muzzle: two puffy cheeks.
  const muzzle = ctx.createRadialGradient(0, -size * 0.1, size * 0.1, 0, 0, size * 0.7);
  muzzle.addColorStop(0, '#d9a56c');
  muzzle.addColorStop(1, '#a8723f');
  ctx.fillStyle = muzzle;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * size * 0.28, size * 0.12, size * 0.36, size * 0.27, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Freckles.
  ctx.fillStyle = 'rgba(70,40,20,0.55)';
  for (const [x, y] of [[-0.42, 0.1], [-0.3, 0.2], [-0.45, 0.24], [0.42, 0.1], [0.3, 0.2], [0.45, 0.24]]) {
    ctx.beginPath();
    ctx.arc(x * size, y * size, size * 0.025, 0, Math.PI * 2);
    ctx.fill();
  }
  // Nose.
  const nose = ctx.createRadialGradient(-size * 0.05, -size * 0.12, size * 0.02, 0, -size * 0.05, size * 0.2);
  nose.addColorStop(0, '#6b4a3a');
  nose.addColorStop(1, '#2a1810');
  ctx.fillStyle = nose;
  ctx.beginPath();
  ctx.ellipse(0, -size * 0.06, size * 0.2, size * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(-size * 0.06, -size * 0.12, size * 0.06, size * 0.03, -0.3, 0, Math.PI * 2);
  ctx.fill();
}

function drawSprite(ctx: Ctx, s: Sprite, cx: number, cy: number, width: number): void {
  const height = (s.height / s.width) * width;
  ctx.drawImage(s.canvas, cx - width / 2, cy - height / 2, width, height);
}

/**
 * 🐶 Dog: floppy ears on the head and a dog nose over the nose. Uses the dog
 * artwork when loaded, otherwise a drawn version.
 */
export function drawDog(ctx: Ctx, lms: readonly Landmark[], w: number, h: number, sprites?: DogSprites | null): void {
  const g = faceGeometry(lms, w, h);
  const r = lmPx(lms, FACE_RIGHT, w, h);
  const l = lmPx(lms, FACE_LEFT, w, h);
  const faceW = Math.hypot(l.x - r.x, l.y - r.y);
  if (faceW < 4) return;
  const top = lmPx(lms, FOREHEAD_TOP, w, h);
  const nose = lmPx(lms, NOSE_TIP, w, h);

  if (sprites) {
    // Ears sit on the hairline, angled out (the artwork already is).
    ctx.save();
    ctx.translate(top.x, top.y);
    ctx.rotate(g.angle);
    drawSprite(ctx, sprites.leftEar, -faceW * 0.4, -faceW * 0.05, faceW * 0.58);
    drawSprite(ctx, sprites.rightEar, faceW * 0.4, -faceW * 0.05, faceW * 0.58);
    ctx.restore();
    // The dark nose of the artwork sits over the nose tip.
    ctx.save();
    ctx.translate(nose.x, nose.y);
    ctx.rotate(g.angle);
    drawSprite(ctx, sprites.nose, 0, faceW * 0.04, faceW * 0.5);
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.translate(top.x, top.y);
  ctx.rotate(g.angle);
  for (const side of [-1, 1] as const) {
    ctx.save();
    ctx.translate(side * faceW * 0.3, -faceW * 0.2);
    ctx.rotate(side * 0.45);
    dogEar(ctx, faceW * 0.55, side);
    ctx.restore();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(nose.x, nose.y);
  ctx.rotate(g.angle);
  dogNose(ctx, faceW * 0.42);
  ctx.restore();
}
