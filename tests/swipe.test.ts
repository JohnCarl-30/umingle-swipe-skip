import { describe, expect, it } from 'vitest';
import { palmCenter, SwipeDetector, type Point } from '../src/detector/swipe';

/** Feeds a motion path (f in 0..1 over `ms`) at 30 fps; returns how many swipes fired. */
function countSwipes(path: (f: number) => Point, ms: number, detector = new SwipeDetector()): number {
  let fires = 0;
  const frames = Math.round((ms / 1000) * 30);
  for (let i = 0; i <= frames; i++) {
    const t = (i / frames) * ms;
    if (detector.update(path(i / frames), 10_000 + t)) fires++;
  }
  return fires;
}

describe('SwipeDetector', () => {
  it('fires on a fast right swipe', () => {
    expect(countSwipes((f) => ({ x: 0.2 + 0.5 * f, y: 0.5 }), 300)).toBe(1);
  });

  it('ignores a left swipe', () => {
    expect(countSwipes((f) => ({ x: 0.7 - 0.5 * f, y: 0.5 }), 300)).toBe(0);
  });

  it('ignores a slow drift to the right', () => {
    expect(countSwipes((f) => ({ x: 0.2 + 0.5 * f, y: 0.5 }), 3000)).toBe(0);
  });

  it('ignores mostly vertical movement', () => {
    expect(countSwipes((f) => ({ x: 0.3 + 0.25 * f, y: 0.1 + 0.8 * f }), 300)).toBe(0);
  });

  it('ignores jitter in place', () => {
    expect(countSwipes((f) => ({ x: 0.5 + 0.03 * Math.sin(f * 60), y: 0.5 }), 3000)).toBe(0);
  });

  it('fires at most once per 1 s cooldown when waving back and forth', () => {
    const wave = (f: number): Point => ({ x: 0.5 + 0.3 * Math.sin(f * Math.PI * 6), y: 0.5 });
    expect(countSwipes(wave, 900)).toBe(1); // second right stroke lands inside the cooldown
    expect(countSwipes(wave, 1200)).toBe(2); // ...but after 1 s it can skip again
  });

  it('needs less travel at higher sensitivity', () => {
    const flick = (f: number): Point => ({ x: 0.4 + 0.15 * f, y: 0.5 });
    expect(countSwipes(flick, 200, new SwipeDetector(3))).toBe(0);
    expect(countSwipes(flick, 200, new SwipeDetector(5))).toBe(1);
  });

  it('forgets the track when the hand disappears', () => {
    const d = new SwipeDetector();
    d.update({ x: 0.2, y: 0.5 }, 0);
    // Hand gone for 400 ms, reappears far right: not a swipe.
    expect(d.update({ x: 0.8, y: 0.5 }, 400)).toBe(false);
  });
});

describe('palmCenter', () => {
  it('mirrors x so the user moving right increases x', () => {
    const landmarks = Array.from({ length: 21 }, () => ({ x: 0.25, y: 0.4 }));
    expect(palmCenter(landmarks)).toEqual({ x: 0.75, y: 0.4 });
  });
});
