// Bitmap text rendering with the original fonts (port of the reference text engine).
import { fonts } from '../../resources/resources';
import { video } from '../../video/draw';
import { Surface } from '../../video/surface';

export const enum FontSize {
  NONE = 0,
  BIG,
  SMALL,
}

export const enum HAlign {
  LEFT,
  CENTER,
  RIGHT,
}

export const enum VAlign {
  TOP,
  MIDDLE,
  BOTTOM,
}

/** Row direction of a text layout (reference text_row_direction). Vertical rows flow top to bottom. */
export const enum TextDirection {
  HORIZONTAL,
  VERTICAL,
}

export const GLYPH_SHADOW_NONE = 0;
export const GLYPH_SHADOW_TOP = 0x1;
export const GLYPH_SHADOW_BOTTOM = 0x2;
export const GLYPH_SHADOW_LEFT = 0x4;
export const GLYPH_SHADOW_RIGHT = 0x8;
export const GLYPH_SHADOW_ALL = 0xf;

export const TEXT_DARK_GREEN = 0xfe;
export const TEXT_MEDIUM_GREEN = 0xfe;
export const TEXT_BLINKY_GREEN = 0xff;
export const TEXT_BRIGHT_GREEN = 0xfd;
export const TEXT_TRN_BLUE = 0xab;
export const TEXT_YELLOW = 0xf8;
export const TEXT_SHADOW_YELLOW = 0xc0;

export interface Font {
  size: FontSize;
  w: number;
  h: number;
  glyphs: Surface[];
}

let fontCache: { small: Font; big: Font } | null = null;

export function getFont(size: FontSize): Font {
  if (!fontCache) {
    const f = fonts();
    const make = (bf: typeof f.small, sz: FontSize, name: string): Font => ({
      size: sz,
      w: bf.size,
      h: bf.size,
      glyphs: bf.glyphs.map((g, i) => {
        const s = new Surface(bf.size, bf.size, g, 0);
        s.source = { kind: 'font', key: `${name}/${i}` };
        return s;
      }),
    });
    fontCache = { small: make(f.small, FontSize.SMALL, 'small'), big: make(f.big, FontSize.BIG, 'big') };
  }
  return size === FontSize.BIG ? fontCache.big : fontCache.small;
}

function glyphFor(font: Font, ch: string): Surface | null {
  const code = ch.charCodeAt(0) - 32;
  if (code < 0 || code >= font.glyphs.length) return null;
  return font.glyphs[code];
}

/** Draws a glyph surface (pixel value 1) with the given palette color. */
export function drawGlyph(glyph: Surface, x: number, y: number, color: number, opacity = 255): void {
  video.drawFull(glyph, x, y, glyph.w, glyph.h, 0, 0, color - 1, 255, opacity, 0, 0);
}

export interface TextMargin {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface LayoutItem {
  glyph: Surface;
  x: number;
  y: number;
}

export class Text {
  str = '';
  font: FontSize;
  w: number;
  h: number;
  color = 0xfd;
  shadowColor = 0xc0;
  valign = VAlign.TOP;
  halign = HAlign.LEFT;
  margin: TextMargin = { left: 0, right: 0, top: 0, bottom: 0 };
  lineSpacing = 0;
  letterSpacing = 0;
  shadow = GLYPH_SHADOW_NONE;
  wordWrap = true;
  direction = TextDirection.HORIZONTAL;
  private items: LayoutItem[] = [];
  /** The laid out rows' ranges of the string. */
  private rowRanges: [number, number][] = [];
  /** In a document (textDocument): where it starts on its line, and whether the next text goes on the next line. */
  docX = 0;
  docAdvance = true;
  layoutW = 0;
  layoutH = 0;
  rows = 0;
  private dirty = true;

  constructor(font: FontSize = FontSize.SMALL, w = 0xffff, h = 0xffff, str = '') {
    this.font = font;
    this.w = w;
    this.h = h;
    this.str = str;
  }

  set(str: string): this {
    if (str !== this.str) {
      this.str = str;
      this.dirty = true;
    }
    return this;
  }

  setColor(c: number): this {
    this.color = c;
    return this;
  }
  setShadowColor(c: number): this {
    this.shadowColor = c;
    return this;
  }
  setShadow(s: number): this {
    this.shadow = s & GLYPH_SHADOW_ALL;
    return this;
  }
  setHAlign(a: HAlign): this {
    if (a !== this.halign) {
      this.halign = a;
      this.dirty = true;
    }
    return this;
  }
  setVAlign(a: VAlign): this {
    if (a !== this.valign) {
      this.valign = a;
      this.dirty = true;
    }
    return this;
  }
  setBox(w: number, h: number): this {
    if (w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
      this.dirty = true;
    }
    return this;
  }
  setWordWrap(b: boolean): this {
    if (b !== this.wordWrap) {
      this.wordWrap = b;
      this.dirty = true;
    }
    return this;
  }
  setMargin(m: Partial<TextMargin>): this {
    this.margin = { ...this.margin, ...m };
    this.dirty = true;
    return this;
  }
  setLineSpacing(n: number): this {
    this.lineSpacing = n;
    this.dirty = true;
    return this;
  }
  setLetterSpacing(n: number): this {
    this.letterSpacing = n;
    this.dirty = true;
    return this;
  }
  setFont(f: FontSize): this {
    if (f !== this.font) {
      this.font = f;
      this.dirty = true;
    }
    return this;
  }
  setDirection(d: TextDirection): this {
    if (d !== this.direction) {
      this.direction = d;
      this.dirty = true;
    }
    return this;
  }

  layout(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const r = computeLayout(this.str, getFont(this.font), this.w, this.h, this.valign, this.halign, this.margin, this.lineSpacing, this.letterSpacing, this.wordWrap, this.direction);
    this.items = r.items;
    this.layoutW = r.w;
    this.layoutH = r.h;
    this.rows = r.rows;
    this.rowRanges = r.ranges;
  }

  width(): number {
    this.layout();
    return this.layoutW;
  }

  height(): number {
    this.layout();
    return this.layoutH;
  }

  draw(x: number, y: number, opacity = 255): void {
    if (opacity === 0) return;
    this.layout();
    const s = this.shadow;
    if (s) {
      for (const it of this.items) {
        const gx = it.x + x, gy = it.y + y;
        if (s & GLYPH_SHADOW_RIGHT) drawGlyph(it.glyph, gx + 1, gy, this.shadowColor, opacity);
        if (s & GLYPH_SHADOW_LEFT) drawGlyph(it.glyph, gx - 1, gy, this.shadowColor, opacity);
        if (s & GLYPH_SHADOW_BOTTOM) drawGlyph(it.glyph, gx, gy + 1, this.shadowColor, opacity);
        if (s & GLYPH_SHADOW_TOP) drawGlyph(it.glyph, gx, gy - 1, this.shadowColor, opacity);
      }
    }
    for (const it of this.items) drawGlyph(it.glyph, it.x + x, it.y + y, this.color, opacity);
  }

  /**
   * The text as one text per row, drawn where its rows are (its box's height no limit): for breaking a long text over
   * pages.
   */
  lines(): Text[] {
    const full = new Text(this.font, this.w, 0xffff, this.str).setHAlign(this.halign).setWordWrap(this.wordWrap)
      .setLineSpacing(this.lineSpacing).setLetterSpacing(this.letterSpacing).setMargin(this.margin);
    full.layout();
    const ranges = full.rowRanges;
    if (ranges.length <= 1) return [this];
    return ranges.map(([s, e], i) => {
      const t = new Text(this.font, this.w, 0xffff, this.str.slice(s, e)).setColor(this.color).setShadowColor(this.shadowColor)
        .setShadow(this.shadow).setHAlign(this.halign).setWordWrap(false).setLetterSpacing(this.letterSpacing)
        .setMargin({ ...this.margin, top: i === 0 ? this.margin.top : 0, bottom: i === ranges.length - 1 ? this.margin.bottom : this.lineSpacing });
      t.docX = this.docX;
      return t;
    });
  }

  /** The laid out glyphs: each glyph's picture (1 where it is drawn) and where, from the box's top left. */
  glyphs(): readonly LayoutItem[] {
    this.layout();
    return this.items;
  }

  glyphPos(index: number): [number, number] | null {
    this.layout();
    const it = this.items[index];
    return it ? [it.x, it.y] : null;
  }
}

function findNextLineEnd(s: string, font: Font, start: number, letterSpacing: number, maxWidth: number, wordWrap: boolean): number {
  const len = s.length;
  if (len === 0) return 0;
  let cutOff = start;
  let foundCut = false;
  let pos = 0;
  for (let i = start; i < len; i++) {
    const c = s[i];
    if (c === '\n') return i + 1;
    if (c === ' ' || c === '-') {
      cutOff = i + 1;
      foundCut = true;
    }
    if (!glyphFor(font, c)) continue;
    pos += letterSpacing + font.w;
    if (pos > maxWidth) return foundCut && wordWrap ? cutOff : i;
  }
  return len;
}

function computeLayout(
  s: string, font: Font, bboxW: number, bboxH: number, valign: VAlign, halign: HAlign, margin: TextMargin,
  lineSpacing: number, letterSpacing: number, wordWrap: boolean, direction: TextDirection = TextDirection.HORIZONTAL,
): { items: LayoutItem[]; w: number; h: number; rows: number; ranges: [number, number][] } {
  // Vertical text swaps the axes: rows run down the box and "vertical" alignment applies along x (the fonts are
  // square, so glyph widths and heights are interchangeable in the row metrics).
  const isH = direction === TextDirection.HORIZONTAL;
  const boxW = (bboxW - margin.left - margin.right) & 0xffff;
  const boxH = (bboxH - margin.top - margin.bottom) & 0xffff;
  const maxWidth = isH ? boxW : boxH;
  const maxHeight = isH ? boxH : boxW;
  const rows: { start: number; end: number; w: number; h: number }[] = [];
  let start = 0;
  let line = 0;
  let rowHeights = 0;
  let maxRowWidth = 0;
  while (start < s.length) {
    const next = findNextLineEnd(s, font, start, letterSpacing, maxWidth, wordWrap);
    if (next === start) break;
    let end = next;
    const last = s[next - 1];
    if (last === '\n' || last === ' ') end--;
    let w = 0;
    for (let i = start; i < end; i++) if (glyphFor(font, s[i])) w += font.w;
    w += (end - start - 1) * letterSpacing;
    if (end - start <= 0) w = 0;
    const total = rowHeights + line * lineSpacing;
    if (total > maxHeight) break;
    rows.push({ start, end, w, h: font.h });
    rowHeights += font.h;
    maxRowWidth = Math.max(maxRowWidth, w);
    start = next;
    line++;
  }
  const blockH = rowHeights + Math.max(0, line - 1) * lineSpacing;
  const items: LayoutItem[] = [];
  let y = valign === VAlign.TOP ? 0 : valign === VAlign.MIDDLE ? (maxHeight - blockH) >> 1 : maxHeight - blockH;
  for (const row of rows) {
    let x = halign === HAlign.LEFT ? 0 : halign === HAlign.CENTER ? (maxWidth - row.w) >> 1 : maxWidth - row.w;
    for (let i = row.start; i < row.end; i++) {
      const g = glyphFor(font, s[i]);
      if (!g) continue;
      items.push({ glyph: g, x: margin.left + (isH ? x : y), y: margin.top + (isH ? y : x) });
      x += letterSpacing + (isH ? g.w : g.h);
    }
    // (reference quirk: vertical rows advance by the row length, not its thickness)
    y += lineSpacing + (isH ? row.h : row.w);
  }
  return {
    items, w: maxRowWidth + margin.left + margin.right, h: blockH + margin.top + margin.bottom, rows: rows.length,
    ranges: rows.map((r) => [r.start, r.end] as [number, number]),
  };
}

/** Convenience: HUD-style small text with a bottom-right shadow. */
export function hudText(str: string, color = 0xe7, shadow = 0xf8, w = 155, h = 6): Text {
  return new Text(FontSize.SMALL, w, h, str).setColor(color).setShadowColor(shadow).setShadow(GLYPH_SHADOW_RIGHT | GLYPH_SHADOW_BOTTOM).setWordWrap(false);
}

/** Colors the German help pages change to in mid-sentence (entries of the main menu's palette, where help is shown). */
const TEXT_WHITE = 0x7f;
const TEXT_PURPLE = 0xf7;

/** A run of a document's text with the style its tags set. */
interface DocPiece {
  text: string;
  font: FontSize;
  w: number;
  h: number;
  color: number;
  shadowColor: number;
  shadow: number;
  halign: HAlign;
  lineSpacing: number;
  yOff: number;
  /** Continues the line of the piece before it (a style change in mid-sentence). */
  inline: boolean;
}

/**
 * Formatted text documents with inline tags used by the original data ({CENTER ON}, {SIZE 8}, {COLOR:YELLOW}, ...).
 * Returns a list of Text blocks to draw top to bottom (drawDocument). The English texts change styles only at the start
 * of a line: each piece is a block of its own, as in the reference. The German texts also change colors in
 * mid-sentence ({COLOR:WHITE}HILFE{COLOR:DEFAULT} zeigt...): such pieces are laid out together, on the same lines.
 */
export function textDocument(src: string, font: FontSize, w: number, h: number, color: number, shadowColor: number,
  halign: HAlign = HAlign.LEFT, shadow = GLYPH_SHADOW_NONE, lineSpacing = 0, margin: Partial<TextMargin> = {}): Text[] {
  const pieces: DocPiece[] = [];
  let start = 0;
  const len = src.length;
  let curW = w;
  let curHAlign = halign;
  let curFont = font;
  let curShadow = shadow;
  let curColor = color;
  let curShadowColor = shadowColor;
  let curYOff = 0;
  const baseFont = getFont(font);
  let curLineSpacing = lineSpacing + baseFont.h;
  // Whether the current line has text (a piece that does not start a new line continues it).
  let lineHasText = false;
  while (start < len) {
    while (start < len && src[start] === '{') {
      const rest = src.slice(start);
      let m: RegExpExecArray | null;
      if (rest.startsWith('{CENTER OFF}')) { start += 12; curHAlign = HAlign.LEFT; }
      else if (rest.startsWith('{CENTER ON}')) { start += 11; curHAlign = HAlign.CENTER; }
      else if (rest.startsWith('{SIZE 8}')) { start += 8; curFont = FontSize.BIG; }
      else if (rest.startsWith('{SIZE 6}')) { start += 8; curFont = FontSize.SMALL; }
      else if (rest.startsWith('{SHADOWS ON}')) { start += 12; curShadow = GLYPH_SHADOW_RIGHT | GLYPH_SHADOW_BOTTOM; }
      else if (rest.startsWith('{SHADOWS OFF}')) { start += 13; curShadow = GLYPH_SHADOW_NONE; }
      else if (rest.startsWith('{COLOR:YELLOW}')) { start += 14; curColor = TEXT_YELLOW; curShadowColor = TEXT_SHADOW_YELLOW; }
      else if (rest.startsWith('{COLOR:DEFAULT}')) { start += 15; curColor = color; curShadowColor = shadowColor; }
      else if (rest.startsWith('{COLOR:WHITE}')) { start += 13; curColor = TEXT_WHITE; curShadowColor = shadowColor; }
      else if (rest.startsWith('{COLOR:PURPLE}')) { start += 14; curColor = TEXT_PURPLE; curShadowColor = shadowColor; }
      else if ((m = /^\{WIDTH (\d+)\}/.exec(rest))) { curW = Math.max(8, Math.min(parseInt(m[1], 10), 320)); start += m[0].length; }
      else if ((m = /^\{VMOVE (\d+)\}/.exec(rest))) { curYOff = Math.min(parseInt(m[1], 10), 200); start += m[0].length; }
      else if ((m = /^\{CENTER (\d+)\}/.exec(rest))) { start += m[0].length; }
      else if ((m = /^\{COLOR (\d+)\}/.exec(rest))) { curColor = parseInt(m[1], 10); start += m[0].length; }
      else if ((m = /^\{SPACING (\d+)\}/.exec(rest))) { curLineSpacing = parseInt(m[1], 10); start += m[0].length; }
      // A size tag that lost its closing brace (a German help page): the size, and the text after it.
      else if ((m = /^\{SIZE ([68])(?=[^}\d])/.exec(rest))) { curFont = m[1] === '8' ? FontSize.BIG : FontSize.SMALL; start += m[0].length; }
      else {
        const end = src.indexOf('}', start);
        if (end < 0) return documentTexts(pieces, margin);
        start = end + 1;
      }
    }
    start = Math.min(start, len);
    const nextTag = src.indexOf('{', start);
    let piece: string;
    if (nextTag >= 0) {
      piece = src.slice(start, nextTag);
      start = nextTag;
    } else {
      if (start === len) break;
      piece = src.slice(start);
      start = len;
    }
    const found = /\S/.test(piece);
    const inline = lineHasText && piece.length > 0 && piece[0] !== '\n';
    if (!found && piece.length > 1 && !inline) piece = piece.slice(0, 1);
    if (piece.length === 0 || (pieces.length === 0 && !found)) continue;
    pieces.push({
      text: piece, font: curFont, w: curW, h, color: curColor, shadowColor: curShadowColor, shadow: curShadow, halign: curHAlign,
      lineSpacing: curLineSpacing, yOff: pieces.length ? 0 : curYOff, inline,
    });
    const nl = piece.lastIndexOf('\n');
    lineHasText = nl >= 0 ? /\S/.test(piece.slice(nl + 1)) : lineHasText || found;
  }
  return documentTexts(pieces, margin);
}

function documentTexts(pieces: DocPiece[], margin: Partial<TextMargin>): Text[] {
  const out: Text[] = [];
  for (let i = 0; i < pieces.length; ) {
    let j = i + 1;
    while (j < pieces.length && pieces[j].inline) j++;
    if (j === i + 1) {
      const p = pieces[i];
      const f = getFont(p.font);
      const t = new Text(p.font, p.w, p.h, p.text).setColor(p.color).setShadowColor(p.shadowColor).setShadow(p.shadow).setHAlign(p.halign);
      t.setLineSpacing(Math.max(0, p.lineSpacing - f.h));
      t.setMargin({ ...margin, bottom: Math.max(0, p.lineSpacing - f.h), top: p.yOff });
      out.push(t);
    } else {
      out.push(...flowTexts(pieces.slice(i, j), margin));
    }
    i = j;
  }
  return out;
}

/**
 * Pieces continuing each other's lines, laid out together: words wrap at the box width (after spaces and dashes, as in
 * Text), and every line is made of one text per piece on it.
 */
function flowTexts(pieces: DocPiece[], margin: Partial<TextMargin>): Text[] {
  const first = pieces[0];
  const left = margin.left ?? 0, right = margin.right ?? 0;
  const avail = first.w - left - right;
  interface Tok { text: string; piece: DocPiece; w: number; kind: 'word' | 'space' | 'nl' }
  interface Line { toks: Tok[]; piece: DocPiece; wrapped: boolean }
  const lines: Line[] = [{ toks: [], piece: first, wrapped: false }];
  let x = 0;
  for (const p of pieces) {
    const f = getFont(p.font);
    for (const m of p.text.matchAll(/\n| |[^ \n-]*-|[^ \n-]+/g)) {
      const s = m[0];
      let line = lines[lines.length - 1];
      if (s === '\n') {
        lines.push({ toks: [], piece: p, wrapped: false });
        x = 0;
        continue;
      }
      let w = 0;
      for (const ch of s) if (glyphFor(f, ch)) w += f.w;
      const kind = s === ' ' ? 'space' : 'word';
      if (kind === 'word' && x + w > avail && line.toks.some((t) => t.kind === 'word')) {
        while (line.toks.length && line.toks[line.toks.length - 1].kind === 'space') line.toks.pop();
        line = { toks: [], piece: p, wrapped: true };
        lines.push(line);
        x = 0;
      }
      if (kind === 'space' && x === 0 && line.wrapped) continue;
      if (line.toks.length === 0) line.piece = p;
      line.toks.push({ text: s, piece: p, w, kind });
      x += w;
    }
  }
  // (a text ending with a newline has no line after it)
  if (lines.length > 1 && lines[lines.length - 1].toks.length === 0) lines.pop();
  const out: Text[] = [];
  lines.forEach((line, li) => {
    const frags: { piece: DocPiece; text: string; w: number }[] = [];
    for (const t of line.toks) {
      const last = frags[frags.length - 1];
      if (last && last.piece === t.piece) {
        last.text += t.text;
        last.w += t.w;
      } else {
        frags.push({ piece: t.piece, text: t.text, w: t.w });
      }
    }
    if (frags.length === 0) frags.push({ piece: line.piece, text: ' ', w: 0 });
    const lw = frags.reduce((s, fr) => s + fr.w, 0);
    let fx = first.halign === HAlign.CENTER ? (avail - lw) >> 1 : first.halign === HAlign.RIGHT ? avail - lw : 0;
    frags.forEach((fr, k) => {
      const p = fr.piece;
      const f = getFont(p.font);
      const last = k === frags.length - 1;
      const t = new Text(p.font, fr.w + left + right + 1, 0xffff, fr.text).setColor(p.color).setShadowColor(p.shadowColor)
        .setShadow(p.shadow).setWordWrap(false)
        .setMargin({ ...margin, top: li === 0 ? first.yOff : 0, bottom: last ? Math.max(0, line.piece.lineSpacing - f.h) : 0 });
      t.docX = fx;
      t.docAdvance = last;
      out.push(t);
      fx += fr.w;
    });
  });
  return out;
}

export function drawDocument(doc: Text[], x: number, y: number): void {
  for (const t of doc) {
    t.draw(x + t.docX, y);
    if (t.docAdvance) y += t.height();
  }
}
