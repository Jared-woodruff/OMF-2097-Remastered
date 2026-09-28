// The remastered typeface: the game's two bitmap fonts drawn with a high-resolution font (Orbitron, SIL Open Font
// License, public/fonts) in their original cells. Every glyph is fitted like the original one (cap height, baseline,
// the center and width of its ink), rendered with the canvas and stored as a signed distance field in one atlas, which
// the HD text shader samples (hd/shaders.ts), so letters are sharp at any size while every text keeps its layout.
// The atlas is built in a worker (typefaceWorker.ts), or here when workers cannot draw text.
import type { BitmapFont } from '../../formats/misc';

/** Atlas texels per native pixel, and the native pixels around each cell (text halo, the reach of descenders). */
export const GLYPH_TEXELS = 12;
export const GLYPH_MARGIN = 2;
/** Native pixels of distance stored on each side of an edge. */
export const GLYPH_RANGE = 2.5;

/** Where the original glyphs sit in their cells (native pixels): cap height, baseline, widest ink, descender room. */
interface CellMetrics {
  cap: number;
  base: number;
  maxWidth: number;
  descender: number;
  weight: number;
}
const METRICS: Record<'small' | 'big', CellMetrics> = {
  // CHARSMAL.DAT: capitals only, rows 1-5 of a 6x6 cell.
  small: { cap: 5, base: 6, maxWidth: 5, descender: 0.6, weight: 700 },
  // GRAPHCHR.DAT: capitals on rows 0-6 of an 8x8 cell, lowercase with one row of descender.
  big: { cap: 7, base: 7, maxWidth: 6, descender: 1.3, weight: 900 },
};
/** Narrow glyphs may be widened this much toward the original's ink width (the cells are monospaced). */
const MAX_STRETCH = 1.25;

export interface GlyphAtlas {
  /** Distance field: 128 = edge, 0..255 = -GLYPH_RANGE..+GLYPH_RANGE native pixels (positive outside). */
  data: Uint8Array;
  w: number;
  h: number;
  /** Tile origins (texels) by glyph surface key ("small/33", "big/65"...: font and code - 32). */
  tiles: Map<string, [number, number]>;
  /** Glyphs drawn at half strength (the dither patterns that stand for a half tone). */
  halftone: Set<string>;
}

/**
 * Glyphs that are blocks rather than letters: the solid cell (0x7F, the menus' slider steps and the text cursor) and
 * the checkerboard ('|', the empty slider steps: a 50% dither in the 320x200 original). Both become one block per
 * cell, a little inset so the steps stay apart; the checkerboard at half strength.
 */
const BLOCK_CODES: Record<number, 'solid' | 'half'> = { [0x7f - 32]: 'solid', ['|'.charCodeAt(0) - 32]: 'half' };
const BLOCK_INSET = 0.3;

/**
 * Loads a font file under a family name (as bytes: servers may not label fonts correctly), for the page or the worker
 * it runs in.
 */
export async function loadTypeface(url: string, family: string): Promise<boolean> {
  const set = (globalThis as { fonts?: FontFaceSet }).fonts ?? (typeof document !== 'undefined' ? document.fonts : undefined);
  if (typeof FontFace === 'undefined' || !set) return false;
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const face = new FontFace(family, await res.arrayBuffer(), { weight: '400 900' });
    await face.load();
    set.add(face);
    return true;
  } catch (err) {
    console.warn('[typeface] not loaded:', err);
    return false;
  }
}

/** The ink columns of an original glyph ([first, last + 1]), or null for an empty one. */
export function inkColumns(glyph: Uint8Array, size: number): [number, number] | null {
  let lo = size, hi = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!glyph[y * size + x]) continue;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
  }
  return hi < 0 ? null : [lo, hi + 1];
}

/**
 * The game's texts are in DOS code page 437 (the German texts' umlauts and ß are bytes 0x80..0xFF): its upper half,
 * and the letters of it the typeface has.
 */
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
const TYPEFACE_EXTRA = new Set('ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£áíóúñÑ¿¡ß°');

/** The character of a font's glyph (code: character code - 32) in Unicode. */
function unicodeOf(code: number): string {
  const c = code + 32;
  return c < 128 ? String.fromCharCode(c) : CP437_HIGH[c - 128];
}

/** A Unicode character's glyph code in the fonts (character code - 32), or -1. */
function codeOf(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c < 128) return c - 32;
  const k = CP437_HIGH.indexOf(ch);
  return k < 0 ? -1 : k + 128 - 32;
}

/**
 * The characters the typeface draws: printable ASCII and the accented letters (the rest keeps the original's
 * reconstruction), except '|', which both fonts draw as a dither pattern (the empty steps of the menus' sliders).
 */
export function typefaceChar(font: BitmapFont, code: number): string | null {
  const c = code + 32;
  const ch = unicodeOf(code);
  if (c < 33 || c === 127 || ch === '|' || (c > 127 && !TYPEFACE_EXTRA.has(ch))) return null;
  const glyph = font.glyphs[code];
  if (!glyph || !inkColumns(glyph, font.size)) return null;
  // Fonts without lowercase letters (the small one) repeat the capitals there.
  const upper = ch.toUpperCase();
  if (upper !== ch && upper.length === 1) {
    const cap = font.glyphs[codeOf(upper)];
    if (cap && cap.every((v, i) => v === glyph[i])) return upper;
  }
  return ch;
}

/**
 * Horizontal fit of a glyph (widths in native pixels): its scale, so it is no wider than the original's ink (or the
 * cell's usual ink width), and somewhat narrower letters widen a little toward the original (not a bare stem that
 * stands for a serifed original: it would only get heavier).
 */
export function fitScale(glyphWidth: number, inkWidth: number, maxWidth: number): number {
  if (glyphWidth <= 0) return 1;
  const limit = inkWidth >= 3 ? Math.max(inkWidth, maxWidth) : inkWidth + 1.5;
  let sx = Math.min(1, limit / glyphWidth);
  if (inkWidth >= 3 && glyphWidth < inkWidth && glyphWidth >= 0.6 * inkWidth) sx = Math.min(MAX_STRETCH, inkWidth / glyphWidth);
  return sx;
}

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvas(w: number, h: number): { ctx: Canvas2D } | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
    return ctx ? { ctx } : null;
  }
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  return ctx ? { ctx } : null;
}

/** Builds the atlas of both fonts' glyphs in the loaded typeface `family`, or null when it cannot be drawn. */
export function buildGlyphAtlas(family: string, fonts: { small: BitmapFont; big: BitmapFont }): GlyphAtlas | null {
  const tile = (8 + 2 * GLYPH_MARGIN) * GLYPH_TEXELS;
  const jobs: { key: string; font: 'small' | 'big'; code: number; ch: string }[] = [];
  const halftone = new Set<string>();
  for (const name of ['small', 'big'] as const) {
    const f = fonts[name];
    for (let code = 0; code < f.glyphs.length; code++) {
      const block = BLOCK_CODES[code];
      const ch = block ? '' : typefaceChar(f, code);
      if (block && !inkColumns(f.glyphs[code], f.size)) continue;
      if (block === 'half') halftone.add(`${name}/${code}`);
      if (block || ch) jobs.push({ key: `${name}/${code}`, font: name, code, ch: ch ?? '' });
    }
  }
  const cols = 16;
  const w = cols * tile, h = Math.ceil(jobs.length / cols) * tile;
  const canvas = makeCanvas(w, h);
  if (!canvas) return null;
  const { ctx } = canvas;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // The font size that gives each cell's cap height, and the typeface's stem width at that size (texels).
  const sizes = {} as Record<'small' | 'big', number>;
  const stems = {} as Record<'small' | 'big', number>;
  for (const name of ['small', 'big'] as const) {
    ctx.font = `${METRICS[name].weight} 100px "${family}"`;
    const capAt100 = ctx.measureText('H').actualBoundingBoxAscent;
    if (!(capAt100 > 0)) return null;
    sizes[name] = (100 * METRICS[name].cap * GLYPH_TEXELS) / capAt100;
    ctx.font = `${METRICS[name].weight} ${sizes[name]}px "${family}"`;
    const i = ctx.measureText('I');
    stems[name] = i.actualBoundingBoxLeft + i.actualBoundingBoxRight;
  }

  const tiles = new Map<string, [number, number]>();
  jobs.forEach((job, i) => {
    const tx = (i % cols) * tile, ty = Math.floor(i / cols) * tile;
    const m = METRICS[job.font];
    const f = fonts[job.font];
    const glyph = f.glyphs[job.code];
    const ink = inkColumns(glyph, f.size)!;
    if (!job.ch) {
      // A block: the whole cell, inset.
      const k = GLYPH_TEXELS, inset = BLOCK_INSET * k;
      ctx.fillRect(tx + GLYPH_MARGIN * k + inset, ty + GLYPH_MARGIN * k + inset, f.size * k - 2 * inset, f.size * k - 2 * inset);
      tiles.set(job.key, [tx, ty]);
      return;
    }
    ctx.font = `${m.weight} ${sizes[job.font]}px "${family}"`;
    const tm = ctx.measureText(job.ch);
    const left = tm.actualBoundingBoxLeft, right = tm.actualBoundingBoxRight;
    const ascent = tm.actualBoundingBoxAscent, descent = tm.actualBoundingBoxDescent;
    const gw = left + right;
    let sx = fitScale(gw / GLYPH_TEXELS, ink[1] - ink[0], m.maxWidth);
    // Squeezed glyphs (W, M...) get their vertical strokes back: drawn several times side by side, over the stem width
    // they lost, within the same total width.
    const stem = stems[job.font];
    let smear = 0;
    if (sx < 0.9 && gw > stem) {
      const target = sx * gw;
      sx = Math.max(0.25, (target - stem) / (gw - stem));
      smear = stem * (1 - sx);
    }
    // Letters as high as the original's: lowercase (its x-height is lower than the typeface's), and accented letters
    // (their accents stay inside the cell: lines are only a pixel apart).
    let kyUp = 1;
    if (/\p{L}/u.test(job.ch) && ascent > 0) {
      let top = f.size;
      for (let k = 0; k < glyph.length; k++) if (glyph[k]) { top = Math.floor(k / f.size); break; }
      const height = (m.base - top) * GLYPH_TEXELS;
      kyUp = Math.max(0.7, Math.min(1.05, height / ascent));
      // (capitals keep the cap height: their original's top row may be a serif or accent-free)
      if (job.ch === job.ch.toUpperCase() && !TYPEFACE_EXTRA.has(job.ch)) kyUp = 1;
    }
    // Placement: the ink centered where the original's is, the baseline on the original's.
    const cx = tx + (GLYPH_MARGIN + (ink[0] + ink[1]) / 2) * GLYPH_TEXELS;
    const baseY = ty + (GLYPH_MARGIN + m.base) * GLYPH_TEXELS;
    const x0 = cx - (sx * (right - left) + smear) / 2;
    // Descenders are pressed into the room the cell has (lines are only a pixel apart).
    const room = m.descender * GLYPH_TEXELS;
    const kyDown = descent > room && descent > 0 ? room / descent : 1;
    const steps = Math.ceil(smear / 2);
    for (const [clipY, clipH, ky] of [[ty, baseY - ty, kyUp], [baseY, ty + tile - baseY, kyDown]] as const) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(tx, clipY, tile, clipH);
      ctx.clip();
      for (let s = 0; s <= steps; s++) {
        ctx.setTransform(sx, 0, 0, ky, x0 + (steps ? (smear * s) / steps : 0), baseY);
        ctx.fillText(job.ch, 0, 0);
      }
      ctx.restore();
    }
    if (job.ch === 'I') {
      // The originals' capital I has serifs, which keep the monospaced words even: bars as thick as the stem and as
      // wide as the original's top row.
      const topRow = glyph.subarray((m.base - m.cap) * f.size, (m.base - m.cap + 1) * f.size);
      const serif = inkColumns(topRow, f.size);
      if (serif) {
        const thick = sx * gw;
        const bw = Math.max(thick, (serif[1] - serif[0] - 0.25) * GLYPH_TEXELS);
        const capTop = baseY - m.cap * GLYPH_TEXELS;
        ctx.fillRect(cx - bw / 2, capTop, bw, thick);
        ctx.fillRect(cx - bw / 2, baseY - thick, bw, thick);
      }
    }
    tiles.set(job.key, [tx, ty]);
  });

  const alpha = ctx.getImageData(0, 0, w, h).data;
  return { data: distanceField(alpha, w, h, tile, [...tiles.values()]), w, h, tiles, halftone };
}

/**
 * The signed distance field of the glyph tiles (`tile` texels square at the given origins) of an RGBA image's alpha:
 * 128 on the edge, GLYPH_RANGE native pixels of distance each way over the rest of the byte range.
 */
export function distanceField(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, tile: number, origins: [number, number][]): Uint8Array {
  const data = new Uint8Array(w * h);
  const outer = new Float64Array(tile * tile), inner = new Float64Array(tile * tile);
  const scratch = edtScratch(tile);
  for (const [tx, ty] of origins) {
    for (let y = 0; y < tile; y++) {
      for (let x = 0; x < tile; x++) {
        const a = rgba[((ty + y) * w + tx + x) * 4 + 3] / 255;
        const i = y * tile + x;
        outer[i] = a >= 1 ? 0 : a <= 0 ? INF : (0.5 - a) ** 2 * (a < 0.5 ? 1 : 0);
        inner[i] = a <= 0 ? 0 : a >= 1 ? INF : (a - 0.5) ** 2 * (a > 0.5 ? 1 : 0);
      }
    }
    edt(outer, tile, scratch);
    edt(inner, tile, scratch);
    for (let y = 0; y < tile; y++) {
      for (let x = 0; x < tile; x++) {
        const i = y * tile + x;
        const d = (Math.sqrt(outer[i]) - Math.sqrt(inner[i])) / GLYPH_TEXELS;
        data[(ty + y) * w + tx + x] = Math.max(0, Math.min(255, Math.round(128 + (d * 127) / GLYPH_RANGE)));
      }
    }
  }
  return data;
}

// ---- Euclidean distance transform (Felzenszwalb & Huttenlocher), squared distances in place ------------------------

const INF = 1e20;

interface EdtScratch {
  f: Float64Array;
  d: Float64Array;
  v: Int32Array;
  z: Float64Array;
}

function edtScratch(n: number): EdtScratch {
  return { f: new Float64Array(n), d: new Float64Array(n), v: new Int32Array(n), z: new Float64Array(n + 1) };
}

function edt(grid: Float64Array, n: number, s: EdtScratch): void {
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) s.f[y] = grid[y * n + x];
    edt1d(s, n);
    for (let y = 0; y < n; y++) grid[y * n + x] = s.d[y];
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) s.f[x] = grid[y * n + x];
    edt1d(s, n);
    for (let x = 0; x < n; x++) grid[y * n + x] = s.d[x];
  }
}

function edt1d(s: EdtScratch, n: number): void {
  const { f, d, v, z } = s;
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let sq = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (sq <= z[k]) {
      k--;
      sq = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = sq;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) ** 2 + f[v[k]];
  }
}
