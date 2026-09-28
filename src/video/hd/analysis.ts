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

/**
 * Least-squares fit of one remap table as an affine color transform, dst' = M * dst + o (M 3x3): unlike the scalar fit
 * above it keeps tints, e.g. brightness turned into shades of blue. Returns 12 numbers, row-major [M | o] per output
 * channel.
 */
export function fitRemapMatrix(pal: Palette, table: Uint8Array): Float32Array {
  const c = pal.colors;
  // Normal equations (X^T X) W = X^T T with X = [r g b 1] per palette color, a little ridge for stability.
  const xtx = new Float64Array(16);
  const xtt = new Float64Array(12);
  for (let i = 1; i < 256; i++) {
    const x = [c[i * 3] / 255, c[i * 3 + 1] / 255, c[i * 3 + 2] / 255, 1];
    const j = table[i];
    const t = [c[j * 3] / 255, c[j * 3 + 1] / 255, c[j * 3 + 2] / 255];
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 4; k++) xtx[r * 4 + k] += x[r] * x[k];
      for (let ch = 0; ch < 3; ch++) xtt[r * 3 + ch] += x[r] * t[ch];
    }
  }
  for (let r = 0; r < 4; r++) xtx[r * 4 + r] += 1e-3;
  // Gauss-Jordan elimination on [X^T X | X^T T].
  const m = Array.from({ length: 4 }, (_, r) => [...xtx.subarray(r * 4, r * 4 + 4), ...xtt.subarray(r * 3, r * 3 + 3)]);
  for (let col = 0; col < 4; col++) {
    let piv = col;
    for (let r = col + 1; r < 4; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    [m[col], m[piv]] = [m[piv], m[col]];
    const d = m[col][col] || 1e-9;
    for (let k = col; k < 7; k++) m[col][k] /= d;
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const f = m[r][col];
      for (let k = col; k < 7; k++) m[r][k] -= f * m[col][k];
    }
  }
  // Row r of the solution holds the weight of input r for each output channel.
  const out = new Float32Array(12);
  for (let ch = 0; ch < 3; ch++) {
    for (let r = 0; r < 4; r++) out[ch * 4 + r] = m[r][4 + ch];
  }
  return out;
}

export function paletteHash(pal: Palette): number {
  let h = 2166136261;
  const c = pal.colors;
  for (let i = 0; i < c.length; i++) h = Math.imul(h ^ c[i], 16777619);
  return h >>> 0;
}
