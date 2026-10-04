// Renders jumpscare video frames: the scare image zooming in, shaking, with
// red flashes. These replace the camera in the video the stranger sees.

const DEFAULT_IMAGE = 'jumpscare/default.jpg';

type Ctx = OffscreenCanvasRenderingContext2D;

/** Shake offset (fraction of size) and zoom for progress p in 0..1. */
export function shake(p: number, t: number): { dx: number; dy: number; scale: number } {
  const punch = p < 0.08 ? 1.6 - (p / 0.08) * 0.6 : 1 + p * 0.12; // slam in, then creep closer
  const amp = 0.02 * (1 - p * 0.5);
  return { dx: Math.sin(t / 23) * amp, dy: Math.cos(t / 31) * amp, scale: punch };
}

/** Red flash strength for progress p: a few hard pulses at the start. */
export function redFlash(p: number): number {
  if (p > 0.6) return 0;
  return Math.max(0, Math.sin(p * Math.PI * 8)) * 0.55 * (1 - p / 0.6);
}

export class ScareFrames {
  readonly canvas = new OffscreenCanvas(640, 480);
  private readonly ctx: Ctx = this.canvas.getContext('2d')!;
  private image: ImageBitmap | null = null;

  /** Loads the scare image (a data: URL, or null for the bundled default). */
  async load(url: string | null): Promise<void> {
    try {
      const res = await fetch(url ?? chrome.runtime.getURL(DEFAULT_IMAGE));
      const next = await createImageBitmap(await res.blob());
      this.image?.close();
      this.image = next;
    } catch (err) {
      console.warn('[swipe-skip] scare image failed to load', err);
    }
  }

  get ready(): boolean {
    return !!this.image;
  }

  /** Draws the frame for elapsed/duration at size w×h; returns the canvas. */
  render(w: number, h: number, elapsed: number, duration: number): OffscreenCanvas {
    const { canvas, ctx } = this;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const p = Math.min(1, elapsed / duration);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const img = this.image;
    if (img) {
      const { dx, dy, scale } = shake(p, elapsed);
      // Cover-fit, then zoom around a point slightly above centre (the face).
      const cover = Math.max(w / img.width, h / img.height) * scale;
      const iw = img.width * cover;
      const ih = img.height * cover;
      ctx.filter = p < 0.08 ? 'brightness(2) contrast(1.4)' : 'contrast(1.2)';
      ctx.drawImage(img, (w - iw) / 2 + dx * w, (h - ih) * 0.45 + dy * h, iw, ih);
      ctx.filter = 'none';
    }
    const flash = redFlash(p);
    if (flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = flash;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    return canvas;
  }
}
