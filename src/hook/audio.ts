// Mixes the jumpscare scream into the microphone audio umingle sends.
//
// Works on the raw audio frames (MediaStreamTrackProcessor/Generator), not an
// AudioContext: a live AudioContext needs a user click first, and umingle may
// open the mic before any click — which used to leave the scream silent.

import { playBuffer, synthScream, SCARE_MAX_MS } from '../shared/scream';

/** Adds `src[from..]` × volume into planar channel buffers; returns samples consumed. */
export function mixInto(channels: Float32Array[], src: Float32Array, from: number, volume: number): number {
  const n = Math.min(channels[0]?.length ?? 0, src.length - from);
  for (const ch of channels) {
    for (let i = 0; i < n; i++) {
      const v = ch[i] + src[from + i] * volume;
      ch[i] = v > 1 ? 1 : v < -1 ? -1 : v;
    }
  }
  return n;
}

/** Copies an AudioData into one Float32Array per channel. */
function toPlanar(frame: AudioData): Float32Array[] {
  const n = frame.numberOfFrames;
  const chans = frame.numberOfChannels;
  try {
    return Array.from({ length: chans }, (_, c) => {
      const plane = new Float32Array(n);
      frame.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
      return plane;
    });
  } catch {
    // Older Chrome without format conversion: handle interleaved f32 / s16.
    const size = frame.allocationSize({ planeIndex: 0 });
    const raw = new ArrayBuffer(size);
    frame.copyTo(raw, { planeIndex: 0 });
    const interleaved = frame.format?.startsWith('s16')
      ? Float32Array.from(new Int16Array(raw), (v) => v / 32768)
      : new Float32Array(raw);
    return Array.from({ length: chans }, (_, c) => {
      const plane = new Float32Array(n);
      for (let i = 0; i < n; i++) plane[i] = interleaved[i * chans + c];
      return plane;
    });
  }
}

export class ScreamMixer {
  volume = 0.8;
  private customData: ArrayBuffer | null = null;
  private rendered = new Map<number, Float32Array>(); // sample rate -> scream samples
  private rendering = new Set<number>();
  private playing: { samples: Float32Array; pos: number } | null = null;
  private pendingScream = false;
  private sampleRate = 0;
  private wrappedTracks = 0;

  /** True once a mic track is wrapped (the scream can reach the stranger). */
  get ready(): boolean {
    return this.wrappedTracks > 0;
  }

  /** Returns a track carrying the mic plus any scream. */
  wrap(mic: MediaStreamTrack): MediaStreamTrack {
    const processor = new MediaStreamTrackProcessor<AudioData>({ track: mic });
    const generator = new MediaStreamTrackGenerator<AudioData>({ kind: 'audio' });
    this.wrappedTracks++;

    // When umingle stops our track, release the real mic.
    const stopGenerator = generator.stop.bind(generator);
    generator.stop = () => {
      stopGenerator();
      mic.stop();
    };

    processor.readable
      .pipeThrough(new TransformStream<AudioData, AudioData>({ transform: (f, out) => out.enqueue(this.mix(f)) }))
      .pipeTo(generator.writable)
      .catch(() => {})
      .finally(() => {
        mic.stop();
        this.wrappedTracks--;
      });
    return generator;
  }

  setSound(data: ArrayBuffer | null): void {
    this.customData = data;
    this.rendered.clear();
    if (this.sampleRate) void this.render(this.sampleRate);
  }

  /** Starts the scream in the outgoing audio. */
  scream(): void {
    const samples = this.rendered.get(this.sampleRate);
    if (samples) this.playing = { samples, pos: 0 };
    else this.pendingScream = true; // plays as soon as it's rendered
  }

  /** Pre-renders the scream at the mic's sample rate (no user click needed offline). */
  private async render(rate: number): Promise<void> {
    if (this.rendered.has(rate) || this.rendering.has(rate)) return;
    this.rendering.add(rate);
    let retryDefault = false;
    try {
      const length = Math.ceil((rate * SCARE_MAX_MS) / 1000);
      const ctx = new OfflineAudioContext(1, length, rate);
      let ms: number;
      if (this.customData) {
        const buffer = await ctx.decodeAudioData(this.customData.slice(0));
        ms = playBuffer(ctx, ctx.destination, buffer, 1);
      } else {
        ms = synthScream(ctx, ctx.destination, 1);
      }
      const out = await ctx.startRendering();
      this.rendered.set(rate, out.getChannelData(0).slice(0, Math.ceil((rate * ms) / 1000)));
    } catch (err) {
      console.warn('[swipe-skip] could not prepare the scream', err);
      if (this.customData) {
        this.customData = null; // unreadable custom sound: fall back to the generated scream
        retryDefault = true;
      }
    } finally {
      this.rendering.delete(rate);
    }
    if (retryDefault) return this.render(rate);
    if (this.pendingScream && rate === this.sampleRate) {
      this.pendingScream = false;
      this.scream();
    }
  }

  private mix(frame: AudioData): AudioData {
    if (frame.sampleRate !== this.sampleRate) {
      this.sampleRate = frame.sampleRate;
      void this.render(frame.sampleRate);
    }
    const playing = this.playing;
    if (!playing) return frame;

    const channels = toPlanar(frame);
    playing.pos += mixInto(channels, playing.samples, playing.pos, this.volume);
    if (playing.pos >= playing.samples.length) this.playing = null;

    const n = frame.numberOfFrames;
    const data = new Float32Array(n * channels.length);
    channels.forEach((ch, c) => data.set(ch, c * n));
    const mixed = new AudioData({
      format: 'f32-planar',
      sampleRate: frame.sampleRate,
      numberOfFrames: n,
      numberOfChannels: channels.length,
      timestamp: frame.timestamp,
      data,
    });
    frame.close();
    return mixed;
  }
}
