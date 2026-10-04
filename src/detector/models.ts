// Loading MediaPipe models: bundled copy if present, else Google's CDN.
import { FilesetResolver } from '@mediapipe/tasks-vision';

const GCS = 'https://storage.googleapis.com/mediapipe-models';

export const MODELS = {
  hand: { file: 'hand_landmarker.task', remote: `${GCS}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task` },
  face: { file: 'face_landmarker.task', remote: `${GCS}/face_landmarker/face_landmarker/float16/1/face_landmarker.task` },
  segmenter: { file: 'selfie_segmenter.tflite', remote: `${GCS}/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite` },
} as const;

export type ModelName = keyof typeof MODELS;
type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

let fileset: Promise<WasmFileset> | null = null;

export function visionFileset(): Promise<WasmFileset> {
  fileset ??= FilesetResolver.forVisionTasks(chrome.runtime.getURL('vendor/wasm'));
  return fileset;
}

export async function modelPath(name: ModelName): Promise<string> {
  const local = chrome.runtime.getURL(`models/${MODELS[name].file}`);
  try {
    const res = await fetch(local, { method: 'HEAD' });
    if (res.ok) return local;
  } catch {
    /* not bundled */
  }
  return MODELS[name].remote;
}

/** Try the GPU delegate first; some machines only manage CPU. */
export async function withGpuFallback<T>(create: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
  try {
    return await create('GPU');
  } catch {
    return await create('CPU');
  }
}
