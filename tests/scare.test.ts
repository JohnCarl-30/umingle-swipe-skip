import { describe, expect, it } from 'vitest';
import { redFlash, shake } from '../src/detector/scare-frame';
import { SCARE_MAX_MS, SCARE_MIN_MS, scareDuration } from '../src/shared/scream';

describe('scare video', () => {
  it('slams in big, then settles and creeps closer', () => {
    expect(shake(0, 0).scale).toBeCloseTo(1.6);
    expect(shake(0.08, 0).scale).toBeCloseTo(1.01, 1);
    expect(shake(1, 0).scale).toBeGreaterThan(shake(0.5, 0).scale);
  });

  it('flashes red only early on', () => {
    expect(Math.max(...[0.03, 0.06, 0.09].map(redFlash))).toBeGreaterThan(0.3);
    expect(redFlash(0.8)).toBe(0);
  });

  it('lasts as long as the sound, within limits', () => {
    expect(scareDuration(500)).toBe(SCARE_MIN_MS);
    expect(scareDuration(2500)).toBe(2500);
    expect(scareDuration(60_000)).toBe(SCARE_MAX_MS);
  });
});

import { mixInto } from '../src/hook/audio';

describe('scream mixing', () => {
  it('adds the scream into every channel at the volume, clipping safely', () => {
    const left = new Float32Array([0.1, 0.1, 0.9]);
    const right = new Float32Array([0, 0, 0]);
    const scream = new Float32Array([0.5, -0.5, 0.5, 0.5]);
    const used = mixInto([left, right], scream, 0, 0.5);
    expect(used).toBe(3);
    expect([...left].map((v) => +v.toFixed(2))).toEqual([0.35, -0.15, 1]); // 0.9 + 0.25 clipped to 1
    expect([...right]).toEqual([0.25, -0.25, 0.25]);
  });

  it('continues from where the last frame stopped', () => {
    const ch = new Float32Array(3);
    expect(mixInto([ch], new Float32Array([1, 1, 1, 1]), 2, 1)).toBe(2);
    expect([...ch]).toEqual([1, 1, 0]);
  });
});
