// The jumpscare scream: a generated shriek, or a user-supplied sound.
// Plays into any AudioNode (speakers for the preview, or the outgoing call audio).

export const SCARE_MIN_MS = 1600;
export const SCARE_MAX_MS = 4000;

/** A distorted, rising shriek: detuned saws + noise through a waveshaper. Returns its length (ms). */
export function synthScream(ctx: BaseAudioContext, out: AudioNode, volume: number): number {
  const t0 = ctx.currentTime;
  const dur = 1.7;

  const master = ctx.createGain();
  master.gain.setValueAtTime(0, t0);
  master.gain.linearRampToValueAtTime(volume, t0 + 0.03);
  master.gain.setValueAtTime(volume, t0 + dur - 0.35);
  master.gain.exponentialRampToValueAtTime(0.001, t0 + dur);

  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 6);
  shaper.curve = curve;
  shaper.connect(master).connect(out);

  // Vibrato makes it sound like a voice rather than a tone.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 11;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 45;
  lfo.connect(lfoDepth);

  for (const [base, gain] of [[620, 0.35], [935, 0.25], [1240, 0.18], [1870, 0.08]] as const) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(base * 0.7, t0);
    osc.frequency.exponentialRampToValueAtTime(base * 1.25, t0 + 0.25);
    osc.frequency.exponentialRampToValueAtTime(base * 1.1, t0 + dur);
    lfoDepth.connect(osc.frequency);
    const g = ctx.createGain();
    g.gain.value = gain;
    osc.connect(g).connect(shaper);
    osc.start(t0);
    osc.stop(t0 + dur);
  }

  const noise = ctx.createBufferSource();
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noise.buffer = buf;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 2600;
  band.Q.value = 0.8;
  const ng = ctx.createGain();
  ng.gain.value = 0.5;
  noise.connect(band).connect(ng).connect(shaper);
  noise.start(t0);

  lfo.start(t0);
  lfo.stop(t0 + dur);
  return dur * 1000;
}

/** Plays a decoded custom sound (capped at SCARE_MAX_MS). Returns its length (ms). */
export function playBuffer(ctx: BaseAudioContext, out: AudioNode, buffer: AudioBuffer, volume: number): number {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const g = ctx.createGain();
  g.gain.value = volume;
  src.connect(g).connect(out);
  const ms = Math.min(SCARE_MAX_MS, buffer.duration * 1000);
  src.start();
  src.stop(ctx.currentTime + ms / 1000);
  return ms;
}

/** How long the scare video should last for a sound of `soundMs`. */
export const scareDuration = (soundMs: number): number => Math.min(SCARE_MAX_MS, Math.max(SCARE_MIN_MS, soundMs));
