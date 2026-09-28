// Arena acoustics: the procedural impulse responses of the convolution reverb (audio/audio.ts).
import { describe, expect, it } from 'vitest';
import { impulseResponse, ROOMS } from '../audio/audio';
import { ARENA_COUNT } from '../game/constants';

/** Enough of an AudioContext to build buffers in Node. */
const fakeCtx = {
  sampleRate: 48000,
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c: number) => data[c] } as unknown as AudioBuffer;
  },
};

function energy(d: Float32Array, from: number, to: number): number {
  let e = 0;
  for (let i = Math.floor(from); i < Math.floor(to); i++) e += d[i] * d[i];
  return e;
}

describe('arena acoustics', () => {
  it('builds a decaying, stereo impulse response for every arena', () => {
    expect(ROOMS.length).toBe(ARENA_COUNT); // the original five and the remaster's four
    ROOMS.forEach((room, i) => {
      const ir = impulseResponse(fakeCtx, room, i + 1);
      expect(ir.numberOfChannels).toBe(2);
      expect(ir.duration).toBeGreaterThan(room.decay);
      const l = ir.getChannelData(0), r = ir.getChannelData(1);
      // Silent before the pre-delay, then decaying by far more than 40 dB over the tail.
      const start = Math.floor(room.predelay * 48000);
      expect(energy(l, 0, start)).toBe(0);
      const n = ir.length - start;
      expect(energy(l, ir.length - n / 10, ir.length)).toBeLessThan(energy(l, start, start + n / 10) * 1e-4);
      // The channels differ (a wide, decorrelated reverb), and every value is finite.
      expect(energy(l, start, ir.length)).toBeGreaterThan(0);
      let diff = 0;
      for (let k = start; k < start + 1000; k++) diff += Math.abs(l[k] - r[k]);
      expect(diff).toBeGreaterThan(0);
      expect(l.every(Number.isFinite) && r.every(Number.isFinite)).toBe(true);
    });
  });

  it('is the same on every run', () => {
    const a = impulseResponse(fakeCtx, ROOMS[2], 3).getChannelData(0);
    const b = impulseResponse(fakeCtx, ROOMS[2], 3).getChannelData(0);
    expect(a).toEqual(b);
  });
});
