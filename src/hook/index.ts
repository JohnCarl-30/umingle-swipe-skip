// Runs in umingle's own JavaScript world at document_start. Wraps
// getUserMedia so the video umingle sends can be replaced with filtered (or
// jumpscare) frames produced by the detector iframe, and so the jumpscare
// scream can be mixed into the outgoing microphone audio.
import {
  FILTERING_EVENT,
  FRAME_READY_EVENT,
  HOOK_SOURCE,
  LOCAL_VIDEO_ATTR,
  type DetectorToHook,
  type HookConnect,
  type HookToDetector,
} from '../shared/messages';
import { ScreamMixer } from './audio';
import { FrameSelector } from './frames';

const FRAME_ID = 'swipe-skip-frame';

// Tracks that belong to the user's own camera (raw and wrapped).
const localTracks = new WeakSet<MediaStreamTrack>();

const blanks = new Map<string, OffscreenCanvas>();
function blank(width: number, height: number): OffscreenCanvas {
  const key = `${width}x${height}`;
  let canvas = blanks.get(key);
  if (!canvas) {
    canvas = new OffscreenCanvas(width || 640, height || 480);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    blanks.set(key, canvas);
  }
  return canvas;
}

const selector = new FrameSelector<VideoFrame>(
  (source, timestamp) => new VideoFrame(source, { timestamp }),
  blank,
);
let port: MessagePort | null = null;
let liveTracks = 0;
let heardFromDetector = false; // its mode messages beat the early saved-state hint
const mixer = new ScreamMixer();

function tellDetector(msg: HookToDetector): void {
  port?.postMessage(msg);
}

function reportActive(): void {
  tellDetector({ type: 'active', active: liveTracks > 0, scream: mixer.ready });
}

function connect(frame: HTMLIFrameElement): void {
  port?.close();
  const channel = new MessageChannel();
  port = channel.port1;
  port.onmessage = (e: MessageEvent<DetectorToHook>) => {
    const msg = e.data;
    if (msg.type === 'frame') {
      selector.pushFiltered(msg.bitmap);
    } else if (msg.type === 'mode') {
      heardFromDetector = true;
      selector.setFiltering(msg.filtering);
    } else if (msg.type === 'scream') {
      mixer.scream();
    } else if (msg.type === 'scream-sound') {
      mixer.volume = msg.volume;
      mixer.setSound(msg.data);
    }
  };
  const hello: HookConnect = { source: HOOK_SOURCE, type: 'connect' };
  frame.contentWindow?.postMessage(hello, '*', [channel.port2]);
  reportActive();
}

function watchFrame(): void {
  const frame = document.getElementById(FRAME_ID);
  if (!(frame instanceof HTMLIFrameElement) || frame.dataset.hooked) return;
  frame.dataset.hooked = '1';
  // Reconnect on every load: the panel reloads itself on "Retry camera".
  frame.addEventListener('load', () => connect(frame));
}

/**
 * Pipe the camera's video track through the selector into a new track, and
 * (when the jumpscare is on) the mic through the scream mixer.
 */
async function wrap(stream: MediaStream): Promise<MediaStream> {
  const [camera] = stream.getVideoTracks();
  // Always route the mic through the mixer (a cheap pass-through until a
  // scream plays), so turning the jumpscare on later needs no refresh.
  let audio = stream.getAudioTracks();
  if (audio[0]) {
    try {
      audio = [mixer.wrap(audio[0]), ...audio.slice(1)];
    } catch (err) {
      console.warn('[swipe-skip] scream mixing unavailable', err);
    }
  }
  if (!camera) return audio[0] !== stream.getAudioTracks()[0] ? new MediaStream(audio) : stream;

  const processor = new MediaStreamTrackProcessor({ track: camera });
  const generator = new MediaStreamTrackGenerator({ kind: 'video' });
  liveTracks++;
  reportActive();

  // When umingle stops our track, release the real camera too.
  const stopGenerator = generator.stop.bind(generator);
  generator.stop = () => {
    stopGenerator();
    camera.stop();
  };

  processor.readable
    .pipeThrough(new TransformStream<VideoFrame, VideoFrame>({ transform: (f, out) => out.enqueue(selector.select(f)) }))
    .pipeTo(generator.writable)
    .catch(() => {})
    .finally(() => {
      camera.stop();
      liveTracks--;
      reportActive();
    });

  localTracks.add(generator);
  return new MediaStream([generator, ...audio]);
}

/**
 * Tag <video> elements playing the user's own camera, so the content script
 * can tell the stranger's video apart (DOM attributes are visible across
 * JavaScript worlds; the MediaStream objects themselves are not).
 */
function tagLocalVideos(): void {
  const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');
  if (!desc?.set || !desc.get) return;
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    ...desc,
    set(this: HTMLMediaElement, value: MediaProvider | null) {
      desc.set!.call(this, value);
      const local = value instanceof MediaStream && value.getVideoTracks().some((t) => localTracks.has(t));
      this.toggleAttribute(LOCAL_VIDEO_ATTR, local);
    },
  });
}

function install(): void {
  tagLocalVideos();
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia || typeof MediaStreamTrackProcessor === 'undefined' || typeof MediaStreamTrackGenerator === 'undefined') {
    return; // unsupported browser: filters unavailable, everything else still works
  }
  const original = media.getUserMedia.bind(media);
  media.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    const stream = await original(constraints);
    stream.getVideoTracks().forEach((t) => localTracks.add(t));
    try {
      return await wrap(stream);
    } catch (err) {
      console.warn('[swipe-skip] camera filters unavailable', err);
      return stream;
    }
  };

  // The content script tells us the saved filter state before the panel
  // loads, so a privacy filter is never skipped while it starts up.
  document.addEventListener(FILTERING_EVENT, (e) => {
    if (!heardFromDetector && (e as CustomEvent<unknown>).detail === 'on') selector.setFiltering(true);
  });
  document.addEventListener(FRAME_READY_EVENT, watchFrame);
  watchFrame();
}

install();
