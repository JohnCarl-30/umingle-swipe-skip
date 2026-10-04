// Renders the filtered camera frame: color look, background, face effect.
import { FaceLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision';
import { COLOR_FILTERS, lookPost, NO_FILTERS, type FilterSettings } from '../../shared/filters';
import { modelPath, visionFileset, withGpuFallback } from '../models';
import { drawBirds, drawDog, drawHearts, drawSunglasses, faceGeometry } from './face';
import { applyLookPost } from './looks';
import { loadDogSprites, type DogSprites } from './sprites';
import { FaceWarp, isWarpEffect, warpOps } from './warp';

type Ctx = OffscreenCanvasRenderingContext2D;

function canvas2d(w = 640, h = 480): [OffscreenCanvas, Ctx] {
  const c = new OffscreenCanvas(w, h);
  return [c, c.getContext('2d')!];
}

export class FilterPipeline {
  readonly output: OffscreenCanvas;
  private readonly ctx: Ctx;
  private readonly person: OffscreenCanvas;
  private readonly personCtx: Ctx;
  private readonly mask: OffscreenCanvas;
  private readonly maskCtx: Ctx;

  private settings: FilterSettings = NO_FILTERS;
  private segmenter: ImageSegmenter | null = null;
  private faces: FaceLandmarker | null = null;
  private loading: Promise<void> | null = null;
  private prevMask: Float32Array | null = null;
  private warp: FaceWarp | null = null;
  private dogSprites: DogSprites | null = null;
  private dogLoading = false;

  /** Called when model loading starts/finishes/fails, for the status line. */
  onStatus: (text: string | null) => void = () => {};

  constructor() {
    [this.output, this.ctx] = canvas2d();
    [this.person, this.personCtx] = canvas2d();
    [this.mask, this.maskCtx] = canvas2d(256, 256);
  }

  get needsSegmenter(): boolean {
    return this.settings.background !== 'none';
  }

  get needsFaces(): boolean {
    return this.settings.faceEffect !== 'none';
  }

  /** True once every model the current settings need is loaded. */
  get ready(): boolean {
    return (!this.needsSegmenter || !!this.segmenter) && (!this.needsFaces || !!this.faces);
  }

  configure(settings: FilterSettings): void {
    this.settings = settings;
    void this.loadModels();
  }

  private loadModels(): Promise<void> {
    if (this.ready) return Promise.resolve();
    this.loading ??= (async () => {
      this.onStatus('Loading filter models…');
      try {
        const vision = await visionFileset();
        if (this.needsSegmenter && !this.segmenter) {
          const modelAssetPath = await modelPath('segmenter');
          this.segmenter = await withGpuFallback((delegate) =>
            ImageSegmenter.createFromOptions(vision, {
              baseOptions: { modelAssetPath, delegate },
              runningMode: 'VIDEO',
              outputConfidenceMasks: true,
              outputCategoryMask: false,
            }),
          );
        }
        if (this.needsFaces && !this.faces) {
          const modelAssetPath = await modelPath('face');
          this.faces = await withGpuFallback((delegate) =>
            FaceLandmarker.createFromOptions(vision, {
              baseOptions: { modelAssetPath, delegate },
              runningMode: 'VIDEO',
              numFaces: 1,
            }),
          );
        }
        this.onStatus(null);
      } catch (err) {
        console.error('[swipe-skip] filter model error', err);
        this.onStatus('Filter models failed to load');
      } finally {
        this.loading = null;
        // Settings may have changed while loading.
        if (!this.ready) void this.loadModels();
      }
    })();
    return this.loading;
  }

  /**
   * Draws the filtered frame into `output`. Returns false when a needed model
   * is still loading, so callers never send an unfiltered face by mistake.
   */
  render(video: HTMLVideoElement, timestamp: number): boolean {
    if (!this.ready) return false;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return false;
    for (const c of [this.output, this.person]) {
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
    }

    const color = COLOR_FILTERS[this.settings.colorFilter].css;
    const ctx = this.ctx;
    ctx.filter = 'none';

    if (this.settings.background !== 'none' && this.segmenter) {
      this.drawBackground(video, color, w, h);
      this.updateMask(video, timestamp);
      const p = this.personCtx;
      p.globalCompositeOperation = 'source-over';
      p.filter = color;
      p.clearRect(0, 0, w, h);
      p.drawImage(video, 0, 0, w, h);
      p.filter = 'none';
      p.globalCompositeOperation = 'destination-in';
      p.filter = `blur(${Math.max(1, Math.round(w / 400))}px)`; // soft edges
      p.drawImage(this.mask, 0, 0, w, h);
      p.filter = 'none';
      p.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.person, 0, 0);
    } else {
      ctx.filter = color;
      ctx.drawImage(video, 0, 0, w, h);
      ctx.filter = 'none';
    }

    // Order: distort the face, apply the look, then draw decorations on top.
    const effect = this.settings.faceEffect;
    const lms = effect !== 'none' && this.faces ? this.faces.detectForVideo(video, timestamp).faceLandmarks[0] : undefined;
    if (lms && isWarpEffect(effect)) {
      this.warp ??= new FaceWarp();
      this.warp.apply(ctx, warpOps(effect, lms, w, h, timestamp));
    }

    const post = lookPost(this.settings.colorFilter);
    if (post) applyLookPost(ctx, post, w, h);

    if (lms) {
      const g = faceGeometry(lms, w, h);
      if (effect === 'sunglasses') drawSunglasses(ctx, g);
      else if (effect === 'hearts') drawHearts(ctx, g, timestamp);
      else if (effect === 'birds') drawBirds(ctx, g, timestamp);
      else if (effect === 'dog') {
        this.loadDog();
        drawDog(ctx, lms, w, h, this.dogSprites);
      }
    }
    return true;
  }

  private loadDog(): void {
    if (this.dogSprites || this.dogLoading) return;
    this.dogLoading = true;
    loadDogSprites(chrome.runtime.getURL('filters/dog.png'))
      .then((s) => (this.dogSprites = s))
      .catch((err) => console.warn('[swipe-skip] dog artwork failed; using drawn version', err));
  }

  private drawBackground(video: HTMLVideoElement, color: string, w: number, h: number): void {
    const ctx = this.ctx;
    if (this.settings.background === 'blur') {
      const blur = Math.round(Math.max(w, h) / 40);
      ctx.filter = `${color === 'none' ? '' : color} blur(${blur}px)`.trim();
      // Overscan so the blurred edges don't fade to transparent.
      ctx.drawImage(video, -blur * 2, -blur * 2, w + blur * 4, h + blur * 4);
      ctx.filter = 'none';
    } else {
      const grad = ctx.createRadialGradient(w / 2, h * 0.4, h * 0.1, w / 2, h / 2, Math.max(w, h) * 0.75);
      grad.addColorStop(0, '#5b6478');
      grad.addColorStop(1, '#1d2230');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  }

  /** Converts the person-confidence mask into an alpha mask. */
  private updateMask(video: HTMLVideoElement, timestamp: number): void {
    const result = this.segmenter!.segmentForVideo(video, timestamp);
    try {
      const masks = result.confidenceMasks;
      const m = masks?.[masks.length - 1]; // last mask = person
      if (!m) return;
      const conf = m.getAsFloat32Array();
      if (this.mask.width !== m.width || this.mask.height !== m.height) {
        this.mask.width = m.width;
        this.mask.height = m.height;
      }
      const img = this.maskCtx.createImageData(m.width, m.height);
      // Smooth over time (less flicker) and keep only confident pixels, so
      // stray low-confidence blobs in the background don't show through.
      if (this.prevMask?.length !== conf.length) this.prevMask = Float32Array.from(conf);
      const prev = this.prevMask;
      for (let i = 0; i < conf.length; i++) {
        const c = 0.6 * conf[i] + 0.4 * prev[i];
        prev[i] = c;
        img.data[i * 4 + 3] = Math.min(255, Math.max(0, (c - 0.5) * 1020));
      }
      this.maskCtx.putImageData(img, 0, 0);
    } finally {
      result.close();
    }
  }
}
