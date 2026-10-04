// Turns a stream of palm positions into "swipe right" events.

import type { Sensitivity } from '../shared/storage';

export interface Point {
  x: number;
  y: number;
}

export interface TrackedPoint extends Point {
  t: number;
}

export interface Landmark {
  x: number;
  y: number;
}

/** Fraction of frame width the palm must travel, per sensitivity level. */
export const MIN_DX_BY_SENSITIVITY: Record<Sensitivity, number> = { 1: 0.38, 2: 0.3, 3: 0.24, 4: 0.18, 5: 0.13 };

export interface SwipeConfig {
  windowMs: number;   // the travel must happen within this time
  maxDyRatio: number; // vertical drift allowed, relative to horizontal travel
  cooldownMs: number; // ignore further swipes for this long after one fires
  lostMs: number;     // forget the track if the hand vanishes this long
}

export const DEFAULT_SWIPE_CONFIG: SwipeConfig = {
  windowMs: 500,
  maxDyRatio: 0.7,
  cooldownMs: 1000,
  lostMs: 250,
};

const PALM_POINTS = [0, 5, 9, 13, 17]; // wrist + finger bases: stable palm centre

/**
 * Palm centre in mirrored coordinates (x = 1 - raw), so "right" means the
 * user's right, matching what they see in a selfie preview.
 */
export function palmCenter(landmarks: readonly Landmark[]): Point {
  let x = 0;
  let y = 0;
  for (const i of PALM_POINTS) {
    x += landmarks[i].x;
    y += landmarks[i].y;
  }
  return { x: 1 - x / PALM_POINTS.length, y: y / PALM_POINTS.length };
}

export class SwipeDetector {
  private history: TrackedPoint[] = [];
  private lastSeen = -Infinity;
  private lastFire = -Infinity;

  constructor(
    public sensitivity: Sensitivity = 3,
    private readonly config: SwipeConfig = DEFAULT_SWIPE_CONFIG,
  ) {}

  /** Recent palm positions, oldest first (for drawing a trail). */
  get trail(): readonly TrackedPoint[] {
    return this.history;
  }

  reset(): void {
    this.history = [];
  }

  /** Feed one palm position at time `t` (ms). Returns true when a swipe fires. */
  update(p: Point, t: number): boolean {
    const { windowMs, maxDyRatio, cooldownMs, lostMs } = this.config;
    if (t - this.lastSeen > lostMs) this.history = [];
    this.lastSeen = t;
    this.history.push({ t, x: p.x, y: p.y });
    while (this.history.length && t - this.history[0].t > windowMs) this.history.shift();
    if (t - this.lastFire < cooldownMs) return false;

    const start = this.history.reduce((a, b) => (b.x < a.x ? b : a));
    const dx = p.x - start.x;
    const dy = Math.abs(p.y - start.y);
    if (dx >= MIN_DX_BY_SENSITIVITY[this.sensitivity] && dy <= dx * maxDyRatio) {
      this.lastFire = t;
      this.history = [];
      return true;
    }
    return false;
  }
}
