// Finds the stranger's <video> on umingle and streams small snapshots of it
// to the detector iframe, which watches for a wave.

import { LOCAL_VIDEO_ATTR } from '../shared/messages';

const SNAPSHOT_WIDTH = 480;
const INTERVAL_MS = 66; // ~15 fps: a quick wave swings several times a second

function isPlaying(v: HTMLVideoElement): boolean {
  if (v.readyState < 2 || !v.videoWidth || v.paused || v.ended) return false;
  const r = v.getBoundingClientRect();
  return r.width > 40 && r.height > 40;
}

/**
 * The stranger's video: a playing video that isn't the user's own camera
 * (tagged by the hook), preferring unmuted ones (own preview is muted), then
 * the largest on screen.
 */
export function findStrangerVideo(doc: Document): HTMLVideoElement | null {
  const candidates = [...doc.querySelectorAll('video')].filter(
    (v) => !v.hasAttribute(LOCAL_VIDEO_ATTR) && isPlaying(v),
  );
  const area = (v: HTMLVideoElement): number => {
    const r = v.getBoundingClientRect();
    return r.width * r.height;
  };
  candidates.sort((a, b) => Number(a.muted) - Number(b.muted) || area(b) - area(a));
  return candidates[0] ?? null;
}

export class StrangerWatcher {
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;
  private lastFound: boolean | null = null;

  constructor(
    private readonly send: (bitmap: ImageBitmap) => void,
    private readonly onFound: (found: boolean) => void,
  ) {}

  get running(): boolean {
    return this.timer !== undefined;
  }

  start(): void {
    if (this.running) return;
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.lastFound = null;
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    const video = findStrangerVideo(document);
    if (this.lastFound !== !!video) {
      this.lastFound = !!video;
      this.onFound(!!video);
    }
    if (!video) return;
    this.busy = true;
    try {
      const h = Math.round((video.videoHeight / video.videoWidth) * SNAPSHOT_WIDTH);
      const bitmap = await createImageBitmap(video, { resizeWidth: SNAPSHOT_WIDTH, resizeHeight: h });
      this.send(bitmap);
    } catch {
      // e.g. a cross-origin video we can't read; try again next tick
    } finally {
      this.busy = false;
    }
  }
}
