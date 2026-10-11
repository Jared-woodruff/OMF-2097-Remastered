// What the game's texts are drawn with, character by character.
//
// The original fonts (CHARSMAL.DAT, 6x6, capitals only; GRAPHCHR.DAT, 8x8) have code page 437's letters: English,
// and the German texts' umlauts and ß. The other Latin letters of the game's languages (Ã, Ê, Ó, Ø...) are made in
// the fonts' own style: the plain letter, pressed a little lower where it is a capital, under its accent (as the
// fonts' Ä and É are). Every other script (Cyrillic, Chinese and Japanese, Korean, Devanagari, Bengali, Arabic) is
// drawn by the system's fonts at a high resolution (hiresText.ts), word by word where letters join or change shape,
// character by character in Chinese, Japanese (which wrap between any two characters) and Korean.
//
// shapeText() turns a text into its units: what the layout places, wraps and reorders (text.ts).
import { cp437Code } from '../../i18n/cp437';
import { lang, langInfo } from '../../i18n/i18n';
import { Surface } from '../../video/surface';
import { clusterGlyph, scriptOf, type GlyphScript } from './hiresText';

/** A font: its cell size (6: the small font, 8: the big one) and its 224 glyphs (code - 32). See text.ts getFont. */
export interface GlyphFont {
  w: number;
  h: number;
  glyphs: Surface[];
}

/** A picture of a unit, drawn at (dx, dy) from the unit's origin, w x h native pixels (its surface may be larger). */
export interface GlyphPiece {
  surf: Surface;
  dx: number;
  dy: number;
  w: number;
  h: number;
}

export const enum UnitKind {
  CHAR,
  SPACE,
  NEWLINE,
  /** A hyphen: a line may end after it. */
  HYPHEN,
}

/** Bidirectional class of a unit: left to right (Latin, digits), right to left (Arabic), neutral. */
export type UnitDir = 'l' | 'r' | 'n';

/** A character (or a word of a script drawn whole) as the layout sees it. */
export interface TextUnit {
  /** The characters of the text it stands for. */
  start: number;
  end: number;
  kind: UnitKind;
  /** Advance, native pixels. */
  w: number;
  pieces: GlyphPiece[];
  /** Has a glyph (the original skips characters its fonts lack: they take no room). */
  glyph: boolean;
  /** A line may start with it (Chinese and Japanese characters, and what follows them). */
  breakBefore: boolean;
  /** Drawn by the system's fonts (a word too wide for its box may still go on a line of its own). */
  hires: boolean;
  /** A space a line does not break at (French: before ? ! : ; and »). */
  glue?: boolean;
  dir: UnitDir;
}

// ---- the original fonts' letters, and the ones made from them ----------------------------------------------------

/** Letters of the fonts' code page 437 half drawn without their accent in the big font (they are made instead). */
const BIG_MISSING_ACCENT = new Set('áíóúñÑù');

/** Accents the fonts' letters get: rows of pixels above the letter, columns from its middle. */
const COMBINING: Record<string, 'acute' | 'grave' | 'circumflex' | 'tilde' | 'diaeresis' | 'caron'> = {
  '̀': 'grave',
  '́': 'acute',
  '̂': 'circumflex',
  '̃': 'tilde',
  '̈': 'diaeresis',
  '̌': 'caron',
};
type Accent = (typeof COMBINING)[string];
/** [row 0, row 1] column offsets, the big font (as its é, à, â, ä are drawn). */
const ACCENT_BIG: Record<Accent, [number[], number[]]> = {
  acute: [[2], [1]],
  grave: [[0], [1]],
  circumflex: [[0], [-1, 1]],
  diaeresis: [[-1, 2], []],
  tilde: [[-1, 0, 2], [-2, 0, 1]],
  caron: [[-1, 1], [0]],
};
/** The small font (as its É, Ä, Ñ are drawn): one row, two for the circumflex and caron. */
const ACCENT_SMALL: Record<Accent, [number[], number[]]> = {
  acute: [[1], []],
  grave: [[-1], []],
  circumflex: [[0], [-1, 1]],
  diaeresis: [[-1, 1], []],
  tilde: [[-1, 0, 1], []],
  caron: [[-1, 1], [0]],
};

/** Characters drawn as other ones (typographic punctuation the fonts lack). */
const SUBSTITUTE: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'", '´': "'", '`': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
  '…': '...', ' ': ' ', ' ': ' ', ' ': ' ', 'Œ': 'OE', 'œ': 'oe',
};

type Bitmap = Uint8Array;

function rowsOf(g: Bitmap, size: number): Bitmap[] {
  const out: Bitmap[] = [];
  for (let y = 0; y < size; y++) out.push(g.subarray(y * size, (y + 1) * size));
  return out;
}

function sameRow(a: Bitmap, b: Bitmap): boolean {
  return a.every((v, i) => (v !== 0) === (b[i] !== 0));
}

function inkRange(g: Bitmap, size: number): { top: number; bottom: number; lo: number; hi: number } | null {
  let top = size, bottom = -1, lo = size, hi = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!g[y * size + x]) continue;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
  }
  return bottom < 0 ? null : { top, bottom, lo, hi: hi + 1 };
}

/** A capital's rows (its first `from` to the cell's last capital row) with `drop` of them taken out: repeated ones first. */
function squash(rows: Bitmap[], drop: number): Bitmap[] {
  const r = rows.slice();
  for (let k = 0; k < drop; k++) {
    // A row that repeats the next one, nearest the middle; else the second row.
    const mid = (r.length - 1) / 2;
    let best = -1;
    for (let i = 0; i + 1 < r.length; i++) {
      if (sameRow(r[i], r[i + 1]) && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    }
    r.splice(best >= 0 ? best : Math.min(1, r.length - 1), 1);
  }
  return r;
}

/**
 * A Latin letter the fonts lack, made from its plain letter and accents (null: it cannot be). The big font: capitals
 * pressed from rows 0..6 into 2..6, small letters keep their place (an i loses its dot), the accent on rows 0..1. The
 * small font (capitals on rows 1..5): pressed into 2..5, the accent on rows 0..1.
 */
function composeLetter(font: GlyphFont, base: string, accents: Accent[]): Bitmap | null {
  const code = cp437Code(base);
  if (code < 32 || code >= 128 || accents.length !== 1) return null;
  const n = font.w;
  const src = font.glyphs[code - 32].data;
  const ink = inkRange(src, n);
  if (!ink) return null;
  const small = n === 6;
  const out = new Uint8Array(n * n);
  const capital = base !== base.toLowerCase() || small;
  if (capital) {
    const capTop = small ? 1 : 0, capBottom = small ? 5 : 6;
    const rows = squash(rowsOf(src, n).slice(capTop, capBottom + 1), small ? 1 : 2);
    rows.forEach((row, i) => out.set(row, (2 + i) * n));
    // (what the letter has below its capital rows: none of the composed letters, but kept)
    for (let y = capBottom + 1; y < n; y++) out.set(src.subarray(y * n, (y + 1) * n), y * n);
  } else {
    if (ink.top < 2 && base !== 'i' && base !== 'j') return null;
    out.set(src.subarray(2 * n), 2 * n);
  }
  const shape = inkRange(out, n)!;
  const c = Math.floor((shape.lo + shape.hi - 1) / 2);
  const marks = (small ? ACCENT_SMALL : ACCENT_BIG)[accents[0]];
  marks.forEach((cols, row) => {
    for (const dx of cols) {
      const x = c + dx;
      if (x >= 0 && x < n) out[row * n + x] = 1;
    }
  });
  return out;
}

/** Ø and ø: the O with a stroke from its bottom left to its top right. */
function slashedO(font: GlyphFont, upper: boolean): Bitmap | null {
  const n = font.w;
  const src = font.glyphs[(upper || n === 6 ? 'O' : 'o').charCodeAt(0) - 32].data;
  const ink = inkRange(src, n);
  if (!ink) return null;
  const out = src.slice();
  const h = ink.bottom - ink.top;
  for (let y = ink.top; y <= ink.bottom; y++) {
    const t = h ? (ink.bottom - y) / h : 0;
    out[y * n + Math.round(ink.lo + t * (ink.hi - 1 - ink.lo))] = 1;
  }
  return out;
}

/** ¡ and ¿: the ! and ? turned upside down within their ink rows. */
function inverted(font: GlyphFont, of: string): Bitmap | null {
  const n = font.w;
  const src = font.glyphs[of.charCodeAt(0) - 32].data;
  const ink = inkRange(src, n);
  if (!ink) return null;
  const out = new Uint8Array(n * n);
  for (let y = ink.top; y <= ink.bottom; y++) {
    for (let x = 0; x < n; x++) out[y * n + x] = src[(ink.top + ink.bottom - y) * n + (ink.lo + ink.hi - 1 - x)];
  }
  return out;
}

/** « and »: two chevrons, each as high as the font's capitals' middle rows. */
function guillemet(font: GlyphFont, right: boolean): Bitmap {
  const n = font.w;
  const out = new Uint8Array(n * n);
  const small = n === 6;
  const mid = small ? 3 : 4, reach = small ? 2 : 2;
  for (let d = -reach; d <= reach; d++) {
    const x = reach - Math.abs(d);
    for (const off of small ? [0, 2] : [0, 3]) {
      const px = right ? n - 2 - (x + off) - (small ? 0 : 1) : x + off;
      if (px >= 0 && px < n) out[(mid + d) * n + px] = 1;
    }
  }
  return out;
}

/** °: a small ring at the top of the cell. */
function degree(font: GlyphFont): Bitmap {
  const n = font.w;
  const out = new Uint8Array(n * n);
  const ring = n === 6 ? ['.#.', '#.#', '.#.'] : ['.##.', '#..#', '#..#', '.##.'];
  ring.forEach((row, y) => [...row].forEach((c, x) => (out[y * n + x + 1] = c === '#' ? 1 : 0)));
  return out;
}

const made = new Map<string, Surface | null>();

function madeGlyph(font: GlyphFont, name: string, ch: string, make: () => Bitmap | null): Surface | null {
  const key = `${name}/u${ch.codePointAt(0)!.toString(16).padStart(4, '0')}`;
  let s = made.get(key);
  if (s === undefined) {
    const data = make();
    s = data ? new Surface(font.w, font.w, data, 0) : null;
    if (s) s.source = { kind: 'font', key };
    made.set(key, s);
  }
  return s;
}

/**
 * The fonts' picture of a character: their own glyph, or one made in their style; null when the fonts cannot draw it
 * (the system's fonts do).
 */
export function fontGlyph(font: GlyphFont, ch: string): Surface | null {
  const small = font.w === 6;
  const name = small ? 'small' : 'big';
  const code = cp437Code(ch);
  if (code >= 32 && code < 128) return font.glyphs[code - 32];
  // The small font has capitals only: its letters are the capitals' (the fonts' own small ê, å, ç are not right).
  if (small && ch !== ch.toUpperCase() && ch.toUpperCase().length === 1) return fontGlyph(font, ch.toUpperCase());
  if (code >= 128 && /\p{L}/u.test(ch) && !(!small && BIG_MISSING_ACCENT.has(ch))) return font.glyphs[code - 32];
  if (ch === 'Ø' || ch === 'ø') return madeGlyph(font, name, ch, () => slashedO(font, ch === 'Ø'));
  if (ch === '¡' || ch === '¿') return madeGlyph(font, name, ch, () => inverted(font, ch === '¡' ? '!' : '?'));
  if (ch === '«' || ch === '»') return madeGlyph(font, name, ch, () => guillemet(font, ch === '»'));
  if (ch === '°') return madeGlyph(font, name, ch, () => degree(font));
  const parts = ch.normalize('NFD');
  if (parts.length < 2 || !/[A-Za-z]/.test(parts[0])) return null;
  const accents = [...parts.slice(1)].map((m) => COMBINING[m]);
  if (accents.some((a) => !a)) return null;
  return madeGlyph(font, name, ch, () => composeLetter(font, parts[0], accents as Accent[]));
}

/** The letters the game's Latin languages use that the fonts lack (for the remastered typeface's atlas). */
export const LATIN_EXTRA = 'ÀÁÂÃÈÊËÌÍÎÏÒÓÔÕÙÚÛÝŸÑØàáâãèêëìíîïòóôõùúûýÿñø¡¿«»';

/** The made glyphs of LATIN_EXTRA in a font: their keys, characters and pictures. */
export function madeGlyphs(font: GlyphFont): { key: string; ch: string; glyph: Uint8Array }[] {
  const out: { key: string; ch: string; glyph: Uint8Array }[] = [];
  for (const ch of LATIN_EXTRA) {
    const s = fontGlyph(font, ch);
    if (s && s.source?.key.includes('/u') && !out.some((o) => o.key === s.source!.key)) out.push({ key: s.source.key, ch: font.w === 6 && ch.toUpperCase().length === 1 ? ch.toUpperCase() : ch, glyph: s.data });
  }
  return out;
}

// ---- shaping ---------------------------------------------------------------------------------------------------

/** Chinese and Japanese characters: each one a unit, a line may break between any two. */
function isCjk(ch: string): boolean {
  return /[　-〿぀-ヿㇰ-ㇿ㐀-䶿一-鿿豈-﫿＀-￯]/.test(ch);
}

/** Japanese and Chinese punctuation (and small kana) a line does not start with; brackets it does not end with. */
const NO_BREAK_BEFORE = new Set('、。，．！？：；）」』】〕〉》｝］〟ー…‥ゝゞ々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ・!?.,:;)]}%\'"');
const NO_BREAK_AFTER = new Set('（「『【〔〈《｛［〝(');

/** French puts a space before these (and after «): a line does not break there. */
const FRENCH_GLUE_BEFORE = new Set('?!:;»');

/** Marks and joiners that belong to the letter before them. */
function isJoining(ch: string): boolean {
  return /[\p{M}‌‍]/u.test(ch);
}

/** Punctuation that goes with the word next to it in a script drawn by the system's fonts (and shares its font). */
function isAttachedPunct(ch: string): boolean {
  return /[.,!?:;'"()%।॥،؛؟۔]/.test(ch);
}

function isRtl(ch: string): boolean {
  return /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(ch);
}

function dirOf(ch: string): UnitDir {
  if (isRtl(ch)) return 'r';
  return /[\p{L}\p{N}]/u.test(ch) ? 'l' : 'n';
}

/**
 * The units of a text in a font: a unit per character the fonts draw (the original's layout, unchanged), a unit per
 * word of a script the system's fonts draw (per character in Chinese and Japanese).
 */
export function shapeText(s: string, font: GlyphFont): TextUnit[] {
  const units: TextUnit[] = [];
  /** The fonts draw it (or what stands in for it). */
  const drawable = (c: string) => !isCjk(c) && !isJoining(c) && (SUBSTITUTE[c] ?? c).split('').every((x) => fontGlyph(font, x));
  const cell = font.w;
  const fontName = font.w === 6 ? 'small' : 'big';
  const unit = (start: number, end: number, kind: UnitKind, w: number, pieces: GlyphPiece[], glyph: boolean, dir: UnitDir): TextUnit =>
    ({ start, end, kind, w, pieces, glyph, breakBefore: false, hires: false, dir });
  let i = 0;
  while (i < s.length) {
    const ch = String.fromCodePoint(s.codePointAt(i)!);
    const next = i + ch.length;
    if (ch === '\n') {
      units.push(unit(i, next, UnitKind.NEWLINE, 0, [], false, 'n'));
      i = next;
      continue;
    }
    // A character the fonts draw (or stand in for), as the original lays it out: one cell.
    const sub = SUBSTITUTE[ch];
    const glyphs = isCjk(ch) || isJoining(ch) ? [] : (sub ?? ch).split('').map((c) => fontGlyph(font, c));
    if (glyphs.length && glyphs.every((g) => g)) {
      const kind = ch === ' ' || sub === ' ' ? UnitKind.SPACE : ch === '-' ? UnitKind.HYPHEN : UnitKind.CHAR;
      units.push(unit(i, next, kind, cell * glyphs.length, glyphs.map((g, k) => ({ surf: g!, dx: k * cell, dy: 0, w: g!.w, h: g!.h })), true, dirOf(ch)));
      i = next;
      continue;
    }
    const script = scriptOf(ch);
    if (!script || isJoining(ch)) {
      // A character no font here draws (the original skips those: they take no room).
      units.push(unit(i, next, UnitKind.CHAR, 0, [], false, 'n'));
      i = next;
      continue;
    }
    // A cluster for the system's fonts: one Chinese / Japanese character, else a word (with the marks, joiners and
    // punctuation that go with it).
    // (Korean syllables too take a cell each, as the translation's columns expect; its lines break at spaces)
    const cellWide = isCjk(ch) || script === 'hangul';
    let end = next;
    if (!cellWide) {
      while (end < s.length) {
        const c = String.fromCodePoint(s.codePointAt(end)!);
        const sc = scriptOf(c);
        if (isJoining(c) || (sc === script && !drawable(c)) || (isAttachedPunct(c) && scriptAround(s, end + c.length, script, drawable))) end += c.length;
        else break;
      }
    } else {
      while (end < s.length && isJoining(s[end])) end++;
    }
    const text = s.slice(i, end);
    const g = clusterGlyph(text, script, fontName, font.w === 6);
    // (a Chinese, Japanese or Korean character takes one cell, as the original's letters: the translations are laid
    // out so)
    const u = unit(i, end, UnitKind.CHAR, cellWide ? cell : g.advance, [{ surf: g.surf, dx: g.dx + (cellWide ? Math.round((cell - g.advance) / 2) : 0), dy: g.dy, w: g.w, h: g.h }], true, script === 'arabic' ? 'r' : 'l');
    u.hires = true;
    units.push(u);
    i = end;
  }
  // French spaces before ? ! : ; » and after « hold their neighbours together.
  if (lang() === 'fr') {
    for (let k = 0; k < units.length; k++) {
      if (units[k].kind !== UnitKind.SPACE) continue;
      const after = units[k + 1] ? s[units[k + 1].start] : '', before = k > 0 ? s[units[k].start - 1] : '';
      if (FRENCH_GLUE_BEFORE.has(after) || before === '«') units[k].glue = true;
    }
  }
  // Where lines may break besides spaces and hyphens: before a Chinese / Japanese character, and before a letter or
  // digit that follows one (unless punctuation says otherwise).
  for (let k = 1; k < units.length; k++) {
    const prev = s.slice(units[k - 1].start, units[k - 1].end), cur = s.slice(units[k].start, units[k].end);
    const prevCjk = isCjk(prev[0]), curCjk = isCjk(cur[0]);
    if (!prevCjk && !curCjk) continue;
    if (NO_BREAK_BEFORE.has(cur[0]) || NO_BREAK_AFTER.has(prev[prev.length - 1])) continue;
    if (curCjk || /[\p{L}\p{N}]/u.test(cur[0])) units[k].breakBefore = true;
  }
  return units;
}

/** Whether the text at `at` goes on in a script, or ends (punctuation after one of its words stays with it). */
function scriptAround(s: string, at: number, script: GlyphScript, drawable: (c: string) => boolean): boolean {
  if (at >= s.length) return true;
  const c = String.fromCodePoint(s.codePointAt(at)!);
  return c === ' ' || c === '\n' || (scriptOf(c) === script && !drawable(c)) || isAttachedPunct(c);
}

/**
 * The visual order of a line's units (Unicode's bidirectional algorithm, simplified): in a right-to-left paragraph the
 * line runs from the right, and runs of left-to-right units (Latin words, numbers) keep their order; in a left-to-right
 * one, runs of right-to-left units are reversed. Neutral units take their neighbours' direction when both agree.
 */
export function visualOrder(units: TextUnit[], rtl: boolean): TextUnit[] {
  if (!units.some((u) => u.dir === 'r') && !rtl) return units;
  const base: UnitDir = rtl ? 'r' : 'l';
  const dirs = units.map((u) => u.dir);
  for (let i = 0; i < dirs.length; i++) {
    if (dirs[i] !== 'n') continue;
    let j = i;
    while (j < dirs.length && dirs[j] === 'n') j++;
    const before = i > 0 ? dirs[i - 1] : base, after = j < dirs.length ? dirs[j] : base;
    const d = before === after ? before : base;
    for (let k = i; k < j; k++) dirs[k] = d;
    i = j - 1;
  }
  const out: TextUnit[] = [];
  const flip: UnitDir = rtl ? 'l' : 'r';
  if (rtl) {
    // Reverse everything, then put the left-to-right runs back in order.
    const rev = units.slice().reverse();
    const rd = dirs.slice().reverse();
    for (let i = 0; i < rev.length; ) {
      let j = i;
      while (j < rev.length && rd[j] === flip) j++;
      if (j > i) {
        out.push(...rev.slice(i, j).reverse());
        i = j;
      } else {
        out.push(rev[i]);
        i++;
      }
    }
    return out;
  }
  for (let i = 0; i < units.length; ) {
    let j = i;
    while (j < units.length && dirs[j] === flip) j++;
    if (j > i) {
      out.push(...units.slice(i, j).reverse());
      i = j;
    } else {
      out.push(units[i]);
      i++;
    }
  }
  return out;
}

/** Whether a text is written right to left (its first letter is). */
export function isRtlText(s: string): boolean {
  for (const ch of s) {
    if (isRtl(ch)) return true;
    if (/\p{L}/u.test(ch)) return false;
  }
  return false;
}

/**
 * Whether a paragraph runs right to left: its first letter is right to left, or the game speaks a right-to-left
 * language and it has such letters (an Arabic sentence may start with a pilot's name).
 */
export function isRtlParagraph(s: string): boolean {
  return isRtlText(s) || (langInfo().rtl === true && /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/.test(s));
}
