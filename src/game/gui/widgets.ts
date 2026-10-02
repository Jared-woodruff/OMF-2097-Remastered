// Menu widgets matching the original game's look (port of the reference GUI components).
import { audio } from '../../audio/audio';
import type { PointerKind } from '../../controller/mouse';
import { ACT_DOWN, ACT_ESC, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_UP, CtrlType } from '../constants';
import { video } from '../../video/draw';
import { Surface } from '../../video/surface';
import { FontSize, HAlign, Text, VAlign } from './text';

export const COLOR_LIGHT_BLUE = 0xa7; // menu help text color
const COLOR_MENU_LINE = 252;
const COLOR_MENU_BORDER = 251;
const COLOR_MENU_LINE2 = 172;
const COLOR_MENU_BORDER1 = 164;
const COLOR_MENU_BORDER2 = 162;
export const CURSOR_CHAR = '\x7f';

export interface GuiTheme {
  borderColor: number;
  font: FontSize;
  primaryColor: number;
  secondaryColor: number;
  activeColor: number;
  inactiveColor: number;
  disabledColor: number;
  shadowColor: number;
}

/** Default theme used by the main menu scene. */
export function mainMenuTheme(): GuiTheme {
  return {
    borderColor: 0xfe, font: FontSize.BIG, primaryColor: 0xfe, secondaryColor: 0xfd, activeColor: 0xff,
    inactiveColor: 0xfe, disabledColor: 0xc0, shadowColor: 0xc0,
  };
}

export const enum MenuBackgroundStyle {
  MENU,
  MELEE_VS,
  NEWSROOM,
}

export function menuBackground(w: number, h: number, style: MenuBackgroundStyle = MenuBackgroundStyle.MENU): Surface {
  const s = new Surface(w, h, undefined, 0);
  if (style === MenuBackgroundStyle.MENU) {
    for (let x = 5; x < w; x += 8) s.line(x, 0, x, h - 1, COLOR_MENU_LINE);
    for (let y = 5; y < h; y += 8) s.line(0, y, w - 1, y, COLOR_MENU_LINE);
    s.rect(0, 0, w - 1, h - 1, COLOR_MENU_BORDER);
  } else if (style === MenuBackgroundStyle.MELEE_VS) {
    for (let x = 5; x < w; x += 5) s.line(x, 0, x, h - 1, COLOR_MENU_LINE2);
    for (let y = 4; y < h; y += 5) s.line(0, y, w - 1, y, COLOR_MENU_LINE2);
    s.rect(1, 1, w - 2, h - 2, COLOR_MENU_BORDER2);
    s.rect(0, 0, w - 2, h - 2, COLOR_MENU_BORDER1);
  } else {
    s.rect(0, 0, w - 1, h - 1, COLOR_MENU_BORDER);
  }
  s.transparent = 0;
  s.source = { kind: 'generated', key: 'menubg' };
  return s;
}

/** Fully transparent surface drawn through remap table 4 to darken whatever is behind it. */
export function menuShade(w: number, h: number): Surface {
  const s = new Surface(w, h, undefined, -1);
  s.source = { kind: 'generated', key: 'menushade' };
  return s;
}

export function menuBorder(w: number, h: number, color: number): Surface {
  const s = new Surface(w, h, undefined, 0);
  s.rect(0, 0, w - 1, h - 1, color);
  return s;
}

export function playMenuSound(id: number, pan = 0): void {
  audio.playSoundSimple(id, pan);
}

// ---------------------------------------------------------------------------

export abstract class Component {
  x = 0;
  y = 0;
  w = 0;
  h = 0;
  wHint = -1;
  hHint = -1;
  /** Position hints (reference x_hint/y_hint), used by the absolute-position sizers (xysizer, trnmenu). */
  xHint = -1;
  yHint = -1;
  supportsSelect = true;
  supportsDisable = true;
  selected = false;
  disabled = false;
  focused = false;
  help: Text | null = null;
  theme!: GuiTheme;
  id = -1;
  parent: Component | null = null;

  setHelp(text: string | null): this {
    // Double spaces after full stops (the original texts have them) would start wrapped lines with a space.
    this.help = text ? new Text(FontSize.SMALL, 284, 20, text.replace(/ {2,}/g, ' ')) : null;
    return this;
  }
  setDisabled(d: boolean): this {
    if (this.supportsDisable) this.disabled = d;
    return this;
  }
  setSizeHints(w: number, h: number): void {
    this.wHint = w;
    this.hHint = h;
  }
  setPosHints(x: number, y: number): void {
    this.xHint = x;
    this.yHint = y;
  }
  init(theme: GuiTheme): void {
    this.theme = theme;
  }
  layout(x: number, y: number, w: number, h: number): void {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }
  tick(): void {}
  render(): void {}
  /** Returns 0 when the action was handled. */
  action(_action: number, _source: CtrlType): number {
    return 1;
  }
  isSelectable(): boolean {
    return this.supportsSelect && !this.disabled;
  }
  find(id: number): Component | null {
    return this.id === id ? this : null;
  }
  free(): void {}
  /** Keyboard text entry support (for text inputs). */
  keyEvent(_code: string, _e: KeyboardEvent): boolean {
    return false;
  }
  /** Mouse input at native (x, y); returns true when this component used it (see Menu.pointer). */
  pointer(_x: number, _y: number, _kind: PointerKind): boolean {
    return false;
  }
  contains(x: number, y: number): boolean {
    return x >= this.x && x < this.x + this.w && y >= this.y && y < this.y + this.h;
  }
}

export class Filler extends Component {
  constructor() {
    super();
    this.supportsSelect = false;
    this.disabled = true;
  }
}

export class Label extends Component {
  text: Text;
  overrideColor = -1;
  colorTheme = 0;
  halign = HAlign.LEFT;
  valign = VAlign.TOP;
  font: FontSize | null = null;
  /**
   * label_set_text_letter_spacing(). Reference quirk: label_init applies this value as the text's *line* spacing
   * (the letter spacing of labels is never set).
   */
  letterSpacing = 0;

  constructor(str: string, maxWidth = 0xffff) {
    super();
    this.text = new Text(FontSize.BIG, maxWidth, 0xffff, str);
    this.disabled = true;
    this.supportsSelect = false;
  }

  static title(str: string): Label {
    const l = new Label(str);
    l.halign = HAlign.CENTER;
    l.colorTheme = 1;
    return l;
  }

  setText(s: string): this {
    this.text.set(s);
    return this;
  }

  override init(theme: GuiTheme): void {
    super.init(theme);
    this.text.setFont(this.font ?? theme.font);
    if (this.letterSpacing) this.text.setLineSpacing(this.letterSpacing);
    this.text.setHAlign(HAlign.LEFT);
    this.text.setBox(this.wHint < 0 ? 0xffff : this.wHint, this.hHint < 0 ? 0xffff : this.hHint);
    if (this.wHint < 0) this.setSizeHints(this.text.width() + 6, this.hHint);
    if (this.hHint < 0) this.setSizeHints(this.wHint, this.text.height() + 3);
  }

  override layout(x: number, y: number, w: number, h: number): void {
    super.layout(x, y, w, h);
    this.text.setBox(w, h).setHAlign(this.halign).setVAlign(this.valign);
  }

  override render(): void {
    let color = this.theme.primaryColor;
    if (this.overrideColor > -1) color = this.overrideColor;
    else if (this.colorTheme === 1) color = this.theme.secondaryColor;
    this.text.setColor(color).draw(this.x, this.y);
  }
}

export class Button extends Component {
  text: Text;
  border: Surface | null = null;

  constructor(label: string, help: string | null, disabled: boolean, public useBorder: boolean, public onClick: ((b: Button) => void) | null) {
    super();
    this.text = new Text(FontSize.BIG, 0xffff, 0xffff, label);
    this.setDisabled(disabled);
    this.setHelp(help);
  }

  setText(s: string): void {
    this.text.set(s);
  }

  override init(theme: GuiTheme): void {
    super.init(theme);
    this.text.setFont(theme.font).setColor(theme.primaryColor);
    if (this.wHint < 0) this.setSizeHints(this.text.width() + (this.useBorder ? 4 : 0), this.hHint);
    if (this.hHint < 0) this.setSizeHints(this.wHint, this.text.height() + (this.useBorder ? 4 : 0));
  }

  override layout(x: number, y: number, w: number, h: number): void {
    super.layout(x, y, w, h);
    this.text.setHAlign(HAlign.CENTER);
    if (this.useBorder) {
      this.text.setBox(w - 4, h - 4);
      this.border = menuBorder(w, h, this.theme.borderColor);
    } else {
      this.text.setBox(w, h);
    }
  }

  override render(): void {
    const t = this.theme;
    this.text.setColor(this.selected ? t.activeColor : this.disabled ? t.disabledColor : t.inactiveColor);
    if (this.useBorder && this.border) {
      video.draw(this.border, this.x, this.y);
      this.text.draw(this.x + 2, this.y + 2);
    } else {
      this.text.draw(this.x, this.y);
    }
  }

  override action(action: number): number {
    if (action === ACT_KICK || action === ACT_PUNCH) {
      this.onClick?.(this);
      playMenuSound(20);
      return 0;
    }
    return 1;
  }
}

export class TextSelector extends Component {
  text: Text;
  options: string[] = [];
  font: FontSize | null = null;
  halign = HAlign.CENTER;
  valign = VAlign.MIDDLE;

  constructor(public title: string, help: string | null, public getPos: () => number, public setPos: (v: number) => void,
    options: string[] = [], public onToggle: ((pos: number) => void) | null = null) {
    super();
    this.text = new Text();
    this.options = options.slice();
    this.setHelp(help);
  }

  refresh(): void {
    const pos = this.getPos();
    let s: string;
    if (this.options.length > 0 && this.title.length > 0) s = `${this.title} ${this.options[pos] ?? 'NULL'}`;
    else if (this.options.length > 0) s = this.options[pos] ?? 'NULL';
    else s = `${this.title} -`;
    this.text.set(s);
  }

  override init(theme: GuiTheme): void {
    super.init(theme);
    this.refresh();
    this.text.setFont(this.font ?? theme.font);
    if (this.wHint < 0 && this.hHint < 0) this.setSizeHints(this.text.width(), this.text.height());
  }

  override layout(x: number, y: number, w: number, h: number): void {
    super.layout(x, y, w, h);
    this.text.setBox(w, h).setHAlign(this.halign).setVAlign(this.valign);
  }

  override render(): void {
    const t = this.theme;
    this.refresh();
    this.text.setColor(this.selected ? t.activeColor : this.disabled ? t.disabledColor : t.inactiveColor);
    this.text.draw(this.x, this.y);
  }

  override action(action: number): number {
    if (this.options.length <= 1) return 0;
    const old = this.getPos();
    let pos = old;
    let pan = 0;
    if (action === ACT_KICK || action === ACT_PUNCH || action === ACT_RIGHT) {
      pan = 50;
      pos++;
      if (pos >= this.options.length) pos = 0;
    } else if (action === ACT_LEFT) {
      pan = -50;
      pos--;
      if (pos < 0) pos = this.options.length - 1;
    }
    if (pos !== old) {
      this.setPos(pos);
      this.refresh();
      this.onToggle?.(pos);
      playMenuSound(20, pan);
      return 0;
    }
    return 1;
  }
}

export class TextSlider extends Component {
  text: Text;
  font: FontSize | null = null;
  disablePanning = false;

  constructor(public title: string, help: string | null, public positions: number, public hasOff: boolean,
    public getPos: () => number, public setPos: (v: number) => void, public onSlide: ((pos: number) => void) | null = null) {
    super();
    this.text = new Text();
    this.setHelp(help);
  }

  refresh(): void {
    let s = `${this.title} `;
    const pos = this.getPos();
    if (this.hasOff && pos === 0) s += 'OFF';
    else for (let i = 0; i < this.positions; i++) s += i + 1 > pos ? '|' : CURSOR_CHAR;
    this.text.set(s);
  }

  override init(theme: GuiTheme): void {
    super.init(theme);
    this.refresh();
    this.text.setFont(this.font ?? theme.font);
    if (this.wHint < 0 && this.hHint < 0) this.setSizeHints(this.text.width(), this.text.height());
  }

  override layout(x: number, y: number, w: number, h: number): void {
    super.layout(x, y, w, h);
    this.text.setBox(w, h).setHAlign(HAlign.CENTER).setVAlign(VAlign.MIDDLE);
  }

  override render(): void {
    const t = this.theme;
    this.refresh();
    this.text.setColor(this.selected ? t.activeColor : this.disabled ? t.disabledColor : t.inactiveColor);
    this.text.draw(this.x, this.y);
  }

  override action(action: number): number {
    const old = this.getPos();
    let pos = old;
    let pan = this.disablePanning ? 0 : 50;
    if (action === ACT_KICK || action === ACT_PUNCH || action === ACT_RIGHT) {
      pos = Math.min(this.positions, pos + 1);
    } else if (action === ACT_LEFT) {
      pan = -pan;
      pos = Math.max(0, pos - 1);
    }
    if (pos !== old) {
      this.setPos(pos);
      this.refresh();
      playMenuSound(20, pan);
      this.onSlide?.(pos);
      return 0;
    }
    return 1;
  }
}

/** Vertical (or horizontal) list of components with the classic grid background. */
export class Menu extends Component {
  items: Component[] = [];
  selectedIndex = 0;
  submenu: Menu | null = null;
  finished = false;
  isSubmenu = false;
  horizontal = false;
  background = true;
  centered = false;
  marginTop = 8;
  padding = 3;
  helpX = 16;
  helpY = 156;
  helpW = 284;
  helpColor = COLOR_LIGHT_BLUE;
  helpFont = FontSize.SMALL;
  helpHAlign = HAlign.CENTER;
  private bg1: Surface | null = null;
  private bg2: Surface | null = null;
  private helpBg1: Surface | null = null;
  private helpBg2: Surface | null = null;
  private prevSubmenuState = false;
  onTick: ((m: Menu) => void) | null = null;
  onSubmenuDone: ((m: Menu, sub: Menu) => void) | null = null;
  onFree: ((m: Menu) => void) | null = null;

  constructor() {
    super();
  }

  attach(c: Component): this {
    c.parent = this;
    this.items.push(c);
    return this;
  }

  select(c: Component): void {
    const i = this.items.indexOf(c);
    if (i < 0) return;
    const old = this.items[this.selectedIndex];
    if (old) {
      old.selected = false;
      old.focused = false;
    }
    c.selected = true;
    c.focused = true;
    this.selectedIndex = i;
  }

  current(): Component | null {
    return this.items[this.selectedIndex] ?? null;
  }

  /** Height of the help text box: the help panel (helpW / 8 pixels tall) less a 2 pixel margin at the top and bottom. */
  helpBoxH(): number {
    return Math.trunc(this.helpW / 8) - 4;
  }

  setSubmenu(sub: Menu): void {
    sub.isSubmenu = true;
    this.submenu?.free();
    this.submenu = sub;
    this.prevSubmenuState = false;
    sub.parent = this;
    sub.init(this.theme);
    sub.layout(this.x, this.y, this.w, this.h);
  }

  activeSubmenu(): Menu | null {
    return this.submenu && !this.submenu.finished ? this.submenu : null;
  }

  override init(theme: GuiTheme): void {
    super.init(theme);
    for (const c of this.items) c.init(theme);
  }

  override layout(x: number, y: number, w: number, h: number): void {
    super.layout(x, y, w, h);
    const n = this.items.length;
    const available = this.horizontal ? w : h - this.marginTop;
    let nonReserved = available;
    let nonReservedItems = n;
    for (const c of this.items) {
      const hint = this.horizontal ? c.wHint : c.hHint;
      if (hint > -1) {
        nonReserved -= hint;
        nonReservedItems--;
      }
    }
    nonReserved -= this.padding * (n - 1);
    const itemSpace = nonReservedItems > 0 ? Math.trunc(nonReserved / nonReservedItems) : 0;
    for (let i = 0; i < n; i++) {
      if (!this.items[i].disabled) {
        this.items[i].selected = true;
        this.selectedIndex = i;
        break;
      }
    }
    let offset = 0;
    if (this.centered && nonReservedItems === 0) {
      const reserved = available - nonReserved;
      offset += Math.trunc(((this.horizontal ? w : h) - reserved) / 2);
    }
    y += this.marginTop;
    for (const c of this.items) {
      const left = available - (offset > 0 ? offset - this.padding : offset);
      if (this.horizontal) {
        const ow = Math.min(left, c.wHint > -1 ? c.wHint : itemSpace);
        c.layout(x + offset, y, ow, h);
        offset += ow + this.padding;
      } else {
        const oh = Math.min(left, c.hHint > -1 ? c.hHint : itemSpace);
        c.layout(x, y + offset, w, oh);
        offset += oh + this.padding;
      }
    }
    if (offset > 0) offset -= this.padding;
    const actualH = this.horizontal ? h : offset;
    if (this.background) {
      this.bg1 = menuShade(w, actualH + this.marginTop * 2);
      this.bg2 = menuBackground(w, actualH + this.marginTop * 2, MenuBackgroundStyle.MENU);
      this.helpBg1 = menuShade(this.helpW + 16, Math.trunc(this.helpW / 8));
      this.helpBg2 = menuBackground(this.helpW + 16, Math.trunc(this.helpW / 8), MenuBackgroundStyle.MENU);
    }
    this.setSizeHints(this.horizontal ? offset : w, this.horizontal ? h : offset);
  }

  override tick(): void {
    const sub = this.activeSubmenu();
    if (sub) {
      sub.tick();
      return;
    }
    if (this.submenu && this.submenu.finished && !this.prevSubmenuState) {
      this.onSubmenuDone?.(this, this.submenu);
      this.prevSubmenuState = true;
    }
    for (const c of this.items) c.tick();
    this.onTick?.(this);
  }

  override render(): void {
    const sub = this.activeSubmenu();
    if (sub) {
      sub.render();
      return;
    }
    if (this.bg1) video.drawRemap(this.bg1, this.x, this.y, 4, 1, 0);
    if (this.bg2) video.draw(this.bg2, this.x, this.y);
    this.items.forEach((c, i) => {
      c.render();
      if (this.selectedIndex === i && c.help) {
        if (this.helpBg1) video.drawRemap(this.helpBg1, this.helpX - 8, this.helpY - 8, 4, 1, 0);
        if (this.helpBg2) video.draw(this.helpBg2, this.helpX - 8, this.helpY - 8);
        // The text box fills the help panel (up to five lines; the reference's 20 px box cut longer texts off).
        c.help.setBox(this.helpW, this.helpBoxH()).setColor(this.helpColor).setHAlign(this.helpHAlign).setVAlign(VAlign.MIDDLE).setFont(this.helpFont);
        c.help.draw(this.helpX, this.helpY - 6);
      }
    });
  }

  override action(action: number, source: CtrlType): number {
    const sub = this.activeSubmenu();
    if (sub) return sub.action(action, source);
    let c = this.current();
    if (action === ACT_ESC) {
      const wasLast = this.selectedIndex === this.items.length - 1;
      const last = this.items[this.items.length - 1];
      if (last) this.select(last);
      if (this.isSubmenu || wasLast) {
        this.finished = true;
        action = ACT_PUNCH;
      } else {
        return 0;
      }
    }
    c = this.current();
    if (c && this.horizontal && (action === ACT_LEFT || action === ACT_RIGHT) && c.action(action, source) === 0) return 0;
    if (c && c.supportsSelect && (((action === ACT_DOWN || action === ACT_UP) && !this.horizontal) || ((action === ACT_LEFT || action === ACT_RIGHT) && this.horizontal))) {
      const old = c;
      c.selected = false;
      let guard = 0;
      do {
        if ((action === ACT_DOWN && !this.horizontal) || (action === ACT_RIGHT && this.horizontal)) this.selectedIndex++;
        if ((action === ACT_UP && !this.horizontal) || (action === ACT_LEFT && this.horizontal)) this.selectedIndex--;
        if (this.selectedIndex < 0) this.selectedIndex = this.items.length - 1;
        if (this.selectedIndex >= this.items.length) this.selectedIndex = 0;
        c = this.items[this.selectedIndex];
      } while (c.disabled && guard++ < 100);
      if (c !== old) playMenuSound(19);
      c.selected = true;
      return 0;
    }
    if (c) return c.action(action, source);
    return 1;
  }

  override find(id: number): Component | null {
    if (this.id === id) return this;
    for (const c of this.items) {
      const f = c.find(id);
      if (f) return f;
    }
    return this.submenu ? this.submenu.find(id) : null;
  }

  override keyEvent(code: string, e: KeyboardEvent): boolean {
    const sub = this.activeSubmenu();
    if (sub) return sub.keyEvent(code, e);
    return this.current()?.keyEvent(code, e) ?? false;
  }

  /**
   * Mouse: hovering an entry selects it, clicking activates it (like ENTER), the wheel changes selectors and sliders.
   * Not in the original game.
   */
  override pointer(x: number, y: number, kind: PointerKind): boolean {
    const sub = this.activeSubmenu();
    if (sub) return sub.pointer(x, y, kind);
    for (let i = 0; i < this.items.length; i++) {
      const c = this.items[i];
      if (!c.isSelectable() || !c.contains(x, y)) continue;
      if (c instanceof Menu) {
        if (!c.pointer(x, y, kind)) continue;
        if (i !== this.selectedIndex) this.select(c);
        return true;
      }
      if (i !== this.selectedIndex) {
        this.select(c);
        if (kind === 'move') playMenuSound(19);
      }
      if (kind === 'click') this.action(ACT_PUNCH, CtrlType.KEYBOARD);
      else if (kind === 'wheelUp' && (c instanceof TextSelector || c instanceof TextSlider)) c.action(ACT_RIGHT);
      else if (kind === 'wheelDown' && (c instanceof TextSelector || c instanceof TextSlider)) c.action(ACT_LEFT);
      return true;
    }
    return false;
  }

  override free(): void {
    this.submenu?.free();
    for (const c of this.items) c.free();
    this.onFree?.(this);
  }
}

/** GUI frames drawn this frame, bottom to top (the host dispatches mouse input to the topmost first). */
export const renderedFrames: GuiFrame[] = [];

/** Positions a root component inside a rectangle with a theme. */
export class GuiFrame {
  root: Component | null = null;
  constructor(public theme: GuiTheme, public x: number, public y: number, public w: number, public h: number) {}
  setRoot(c: Component): void {
    this.root?.free();
    this.root = c;
  }
  layout(): void {
    if (!this.root) return;
    this.root.init(this.theme);
    this.root.layout(this.x, this.y, this.w, this.h);
  }
  tick(): void {
    this.root?.tick();
  }
  render(): void {
    if (this.root) renderedFrames.push(this);
    this.root?.render();
  }
  pointer(x: number, y: number, kind: PointerKind): boolean {
    return this.root?.pointer(x, y, kind) ?? false;
  }
  action(action: number, source: CtrlType = CtrlType.KEYBOARD): number {
    return this.root ? this.root.action(action, source) : 1;
  }
  keyEvent(code: string, e: KeyboardEvent): boolean {
    return this.root?.keyEvent(code, e) ?? false;
  }
  find(id: number): Component | null {
    return this.root?.find(id) ?? null;
  }
  free(): void {
    this.root?.free();
    this.root = null;
  }
}
