// Animated GIF encoding for replay clips (clipExport.ts, in a worker: gifWorker.ts). Only the pixels that changed since
// the frame before are written, cropped to the area that changed (the rest is transparent and shows the frame before);
// each frame gets its own palette of up to 255 colors: the exact colors when there are few enough (the classic graphics
// have at most 256), else a median cut of the changed pixels. The image data is LZW-compressed as GIF requires.

class Bytes {
  buf = new Uint8Array(1 << 16);
  len = 0;

  private room(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const b = new Uint8Array(size);
    b.set(this.buf.subarray(0, this.len));
    this.buf = b;
  }

  byte(v: number): void {
    this.room(1);
    this.buf[this.len++] = v;
  }

  u16(v: number): void {
    this.room(2);
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >> 8) & 0xff;
  }

  bytes(b: Uint8Array): void {
    this.room(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }

  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

// LZW dictionary: (prefix code << 8 | index) -> code, valid when its stamp is the current generation (no clearing).
const dictCodes = new Uint16Array(1 << 20);
const dictStamps = new Uint32Array(1 << 20);
let dictGen = 0;

/** Writes `indices` as GIF image data: the LZW minimum code size and the data sub-blocks with their terminator. */
export function lzwEncode(indices: Uint8Array, minCodeSize: number, out: Bytes): void {
  out.byte(minCodeSize);
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let next = eoi + 1;
  let size = minCodeSize + 1;
  const block = new Uint8Array(255);
  let blockLen = 0;
  let acc = 0;
  let bits = 0;
  const emit = (code: number) => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) {
      block[blockLen++] = acc & 0xff;
      acc >>>= 8;
      bits -= 8;
      if (blockLen === 255) {
        out.byte(255);
        out.bytes(block);
        blockLen = 0;
      }
    }
  };
  const newTable = () => {
    dictGen = (dictGen + 1) >>> 0;
    if (dictGen === 0) {
      dictStamps.fill(0);
      dictGen = 1;
    }
  };
  newTable();
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    if (dictStamps[key] === dictGen) {
      prefix = dictCodes[key];
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      // Table full: start a new one.
      emit(clear);
      next = eoi + 1;
      size = minCodeSize + 1;
      newTable();
    } else {
      if (next >= 1 << size) size++;
      dictCodes[key] = next++;
      dictStamps[key] = dictGen;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) {
    block[blockLen++] = acc & 0xff;
    if (blockLen === 255) {
      out.byte(255);
      out.bytes(block);
      blockLen = 0;
    }
  }
  if (blockLen > 0) {
    out.byte(blockLen);
    out.bytes(block.subarray(0, blockLen));
  }
  out.byte(0);
}

/**
 * A palette of at most `max` colors for the given 15-bit color histogram (median cut); returns the colors (RGB) and
 * each used histogram bin's palette index.
 */
export function medianCut(hist: Uint32Array, sums: Float64Array, max: number): { colors: number[]; binIndex: Uint16Array } {
  const bins: number[] = [];
  for (let k = 0; k < hist.length; k++) if (hist[k]) bins.push(k);
  const binIndex = new Uint16Array(hist.length);
  const chan = (k: number, c: number) => (k >> (10 - c * 5)) & 31;
  interface Box { lo: number; hi: number; count: number; axis: number; range: number }
  const order = bins;
  const makeBox = (lo: number, hi: number): Box => {
    const mn = [31, 31, 31], mx = [0, 0, 0];
    let count = 0;
    for (let i = lo; i < hi; i++) {
      const k = order[i];
      count += hist[k];
      for (let c = 0; c < 3; c++) {
        const v = chan(k, c);
        if (v < mn[c]) mn[c] = v;
        if (v > mx[c]) mx[c] = v;
      }
    }
    // Green counts a little more, blue a little less (the eye's sensitivity).
    const r = [(mx[0] - mn[0]) * 1.0, (mx[1] - mn[1]) * 1.2, (mx[2] - mn[2]) * 0.8];
    const axis = r[0] >= r[1] && r[0] >= r[2] ? 0 : r[1] >= r[2] ? 1 : 2;
    return { lo, hi, count, axis, range: r[axis] };
  };
  const boxes: Box[] = bins.length ? [makeBox(0, bins.length)] : [];
  while (boxes.length < max) {
    let best = -1, bestScore = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.hi - b.lo < 2 || b.range === 0) continue;
      const score = b.range * Math.sqrt(b.count);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break;
    const b = boxes[best];
    const sub = order.slice(b.lo, b.hi).sort((x, y) => chan(x, b.axis) - chan(y, b.axis));
    for (let i = 0; i < sub.length; i++) order[b.lo + i] = sub[i];
    // Split at the median pixel, keeping at least one bin on each side.
    let acc = 0, cut = b.lo + 1;
    for (let i = b.lo; i < b.hi - 1; i++) {
      acc += hist[order[i]];
      cut = i + 1;
      if (acc * 2 >= b.count) break;
    }
    boxes[best] = makeBox(b.lo, cut);
    boxes.push(makeBox(cut, b.hi));
  }
  const colors: number[] = [];
  boxes.forEach((b, idx) => {
    let r = 0, g = 0, bl = 0, n = 0;
    for (let i = b.lo; i < b.hi; i++) {
      const k = order[i];
      r += sums[k * 3];
      g += sums[k * 3 + 1];
      bl += sums[k * 3 + 2];
      n += hist[k];
      binIndex[k] = idx;
    }
    colors.push(n ? Math.round(r / n) : 0, n ? Math.round(g / n) : 0, n ? Math.round(bl / n) : 0);
  });
  return { colors, binIndex };
}

interface PendingFrame {
  data: Uint8Array;
  time: number;
  transparent: number;
}

export class GifEncoder {
  private out = new Bytes();
  /** The source color of each pixel when it was last written (RGB). */
  private ref: Uint8Array;
  private first = true;
  private pending: PendingFrame | null = null;
  private hist = new Uint32Array(32768);
  private sums = new Float64Array(32768 * 3);

  /** `tolerance`: a pixel whose color moved less than this (per channel) since it was written is left as it is. */
  constructor(readonly width: number, readonly height: number, private tolerance = 3) {
    this.ref = new Uint8Array(width * height * 3);
    const o = this.out;
    o.ascii('GIF89a');
    o.u16(width);
    o.u16(height);
    o.byte(0x70); // no global color table, 8 bit color resolution
    o.byte(0);
    o.byte(0);
    // Loop forever.
    o.byte(0x21);
    o.byte(0xff);
    o.byte(11);
    o.ascii('NETSCAPE2.0');
    o.byte(3);
    o.byte(1);
    o.u16(0);
    o.byte(0);
  }

  /** Adds a frame (RGBA, width x height) shown from `timeMs`; frames without changes only lengthen the one before. */
  addFrame(rgba: Uint8Array | Uint8ClampedArray, timeMs: number): void {
    const frame = this.encode(rgba);
    if (!frame) return;
    this.flush(timeMs);
    this.pending = { ...frame, time: timeMs };
  }

  /** Ends the animation at `endMs`; returns the file. */
  finish(endMs: number): Uint8Array {
    if (this.pending) this.flush(Math.max(endMs, this.pending.time + 20));
    this.out.byte(0x3b);
    return this.out.result();
  }

  private flush(nextTime: number): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    const o = this.out;
    const delay = Math.max(2, Math.round(nextTime / 10) - Math.round(p.time / 10));
    o.byte(0x21);
    o.byte(0xf9);
    o.byte(4);
    o.byte((1 << 2) | (p.transparent >= 0 ? 1 : 0)); // do not dispose: the next frame draws over this one
    o.u16(Math.min(0xffff, delay));
    o.byte(Math.max(0, p.transparent));
    o.byte(0);
    o.bytes(p.data);
  }

  /** The image block (descriptor, color table, LZW data) of what changed, or null when nothing did. */
  private encode(rgba: Uint8Array | Uint8ClampedArray): { data: Uint8Array; transparent: number } | null {
    const { width: w, height: h, ref, tolerance: tol } = this;
    const changed = new Uint8Array(w * h);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
        if (!this.first && Math.abs(r - ref[i * 3]) <= tol && Math.abs(g - ref[i * 3 + 1]) <= tol && Math.abs(b - ref[i * 3 + 2]) <= tol) continue;
        changed[i] = 1;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return null;
    const first = this.first;
    this.first = false;
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;

    // The changed pixels' colors: exact when there are few, else a median cut.
    const exact = new Map<number, number>();
    let overflow = false;
    for (let y = y0; y <= y1 && !overflow; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        if (!changed[i]) continue;
        const c = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];
        if (exact.has(c)) continue;
        if (exact.size === 255) {
          overflow = true;
          break;
        }
        exact.set(c, exact.size);
      }
    }
    let colors: number[];
    let lookup: (i: number) => number;
    if (!overflow) {
      colors = [];
      for (const c of exact.keys()) colors.push((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff);
      lookup = (i) => exact.get((rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2])!;
    } else {
      const { hist, sums } = this;
      hist.fill(0);
      sums.fill(0);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * w + x;
          if (!changed[i]) continue;
          const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
          const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
          hist[k]++;
          sums[k * 3] += r;
          sums[k * 3 + 1] += g;
          sums[k * 3 + 2] += b;
        }
      }
      const cut = medianCut(hist, sums, 255);
      colors = cut.colors;
      lookup = (i) => cut.binIndex[((rgba[i * 4] >> 3) << 10) | ((rgba[i * 4 + 1] >> 3) << 5) | (rgba[i * 4 + 2] >> 3)];
    }
    const n = colors.length / 3;
    const transparent = first ? -1 : n;
    const bits = Math.max(1, Math.ceil(Math.log2(n + (first ? 0 : 1))));
    const indices = new Uint8Array(cw * ch);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        const j = (y - y0) * cw + (x - x0);
        if (!changed[i]) {
          indices[j] = transparent;
          continue;
        }
        indices[j] = lookup(i);
        ref[i * 3] = rgba[i * 4];
        ref[i * 3 + 1] = rgba[i * 4 + 1];
        ref[i * 3 + 2] = rgba[i * 4 + 2];
      }
    }
    const o = new Bytes();
    o.byte(0x2c);
    o.u16(x0);
    o.u16(y0);
    o.u16(cw);
    o.u16(ch);
    o.byte(0x80 | (bits - 1)); // local color table of 2^bits entries
    for (let c = 0; c < 1 << bits; c++) {
      o.byte(colors[c * 3] ?? 0);
      o.byte(colors[c * 3 + 1] ?? 0);
      o.byte(colors[c * 3 + 2] ?? 0);
    }
    lzwEncode(indices, Math.max(2, bits), o);
    return { data: o.result(), transparent };
  }
}

export { Bytes as GifBytes };
