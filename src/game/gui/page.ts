// Full-screen pages shown by the help overlay (helpOverlay.ts) over the main menu backdrop, like the help pages and the
// controls screen: the replay list, records, and the other remaster screens. A page gets the menu actions (arrows,
// ENTER / A = PUNCH, X / Y = KICK), raw keys for its own shortcuts, the mouse, and closes itself by setting `finished`.
import type { PointerKind } from '../../controller/mouse';
import { video } from '../../video/draw';
import { vga } from '../../video/vga';
import type { CtrlType } from '../constants';
import { FontSize, GLYPH_SHADOW_BOTTOM, GLYPH_SHADOW_RIGHT, HAlign, Text } from './text';
import { Menu, MenuBackgroundStyle, menuBackground, menuShade } from './widgets';

/** Menu text colors of the main menu's palette. */
export const PAGE_TITLE = 0xfd;
export const PAGE_ACTIVE = 0xff;
export const PAGE_NORMAL = 0xfe;

/**
 * Extra colors a page may use: palette entries the main menu's backdrop does not use (it uses 0x00-0x14, 0x40-0x5E and
 * 0x80-0xDD; the controls screen takes 0x60-0x78), set while the page is open.
 */
export const PC = {
  white: 0x20, dim: 0x21, grey: 0x22, dark: 0x23, gold: 0x24, green: 0x25, red: 0x26, blue: 0x27, cyan: 0x28, orange: 0x29,
  select: 0x2a, shadow: 0x2b, panel: 0x2c, p1: 0x2d, p2: 0x2e,
};
const PAGE_COLORS: [number, number, number, number][] = [
  [PC.white, 0xf2, 0xf4, 0xf7], [PC.dim, 0x7c, 0x86, 0x94], [PC.grey, 0xaa, 0xb2, 0xbd], [PC.dark, 0x3a, 0x40, 0x4c],
  [PC.gold, 0xff, 0xc8, 0x40], [PC.green, 0x5c, 0xe6, 0x6e], [PC.red, 0xff, 0x5a, 0x50], [PC.blue, 0x4a, 0x7c, 0xe6],
  [PC.cyan, 0x55, 0xdc, 0xff], [PC.orange, 0xff, 0x9a, 0x30], [PC.select, 0x1c, 0x3c, 0x78], [PC.shadow, 0x05, 0x06, 0x08],
  [PC.panel, 0x10, 0x18, 0x30], [PC.p1, 0x7c, 0xbe, 0xff], [PC.p2, 0xff, 0xa8, 0x5c],
];

export abstract class Page extends Menu {
  private shade = menuShade(304, 190);
  private grid = menuBackground(304, 190, MenuBackgroundStyle.MENU);
  private texts = new Map<string, Text>();

  /** Sets the page's palette entries (called when it opens; the scene's palette comes back when it closes). */
  setColors(): void {
    for (const [i, r, g, b] of PAGE_COLORS) vga.setBaseIndex(i, r, g, b);
  }

  /** Called when the page is shown. */
  onOpen(): void {}

  /** ESC / B: return true when the page handled it (e.g. cancelled a question); otherwise the page closes. */
  back(): boolean {
    return false;
  }

  /** Raw keys for the page's shortcuts (letters, DELETE...): return true when used. */
  key(_code: string): boolean {
    return false;
  }

  /** A text (cached by its key and content). */
  protected t(key: string, str: string, font = FontSize.SMALL, color = PC.white, shadow = true): Text {
    const k = `${key}|${str}|${font}|${color}|${shadow}`;
    let v = this.texts.get(k);
    if (!v) {
      v = new Text(font, 0xffff, 0xffff, str).setColor(color).setWordWrap(false);
      if (shadow) v.setShadowColor(PC.shadow).setShadow(GLYPH_SHADOW_RIGHT | GLYPH_SHADOW_BOTTOM);
      if (this.texts.size > 400) this.texts.clear();
      this.texts.set(k, v);
    }
    return v;
  }

  protected drawText(key: string, str: string, x: number, y: number, font = FontSize.SMALL, color = PC.white, align = HAlign.LEFT): void {
    const t = this.t(key, str, font, color);
    const w = t.width();
    t.draw(Math.round(align === HAlign.CENTER ? x - w / 2 : align === HAlign.RIGHT ? x - w : x), y);
  }

  /** The framed panel and a title, like the other menu screens. */
  protected drawFrame(title: string): void {
    video.drawRemap(this.shade, 8, 5, 4, 1, 0);
    video.draw(this.grid, 8, 5);
    this.drawText('title', title, 160, 9, FontSize.BIG, PAGE_TITLE, HAlign.CENTER);
  }

  override action(_action: number, _source: CtrlType): number {
    return 0;
  }

  override pointer(_x: number, _y: number, _kind: PointerKind): boolean {
    return false;
  }
}
