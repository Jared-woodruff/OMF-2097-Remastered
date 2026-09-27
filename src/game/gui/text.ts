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
): { items: LayoutItem[]; w: number; h: number; rows: number } {
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
  return { items, w: maxRowWidth + margin.left + margin.right, h: blockH + margin.top + margin.bottom, rows: rows.length };
}

/** Convenience: HUD-style small text with a bottom-right shadow. */
export function hudText(str: string, color = 0xe7, shadow = 0xf8, w = 155, h = 6): Text {
  return new Text(FontSize.SMALL, w, h, str).setColor(color).setShadowColor(shadow).setShadow(GLYPH_SHADOW_RIGHT | GLYPH_SHADOW_BOTTOM).setWordWrap(false);
}

/**
 * Formatted text documents with inline tags used by the original data ({CENTER ON}, {SIZE 8}, {COLOR:YELLOW}, ...).
 * Returns a list of Text blocks to draw top to bottom.
 */
export function textDocument(src: string, font: FontSize, w: number, h: number, color: number, shadowColor: number,
  halign: HAlign = HAlign.LEFT, shadow = GLYPH_SHADOW_NONE, lineSpacing = 0): Text[] {
  const out: Text[] = [];
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
  let count = 0;
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
      else if ((m = /^\{WIDTH (\d+)\}/.exec(rest))) { curW = Math.max(8, Math.min(parseInt(m[1], 10), 320)); start += m[0].length; }
      else if ((m = /^\{VMOVE (\d+)\}/.exec(rest))) { curYOff = Math.min(parseInt(m[1], 10), 200); start += m[0].length; }
      else if ((m = /^\{CENTER (\d+)\}/.exec(rest))) { start += m[0].length; }
      else if ((m = /^\{COLOR (\d+)\}/.exec(rest))) { curColor = parseInt(m[1], 10); start += m[0].length; }
      else if ((m = /^\{SPACING (\d+)\}/.exec(rest))) { curLineSpacing = parseInt(m[1], 10); start += m[0].length; }
      else {
        const end = src.indexOf('}', start);
        if (end < 0) return out;
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
    if (!found && piece.length > 1) piece = piece.slice(0, 1);
    if (piece.length === 0 || (count === 0 && !found)) continue;
    const f = getFont(curFont);
    const t = new Text(curFont, curW, h, piece).setColor(curColor).setShadowColor(curShadowColor).setShadow(curShadow).setHAlign(curHAlign);
    t.setLineSpacing(Math.max(0, curLineSpacing - f.h));
    t.setMargin({ bottom: Math.max(0, curLineSpacing - f.h), top: count ? 0 : curYOff });
    out.push(t);
    count++;
  }
  return out;
}

export function drawDocument(doc: Text[], x: number, y: number): void {
  for (const t of doc) {
    t.draw(x, y);
    y += t.height();
  }
}
