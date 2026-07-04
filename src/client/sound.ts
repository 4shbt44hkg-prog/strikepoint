// All audio is synthesized with WebAudio — no asset files, no copyright.

import { settings } from "./settings";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ac(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  if (master) master.gain.value = settings.volume;
  return ctx;
}

/** Call once from a user gesture so the AudioContext can start. */
export function unlockAudio(): void {
  ac();
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * seconds)), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

interface ShotParams { dur: number; freq: number; body: number; vol: number; }
const SHOT: Record<string, ShotParams> = {
  raptor: { dur: 0.09, freq: 1400, body: 140, vol: 0.5 },
  hornet: { dur: 0.06, freq: 2000, body: 200, vol: 0.35 },
  mauler: { dur: 0.22, freq: 700, body: 70, vol: 0.85 },
  longshot: { dur: 0.3, freq: 900, body: 55, vol: 0.9 },
  trident: { dur: 0.07, freq: 1600, body: 160, vol: 0.45 },
  sidekick: { dur: 0.1, freq: 1200, body: 170, vol: 0.45 },
  judge: { dur: 0.18, freq: 800, body: 80, vol: 0.75 },
  wasp: { dur: 0.05, freq: 2400, body: 240, vol: 0.3 },
};

/** Gunshot: filtered noise crack + low thump. gain 0..1 scales with distance. */
export function playShot(wpnId: string, gain = 1): void {
  const c = ac();
  if (!c || !master || gain < 0.03) return;
  const p = SHOT[wpnId] ?? SHOT.raptor;
  const t = c.currentTime;

  const noise = c.createBufferSource();
  noise.buffer = noiseBuffer(c, p.dur);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = p.freq;
  bp.Q.value = 0.8;
  const ng = c.createGain();
  ng.gain.setValueAtTime(p.vol * gain, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + p.dur);
  noise.connect(bp).connect(ng).connect(master);
  noise.start(t);

  const osc = c.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(p.body, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(30, p.body * 0.4), t + p.dur * 1.5);
  const og = c.createGain();
  og.gain.setValueAtTime(p.vol * 0.7 * gain, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + p.dur * 1.5);
  osc.connect(og).connect(master);
  osc.start(t);
  osc.stop(t + p.dur * 1.6);
}

function blip(freq: number, dur: number, vol: number, type: OscillatorType = "square", delay = 0): void {
  const c = ac();
  if (!c || !master) return;
  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export function playHit(head: boolean): void {
  blip(head ? 1500 : 1100, 0.06, 0.25, "square");
}

export function playKill(): void {
  blip(700, 0.09, 0.3, "square");
  blip(1050, 0.12, 0.3, "square", 0.08);
}

export function playHurt(): void {
  blip(160, 0.16, 0.4, "sawtooth");
}

export function playDeath(): void {
  blip(300, 0.3, 0.35, "sawtooth");
  blip(150, 0.5, 0.35, "sawtooth", 0.12);
}

export function playReload(): void {
  blip(900, 0.03, 0.15, "square");
  blip(600, 0.03, 0.15, "square", 0.09);
}

export function playSwap(): void {
  blip(500, 0.04, 0.12, "triangle");
}

export function playRoundStart(): void {
  blip(440, 0.1, 0.25, "triangle");
  blip(550, 0.1, 0.25, "triangle", 0.12);
  blip(660, 0.18, 0.3, "triangle", 0.24);
}

export function playRoundEnd(won: boolean): void {
  if (won) {
    blip(523, 0.12, 0.3, "triangle");
    blip(659, 0.12, 0.3, "triangle", 0.1);
    blip(784, 0.25, 0.35, "triangle", 0.2);
  } else {
    blip(400, 0.15, 0.3, "triangle");
    blip(300, 0.3, 0.3, "triangle", 0.14);
  }
}

export function playClick(): void {
  blip(1200, 0.02, 0.1, "square");
}

export function playPickup(kind: "health" | "shield"): void {
  if (kind === "health") {
    blip(660, 0.07, 0.25, "triangle");
    blip(880, 0.1, 0.25, "triangle", 0.07);
  } else {
    blip(523, 0.09, 0.28, "triangle");
    blip(659, 0.09, 0.28, "triangle", 0.07);
    blip(988, 0.16, 0.3, "triangle", 0.14);
  }
}

export function playLaunch(): void {
  const c = ac();
  if (!c || !master) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(160, t);
  osc.frequency.exponentialRampToValueAtTime(900, t + 0.28);
  const g = c.createGain();
  g.gain.setValueAtTime(0.3, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.4);
}
