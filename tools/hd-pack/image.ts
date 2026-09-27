// Small RGBA image toolkit for the HD asset pack (Node): indexed -> RGBA, padding, resampling, sheets, PNG.
import zlib from 'node:zlib';

export interface Rgba {
  w: number;
  h: number;
  data: Uint8Array;
}

export function newImage(w: number, h: number): Rgba {
  return { w, h, data: new Uint8Array(w * h * 4) };
}

/** Renders palette indices to RGBA (the transparent index becomes alpha 0). */
export function indexedToRgba(w: number, h: number, px: Uint8Array, pal: Uint8Array, transparent: number): Rgba {
  const img = newImage(w, h);
  for (let i = 0; i < w * h; i++) {
    const c = px[i];
    if (c === transparent) continue;
    img.data[i * 4] = pal[c * 3];
    img.data[i * 4 + 1] = pal[c * 3 + 1];
    img.data[i * 4 + 2] = pal[c * 3 + 2];
    img.data[i * 4 + 3] = 255;
  }
  return img;
}

export function pad(src: Rgba, p: number): Rgba {
  const out = newImage(src.w + p * 2, src.h + p * 2);
  blit(out, src, p, p);
  return out;
}

/** Copies src into dst at (x, y), with alpha blending over what is there. */
export function blit(dst: Rgba, src: Rgba, x: number, y: number): void {
  for (let j = 0; j < src.h; j++) {
    const dy = y + j;
    if (dy < 0 || dy >= dst.h) continue;
    for (let i = 0; i < src.w; i++) {
      const dx = x + i;
      if (dx < 0 || dx >= dst.w) continue;
      const s = (j * src.w + i) * 4;
      const a = src.data[s + 3];
      if (a === 0) continue;
      const d = (dy * dst.w + dx) * 4;
      if (a === 255) {
        dst.data.set(src.data.subarray(s, s + 4), d);
      } else {
        const k = a / 255;
        for (let c = 0; c < 3; c++) dst.data[d + c] = Math.round(src.data[s + c] * k + dst.data[d + c] * (1 - k));
        dst.data[d + 3] = Math.max(dst.data[d + 3], a);
      }
    }
  }
}

export function fill(img: Rgba, r: number, g: number, b: number, a = 255): void {
  for (let i = 0; i < img.w * img.h; i++) img.data.set([r, g, b, a], i * 4);
}

function cubic(t: number): number {
  const x = Math.abs(t);
  if (x < 1) return (1.5 * x - 2.5) * x * x + 1;
  if (x < 2) return ((-0.5 * x + 2.5) * x - 4) * x + 2;
  return 0;
}

/**
 * Catmull-Rom resize (separable) with premultiplied alpha. Used for the aspect-correct guides: sources have
 * non-square pixels (320x200 shown at 4:3), guides are square-pixel at the target size.
 */
export function resizeCubic(src: Rgba, W: number, H: number): Rgba {
  // Premultiply into floats.
  const n = src.w * src.h;
  const pm = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = src.data[i * 4 + 3] / 255;
    pm[i * 4] = src.data[i * 4] * a;
    pm[i * 4 + 1] = src.data[i * 4 + 1] * a;
    pm[i * 4 + 2] = src.data[i * 4 + 2] * a;
    pm[i * 4 + 3] = a;
  }
  const pass = (inp: Float32Array, iw: number, ih: number, ow: number, horizontal: boolean): Float32Array => {
    const oh = horizontal ? ih : ow;
    const outW = horizontal ? ow : iw;
    const out = new Float32Array(outW * oh * 4);
    const len = horizontal ? iw : ih;
    const scale = len / ow;
    for (let o = 0; o < ow; o++) {
      const center = (o + 0.5) * scale - 0.5;
      const base = Math.floor(center);
      const w: number[] = [];
      const idx: number[] = [];
      let wsum = 0;
      for (let k = -1; k <= 2; k++) {
        const wt = cubic(center - (base + k));
        w.push(wt);
        idx.push(Math.min(len - 1, Math.max(0, base + k)));
        wsum += wt;
      }
      for (let k = 0; k < 4; k++) w[k] /= wsum;
      const lines = horizontal ? ih : iw;
      for (let l = 0; l < lines; l++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let k = 0; k < 4; k++) {
          const si = horizontal ? (l * iw + idx[k]) * 4 : (idx[k] * iw + l) * 4;
          r += inp[si] * w[k];
          g += inp[si + 1] * w[k];
          b += inp[si + 2] * w[k];
          a += inp[si + 3] * w[k];
        }
        const di = horizontal ? (l * ow + o) * 4 : (o * iw + l) * 4;
        out[di] = r;
        out[di + 1] = g;
        out[di + 2] = b;
        out[di + 3] = a;
      }
    }
    return out;
  };
  const h1 = pass(pm, src.w, src.h, W, true);
  const v1 = pass(h1, W, src.h, H, false);
  const out = newImage(W, H);
  for (let i = 0; i < W * H; i++) {
    const a = Math.min(1, Math.max(0, v1[i * 4 + 3]));
    if (a < 1 / 255) continue;
    out.data[i * 4] = Math.round(Math.min(255, Math.max(0, v1[i * 4] / a)));
    out.data[i * 4 + 1] = Math.round(Math.min(255, Math.max(0, v1[i * 4 + 1] / a)));
    out.data[i * 4 + 2] = Math.round(Math.min(255, Math.max(0, v1[i * 4 + 2] / a)));
    out.data[i * 4 + 3] = Math.round(a * 255);
  }
  return out;
}

/** Nearest-neighbor scale by integer factors. */
export function scaleNearest(src: Rgba, sx: number, sy: number): Rgba {
  const out = newImage(src.w * sx, src.h * sy);
  for (let y = 0; y < out.h; y++) {
    const srow = Math.floor(y / sy) * src.w;
    for (let x = 0; x < out.w; x++) {
      const s = (srow + Math.floor(x / sx)) * 4;
      out.data.set(src.data.subarray(s, s + 4), (y * out.w + x) * 4);
    }
  }
  return out;
}

// ---- PNG ------------------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function encodePng(img: Rgba, opaque = false): Buffer {
  const channels = opaque ? 3 : 4;
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  const stride = img.w * channels + 1;
  const raw = Buffer.alloc(stride * img.h);
  for (let y = 0; y < img.h; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < img.w; x++) {
      const s = (y * img.w + x) * 4;
      const d = y * stride + 1 + x * channels;
      raw[d] = img.data[s];
      raw[d + 1] = img.data[s + 1];
      raw[d + 2] = img.data[s + 2];
      if (!opaque) raw[d + 3] = img.data[s + 3];
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
