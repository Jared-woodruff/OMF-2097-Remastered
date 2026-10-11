// Letters of the scripts the original fonts do not have (Cyrillic, Chinese, Japanese, Korean, Devanagari, Bengali,
// Arabic...), drawn by the system's fonts: each cluster (a word, or a Chinese / Japanese character) becomes a glyph
// surface at HIRES_SCALE times the game's resolution, fitted to the cell of the font it stands in for (the
// capitals' height for Cyrillic, the whole cell for Chinese characters...). The classic renderer draws that picture
// at its resolution, the remastered one a distance field of the same shapes (Surface.hires), so the letters are sharp
// at any size. Fonts: Windows' own first (Yu Gothic, Microsoft YaHei, Malgun Gothic, Nirmala UI, Segoe UI,
// Bahnschrift), then those of other systems.
//
// Without a canvas (the tests) the clusters are blank, with sizes estimated from their characters.
import { lang } from '../../i18n/i18n';
import { Surface, type HiresGlyph } from '../../video/surface';

/** Surface pixels per native pixel of the clusters' pictures (the classic renderer draws them at this resolution). */
export const HIRES_SCALE = 4;

export type GlyphScript = 'cyrillic' | 'greek' | 'han' | 'hangul' | 'devanagari' | 'bengali' | 'arabic' | 'other';

/** The script of a character the original fonts may not have (null: a control character). */
export function scriptOf(ch: string): GlyphScript | null {
  const c = ch.codePointAt(0)!;
  if (c < 0x20 || (c >= 0x7f && c < 0xa0)) return null;
  if (c >= 0x0400 && c <= 0x052f) return 'cyrillic';
  if (c >= 0x0370 && c <= 0x03ff) return 'greek';
  if ((c >= 0x0600 && c <= 0x06ff) || (c >= 0x0750 && c <= 0x077f) || (c >= 0x08a0 && c <= 0x08ff) || (c >= 0xfb50 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff)) return 'arabic';
  if ((c >= 0x0900 && c <= 0x097f) || (c >= 0xa8e0 && c <= 0xa8ff)) return 'devanagari';
  if (c >= 0x0980 && c <= 0x09ff) return 'bengali';
  if ((c >= 0xac00 && c <= 0xd7af) || (c >= 0x1100 && c <= 0x11ff) || (c >= 0x3130 && c <= 0x318f)) return 'hangul';
  if ((c >= 0x2e80 && c <= 0x2fdf) || (c >= 0x3000 && c <= 0x31ff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffef)) return 'han';
  return 'other';
}

const JA = '"Yu Gothic UI", "Yu Gothic", "Meiryo UI", Meiryo, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", "Noto Sans JP", sans-serif';
const ZH = '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "WenQuanYi Micro Hei", sans-serif';
const KO = '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK KR", "Noto Sans KR", NanumGothic, sans-serif';

/** The fonts of a script (Chinese characters: in the forms of the language that is spoken). */
function familyOf(script: GlyphScript): string {
  switch (script) {
    case 'cyrillic':
    case 'greek':
      return 'Bahnschrift, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif';
    case 'han':
      return lang() === 'ja' ? JA : lang() === 'ko' ? KO : ZH;
    case 'hangul':
      return KO;
    case 'devanagari':
      return '"Nirmala UI", "Kohinoor Devanagari", "Noto Sans Devanagari", Mangal, sans-serif';
    case 'bengali':
      return '"Nirmala UI", "Kohinoor Bangla", "Noto Sans Bengali", Vrinda, sans-serif';
    case 'arabic':
      return '"Segoe UI", "Geeza Pro", "Noto Sans Arabic", "Noto Naskh Arabic", Tahoma, Arial, sans-serif';
    default:
      return '"Segoe UI", system-ui, "Noto Sans", sans-serif';
  }
}

/**
 * Where a script's letters go in a cell (native pixels from its top): the ink of the reference text from `top` to
 * `bottom`. Capitals-like scripts take the original capitals' rows; Chinese and Korean characters fill the cell; the
 * scripts with marks above and below their letters (Devanagari, Bengali, Arabic) reach a pixel past it each way.
 */
const BANDS: Record<GlyphScript, { ref: string; small: [number, number]; big: [number, number] }> = {
  cyrillic: { ref: 'НШЮ', small: [1, 6], big: [0, 7] },
  greek: { ref: 'ΗΣΩ', small: [1, 6], big: [0, 7] },
  han: { ref: '国', small: [0.4, 5.6], big: [0.4, 7.6] },
  hangul: { ref: '한', small: [0.4, 5.6], big: [0.4, 7.6] },
  devanagari: { ref: 'किकु', small: [-1, 7], big: [-1, 9] },
  bengali: { ref: 'কিকু', small: [-1, 7], big: [-1, 9] },
  arabic: { ref: 'لكي', small: [-0.5, 7], big: [-0.5, 9] },
  other: { ref: 'H', small: [1, 6], big: [0, 7] },
};

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

let scratch: Ctx | null | undefined;

function context(w = 1, h = 1): Ctx | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c.getContext('2d', { willReadFrequently: true });
}

function measurer(): Ctx | null {
  if (scratch === undefined) scratch = context();
  return scratch;
}

interface Fit {
  font: string;
  /** The baseline (native pixels from the cell's top). */
  base: number;
}

const fits = new Map<string, Fit>();

function fitOf(script: GlyphScript, size: 'small' | 'big'): Fit | null {
  const family = familyOf(script);
  const key = `${script}/${size}/${family}`;
  const have = fits.get(key);
  if (have) return have;
  const ctx = measurer();
  if (!ctx) return null;
  const band = BANDS[script][size];
  ctx.font = `700 100px ${family}`;
  const m = ctx.measureText(BANDS[script].ref);
  const ink = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  const px = ink > 0 ? (100 * (band[1] - band[0])) / ink : (band[1] - band[0]) * 0.75;
  const fit = { font: `700 ${px}px ${family}`, base: band[0] + (ink > 0 ? (m.actualBoundingBoxAscent * px) / 100 : px * 0.8) };
  fits.set(key, fit);
  return fit;
}

/**
 * A cluster's picture: its surface (HIRES_SCALE times larger), drawn at (dx, dy) over w x h; its advance. A turned
 * cluster (for a column of text) is the word a quarter turn round: dx runs down the column and dy across it, w x h
 * is its size on the screen, and the advance is down the column.
 */
export interface ClusterGlyph {
  surf: Surface;
  dx: number;
  dy: number;
  w: number;
  h: number;
  advance: number;
}

const clusters = new Map<string, ClusterGlyph>();
/** (a cache, not a store: texts that are no longer shown make room) */
const MAX_CLUSTERS = 6000;
let nextKey = 1;

/** Estimated advance without a canvas (native pixels). */
function estimate(text: string, script: GlyphScript, cell: number): number {
  const n = [...text].filter((c) => !/[\p{M}‌‍]/u.test(c)).length;
  return Math.max(1, Math.round(n * (script === 'han' || script === 'hangul' ? cell : cell * 0.75)));
}

/**
 * The picture of a cluster of a script in the small or big font's cell. `upper`: the small font, which has capitals
 * only (its letters are capitals in every script that has them). `turn`: the word a quarter turn right (its letters'
 * tops to the right: a left-to-right word reads down) or left (tops to the left, its right end at the top: a right-to-left
 * word reads down).
 */
export function clusterGlyph(text: string, script: GlyphScript, size: 'small' | 'big', upper: boolean, turn?: 'right' | 'left'): ClusterGlyph {
  const shown = upper ? text.toUpperCase() : text;
  const fit = fitOf(script, size);
  const key = `${size}|${script}|${fit?.font ?? ''}|${turn ?? ''}|${shown}`;
  const have = clusters.get(key);
  if (have) {
    // (most recently used last)
    clusters.delete(key);
    clusters.set(key, have);
    return have;
  }
  const cell = size === 'small' ? 6 : 8;
  const rtl = script === 'arabic';
  let g: ClusterGlyph;
  const ctx = fit ? measurer() : null;
  if (!fit || !ctx) {
    const advance = estimate(shown, script, cell);
    const [w, h] = turn ? [cell, advance] : [advance, cell];
    const surf = new Surface(w * HIRES_SCALE, h * HIRES_SCALE, undefined, 0);
    g = { surf, dx: 0, dy: 0, w, h, advance };
  } else {
    ctx.font = fit.font;
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText(shown);
    const advance = Math.max(1, Math.round(m.width));
    // The box: the advance and the cell, and whatever ink reaches past them.
    const x0 = Math.floor(Math.min(0, -m.actualBoundingBoxLeft));
    const x1 = Math.ceil(Math.max(advance, m.actualBoundingBoxRight));
    const y0 = Math.floor(Math.min(0, fit.base - m.actualBoundingBoxAscent));
    const y1 = Math.ceil(Math.max(cell, fit.base + m.actualBoundingBoxDescent));
    const w = x1 - x0, h = y1 - y0;
    // (the picture's size on the screen: turned, the word's height across and its length down)
    const [sw, sh] = turn ? [h, w] : [w, h];
    const coverage = (texels: number, margin: number): { data: Uint8ClampedArray; w: number; h: number } | null => {
      const cw = (sw + 2 * margin) * texels, ch = (sh + 2 * margin) * texels;
      const c = context(cw, ch);
      if (!c) return null;
      c.font = fit.font;
      c.direction = rtl ? 'rtl' : 'ltr';
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      c.fillStyle = '#fff';
      // (the word's point (x, y) goes to: unturned (x - x0, y - y0); turned right (y1 - y, x - x0); turned left
      // (y - y0, x1 - x))
      if (turn === 'right') c.setTransform(0, texels, -texels, 0, (y1 + margin) * texels, (margin - x0) * texels);
      else if (turn === 'left') c.setTransform(0, -texels, texels, 0, (margin - y0) * texels, (x1 + margin) * texels);
      else c.setTransform(texels, 0, 0, texels, (margin - x0) * texels, (margin - y0) * texels);
      c.fillText(shown, 0, fit.base);
      const rgba = c.getImageData(0, 0, cw, ch).data;
      const data = new Uint8ClampedArray(cw * ch);
      for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3];
      return { data, w: cw, h: ch };
    };
    const cov = coverage(HIRES_SCALE, 0);
    const pixels = new Uint8Array(sw * HIRES_SCALE * sh * HIRES_SCALE);
    if (cov) for (let i = 0; i < pixels.length; i++) pixels[i] = cov.data[i] >= 128 ? 1 : 0;
    const surf = new Surface(sw * HIRES_SCALE, sh * HIRES_SCALE, pixels, 0);
    const hires: HiresGlyph = { scale: HIRES_SCALE, coverage };
    surf.hires = hires;
    // (turned right, the word's top (y0) is at the column's right, across the cell; turned left, at its left. Down the
    // column, its left end (x0) comes first, or (turned left) its right end (x1, before the advance))
    if (turn === 'right') g = { surf, dx: x0, dy: cell - y1, w: sw, h: sh, advance };
    else if (turn === 'left') g = { surf, dx: advance - x1, dy: y0, w: sw, h: sh, advance };
    else g = { surf, dx: x0, dy: y0, w, h, advance };
  }
  g.surf.source = { kind: 'font', key: `hires/${nextKey++}` };
  clusters.set(key, g);
  if (clusters.size > MAX_CLUSTERS) clusters.delete(clusters.keys().next().value!);
  return g;
}
