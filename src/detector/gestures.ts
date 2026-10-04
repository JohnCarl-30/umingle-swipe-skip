// Static hand poses (as opposed to the swipe motion) that trigger a skip.

import type { Landmark } from './swipe';

const dist = (a: Landmark, b: Landmark): number => Math.hypot(a.x - b.x, a.y - b.y);

// [mcp, tip] for index, middle, ring, pinky.
const FINGERS: readonly [number, number][] = [
  [5, 8],
  [9, 12],
  [13, 16],
  [17, 20],
];

/**
 * 👎 Thumb extended and pointing down, below the rest of the hand, with the
 * other fingers curled. Image coordinates: y grows downward.
 */
export function isThumbsDown(lms: readonly Landmark[]): boolean {
  const palm = dist(lms[0], lms[9]);
  if (palm < 1e-3) return false;

  const base = lms[2];
  const tip = lms[4];
  const len = dist(base, tip);
  if (len < 0.6 * palm) return false; // thumb not extended
  if ((tip.y - base.y) / len < 0.75) return false; // not pointing down

  // Thumb tip is the lowest point of the hand.
  for (const [mcp, fingerTip] of FINGERS) {
    if (tip.y <= lms[mcp].y || tip.y <= lms[fingerTip].y) return false;
  }

  // Other fingers curled: tips stay close to their knuckles.
  const curled = FINGERS.filter(([mcp, fingerTip]) => dist(lms[mcp], lms[fingerTip]) < 0.75 * palm).length;
  return curled >= 3;
}

/** Open hand, fingers up: at least 3 fingers extended and pointing upward. */
export function isOpenPalm(lms: readonly Landmark[]): boolean {
  const palm = dist(lms[0], lms[9]);
  if (palm < 1e-3) return false;
  const extended = FINGERS.filter(
    ([mcp, tip]) => dist(lms[mcp], lms[tip]) > 0.8 * palm && lms[tip].y < lms[mcp].y,
  ).length;
  return extended >= 3;
}

export interface WaveConfig {
  windowMs: number;    // all swings must happen within this time
  swingPalms: number;  // each swing must travel this many palm-lengths
  reversals: number;   // direction changes needed (2 = right-left-right)
  lostMs: number;      // forget the track after the hand vanishes this long
  cooldownMs: number;
}

export const DEFAULT_WAVE_CONFIG: WaveConfig = {
  windowMs: 1600,
  swingPalms: 0.35,
  reversals: 2,
  lostMs: 400,
  cooldownMs: 1000,
};

/** 👋 An open hand moving side to side. Direction-agnostic (no mirroring needed). */
export class WaveDetector {
  private history: { t: number; x: number }[] = [];
  private lastSeen = -Infinity;
  private lastFire = -Infinity;

  constructor(private readonly config: WaveConfig = DEFAULT_WAVE_CONFIG) {}

  reset(): void {
    this.history = [];
  }

  update(lms: readonly Landmark[] | null | undefined, t: number): boolean {
    const { windowMs, swingPalms, reversals, lostMs, cooldownMs } = this.config;
    if (!lms || !isOpenPalm(lms)) {
      if (t - this.lastSeen > lostMs) this.history = [];
      return false;
    }
    if (t - this.lastSeen > lostMs) this.history = [];
    this.lastSeen = t;

    const x = (lms[0].x + lms[5].x + lms[9].x + lms[13].x + lms[17].x) / 5;
    this.history.push({ t, x });
    while (this.history.length && t - this.history[0].t > windowMs) this.history.shift();
    if (t - this.lastFire < cooldownMs) return false;

    if (countReversals(this.history.map((p) => p.x), swingPalms * dist(lms[0], lms[9])) >= reversals) {
      this.lastFire = t;
      this.history = [];
      return true;
    }
    return false;
  }
}

/** Direction changes in a 1-D path, ignoring wiggles smaller than `minSwing`. */
export function countReversals(xs: readonly number[], minSwing: number): number {
  if (!xs.length) return 0;
  let dir = 0;
  let lo = xs[0];
  let hi = xs[0];
  let count = 0;
  for (const x of xs) {
    if (dir === 0) {
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
      if (x - lo >= minSwing) [dir, hi] = [1, x];
      else if (hi - x >= minSwing) [dir, lo] = [-1, x];
    } else if (dir === 1) {
      if (x > hi) hi = x;
      else if (hi - x >= minSwing) [dir, lo, count] = [-1, x, count + 1];
    } else {
      if (x < lo) lo = x;
      else if (x - lo >= minSwing) [dir, hi, count] = [1, x, count + 1];
    }
  }
  return count;
}

export interface HoldConfig {
  holdMs: number;     // pose must be held this long
  graceMs: number;    // tolerate brief detection dropouts
  cooldownMs: number; // ignore the pose for this long after firing
}

export const DEFAULT_HOLD_CONFIG: HoldConfig = { holdMs: 450, graceMs: 150, cooldownMs: 1000 };

/** Fires once when a pose has been held continuously for `holdMs`. */
export class HoldDetector {
  private since: number | null = null;
  private lastTrue = -Infinity;
  private lastFire = -Infinity;
  private held = false;

  constructor(private readonly config: HoldConfig = DEFAULT_HOLD_CONFIG) {}

  /** 0..1 progress toward firing, for UI feedback. */
  progress(t: number): number {
    if (this.since === null || this.held) return 0;
    return Math.min(1, (t - this.since) / this.config.holdMs);
  }

  reset(): void {
    this.since = null;
    this.held = false;
  }

  update(active: boolean, t: number): boolean {
    const { holdMs, graceMs, cooldownMs } = this.config;
    if (active) {
      this.lastTrue = t;
      this.since ??= t;
    } else if (t - this.lastTrue > graceMs) {
      this.since = null;
      this.held = false; // pose released: may fire again after cooldown
    }
    if (this.since === null || this.held || t - this.lastFire < cooldownMs) return false;
    if (t - this.since >= holdMs) {
      this.lastFire = t;
      this.held = true; // keep holding = no repeat
      return true;
    }
    return false;
  }
}
