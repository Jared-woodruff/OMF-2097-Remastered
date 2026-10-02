// Where the game shows a pilot's words: the boxes of the pilot select, VS, victory and ending screens, laid out by the
// game's own text code (its font, wrapping and alignment), so OMF Studio shows them as the game does and says when one
// does not fit.
import { parseBK } from '../../formats/bk';
import type { Palette } from '../../formats/palette';
import { FontSize, HAlign, Text } from '../../game/gui/text';
import { getFile } from '../../resources/files';
import { withMenuColors } from '../../video/vga';

export interface WordBox {
  /** The screen's scene file (its colors). */
  scene: string;
  /** The box the game lays the text out in. */
  w: number;
  h: number;
  /** Space left and right. */
  margin: number;
  color: number;
  /** The shadow's color (right and below), if it has one. */
  shadow: number | null;
  /** Centred up and down in the box (else from its top). */
  middle: boolean;
  /** A page near the bottom of the screen: the rows that show. */
  maxRows?: number;
  /** The text as the screen writes it (the victory screen puts it in quotes). */
  wrap?: (s: string) => string;
}

/** The small font's rows. */
const ROW = 6;

export const BIO_BOX: WordBox = { scene: 'MELEE.BK', w: 156, h: 34, margin: 2, color: 0xa6, shadow: 0xa2, middle: true };
export const VS_BOX: WordBox = { scene: 'VS.BK', w: 150, h: 30, margin: 0, color: 0xcf, shadow: null, middle: true };
export const VICTORY_BOX: WordBox = { scene: 'VS.BK', w: 200, h: 34, margin: 0, color: 0xcf, shadow: 0xca, middle: true, wrap: (s) => `"${s}"` };
/** The ending's pages (END1, from y 157) and its last line (END2, from y 160): 7 and 6 rows show. */
export const ENDING_BOX: WordBox = { scene: 'END1.BK', w: 300, h: 200, margin: 0, color: 0xfd, shadow: null, middle: false, maxRows: 7 };
export const ENDING_LAST_BOX: WordBox = { scene: 'END2.BK', w: 300, h: 200, margin: 0, color: 0xf8, shadow: null, middle: false, maxRows: 6 };

const palettes = new Map<string, Palette>();

/** A screen's colors (with the menu colors every scene has at 250-255: the ending's text is one). */
export function scenePalette(scene: string): Palette {
  let p = palettes.get(scene);
  if (!p) palettes.set(scene, (p = withMenuColors(parseBK(getFile(scene)).palettes[0])));
  return p;
}

function text(box: WordBox, s: string, h: number): Text {
  return new Text(FontSize.SMALL, box.w, h, box.wrap ? box.wrap(s) : s).setHAlign(HAlign.CENTER)
    .setMargin({ left: box.margin, right: box.margin, top: 0, bottom: 0 });
}

/** The rows a text needs in a box, and the rows the screen shows of it. */
export function wordRows(box: WordBox, s: string): { needed: number; shown: number } {
  if (!s) return { needed: 0, shown: 0 };
  const all = text(box, s, 0xffff);
  all.layout();
  const boxed = text(box, s, box.h);
  boxed.layout();
  const shown = Math.min(boxed.rows, box.maxRows ?? boxed.rows);
  return { needed: all.rows, shown };
}

/** Whether a text shows whole in its box. */
export function wordsFit(box: WordBox, s: string): boolean {
  const r = wordRows(box, s);
  return r.needed === r.shown;
}

/** The ending's pages: its lines (the game shows one at a time; empty lines are skipped). */
export function endingPages(s: string): string[] {
  return s.split('\n').filter((p) => p.length > 0);
}

/**
 * A text drawn as the screen draws it, `k` times the size, on the box's background; rows the screen does not show are
 * faint, under a red line where the box ends.
 */
export function wordsCanvas(box: WordBox, s: string, k = 2): HTMLCanvasElement {
  const pal = scenePalette(box.scene);
  const { needed, shown } = wordRows(box, s);
  const boxRows = box.maxRows ?? Math.floor(box.h / ROW);
  const h = Math.max(box.maxRows ? boxRows * ROW : box.h, needed * ROW) + 2;
  const t = text(box, s, 0xffff);
  // (centred up and down in its box, like the game, when it fits)
  const oy = box.middle && needed === shown ? Math.max(0, (box.h - needed * ROW) >> 1) : 0;
  const px = new Uint8Array(box.w * h);
  const put = (x: number, y: number, v: number) => {
    if (x >= 0 && y >= 0 && x < box.w && y < h) px[y * box.w + x] = v;
  };
  for (const pass of box.shadow === null ? [0] : [1, 0]) {
    for (const it of t.glyphs()) {
      const g = it.glyph;
      for (let y = 0; y < g.h; y++) {
        for (let x = 0; x < g.w; x++) {
          if (!g.data[y * g.w + x]) continue;
          const gx = it.x + x, gy = it.y + y + oy;
          if (pass) {
            put(gx + 1, gy, box.shadow!);
            put(gx, gy + 1, box.shadow!);
          } else put(gx, gy, box.color);
        }
      }
    }
  }
  const c = document.createElement('canvas');
  c.width = box.w * k;
  c.height = h * k;
  const g = c.getContext('2d')!;
  g.fillStyle = '#05070c';
  g.fillRect(0, 0, c.width, c.height);
  const cut = shown * ROW;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < box.w; x++) {
      const v = px[y * box.w + x];
      if (!v) continue;
      g.globalAlpha = needed > shown && y >= cut ? 0.35 : 1;
      g.fillStyle = `rgb(${pal.r(v)},${pal.g(v)},${pal.b(v)})`;
      g.fillRect(x * k, y * k, k, k);
    }
  }
  g.globalAlpha = 1;
  if (needed > shown) {
    g.strokeStyle = '#ff5a5a';
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(0, cut * k + 0.5);
    g.lineTo(c.width, cut * k + 0.5);
    g.stroke();
  }
  c.className = 'pix';
  c.style.width = `${c.width}px`;
  c.style.height = `${c.height}px`;
  return c;
}
