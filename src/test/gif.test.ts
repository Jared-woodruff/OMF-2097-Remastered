// The GIF encoder of replay clips: frames decode back to the pictures that went in (exactly when a frame has few
// colors, closely when it is quantized), unchanged frames are merged, and frame times become delays.
import { describe, expect, it } from 'vitest';
import { GifBytes, GifEncoder, lzwEncode } from '../platform/gif';

/** GIF LZW decoding of one image's data sub-blocks (after the minimum code size byte). */
function lzwDecode(data: Uint8Array, minCodeSize: number, count: number): Uint8Array {
  const out = new Uint8Array(count);
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let size = minCodeSize + 1;
  let dict: number[][] = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict.push([i]);
    dict.push([], []);
    size = minCodeSize + 1;
  };
  reset();
  let bitPos = 0;
  const read = () => {
    let v = 0;
    for (let i = 0; i < size; i++, bitPos++) v |= ((data[bitPos >> 3] >> (bitPos & 7)) & 1) << i;
    return v;
  };
  let n = 0;
  let prev: number[] | null = null;
  for (;;) {
    const code = read();
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry: number[];
    if (code < dict.length) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error('bad code');
    for (const v of entry) out[n++] = v;
    if (prev) {
      dict.push([...prev, entry[0]]);
      if (dict.length === 1 << size && size < 12) size++;
    }
    prev = entry;
  }
  expect(n).toBe(count);
  return out;
}

interface Decoded {
  width: number;
  height: number;
  frames: { rgb: Uint8Array; delay: number }[];
  loops: boolean;
}

/** A small GIF decoder: composes every frame (disposal "do not dispose", transparency) to RGB. */
function decodeGif(b: Uint8Array): Decoded {
  let p = 0;
  const u8 = () => b[p++];
  const u16 = () => b[p++] | (b[p++] << 8);
  const text = (n: number) => String.fromCharCode(...b.subarray(p, (p += n)));
  expect(text(6)).toBe('GIF89a');
  const width = u16(), height = u16();
  const flags = u8();
  u8();
  u8();
  expect(flags & 0x80).toBe(0);
  const screen = new Uint8Array(width * height * 3);
  const frames: Decoded['frames'] = [];
  let delay = 0, transparent = -1, loops = false;
  const subBlocks = () => {
    const parts: number[] = [];
    for (let len = u8(); len; len = u8()) for (let i = 0; i < len; i++) parts.push(u8());
    return new Uint8Array(parts);
  };
  for (;;) {
    const t = u8();
    if (t === 0x3b) break;
    if (t === 0x21) {
      const label = u8();
      if (label === 0xf9) {
        expect(u8()).toBe(4);
        const f = u8();
        delay = u16();
        const ti = u8();
        transparent = f & 1 ? ti : -1;
        u8();
      } else if (label === 0xff) {
        const len = u8();
        loops = text(len) === 'NETSCAPE2.0';
        subBlocks();
      } else {
        subBlocks();
      }
      continue;
    }
    expect(t).toBe(0x2c);
    const x = u16(), y = u16(), w = u16(), h = u16();
    const f = u8();
    expect(f & 0x80).toBe(0x80);
    const size = 1 << ((f & 7) + 1);
    const table = b.subarray(p, (p += size * 3));
    const minCode = u8();
    const indices = lzwDecode(subBlocks(), minCode, w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const idx = indices[j * w + i];
        if (idx === transparent) continue;
        const o = ((y + j) * width + x + i) * 3;
        screen[o] = table[idx * 3];
        screen[o + 1] = table[idx * 3 + 1];
        screen[o + 2] = table[idx * 3 + 2];
      }
    }
    frames.push({ rgb: screen.slice(), delay });
  }
  return { width, height, frames, loops };
}

function rgbOf(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0; i < rgba.length / 4; i++) out.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
  return out;
}

describe('GIF encoder', () => {
  it('LZW round trip for long, repetitive and noisy data', () => {
    let r = 1;
    for (const [len, bits, noisy] of [[1, 2, false], [5000, 8, true], [200000, 8, true], [100000, 3, false], [70000, 1, true]] as const) {
      const data = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        r = (Math.imul(r, 1103515245) + 12345) >>> 0;
        data[i] = noisy ? (r >>> 16) & ((1 << bits) - 1) : Math.floor(i / 37) % (1 << bits);
      }
      const out = new GifBytes();
      lzwEncode(data, Math.max(2, bits), out);
      const bytes = out.result();
      const min = bytes[0];
      // Strip the sub-block framing.
      const payload: number[] = [];
      let p = 1;
      for (let n = bytes[p++]; n; n = bytes[p++]) for (let i = 0; i < n; i++) payload.push(bytes[p++]);
      expect(p).toBe(bytes.length);
      expect(Array.from(lzwDecode(new Uint8Array(payload), min, len))).toEqual(Array.from(data));
    }
  });

  it('frames with few colors come back exactly, with only the changes written', () => {
    const w = 64, h = 40;
    const frame = (t: number) => {
      const rgba = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          // A striped background and a moving square.
          const inBox = x >= 10 + t * 3 && x < 20 + t * 3 && y >= 12 && y < 22;
          const c = inBox ? [250, 40, 30] : (x + y) % 8 < 4 ? [20, 30, 90] : [200, 200, 210];
          rgba.set([...c, 255], i);
        }
      }
      return rgba;
    };
    const enc = new GifEncoder(w, h);
    const inputs = [0, 1, 1, 2, 3].map(frame);
    inputs.forEach((f, k) => enc.addFrame(f, k * 40));
    const gif = decodeGif(enc.finish(200));
    expect(gif.loops).toBe(true);
    expect([gif.width, gif.height]).toEqual([w, h]);
    // The third frame repeats the second: merged into it (shown twice as long).
    expect(gif.frames.length).toBe(4);
    expect(gif.frames.map((f) => f.delay)).toEqual([4, 8, 4, 4]);
    const expected = [inputs[0], inputs[1], inputs[3], inputs[4]];
    gif.frames.forEach((f, k) => expect(Array.from(f.rgb)).toEqual(Array.from(rgbOf(expected[k]))));
  });

  it('frames with many colors are close to the source', () => {
    const w = 96, h = 64;
    const enc = new GifEncoder(w, h);
    const frames: Uint8Array[] = [];
    for (let t = 0; t < 3; t++) {
      const rgba = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          rgba.set([(x * 255) / w, (y * 255) / h, ((x + y + t * 20) * 3) & 255, 255], (y * w + x) * 4);
        }
      }
      frames.push(rgba);
      enc.addFrame(rgba, t * 50);
    }
    const gif = decodeGif(enc.finish(150));
    expect(gif.frames.length).toBe(3);
    gif.frames.forEach((f, k) => {
      const src = rgbOf(frames[k]);
      let err = 0;
      for (let i = 0; i < src.length; i++) err += Math.abs(src[i] - f.rgb[i]);
      // Average error per channel (the tolerance for unchanged pixels and the 255 color palette).
      expect(err / src.length).toBeLessThan(6);
    });
  });
});
