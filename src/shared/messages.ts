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
export type PageMessage =
  | { type: 'status'; text: string; state?: StatusState }
  | { type: 'stranger-frame'; bitmap: ImageBitmap }  // snapshot of the stranger's video
  | { type: 'stranger-video'; found: boolean };

export type FrameEnvelope = FrameMessage & { source: typeof FRAME_SOURCE };
export type PageEnvelope = PageMessage & { source: typeof PAGE_SOURCE };

const isObject = (data: unknown): data is Record<string, unknown> =>
  typeof data === 'object' && data !== null;

// ---------- camera hook (page main world) <-> detector iframe ----------
//
// The hook sends the iframe a MessagePort; filtered frames then travel over
// that private channel instead of window messages.

export const HOOK_SOURCE = 'swipe-skip-hook';
export type HookConnect = { source: typeof HOOK_SOURCE; type: 'connect' };

/**
 * Over the port, hook -> detector: whether umingle currently has a camera
 * stream, and whether the scream can be mixed into the outgoing audio.
 */
export type HookToDetector = { type: 'active'; active: boolean; scream: boolean };

/** Over the port, detector -> hook. */
export type DetectorToHook =
  | { type: 'mode'; filtering: boolean }
  | { type: 'frame'; bitmap: ImageBitmap }
  | { type: 'scream' }                                         // play the scream to the stranger now
  | { type: 'scream-sound'; data: ArrayBuffer | null; volume: number };

/** DOM event the content script fires so the hook knows the iframe exists. */
export const FRAME_READY_EVENT = 'swipe-skip:frame-ready';
/** DOM event carrying the saved filter state ('on' | 'off') before the iframe loads. */
export const FILTERING_EVENT = 'swipe-skip:filtering';

/** Attribute the hook puts on <video> elements showing the user's own camera. */
export const LOCAL_VIDEO_ATTR = 'data-swipe-skip-local';

export function isHookConnect(data: unknown): data is HookConnect {
  return isObject(data) && data.source === HOOK_SOURCE && data.type === 'connect';
}

export function isFrameEnvelope(data: unknown): data is FrameEnvelope {
  return isObject(data) && data.source === FRAME_SOURCE && typeof data.type === 'string';
}

export function isPageEnvelope(data: unknown): data is PageEnvelope {
  return isObject(data) && data.source === PAGE_SOURCE && typeof data.type === 'string';
}
