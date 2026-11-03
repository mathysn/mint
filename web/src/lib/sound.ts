import { useSyncExternalStore } from 'react';
import type { Tier } from '../../../shared/api';

/**
 * Opening sounds, synthesized with the Web Audio API (no audio files). The context is created on
 * the first sound, which always follows a click ("Open case"), so browsers and Discord allow it.
 * Muting is a per-browser preference (localStorage); nothing plays in a hidden tab.
 */

const STORAGE_KEY = 'mint.sound';
const VOLUME = 0.55;

function readMuted(): boolean {
  try {
    return (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { muted?: boolean }).muted === true;
  } catch {
    return false;
  }
}

let muted = readMuted();
const listeners = new Set<() => void>();

export function setSoundMuted(next: boolean) {
  muted = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ muted }));
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useSoundMuted = () => useSyncExternalStore(subscribe, () => muted);

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (muted || typeof window === 'undefined' || document.hidden) return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
    // A compressor keeps chords from clipping.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 6;
    limiter.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = VOLUME;
    master.connect(limiter);
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

type ToneOptions = { type?: OscillatorType; gain?: number; attack?: number; endFreq?: number; detune?: number };

/** One oscillator note with a short attack and an exponential release. */
function tone(ac: AudioContext, freq: number, at: number, duration: number, { type = 'sine', gain = 0.2, attack = 0.005, endFreq, detune = 0 }: ToneOptions = {}) {
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, at + duration);
  osc.detune.value = detune;
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(gain, at + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(env).connect(master!);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

type NoiseOptions = { filter?: BiquadFilterType; freq?: number; q?: number; gain?: number };

/** Filtered white noise burst (clicks, latches, sparkle). */
function noise(ac: AudioContext, at: number, duration: number, { filter = 'bandpass', freq = 3000, q = 1, gain = 0.2 }: NoiseOptions = {}) {
  if (!noiseBuffer) {
    noiseBuffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const biquad = ac.createBiquadFilter();
  biquad.type = filter;
  biquad.frequency.value = freq;
  biquad.Q.value = q;
  const env = ac.createGain();
  env.gain.setValueAtTime(gain, at);
  env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  src.connect(biquad).connect(env).connect(master!);
  src.start(at, Math.random() * 0.5);
  src.stop(at + duration + 0.02);
}

const jitter = (amount: number) => 1 + (Math.random() * 2 - 1) * amount;

let lastTick = 0;

export const sound = {
  /** Call from a click before the first sound, so the context starts unlocked. */
  unlock() {
    audio();
  },

  /** Case unlatch: two clicks and a low knock. */
  open() {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime + 0.01;
    noise(ac, t, 0.03, { freq: 2600, q: 3, gain: 0.5 });
    noise(ac, t + 0.07, 0.04, { freq: 1800, q: 2, gain: 0.4 });
    tone(ac, 150, t + 0.06, 0.18, { gain: 0.35, endFreq: 60 });
  },

  /** A card edge passes the marker. */
  tick() {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime;
    if (t - lastTick < 0.03) return;
    lastTick = t;
    tone(ac, 1900 * jitter(0.06), t, 0.03, { type: 'triangle', gain: 0.12, attack: 0.001 });
    noise(ac, t, 0.015, { filter: 'highpass', freq: 4500, gain: 0.08 });
  },

  /** The strip settles on the result. */
  stop() {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime;
    tone(ac, 130, t, 0.22, { gain: 0.5, endFreq: 55 });
    noise(ac, t, 0.07, { filter: 'lowpass', freq: 900, gain: 0.35 });
  },

  /** Reveal, growing with rarity: a blip for Mil-Spec, a fanfare for ★. */
  reveal(tier: Tier) {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime + 0.02;
    const notes = (freqs: number[], gap: number, length: number, opts: ToneOptions) => freqs.forEach((f, i) => tone(ac, f, t + i * gap, length, opts));
    switch (tier) {
      case 'milspec':
        tone(ac, 660, t, 0.28, { gain: 0.16 });
        break;
      case 'restricted':
        notes([660, 880], 0.08, 0.35, { type: 'triangle', gain: 0.14 });
        break;
      case 'classified':
        notes([1047, 1319, 1568], 0.09, 0.7, { gain: 0.16 });
        notes([1047, 1319, 1568], 0.09, 0.7, { gain: 0.06, detune: 8 });
        break;
      case 'covert':
        notes([440, 554, 659, 880], 0.07, 1.4, { type: 'triangle', gain: 0.12, attack: 0.03 });
        notes([880, 1109, 1319, 1760], 0.07, 1.1, { gain: 0.05, detune: -6 });
        noise(ac, t + 0.25, 0.9, { filter: 'bandpass', freq: 6500, q: 4, gain: 0.08 });
        break;
      case 'gold': {
        notes([523, 659, 784, 1047, 1319, 1568], 0.07, 0.5, { type: 'triangle', gain: 0.13 });
        const chord = t + 0.45;
        [523, 659, 784, 1047].forEach((f) => tone(ac, f, chord, 2, { type: 'triangle', gain: 0.1, attack: 0.04 }));
        [1047, 1319, 1568].forEach((f) => tone(ac, f, chord, 1.6, { gain: 0.05, detune: 7 }));
        for (let i = 0; i < 9; i++) tone(ac, 2400 + Math.random() * 2400, chord + 0.1 + i * 0.13 * jitter(0.3), 0.25, { gain: 0.04 });
        noise(ac, chord, 1.4, { filter: 'bandpass', freq: 7000, q: 3, gain: 0.07 });
        break;
      }
    }
  },
};
