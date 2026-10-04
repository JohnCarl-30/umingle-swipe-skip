import { describe, expect, it } from 'vitest';
import { posterize, sobel, thermalColor } from '../src/detector/filters/looks';
import { isWarpEffect, warpOps, WarpKind } from '../src/detector/filters/warp';
import { lookPost, sanitizeFilters, NO_FILTERS } from '../src/shared/filters';

describe('looks', () => {
  it('maps dark to cold blue and bright to hot', () => {
    const [r0, , b0] = thermalColor(0);
    const [r1, g1] = thermalColor(220);
    expect(b0).toBeGreaterThan(r0);
    expect(r1).toBe(255);
    expect(g1).toBeLessThan(255);
    expect(thermalColor(255)).toEqual([255, 255, 255]);
  });

  it('posterizes into flat steps', () => {
    expect(posterize(0, 4)).toBe(0);
    expect(posterize(90, 4)).toBe(85);
    expect(posterize(200, 4)).toBe(170);
    expect(posterize(255, 4)).toBe(255);
  });

  it('finds edges only where brightness changes', () => {
    const w = 6, h = 4;
    const lum = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 3; x < w; x++) lum[y * w + x] = 255; // left dark, right bright
    const e = sobel(lum, w, h);
    expect(e[1 * w + 1]).toBe(0); // flat dark area
    expect(e[1 * w + 3]).toBeGreaterThan(500); // on the edge
  });

  it('knows which looks need a pixel pass', () => {
    expect(lookPost('thermal')).toBe('thermal');
    expect(lookPost('sepia')).toBeNull();
  });

  it('resets looks that were removed (e.g. warm) to none', () => {
    expect(sanitizeFilters({ ...NO_FILTERS, colorFilter: 'warm' as never }).colorFilter).toBe('none');
  });
});

describe('face warps', () => {
  const face = () => {
    const lms = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    lms[33] = { x: 0.38, y: 0.45 }; lms[133] = { x: 0.42, y: 0.45 }; // right eye
    lms[362] = { x: 0.58, y: 0.45 }; lms[263] = { x: 0.62, y: 0.45 }; // left eye
    lms[1] = { x: 0.5, y: 0.55 }; // nose tip
    return lms;
  };

  it('bug out bulges both eyes', () => {
    const ops = warpOps('bugout', face(), 1000, 1000, 0);
    expect(ops).toHaveLength(2);
    expect(ops.every((o) => o.kind === WarpKind.Bulge && o.strength > 0)).toBe(true);
    expect(ops.map((o) => Math.round(o.center.x))).toEqual([400, 600]);
  });

  it('nose twirl swirls around the nose and animates', () => {
    const [a] = warpOps('twirl', face(), 1000, 1000, 300);
    const [b] = warpOps('twirl', face(), 1000, 1000, 900);
    expect(a.kind).toBe(WarpKind.Swirl);
    expect(a.center).toEqual({ x: 500, y: 550 });
    expect(a.strength).not.toBeCloseTo(b.strength);
  });

  it('only distortions use the warp pass', () => {
    expect(isWarpEffect('frog')).toBe(true);
    expect(isWarpEffect('hearts')).toBe(false);
    expect(warpOps('sunglasses', face(), 100, 100, 0)).toEqual([]);
  });
});
