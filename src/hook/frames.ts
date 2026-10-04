// Decides which frame umingle gets: the raw camera frame, or the latest
// filtered frame from the detector iframe.

/** The parts of VideoFrame we use (lets tests pass fakes). */
export interface RawFrame {
  readonly timestamp: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
  close(): void;
}

export type FrameFactory<F extends RawFrame> = (source: CanvasImageSource, timestamp: number) => F;
export type BlankFactory = (width: number, height: number) => CanvasImageSource;

export class FrameSelector<F extends RawFrame = VideoFrame> {
  private filtering = false;
  private latest: ImageBitmap | null = null;

  constructor(
    private readonly makeFrame: FrameFactory<F>,
    private readonly makeBlank: BlankFactory,
  ) {}

  get isFiltering(): boolean {
    return this.filtering;
  }

  setFiltering(on: boolean): void {
    this.filtering = on;
    if (!on) this.dropLatest();
  }

  pushFiltered(bitmap: ImageBitmap): void {
    this.latest?.close();
    this.latest = bitmap;
  }

  /**
   * While filtering, never pass the raw camera through: use the newest
   * filtered frame (even if stale, e.g. the tab is in the background), or a
   * blank frame until the first one arrives.
   */
  select(raw: F): F {
    if (!this.filtering) return raw;
    const source = this.latest ?? this.makeBlank(raw.displayWidth, raw.displayHeight);
    const out = this.makeFrame(source, raw.timestamp);
    raw.close();
    return out;
  }

  private dropLatest(): void {
    this.latest?.close();
    this.latest = null;
  }
}
