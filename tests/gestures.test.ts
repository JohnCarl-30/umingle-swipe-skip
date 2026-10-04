import { describe, expect, it } from 'vitest';
import { countReversals, HoldDetector, isOpenPalm, isThumbsDown, WaveDetector } from '../src/detector/gestures';

type P = [number, number];

/** Builds 21 hand landmarks from a few key points (unspecified joints interpolate). */
function hand(points: { wrist: P; thumb: [P, P, P, P]; fingers: [P, P, P, P][] }) {
  const lms = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
  lms[0] = { x: points.wrist[0], y: points.wrist[1] };
  points.thumb.forEach(([x, y], i) => (lms[1 + i] = { x, y }));
  points.fingers.forEach((f, fi) => f.forEach(([x, y], i) => (lms[5 + fi * 4 + i] = { x, y })));
  return lms;
}

// A fist seen from the front, knuckles in a row around y=0.40, wrist below.
const curledFingers: [P, P, P, P][] = [0.44, 0.48, 0.52, 0.56].map((x) => [
  [x, 0.4], [x, 0.36], [x, 0.4], [x, 0.43],
]);

// Thumbs down: the hand is rotated so the wrist is above and the thumb points down.
const thumbsDown = hand({
  wrist: [0.5, 0.25],
  thumb: [[0.47, 0.42], [0.45, 0.46], [0.45, 0.55], [0.45, 0.64]],
  fingers: curledFingers.map((f) => f.map(([x, y]) => [x + 0.02, y + 0.08]) as [P, P, P, P]),
});

const thumbsUp = hand({
  wrist: [0.5, 0.6],
  thumb: [[0.47, 0.45], [0.45, 0.4], [0.45, 0.3], [0.45, 0.2]],
  fingers: curledFingers,
});

const openPalm = hand({
  wrist: [0.5, 0.7],
  thumb: [[0.42, 0.62], [0.38, 0.56], [0.35, 0.5], [0.33, 0.45]],
  fingers: [0.44, 0.48, 0.52, 0.56].map((x) => [[x, 0.45], [x, 0.35], [x, 0.28], [x, 0.2]] as [P, P, P, P]),
});

describe('isThumbsDown', () => {
  it('recognises a thumbs down', () => {
    expect(isThumbsDown(thumbsDown)).toBe(true);
  });

  it('ignores thumbs up', () => {
    expect(isThumbsDown(thumbsUp)).toBe(false);
  });

  it('ignores an open palm', () => {
    expect(isThumbsDown(openPalm)).toBe(false);
  });
});

describe('HoldDetector', () => {
  const feed = (d: HoldDetector, active: (t: number) => boolean, ms: number) => {
    const fired: number[] = [];
    for (let t = 0; t <= ms; t += 33) if (d.update(active(t), t)) fired.push(t);
    return fired;
  };

  it('fires once after the pose is held', () => {
    const fired = feed(new HoldDetector(), () => true, 3000);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toBeGreaterThanOrEqual(450);
  });

  it('does not fire for a brief pose', () => {
    expect(feed(new HoldDetector(), (t) => t < 300, 2000)).toHaveLength(0);
  });

  it('tolerates a one-frame dropout', () => {
    expect(feed(new HoldDetector(), (t) => t !== 231, 600)).toHaveLength(1);
  });

  it('fires again after releasing and holding again', () => {
    expect(feed(new HoldDetector(), (t) => t < 1000 || t > 1800, 3000)).toHaveLength(2);
  });

  it('reports progress while holding', () => {
    const d = new HoldDetector();
    d.update(true, 0);
    d.update(true, 225);
    expect(d.progress(225)).toBeCloseTo(0.5);
  });
});

describe('waving', () => {
  // Open hand, fingers up, centred at (cx, 0.5). Palm length 0.2.
  const open = (cx: number) =>
    hand({
      wrist: [cx, 0.6],
      thumb: [[cx - 0.06, 0.55], [cx - 0.1, 0.5], [cx - 0.12, 0.46], [cx - 0.14, 0.42]],
      fingers: [-0.06, -0.02, 0.02, 0.06].map((dx) => [
        [cx + dx, 0.42], [cx + dx, 0.34], [cx + dx, 0.28], [cx + dx, 0.2],
      ]) as [P, P, P, P][],
    });

  it('recognises an open palm and rejects a fist', () => {
    expect(isOpenPalm(open(0.5))).toBe(true);
    expect(isOpenPalm(thumbsUp)).toBe(false);
  });

  it('counts reversals, ignoring small wiggles', () => {
    expect(countReversals([0, 0.1, 0.2, 0.1, 0, 0.1, 0.2], 0.1)).toBe(2);
    expect(countReversals([0, 0.02, 0, 0.02, 0], 0.1)).toBe(0);
  });

  const run = (path: (t: number) => number | null, ms: number) => {
    const d = new WaveDetector();
    let fired = 0;
    for (let t = 0; t <= ms; t += 66) {
      const cx = path(t);
      if (d.update(cx === null ? null : open(cx), t)) fired++;
    }
    return fired;
  };

  it('fires on a wave (side to side, ~3 Hz)', () => {
    expect(run((t) => 0.5 + 0.12 * Math.sin((t / 1000) * 2 * Math.PI * 1.5), 1500)).toBe(1);
  });

  it('ignores a hand held still', () => {
    expect(run(() => 0.5, 3000)).toBe(0);
  });

  it('ignores one slow move across the frame', () => {
    expect(run((t) => 0.3 + 0.4 * (t / 2000), 2000)).toBe(0);
  });

  it('ignores side-to-side motion without an open hand', () => {
    const d = new WaveDetector();
    let fired = 0;
    for (let t = 0; t <= 1500; t += 66) if (d.update(thumbsUp, t)) fired++;
    expect(fired).toBe(0);
  });
});
