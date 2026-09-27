import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Effect, NOTE_BASE, PARAM_NONE, parsePSM, type TrackerModule } from './psm';
import { MasiSequencer, TrackerPlayer, measureSong, type MasiDriver } from './tracker';

const dir = path.resolve(__dirname, '../../public/gamedata');
const SONGS = ['MENU', 'END', 'ARENA0', 'ARENA1', 'ARENA2', 'ARENA3', 'ARENA4'] as const;
const has = SONGS.every((s) => fs.existsSync(path.join(dir, `${s}.PSM`)));
const load = (name: string) => parsePSM(new Uint8Array(fs.readFileSync(path.join(dir, `${name}.PSM`))));

/**
 * Expected values. Song lengths agree with libxmp's to the millisecond. The hashes are FNV-1a
 * digests of every sound-driver call made during the first 20000 ticks by the ORIGINAL MASI line
 * processor (MDRV000R.MUS executed in a CPU emulator); MasiSequencer must reproduce them exactly.
 */
const EXPECTED: Record<(typeof SONGS)[number], { channels: number; patterns: number; seconds: number; hash: number }> = {
  MENU: { channels: 6, patterns: 24, seconds: 180.0, hash: 0xa9ed93e2 },
  END: { channels: 8, patterns: 17, seconds: 152.32, hash: 0x3d8b6c33 },
  ARENA0: { channels: 4, patterns: 24, seconds: 180.0, hash: 0x10e78b67 },
  ARENA1: { channels: 6, patterns: 13, seconds: 99.84, hash: 0x51492518 },
  ARENA2: { channels: 6, patterns: 12, seconds: 78.904, hash: 0x7e53efea },
  ARENA3: { channels: 6, patterns: 22, seconds: 84.48, hash: 0x11f9b9b0 },
  ARENA4: { channels: 6, patterns: 11, seconds: 66.4, hash: 0x04f4c844 },
};

function render(player: TrackerPlayer, seconds: number, block = 128): { L: Float32Array; R: Float32Array } {
  const n = Math.round(seconds * player.sampleRate);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i += block) player.render(L, R, i, Math.min(block, n - i));
  return { L, R };
}

function stats(x: Float32Array, from = 0, to = x.length) {
  let peak = 0;
  let sum = 0;
  let finite = true;
  for (let i = from; i < to; i++) {
    const v = x[i];
    if (!Number.isFinite(v)) finite = false;
    peak = Math.max(peak, Math.abs(v));
    sum += v * v;
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, to - from)), finite };
}

/** FNV-1a over the driver-call stream (same normalisation as the emulator logs). */
function driverHash(mod: TrackerModule, ticks: number): number {
  let h = 0x811c9dc5;
  const add = (v: number) => {
    v >>>= 0;
    for (let i = 0; i < 4; i++) {
      h ^= (v >>> (i * 8)) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  const drv: MasiDriver = {
    noteOn(c, s, o, p, f) {
      add(12); add(c + 1); add(s); add(p & 0xff); add(f); add(o);
    },
    setPosition(c, o) {
      add(13); add(c + 1); add(o);
    },
    setVolume(c, v) {
      add(16); add(c + 1); add(v);
    },
    setFrequency(c, hz) {
      add(20); add(c + 1); add(hz);
    },
    setTempo(b) {
      add(6); add(0); add(b);
    },
  };
  const seq = new MasiSequencer(mod, drv);
  for (let t = 0; t < ticks; t++) {
    seq.step();
    add(0xffff);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------------------------
// Synthetic modules (no game data needed)
// ---------------------------------------------------------------------------------------------

interface SynthEvent {
  ch: number;
  note?: number; // raw PSM note byte
  ins?: number;
  vol?: number;
  fx?: [number, ...number[]];
}

function chunk(id: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** Builds a one-pattern PSM: `rows[r]` = events of row r. Sample 0 = `sample` (8-bit signed). */
function buildPSM(opts: {
  channels: number;
  rows: SynthEvent[][];
  sample: Int8Array;
  loop?: [number, number];
  c5?: number;
  pans?: number[];
  speed?: number;
  tempo?: number;
  loops?: boolean;
}): Uint8Array {
  const rowBufs = opts.rows.map((evs) => {
    const bytes: number[] = [];
    for (const e of evs) {
      let flags = 0;
      const b: number[] = [];
      if (e.note !== undefined) {
        flags |= 0x80;
        b.push(e.note);
      }
      if (e.ins !== undefined) {
        flags |= 0x40;
        b.push(e.ins);
      }
      if (e.vol !== undefined) {
        flags |= 0x20;
        b.push(e.vol);
      }
      if (e.fx) {
        flags |= 0x10;
        b.push(...e.fx);
      }
      bytes.push(flags, e.ch, ...b);
    }
    return Uint8Array.from([(bytes.length + 2) & 0xff, (bytes.length + 2) >> 8, ...bytes]);
  });
  const rowData = concat(...rowBufs);
  const pbod = new Uint8Array(10 + rowData.length);
  const pv = new DataView(pbod.buffer);
  pv.setUint32(0, pbod.length, true);
  pbod.set(ascii('P0  '), 4);
  pv.setUint16(8, opts.rows.length, true);
  pbod.set(rowData, 10);

  const ops: number[][] = [[0x0c, 0x00, 0xff, 0x00, 0x00, 0x01, 0x00]];
  for (let c = 0; c < opts.channels; c++) ops.push([0x0d, c, (opts.pans?.[c] ?? 0) & 0xff, 0]);
  ops.push([0x07, opts.speed ?? 6], [0x08, opts.tempo ?? 125], [0x01, ...ascii('P0  ')]);
  if (opts.loops !== false) ops.push([0x04, 0, 0]);
  ops.push([0x00]);
  const oplh = Uint8Array.from([ops.length, 0, ...ops.flat()]);
  const song = concat(ascii('MAINSONG '), Uint8Array.from([1, opts.channels]), chunk('OPLH', oplh));

  const h = new Uint8Array(96);
  const hv = new DataView(h.buffer);
  h[0] = opts.loop ? 0x80 : 0;
  h.set(ascii('TEST    '), 1);
  h.set(ascii('I0  '), 9);
  hv.setUint16(52, 0, true);
  hv.setUint32(54, opts.sample.length, true);
  hv.setUint32(58, opts.loop?.[0] ?? 0, true);
  hv.setUint32(62, opts.loop?.[1] ?? 0, true);
  h[68] = 127;
  hv.setUint32(73, opts.c5 ?? 8448, true);
  const delta = new Uint8Array(opts.sample.length);
  let prev = 0;
  for (let i = 0; i < opts.sample.length; i++) {
    delta[i] = (opts.sample[i] - prev) & 0xff;
    prev = opts.sample[i];
  }
  const body = concat(
    chunk('SDFT', ascii('MAINSONG')),
    chunk('TITL', ascii('test song')),
    chunk('PBOD', pbod),
    chunk('SONG', song),
    chunk('DSMP', concat(h, delta)),
  );
  const head = new Uint8Array(12);
  head.set(ascii('PSM '), 0);
  new DataView(head.buffer).setUint32(4, body.length + 4, true);
  head.set(ascii('FILE'), 8);
  return concat(head, body);
}

/** Square wave with the given period (in samples), looped. */
function square(period: number, cycles = 64): Int8Array {
  const s = new Int8Array(period * cycles);
  for (let i = 0; i < s.length; i++) s[i] = i % period < period / 2 ? 100 : -100;
  return s;
}

/** Average frequency of a signal from its positive-going zero crossings. */
function zeroCrossingHz(x: Float32Array, rate: number, from: number, to: number): number {
  let first = -1;
  let last = -1;
  let count = 0;
  for (let i = from + 1; i < to; i++) {
    if (x[i - 1] <= 0 && x[i] > 0) {
      if (first < 0) first = i;
      else count++;
      last = i;
    }
  }
  return count > 0 ? (count * rate) / (last - first) : 0;
}

describe('parsePSM (synthetic data)', () => {
  it('decodes patterns, samples and the playlist', () => {
    const data = buildPSM({
      channels: 2,
      rows: [[{ ch: 0, note: 0x40, ins: 0, vol: 95, fx: [Effect.Vibrato, 0x82] }], [{ ch: 1, fx: [Effect.SampleOffset, 0x00, 0x12, 0x00] }]],
      sample: square(32),
      loop: [0, 2048],
      pans: [-63, 63],
    });
    const m = parsePSM(data);
    expect(m.title).toBe('test song');
    expect(m.channels).toBe(2);
    expect(m.patterns).toHaveLength(1);
    const p = m.patterns[0];
    expect(p.rows).toBe(2);
    expect(Array.from(p.rowStart)).toEqual([0, 1, 2]);
    expect(p.note[0]).toBe(NOTE_BASE);
    expect(p.volume[0]).toBe(95);
    expect(p.effect[0]).toBe(Effect.Vibrato);
    expect(p.param[0]).toBe(0x82);
    expect(p.param[1]).toBe(0x1200); // 24-bit offset
    expect(m.samples[0].data.length).toBe(32 * 64);
    expect(m.samples[0].data[0]).toBe(100);
    expect(m.samples[0].data[20]).toBe(-100);
    expect(m.samples[0].loop).toBe(true);
    const song = m.songs[0];
    expect(song.orders).toEqual([0]);
    expect(song.restartOrder).toBe(0);
    expect(song.channelPanRaw).toEqual([-63, 63]);
  });

  it('keeps the previous parameter for effects without parameter bytes', () => {
    const m = parsePSM(buildPSM({ channels: 1, rows: [[{ ch: 0, fx: [Effect.SampleOffsetRepeat] }]], sample: square(32) }));
    expect(m.patterns[0].effect[0]).toBe(Effect.SampleOffsetRepeat);
    expect(m.patterns[0].param[0]).toBe(PARAM_NONE);
  });

  it('rejects malformed data with descriptive errors', () => {
    const good = buildPSM({ channels: 1, rows: [[{ ch: 0, note: 0x40, ins: 0 }]], sample: square(32) });
    expect(() => parsePSM(new Uint8Array(4))).toThrow(/too short/);
    expect(() => parsePSM(ascii('MThd\0\0\0\x06FILE0000'))).toThrow(/bad magic/);
    const truncated = good.slice(0, good.length - 50);
    expect(() => parsePSM(truncated)).toThrow(/PSM:/);
    const badFx = good.slice();
    // corrupt the effect-less event of row 0 into an unknown effect command
    const i = badFx.indexOf(0x40, 40); // the note byte 0x40 inside PBOD
    badFx[i - 2] = 0x10; // flags: effect only
    badFx[i] = 0x77; // unknown command
    expect(() => parsePSM(badFx)).toThrow(/PSM:/);
  });
});

describe('TrackerPlayer (synthetic data)', () => {
  const rate = 44100;

  it('plays notes at MASI pitch (note 0x40 = c5 speed, 0x50 one octave up)', () => {
    // 32-sample square at 8448 Hz => 264 Hz at the base note.
    const m = parsePSM(buildPSM({ channels: 1, rows: [[{ ch: 0, note: 0x40, ins: 0 }], [], [], [], [{ ch: 0, note: 0x50 }]], sample: square(32), loop: [0, 2048] }));
    const p = new TrackerPlayer(m, rate, { interpolation: 'linear' });
    const { L } = render(p, 0.9);
    const row = Math.round(rate * 0.12); // speed 6 at 125 BPM
    expect(zeroCrossingHz(L, rate, 1000, 4 * row - 1000)).toBeCloseTo(264, 0);
    expect(zeroCrossingHz(L, rate, 4 * row + 1000, 5 * row - 500)).toBeCloseTo(528, 0);
  });

  it('applies volume and the Sound Blaster driver pan law', () => {
    const m = parsePSM(buildPSM({ channels: 1, rows: [[{ ch: 0, note: 0x40, ins: 0, vol: 127 }], [], [], [{ ch: 0, vol: 63 }], [], []], sample: square(32), loop: [0, 2048], pans: [-63] }));
    const p = new TrackerPlayer(m, rate, { mixGain: 1 });
    const { L, R } = render(p, 0.75);
    const row = Math.round(rate * 0.12);
    const a = stats(L, 1000, 3 * row - 500);
    const b = stats(L, 3 * row + 1000, 6 * row - 500);
    const ar = stats(R, 1000, 3 * row - 500);
    expect(a.peak).toBeCloseTo((100 / 128) * 1, 2); // left = full level
    expect(ar.peak / a.peak).toBeCloseTo(64 / 128, 2); // right = (pan + 127) / 128
    expect(b.peak / a.peak).toBeCloseTo(63 / 127, 2);
  });

  it('renders identically regardless of block size and after reset()', () => {
    const rows: SynthEvent[][] = [];
    for (let r = 0; r < 16; r++) rows.push([{ ch: r & 1, note: 0x40 + (r % 7), ins: 0, fx: [Effect.Vibrato, 0x84] }]);
    const m = parsePSM(buildPSM({ channels: 2, rows, sample: square(20), loop: [0, 1280], pans: [-63, 63], tempo: 128 }));
    const a = render(new TrackerPlayer(m, rate), 2, 128);
    const b = render(new TrackerPlayer(m, rate), 2, 1000);
    expect(b.L).toEqual(a.L);
    expect(b.R).toEqual(a.R);
    const p = new TrackerPlayer(m, rate);
    render(p, 1.3);
    p.reset();
    expect(render(p, 2, 128).L).toEqual(a.L);
  });

  it('loops by default and stops with setLoop(false)', () => {
    const rows: SynthEvent[][] = [[{ ch: 0, note: 0x40, ins: 0 }]];
    for (let r = 1; r < 8; r++) rows.push([]);
    const m = parsePSM(buildPSM({ channels: 1, rows, sample: square(32), loop: [0, 2048] }));
    expect(measureSong(m).seconds).toBeCloseTo(8 * 0.12, 6);
    const looping = new TrackerPlayer(m, rate);
    const x = render(looping, 3);
    expect(looping.ended).toBe(false);
    expect(looping.loopCount).toBeGreaterThanOrEqual(2);
    expect(stats(x.L, rate * 2.5, rate * 3).rms).toBeGreaterThan(0.01);
    const once = new TrackerPlayer(m, rate);
    once.setLoop(false);
    const y = render(once, 3);
    expect(once.ended).toBe(true);
    expect(stats(y.L, rate * 1.5, rate * 3).peak).toBe(0);
  });

  it('mixes into (adds to) the output buffers', () => {
    const m = parsePSM(buildPSM({ channels: 1, rows: [[{ ch: 0, note: 0x40, ins: 0 }]], sample: square(32), loop: [0, 2048] }));
    const L = new Float32Array(256).fill(0.25);
    const R = new Float32Array(256).fill(0.25);
    const p = new TrackerPlayer(m, rate);
    p.setVolume(0);
    p.render(L, R, 0, 256);
    expect(Array.from(new Set(L))).toEqual([0.25]);
  });
});

describe.skipIf(!has)('One Must Fall 2097 music', () => {
  for (const name of SONGS) {
    describe(name, () => {
      const mod = has ? load(name) : (null as unknown as TrackerModule);
      const exp = EXPECTED[name];

      it('parses with sane invariants', () => {
        expect(mod.format).toBe('psm');
        expect(mod.title).toMatch(/One Must Fall!/);
        expect(mod.channels).toBe(exp.channels);
        expect(mod.patterns).toHaveLength(exp.patterns);
        expect(mod.samples).toHaveLength(31);
        const song = mod.songs[0];
        expect(mod.songs).toHaveLength(1);
        expect(song.orders.length).toBe(exp.patterns);
        expect(song.restartOrder).toBe(0);
        expect([song.initialSpeed, song.initialTempo]).toEqual([6, 125]);
        expect([song.restartSpeed, song.restartTempo]).toEqual([6, 125]);
        for (const o of song.orders) expect(o).toBeLessThan(mod.patterns.length);
        for (const p of song.channelPanRaw) expect(Math.abs(p)).toBe(63);
        for (const p of mod.patterns) {
          expect(p.rows).toBe(64);
          expect(p.rowStart[p.rows]).toBe(p.channel.length);
          for (let e = 0; e < p.channel.length; e++) {
            expect(p.channel[e]).toBeLessThan(mod.channels);
            if (p.mask[e] & 0x40) expect(mod.samples[p.instrument[e]].data.length).toBeGreaterThan(0);
          }
        }
        for (const s of mod.samples) {
          if (s.data.length === 0) continue;
          expect(s.c5Speed).toBe(8448);
          if (s.loop) {
            expect(s.loopStart).toBeLessThan(s.loopEnd);
            expect(s.loopEnd).toBeLessThanOrEqual(s.data.length);
          }
        }
      });

      it('matches the original MASI line processor tick for tick', () => {
        expect(driverHash(mod, 20000).toString(16)).toBe(exp.hash.toString(16));
      });

      it('has the expected song length', () => {
        const len = measureSong(mod);
        expect(len.loops).toBe(true);
        expect(len.seconds).toBeCloseTo(exp.seconds, 3);
      });

      it('renders finite, non-silent audio with headroom', () => {
        const p = new TrackerPlayer(mod, 44100);
        const { L, R } = render(p, 4);
        const l = stats(L);
        const r = stats(R);
        expect(l.finite && r.finite).toBe(true);
        expect(l.rms).toBeGreaterThan(0.01);
        expect(r.rms).toBeGreaterThan(0.01);
        expect(Math.max(l.peak, r.peak)).toBeLessThan(1);
        let diff = 0;
        for (let i = 0; i < L.length; i++) diff += Math.abs(L[i] - R[i]);
        expect(diff / L.length).toBeGreaterThan(1e-3); // stereo
        expect(p.row).toBeGreaterThan(0);
      });
    });
  }

  it('loops seamlessly past the end of a song (ARENA4)', () => {
    const mod = load('ARENA4');
    const p = new TrackerPlayer(mod, 22050);
    p.setInterpolation('cubic');
    const secs = EXPECTED.ARENA4.seconds;
    const { L } = render(p, secs + 3);
    expect(p.loopCount).toBe(1);
    expect(p.order).toBe(0);
    const around = stats(L, Math.round((secs - 1) * 22050), Math.round((secs + 3) * 22050));
    expect(around.finite).toBe(true);
    expect(around.rms).toBeGreaterThan(0.01);
  });
});
