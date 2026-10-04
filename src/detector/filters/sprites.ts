// Image-based face stickers (e.g. the dog ears + nose artwork). The artwork
// comes on a white background; we key the white out and split it into parts.

export interface Sprite {
  canvas: OffscreenCanvas;
  width: number;
  height: number;
}

export interface DogSprites {
  leftEar: Sprite; // the ear on the left of the picture
  rightEar: Sprite;
  nose: Sprite;
}

/** Alpha for a pixel on a white background: white → transparent, soft edge. */
export function whiteKeyAlpha(r: number, g: number, b: number): number {
  const darkness = 765 - (r + g + b); // 0 = pure white
  return Math.max(0, Math.min(255, Math.round((darkness - 12) * 6)));
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Bounding box of opaque pixels inside a region of an RGBA buffer, or null if empty. */
export function opaqueBounds(data: Uint8ClampedArray, width: number, region: Box): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = region.y0; y < region.y1; y++) {
    for (let x = region.x0; x < region.x1; x++) {
      if (data[(y * width + x) * 4 + 3] > 40) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x0 === Infinity ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

function crop(src: OffscreenCanvas, b: Box): Sprite {
  const width = b.x1 - b.x0;
  const height = b.y1 - b.y0;
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.drawImage(src, b.x0, b.y0, width, height, 0, 0, width, height);
  return { canvas, width, height };
}

/** Loads the dog artwork: ears in the top half (left/right), nose in the bottom half. */
export async function loadDogSprites(url: string): Promise<DogSprites> {
  const img = await createImageBitmap(await (await fetch(url)).blob());
  const { width: w, height: h } = img;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  img.close();
  const pixels = ctx.getImageData(0, 0, w, h);
  const d = pixels.data;
  for (let i = 0; i < d.length; i += 4) d[i + 3] = whiteKeyAlpha(d[i], d[i + 1], d[i + 2]);
  ctx.putImageData(pixels, 0, 0);

  const mid = Math.round(h * 0.45);
  const parts = {
    leftEar: opaqueBounds(d, w, { x0: 0, y0: 0, x1: Math.round(w / 2), y1: mid }),
    rightEar: opaqueBounds(d, w, { x0: Math.round(w / 2), y0: 0, x1: w, y1: mid }),
    nose: opaqueBounds(d, w, { x0: 0, y0: mid, x1: w, y1: h }),
  };
  if (!parts.leftEar || !parts.rightEar || !parts.nose) throw new Error('dog artwork: missing ears or nose');
  return { leftEar: crop(canvas, parts.leftEar), rightEar: crop(canvas, parts.rightEar), nose: crop(canvas, parts.nose) };
}
