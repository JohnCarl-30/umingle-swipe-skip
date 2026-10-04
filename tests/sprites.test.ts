import { describe, expect, it } from 'vitest';
import { opaqueBounds, whiteKeyAlpha } from '../src/detector/filters/sprites';

describe('dog artwork keying', () => {
  it('makes white transparent and fur/nose opaque', () => {
    expect(whiteKeyAlpha(255, 255, 255)).toBe(0);
    expect(whiteKeyAlpha(250, 251, 252)).toBe(0); // off-white JPEG noise
    expect(whiteKeyAlpha(160, 110, 60)).toBe(255); // brown fur
    expect(whiteKeyAlpha(230, 170, 170)).toBe(255); // pink inner ear
  });

  it('finds the box around opaque pixels in a region', () => {
    const w = 10, h = 10;
    const d = new Uint8ClampedArray(w * h * 4);
    for (const [x, y] of [[2, 3], [5, 6]]) d[(y * w + x) * 4 + 3] = 255;
    expect(opaqueBounds(d, w, { x0: 0, y0: 0, x1: w, y1: h })).toEqual({ x0: 2, y0: 3, x1: 6, y1: 7 });
    expect(opaqueBounds(d, w, { x0: 6, y0: 0, x1: w, y1: h })).toBeNull();
  });
});
