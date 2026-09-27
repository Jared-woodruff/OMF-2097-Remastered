// Palette analysis for the HD renderer.
//  - Remap fits: each of the 19 remap tables (index -> index color effects: shadows, glows, tints) approximated
//    by an RGB transform  dst' = a*dst + b, used where the exact paths (background shadow ratios, native-resolution
//    remap delta) do not apply.
import type { Palette, RemapTables } from '../../formats/palette';

function lum(c: Uint8Array, i: number): number {
  return 0.299 * c[i * 3] + 0.587 * c[i * 3 + 1] + 0.114 * c[i * 3 + 2];
}

export interface RemapFit {
  /** Per-table scalar multiplier a (dst' = a*dst + b). */
  a: Float32Array; // 19
  /** Per-table additive color b (0..1 range), 3 floats per table. */
  b: Float32Array; // 19*3
}

/** Least-squares fit of each remap table to dst' = a*dst + b (scalar a, per-channel b). */
export function fitRemaps(pal: Palette, remaps: RemapTables): RemapFit {
  const c = pal.colors;
  const a = new Float32Array(19);
  const b = new Float32Array(19 * 3);
  for (let t = 0; t < 19; t++) {
    const tb = remaps.tables[t];
    // Fit a on luminance, then b per channel as the mean residual.
    let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
    for (let i = 1; i < 256; i++) {
      const x = lum(c, i) / 255;
      const y = lum(c, tb[i]) / 255;
      sx += x;
      sy += y;
      sxx += x * x;
      sxy += x * y;
      n++;
    }
    const den = n * sxx - sx * sx;
    let slope = den !== 0 ? (n * sxy - sx * sy) / den : 1;
    slope = Math.max(0, Math.min(4, slope));
    a[t] = slope;
    for (let ch = 0; ch < 3; ch++) {
      let r = 0;
      for (let i = 1; i < 256; i++) r += c[tb[i] * 3 + ch] / 255 - slope * (c[i * 3 + ch] / 255);
      b[t * 3 + ch] = Math.max(-1, Math.min(1, r / 255));
    }
  }
  return { a, b };
}

export function paletteHash(pal: Palette): number {
  let h = 2166136261;
  const c = pal.colors;
  for (let i = 0; i < c.length; i++) h = Math.imul(h ^ c[i], 16777619);
  return h >>> 0;
}
