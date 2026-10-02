// Timing helpers for the credits' pictures, which are all worked out from the song's position (song seconds) each frame
// rather than left to CSS animations: they stay on the music, and a recording can step through them.
import { barAt, BEAT, beatTime, FIRST_BEAT } from './song';

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
/** 0 before `a`, 1 after `b`, linear in between. */
export const ramp = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));
export const easeOut = (x: number): number => 1 - Math.pow(1 - clamp01(x), 3);
export const easeIn = (x: number): number => Math.pow(clamp01(x), 3);
/** Overshoots a little before settling (a slam). */
export const easeOutBack = (x: number, s = 1.7): number => {
  const k = clamp01(x) - 1;
  return 1 + (s + 1) * k * k * k + s * k * k;
};
/** A hit's light at time t: 1 when it lands at `at`, dying away with the time constant `decay` (0 before). */
export const hit = (t: number, at: number, decay: number): number => (t < at ? 0 : Math.exp(-(t - at) / decay));
/** Up over `rise`, held, down over `fall`: a visibility between `a` and `b`. */
export const window01 = (t: number, a: number, b: number, rise: number, fall: number): number =>
  Math.min(ramp(t, a, a + rise), 1 - ramp(t, b - fall, b));

/** Seconds since the last beat, and since the last downbeat, at time t. */
export function sinceBeat(t: number): number {
  const n = Math.floor((t - FIRST_BEAT) / BEAT);
  return t - beatTime(n);
}
export function sinceBar(t: number): number {
  const k = Math.floor(barAt(t) + 1e-9);
  return t - beatTime(2 + 4 * k);
}

/** A light pulsing on the beats (1 on a beat, dying away), stronger on the downbeats. */
export function beatPulse(t: number, decay = 0.16): number {
  const bar = Math.exp(-sinceBar(t) / (decay * 1.6));
  const beat = Math.exp(-sinceBeat(t) / decay);
  return Math.max(bar, beat * 0.55);
}
