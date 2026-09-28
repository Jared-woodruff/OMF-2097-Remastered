// Development aid: writes generated sprites as PNG files (Node only), with a preview palette for the three ramps.
import fs from 'node:fs';
import zlib from 'node:zlib';
import type { IndexedSprite } from '../raster';

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
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

/** Encodes RGBA pixels as a PNG file. */
export function writePng(file: string, w: number, h: number, rgba: Uint8Array): void {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', new Uint8Array())];
  fs.writeFileSync(file, Buffer.concat(parts));
}

/** Preview colors: ramp 0 steel blue, ramp 1 grey, ramp 2 orange (dark to light), other indices magenta. */
export function previewColor(i: number): [number, number, number] {
  if (i === 0) return [0, 0, 0];
  if (i >= 48) return [255, 0, 255];
  const bases: [number, number, number][] = [[70, 120, 220], [150, 150, 160], [240, 140, 40]];
  const base = bases[i >> 4];
  const t = (i & 15) / 15;
  const k = 0.15 + 0.85 * t;
  const hi = Math.max(0, t - 0.75) * 3;
  return [Math.min(255, base[0] * k + 255 * hi * 0.5), Math.min(255, base[1] * k + 255 * hi * 0.5), Math.min(255, base[2] * k + 255 * hi * 0.5)];
}

/** Preview colors from three base colors (tertiary, secondary, primary), ramps like the game's color choices. */
export function rampColors(colors: [number, number, number][]): (i: number) => [number, number, number] {
  return (i: number) => {
    if (i === 0) return [0, 0, 0];
    if (i >= 48) return previewColor(i);
    const base = colors[i >> 4];
    const t = (i & 15) / 15;
    const k = 0.06 + 1.05 * t;
    const hi = Math.max(0, t - 0.78) * 2.2;
    return [0, 1, 2].map((c) => Math.min(255, base[c] * k * (1 - hi) + 255 * hi)) as [number, number, number];
  };
}

/** Lays sprites out side by side on a dark background, zoomed (rows 1.2x, like a 4:3 display), feet on one line. */
export function writeSheet(file: string, sprites: IndexedSprite[], zoom = 3, gap = 6, colorOf = previewColor): void {
  const zy = Math.round(zoom * 1.2);
  const top = Math.max(...sprites.map((s) => -s.y)) + gap;
  const bottom = Math.max(0, ...sprites.map((s) => s.y + s.h)) + gap;
  const widths = sprites.map((s) => s.w + gap);
  const W = widths.reduce((a, b) => a + b, gap) * zoom;
  const H = (top + bottom) * zy;
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) rgba.set([24, 26, 34, 255], i * 4);
  // The floor line.
  for (let x = 0; x < W; x++) for (let dy = 0; dy < 2; dy++) rgba.set([60, 64, 80, 255], ((top * zy + dy) * W + x) * 4);
  let ox = gap;
  sprites.forEach((s, k) => {
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const v = s.data[y * s.w + x];
        if (!v) continue;
        const [r, g, b] = colorOf(v);
        const cy = (top + s.y + y) * zy, cx = (ox + x) * zoom;
        for (let dy = 0; dy < zy; dy++) {
          for (let dx = 0; dx < zoom; dx++) rgba.set([r, g, b, 255], ((cy + dy) * W + cx + dx) * 4);
        }
      }
    }
    ox += widths[k];
  });
  writePng(file, W, H, rgba);
}
