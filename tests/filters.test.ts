import { describe, expect, it } from 'vitest';
import { faceGeometry } from '../src/detector/filters/face';
import { FrameSelector, type RawFrame } from '../src/hook/frames';
import { filtersActive, NO_FILTERS, sanitizeFilters } from '../src/shared/filters';

class FakeFrame implements RawFrame {
  closed = false;
  constructor(
    readonly label: string,
    readonly timestamp = 0,
    readonly displayWidth = 640,
    readonly displayHeight = 480,
  ) {}
  close(): void {
    this.closed = true;
  }
}

class FakeBitmap {
  closed = false;
  constructor(readonly label: string) {}
  close(): void {
    this.closed = true;
  }
}

function makeSelector() {
  const selector = new FrameSelector<FakeFrame>(
    (source, timestamp) => new FakeFrame(`from:${(source as unknown as { label: string }).label}`, timestamp),
    (w, h) => ({ label: `blank ${w}x${h}` }) as unknown as CanvasImageSource,
  );
  const bitmap = (label: string) => new FakeBitmap(label) as unknown as ImageBitmap;
  return { selector, bitmap };
}

describe('FrameSelector (what umingle receives)', () => {
  it('passes the raw camera through when filters are off', () => {
    const { selector } = makeSelector();
    const raw = new FakeFrame('raw');
    expect(selector.select(raw)).toBe(raw);
    expect(raw.closed).toBe(false);
  });

  it('sends a blank frame, never the raw camera, until the first filtered frame', () => {
    const { selector } = makeSelector();
    selector.setFiltering(true);
    const raw = new FakeFrame('raw', 42, 1280, 720);
    const out = selector.select(raw);
    expect(out.label).toBe('from:blank 1280x720');
    expect(out.timestamp).toBe(42);
    expect(raw.closed).toBe(true);
  });

  it('uses the newest filtered frame and keeps reusing it if frames stop', () => {
    const { selector, bitmap } = makeSelector();
    selector.setFiltering(true);
    const first = bitmap('f1');
    selector.pushFiltered(first);
    selector.pushFiltered(bitmap('f2'));
    expect((first as unknown as FakeBitmap).closed).toBe(true);
    expect(selector.select(new FakeFrame('raw')).label).toBe('from:f2');
    expect(selector.select(new FakeFrame('raw')).label).toBe('from:f2'); // stale, still filtered
  });

  it('goes back to raw and frees the cached frame when filters turn off', () => {
    const { selector, bitmap } = makeSelector();
    selector.setFiltering(true);
    const b = bitmap('f1');
    selector.pushFiltered(b);
    selector.setFiltering(false);
    expect((b as unknown as FakeBitmap).closed).toBe(true);
    const raw = new FakeFrame('raw');
    expect(selector.select(raw)).toBe(raw);
  });
});

describe('faceGeometry', () => {
  // 478 landmarks, all at the face centre except the eye corners.
  function face(rightEye: [number, number], leftEye: [number, number]) {
    const lms = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    lms[33] = { x: rightEye[0] - 0.02, y: rightEye[1] };
    lms[133] = { x: rightEye[0] + 0.02, y: rightEye[1] };
    lms[362] = { x: leftEye[0] - 0.02, y: leftEye[1] };
    lms[263] = { x: leftEye[0] + 0.02, y: leftEye[1] };
    lms[10] = { x: 0.5, y: 0.3 }; // forehead
    lms[152] = { x: 0.5, y: 0.7 }; // chin
    return lms;
  }

  it('finds eye centres, eye distance and a level head', () => {
    const g = faceGeometry(face([0.4, 0.45], [0.6, 0.45]), 1000, 1000);
    expect(g.rightEye).toEqual({ x: 400, y: 450 });
    expect(g.leftEye).toEqual({ x: 600, y: 450 });
    expect(g.eyeDistance).toBeCloseTo(200);
    expect(g.angle).toBeCloseTo(0);
  });

  it('measures head tilt', () => {
    const g = faceGeometry(face([0.4, 0.4], [0.6, 0.6]), 1000, 1000);
    expect(g.angle).toBeCloseTo(Math.PI / 4);
  });

  it('bounds the face', () => {
    const g = faceGeometry(face([0.4, 0.45], [0.6, 0.45]), 1000, 1000);
    expect(g.box.y).toBeCloseTo(300);
    expect(g.box.h).toBeCloseTo(400);
  });
});

describe('filter settings', () => {
  it('knows when any filter is active', () => {
    expect(filtersActive(NO_FILTERS)).toBe(false);
    expect(filtersActive({ ...NO_FILTERS, background: 'blur' })).toBe(true);
  });

  it('resets removed face effects to none', () => {
    const saved = { ...NO_FILTERS, faceEffect: 'robot' as never };
    expect(sanitizeFilters(saved).faceEffect).toBe('none');
    expect(sanitizeFilters({ ...NO_FILTERS, faceEffect: 'sunglasses' }).faceEffect).toBe('sunglasses');
  });
});
