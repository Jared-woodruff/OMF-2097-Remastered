// PNG images, read and written without the browser's image decoder (so the game, OMF Studio and the tests share it):
// mod pilots' portraits, and art going in and out of OMF Studio. Indexed images keep their color indices both ways, so
// sprites exported with the game's palette come back pixel for pixel after editing in another program.
import { crc32 } from './zip';

export interface PngImage {
  w: number;
  h: number;
  /** Every pixel as RGBA. */
  rgba: Uint8Array;
  /** For indexed (palette) images: the indices, the palette (RGB) and the alpha of each palette entry. */
  indexed: { data: Uint8Array; palette: Uint8Array; alpha: Uint8Array } | null;
}

export class PngError extends Error {}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** zlib data: deflated when the platform can, else stored blocks. */
async function deflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'undefined') {
    try {
      const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      // stored below
    }
  }
  const blocks = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let p = 2;
  for (let b = 0; b < blocks; b++) {
    const part = data.subarray(b * 65535, Math.min(data.length, (b + 1) * 65535));
    out[p++] = b === blocks - 1 ? 1 : 0;
    out[p++] = part.length & 0xff;
    out[p++] = part.length >> 8;
    out[p++] = ~part.length & 0xff;
    out[p++] = (~part.length >> 8) & 0xff;
    out.set(part, p);
    p += part.length;
  }
  let a = 1, b2 = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b2 = (b2 + a) % 65521;
  }
  new DataView(out.buffer).setUint32(p, ((b2 << 16) | a) >>> 0);
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export async function decodePng(buf: Uint8Array): Promise<PngImage> {
  if (buf.length < 8 || SIGNATURE.some((v, i) => buf[i] !== v)) throw new PngError('This is not a PNG image.');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let w = 0, h = 0, depth = 0, color = -1, interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  for (let p = 8; p + 12 <= buf.length;) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = dv.getUint32(p + 8);
      h = dv.getUint32(p + 12);
      depth = data[8];
      color = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data.slice();
    else if (type === 'tRNS') trns = data.slice();
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
  if (!w || !h || !channels) throw new PngError('The PNG image is damaged.');
  if (interlace) throw new PngError('Interlaced PNG images are not supported: save it without interlacing.');
  if (w * h > 4096 * 4096) throw new PngError('The image is too big.');
  if (color === 3 && !palette) throw new PngError('The PNG image is damaged (no palette).');
  const joined = new Uint8Array(idat.reduce((a, d) => a + d.length, 0));
  let o = 0;
  for (const d of idat) {
    joined.set(d, o);
    o += d.length;
  }
  let raw: Uint8Array;
  try {
    raw = await inflate(joined);
  } catch {
    throw new PngError('The PNG image is damaged.');
  }
  const bitsPerPixel = depth * channels;
  const stride = Math.ceil((w * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  if (raw.length < (stride + 1) * h) throw new PngError('The PNG image is damaged.');
  // Undo the filters, row by row.
  const rows = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = rows.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev ? prev[i] : 0, c = prev && i >= bpp ? prev[i - bpp] : 0;
      const x = src[i];
      cur[i] = (f === 1 ? x + a : f === 2 ? x + b : f === 3 ? x + ((a + b) >> 1) : f === 4 ? x + paeth(a, b, c) : x) & 0xff;
    }
  }
  // A sample (the high byte of 16-bit ones; small ones as they are).
  const sample = (y: number, x: number, ch: number): number => {
    const bit = (x * channels + ch) * depth;
    const row = y * stride;
    if (depth === 8) return rows[row + (bit >> 3)];
    if (depth === 16) return rows[row + (bit >> 3)];
    return (rows[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1;
  const rgba = new Uint8Array(w * h * 4);
  let indexed: PngImage['indexed'] = null;
  if (color === 3) {
    const n = palette!.length / 3;
    const alpha = new Uint8Array(256).fill(255);
    if (trns) alpha.set(trns.subarray(0, 256));
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = sample(y, x, 0);
        data[y * w + x] = v;
        const q = (y * w + x) * 4;
        if (v < n) {
          rgba[q] = palette![v * 3];
          rgba[q + 1] = palette![v * 3 + 1];
          rgba[q + 2] = palette![v * 3 + 2];
          rgba[q + 3] = alpha[v];
        }
      }
    }
    const pal = new Uint8Array(768);
    pal.set(palette!.subarray(0, 768));
    indexed = { data, palette: pal, alpha };
  } else {
    // (a tRNS chunk of grey or RGB images names the one transparent color)
    const greyKey = color === 0 && trns && trns.length >= 2 ? (depth === 16 ? trns[0] : trns[1]) : -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const q = (y * w + x) * 4;
        if (color === 0 || color === 4) {
          const v = sample(y, x, 0);
          const g = Math.round(v * scale);
          rgba[q] = rgba[q + 1] = rgba[q + 2] = g;
          rgba[q + 3] = color === 4 ? sample(y, x, 1) : v === greyKey ? 0 : 255;
        } else {
          rgba[q] = sample(y, x, 0);
          rgba[q + 1] = sample(y, x, 1);
          rgba[q + 2] = sample(y, x, 2);
          rgba[q + 3] = color === 6 ? sample(y, x, 3) : 255;
          if (color === 2 && trns && trns.length >= 6) {
            const tr = depth === 16 ? trns[0] : trns[1], tg = depth === 16 ? trns[2] : trns[3], tb = depth === 16 ? trns[4] : trns[5];
            if (rgba[q] === tr && rgba[q + 1] === tg && rgba[q + 2] === tb) rgba[q + 3] = 0;
          }
        }
      }
    }
  }
  return { w, h, rgba, indexed };
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function header(w: number, h: number, color: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, color, 0, 0, 0], 8);
  return chunk('IHDR', ihdr);
}

/** An RGBA image as a PNG file. */
export async function encodePng(w: number, h: number, rgba: Uint8Array): Promise<Uint8Array> {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  return join([new Uint8Array(SIGNATURE), header(w, h, 6), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array())]);
}

/**
 * An indexed image as a PNG file with its palette (256 RGB entries); `transparent` is the index shown see-through
 * (-1: none). Paint programs keep the indices when they edit it.
 */
export async function encodeIndexedPng(w: number, h: number, data: Uint8Array, palette: Uint8Array, transparent = -1): Promise<Uint8Array> {
  const raw = new Uint8Array((w + 1) * h);
  for (let y = 0; y < h; y++) raw.set(data.subarray(y * w, (y + 1) * w), y * (w + 1) + 1);
  const parts = [new Uint8Array(SIGNATURE), header(w, h, 3), chunk('PLTE', palette.subarray(0, 768))];
  if (transparent >= 0 && transparent < 256) {
    const t = new Uint8Array(transparent + 1).fill(255);
    t[transparent] = 0;
    parts.push(chunk('tRNS', t));
  }
  parts.push(chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array()));
  return join(parts);
}
