// Photo Booth-style looks that need more than a CSS filter. Each runs on the
// whole rendered frame, in place.

import type { LookPost } from '../../shared/filters';

type Ctx = OffscreenCanvasRenderingContext2D;

export const luminance = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

/** Thermal-camera palette: dark blue → blue → cyan → green → yellow → red → white-hot. */
export function thermalColor(l: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [10, 0, 90]],
    [0.18, [0, 40, 255]],
    [0.36, [0, 230, 255]],
    [0.52, [40, 255, 60]],
    [0.68, [255, 240, 0]],
    [0.85, [255, 40, 0]],
    [1, [255, 255, 255]],
  ];
  const v = Math.min(1, Math.max(0, l / 255));
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i];
    const [t0, c0] = stops[i - 1];
    if (v <= t1) {
      const f = (v - t0) / (t1 - t0);
      return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * f)) as [number, number, number];
    }
  }
  return stops[stops.length - 1][1];
}

const THERMAL_LUT = (() => {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let l = 0; l < 256; l++) lut.set(thermalColor(l), l * 3);
  return lut;
})();

/** Snap a channel to `levels` flat steps (comic-book color). */
export const posterize = (v: number, levels: number): number => {
  const step = 255 / (levels - 1);
  return Math.round(Math.round(v / step) * step);
};

/** Sobel edge strength (0..~1442) per pixel of a luminance image. */
export function sobel(lum: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = lum[i - w - 1], t = lum[i - w], tr = lum[i - w + 1];
      const l = lum[i - 1], r = lum[i + 1];
      const bl = lum[i + w - 1], b = lum[i + w], br = lum[i + w + 1];
      const gx = tr + 2 * r + br - tl - 2 * l - bl;
      const gy = bl + 2 * b + br - tl - 2 * t - tr;
      out[i] = Math.hypot(gx, gy);
    }
  }
  return out;
}

function luminanceOf(data: Uint8ClampedArray, n: number): Float32Array {
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = luminance(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  return lum;
}

let scratch: OffscreenCanvas | null = null;
function scratchCanvas(w: number, h: number): OffscreenCanvasRenderingContext2D {
  scratch ??= new OffscreenCanvas(w, h);
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  return scratch.getContext('2d')!;
}

const patterns = new Map<string, CanvasPattern>();
function pattern(ctx: Ctx, key: string, draw: (p: OffscreenCanvasRenderingContext2D) => void, size: number): CanvasPattern {
  let pat = patterns.get(key);
  if (!pat) {
    const c = new OffscreenCanvas(size, size);
    draw(c.getContext('2d')!);
    pat = ctx.createPattern(c, 'repeat')!;
    patterns.set(key, pat);
  }
  return pat;
}

function thermal(ctx: Ctx, w: number, h: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = Math.round(luminance(d[i], d[i + 1], d[i + 2])) * 3;
    d[i] = THERMAL_LUT[l];
    d[i + 1] = THERMAL_LUT[l + 1];
    d[i + 2] = THERMAL_LUT[l + 2];
  }
  ctx.putImageData(img, 0, 0);
}

function comic(ctx: Ctx, w: number, h: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const edges = sobel(luminanceOf(d, w * h), w, h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (edges[p] > 220) {
      d[i] = d[i + 1] = d[i + 2] = 20; // ink outline
    } else {
      d[i] = posterize(d[i], 4);
      d[i + 1] = posterize(d[i + 1], 4);
      d[i + 2] = posterize(d[i + 2], 4);
    }
  }
  ctx.putImageData(img, 0, 0);
  // Halftone dots over the midtones.
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = pattern(ctx, 'dots', (p) => {
    p.fillStyle = '#fff';
    p.fillRect(0, 0, 6, 6);
    p.fillStyle = '#5a5a78';
    p.beginPath();
    p.arc(3, 3, 1.4, 0, Math.PI * 2);
    p.fill();
  }, 6);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function pencil(ctx: Ctx, w: number, h: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const edges = sobel(luminanceOf(d, w * h), w, h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    // White paper, dark strokes along edges, a wash of the original color.
    const stroke = Math.min(1, edges[p] / 260);
    const paper = 255 * (1 - stroke * 0.85);
    d[i] = paper * 0.78 + d[i] * 0.22 * (1 - stroke);
    d[i + 1] = paper * 0.78 + d[i + 1] * 0.22 * (1 - stroke);
    d[i + 2] = paper * 0.78 + d[i + 2] * 0.22 * (1 - stroke);
  }
  ctx.putImageData(img, 0, 0);
  // Diagonal pencil hatching.
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = pattern(ctx, 'hatch', (p) => {
    p.fillStyle = '#fff';
    p.fillRect(0, 0, 8, 8);
    p.strokeStyle = '#555';
    p.lineWidth = 1;
    p.beginPath();
    p.moveTo(0, 8);
    p.lineTo(8, 0);
    p.stroke();
  }, 8);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function glow(ctx: Ctx, w: number, h: number): void {
  const s = scratchCanvas(w, h);
  s.filter = `blur(${Math.round(w / 45)}px) brightness(1.3)`;
  s.drawImage(ctx.canvas, 0, 0);
  s.filter = 'none';
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.75;
  ctx.drawImage(s.canvas, 0, 0);
  ctx.restore();
}

function plastic(ctx: Ctx, w: number, h: number): void {
  // Toy-camera color cast plus dark corners.
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  const cast = ctx.createLinearGradient(0, 0, w, h);
  cast.addColorStop(0, 'rgba(120,255,120,0.9)');
  cast.addColorStop(1, 'rgba(255,240,0,0.9)');
  ctx.fillStyle = cast;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'multiply';
  const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  vignette.addColorStop(0, 'rgba(255,255,255,1)');
  vignette.addColorStop(1, 'rgba(40,40,20,1)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function xray(ctx: Ctx, w: number, h: number): void {
  // The CSS already inverted it to grayscale; tint it cold blue-green.
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgb(150, 235, 230)';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

const POSTS: Record<LookPost, (ctx: Ctx, w: number, h: number) => void> = {
  thermal,
  comic,
  pencil,
  glow,
  plastic,
  xray,
};

export function applyLookPost(ctx: Ctx, post: LookPost, w: number, h: number): void {
  POSTS[post](ctx, w, h);
}
