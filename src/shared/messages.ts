// Messages exchanged between the umingle page (content script) and the
// detector iframe over window.postMessage.

export const FRAME_SOURCE = 'swipe-skip';
export const PAGE_SOURCE = 'swipe-skip-page';

export type StatusState = 'ready' | 'hand' | 'loading' | 'error' | 'off';

/** Detector iframe -> page. */
export type FrameMessage =
  | { type: 'swipe' }
  | { type: 'pick' }
  | { type: 'drag'; dx: number; dy: number }
  | { type: 'drag-end' }
  | { type: 'resize'; width: number; height: number };

/** Page -> detector iframe. */
export type PageMessage = { type: 'status'; text: string; state?: StatusState };

export type FrameEnvelope = FrameMessage & { source: typeof FRAME_SOURCE };
export type PageEnvelope = PageMessage & { source: typeof PAGE_SOURCE };

const isObject = (data: unknown): data is Record<string, unknown> =>
  typeof data === 'object' && data !== null;

export function isFrameEnvelope(data: unknown): data is FrameEnvelope {
  return isObject(data) && data.source === FRAME_SOURCE && typeof data.type === 'string';
}

export function isPageEnvelope(data: unknown): data is PageEnvelope {
  return isObject(data) && data.source === PAGE_SOURCE && data.type === 'status';
}
