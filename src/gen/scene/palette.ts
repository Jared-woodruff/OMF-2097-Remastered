// Turns a rendered arena into the game's indexed format: 64 colors of its own (palette entries 0x60..0x9F) chosen by
// k-means alongside the colors every arena shares (0xA0..0xF9, taken as they are), a light ordered dither, and the
// remap tables (shadows, glows, tints) computed for the new colors the way the original arenas' tables map theirs.
import { color6to8, Palette, RemapTables, REMAP_COUNT } from '../../formats/palette';
import { fitRemapMatrix } from '../../video/hd/analysis';
import type { RenderedImage } from './render';

/** The arena's own palette entries. */
export const OWN_FIRST = 0x60;
export const OWN_COUNT = 0x40;
/** Entries a background may use: its own and the shared effect colors (not the players' 0x00..0x5F, not the menu's). */
export const USABLE_FIRST = 0x60;
export const USABLE_LAST = 0xf9;

/** Perceptual-ish weighted distance between two colors. */
function dist(r: number, g: number, b: number, pr: number, pg: number, pb: number): number {
  const dr = r - pr, dg = g - pg, db = b - pb;
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
}

/** A 6-bit VGA color as the game shows it (the palette is stored with 6 bits per channel). */
const vga = (c: number) => color6to8(Math.max(0, Math.min(63, Math.round(c / 4))));

/**
 * Picks the arena's 64 colors for images rendered with it (k-means with the shared colors of `base` held fixed) and
 * returns the palette: `base` with entries 0x60..0x9F replaced.
 */
export function choosePalette(images: RenderedImage[], base: Palette, iterations = 14): Palette {
  // Samples: every other pixel of every image.
  const samples: number[] = [];
  for (const img of images) for (let i = 0; i < img.w * img.h; i += 2) samples.push(img.rgb[i * 3], img.rgb[i * 3 + 1], img.rgb[i * 3 + 2]);
  const n = samples.length / 3;
  const fixed: number[] = [];
  for (let i = USABLE_FIRST + OWN_COUNT; i <= USABLE_LAST; i++) fixed.push(base.r(i), base.g(i), base.b(i));
  // Start from colors spread over the samples (brightness-sorted picks).
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => samples[a * 3] + samples[a * 3 + 1] * 2 + samples[a * 3 + 2] - (samples[b * 3] + samples[b * 3 + 1] * 2 + samples[b * 3 + 2]));
  const own = new Float64Array(OWN_COUNT * 3);
  for (let k = 0; k < OWN_COUNT; k++) {
    const s = order[Math.floor(((k + 0.5) / OWN_COUNT) * n)];
    own.set([samples[s * 3], samples[s * 3 + 1], samples[s * 3 + 2]], k * 3);
  }
  const fixedCount = fixed.length / 3;
  const assign = new Int32Array(n);
  for (let it = 0; it < iterations; it++) {
    const sum = new Float64Array(OWN_COUNT * 3), cnt = new Float64Array(OWN_COUNT);
    for (let i = 0; i < n; i++) {
      const r = samples[i * 3], g = samples[i * 3 + 1], b = samples[i * 3 + 2];
      let best = -1, bestD = Infinity;
      for (let k = 0; k < OWN_COUNT; k++) {
        const d = dist(r, g, b, own[k * 3], own[k * 3 + 1], own[k * 3 + 2]);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      for (let k = 0; k < fixedCount; k++) {
        const d = dist(r, g, b, fixed[k * 3], fixed[k * 3 + 1], fixed[k * 3 + 2]);
        if (d < bestD) {
          bestD = d;
          best = -1;
        }
      }
      assign[i] = best;
      if (best >= 0) {
        sum[best * 3] += r;
        sum[best * 3 + 1] += g;
        sum[best * 3 + 2] += b;
        cnt[best]++;
      }
    }
    for (let k = 0; k < OWN_COUNT; k++) {
      if (cnt[k] > 0) {
        own[k * 3] = sum[k * 3] / cnt[k];
        own[k * 3 + 1] = sum[k * 3 + 1] / cnt[k];
        own[k * 3 + 2] = sum[k * 3 + 2] / cnt[k];
      } else {
        // An unused color moves to a random sample, where it may help.
        const s = Math.floor(((k * 7919 + it * 104729) % n));
        own.set([samples[s * 3], samples[s * 3 + 1], samples[s * 3 + 2]], k * 3);
      }
    }
  }
  // Sorted dark to bright (tidier palette, stable output).
  const idx = Array.from({ length: OWN_COUNT }, (_, k) => k).sort((a, b) =>
    own[a * 3] * 0.3 + own[a * 3 + 1] * 0.59 + own[a * 3 + 2] * 0.11 - (own[b * 3] * 0.3 + own[b * 3 + 1] * 0.59 + own[b * 3 + 2] * 0.11));
  const pal = base.clone();
  idx.forEach((k, i) => pal.set(OWN_FIRST + i, vga(own[k * 3]), vga(own[k * 3 + 1]), vga(own[k * 3 + 2])));
  return pal;
}

/** 4x4 Bayer matrix (0..15). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Maps an image to the nearest usable palette entries, with an ordered dither of +-`dither` levels. */
export function indexImage(img: RenderedImage, pal: Palette, dither = 5): Uint8Array {
  const out = new Uint8Array(img.w * img.h);
  const cache = new Map<number, number>();
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const i = y * img.w + x;
      const o = ((BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * 2 * dither;
      const r = Math.max(0, Math.min(255, img.rgb[i * 3] + o));
      const g = Math.max(0, Math.min(255, img.rgb[i * 3 + 1] + o));
      const b = Math.max(0, Math.min(255, img.rgb[i * 3 + 2] + o));
      const key = ((r >> 1) << 14) | ((g >> 1) << 7) | (b >> 1);
      let best = cache.get(key);
      if (best === undefined) {
        let bestD = Infinity;
        best = USABLE_FIRST;
        for (let k = USABLE_FIRST; k <= USABLE_LAST; k++) {
          const d = dist(r, g, b, pal.r(k), pal.g(k), pal.b(k));
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        }
        cache.set(key, best);
      }
      out[i] = best;
    }
  }
  return out;
}

/**
 * Remap tables for an arena palette: each table of the reference arena (ARENA0) fitted as a color transform and
 * applied to this palette's colors, then the nearest usable entry. Rows 0x00..0x5F (the robots' colors) are left to
 * the reference arena's tables, which the game copies in when it loads the arena.
 */
export function buildRemaps(pal: Palette, refPal: Palette, refRemaps: RemapTables): RemapTables {
  const out = new RemapTables();
  for (let t = 0; t < REMAP_COUNT; t++) {
    const m = fitRemapMatrix(refPal, refRemaps.tables[t]);
    const table = out.tables[t];
    for (let i = OWN_FIRST; i < 0x100; i++) {
      if (i > USABLE_LAST) {
        table[i] = refRemaps.tables[t][i];
        continue;
      }
      const c = [pal.r(i) / 255, pal.g(i) / 255, pal.b(i) / 255];
      const tr = (m[0] * c[0] + m[1] * c[1] + m[2] * c[2] + m[3]) * 255;
      const tg = (m[4] * c[0] + m[5] * c[1] + m[6] * c[2] + m[7]) * 255;
      const tb = (m[8] * c[0] + m[9] * c[1] + m[10] * c[2] + m[11]) * 255;
      let best = i, bestD = Infinity;
      for (let k = USABLE_FIRST; k <= USABLE_LAST; k++) {
        const d = dist(tr, tg, tb, pal.r(k), pal.g(k), pal.b(k));
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      table[i] = best;
    }
  }
  return out;
}
