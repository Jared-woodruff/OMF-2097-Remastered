// Single-line text entry field (port of the reference gui textinput).
// Keyboard: typed characters arrive through `keyEvent` (the SDL_TEXTINPUT/SDL_KEYDOWN events of the reference);
// menu actions move the caret. Gamepad: up/down scroll through a character wheel.
import { video } from '../../video/draw';
import { Surface } from '../../video/surface';
import { ACT_DOWN, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_STOP, ACT_UP, CtrlType } from '../constants';
import { drawGlyph, FontSize, getFont, GLYPH_SHADOW_NONE, HAlign, Text } from './text';
import { Component, CURSOR_CHAR, type GuiTheme } from './widgets';

const COLOR_MENU_BORDER = 251;

export type TextInputDoneCb = (c: TextInput) => void;
export type TextInputFilterCb = (ch: string) => boolean;

/** Next/previous character of the wheel charset (unknown characters start from the space, or the first entry). */
export function textinputWheelStep(charset: string, current: string, up: boolean): string {
  const n = charset.length;
  if (n === 0) return current;
  let idx = charset.indexOf(current);
  if (idx < 0) idx = charset.indexOf(' ');
  if (idx < 0) idx = 0;
  idx = up ? (idx + 1) % n : (idx + n - 1) % n;
  return charset[idx];
}

function isValidInput(ch: string): boolean {
  // isprint() in the C locale: 0x20..0x7E.
  const c = ch.charCodeAt(0);
  return ch.length === 1 && c >= 0x20 && c <= 0x7e && ch !== '@' && ch !== '~';
}

export class TextInput extends Component {
  maxChars: number;
  pos: number;
  lastSource: CtrlType = CtrlType.KEYBOARD;
  editByDefault = false;
  bgEnabled = true;
  bgSurface: Surface | null = null;
  textMaxLines = 1;
  textHAlign = HAlign.CENTER;
  fontSize = FontSize.SMALL;
  textShadow = GLYPH_SHADOW_NONE;
  textShadowColor = 0;
  text: Text;
  buf: string;
  wheelCharset = '0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  filterCb: TextInputFilterCb | null = null;
  doneCb: TextInputDoneCb | null = null;
  editing = false;
  dirty = false;

  constructor(maxChars: number, help: string | null, initialValue: string) {
    super();
    this.buf = initialValue;
    this.maxChars = maxChars;
    this.text = new Text();
    this.pos = Math.min(this.buf.length, this.maxChars - 1);
    this.setHelp(help);
  }

  // ---- reference API -----------------------------------------------------------------
  setEditing(editing: boolean): void {
    if (this.editing !== editing) {
      this.editing = editing;
      this.dirty = true;
    }
  }

  /** Focus callback: entering the field starts editing when edit-by-default is set. */
  focus(focused: boolean): void {
    this.focused = focused;
    this.setEditing(focused && this.editByDefault);
  }

  wheelActive(): boolean {
    return this.lastSource === CtrlType.GAMEPAD && this.editing;
  }

  /** Returns the stripped value (and resets the caret like the reference). */
  value(): string {
    this.buf = this.buf.trim();
    this.pos = 0;
    return this.buf;
  }

  clear(): void {
    this.buf = '';
    this.dirty = true;
    this.text.set(this.buf);
    this.pos = 0;
  }

  setText(value: string): void {
    this.buf = value;
    this.refresh();
    this.pos = this.buf.length;
  }

  enableBackground(enabled: boolean): void {
    this.bgEnabled = enabled;
  }
  setFilterCb(cb: TextInputFilterCb | null): void {
    this.filterCb = cb;
  }
  setDoneCb(cb: TextInputDoneCb | null): void {
    this.doneCb = cb;
  }
  setFont(font: FontSize): void {
    this.fontSize = font;
  }
  setHorizontalAlign(align: HAlign): void {
    this.textHAlign = align;
  }
  setTextShadow(shadow: number, color: number): void {
    this.textShadow = shadow;
    this.textShadowColor = color;
  }
  setWheelCharset(charset: string): void {
    this.wheelCharset = charset;
  }
  setEditByDefault(enabled: boolean): void {
    this.editByDefault = enabled;
    this.setEditing(enabled);
  }

  // ---- internals -------------------------------------------------------------------------
  private setCursor(focused: boolean): void {
    if (!this.dirty) return;
    this.dirty = false;
    if (!focused) {
      this.text.set(this.buf);
      return;
    }
    let tmp = this.buf;
    if (this.lastSource === CtrlType.GAMEPAD) {
      if (this.editing) {
        if (this.pos >= tmp.length) tmp += CURSOR_CHAR;
        else tmp = tmp.slice(0, this.pos) + CURSOR_CHAR + tmp.slice(this.pos + 1);
      }
    } else {
      tmp = tmp.slice(0, this.pos) + CURSOR_CHAR + tmp.slice(this.pos);
    }
    this.text.set(tmp);
  }

  private refresh(): void {
    this.buf = this.buf.slice(0, Math.max(0, this.maxChars - 1));
    this.dirty = true;
    this.text.set(this.buf);
  }

  private wheelScroll(up: boolean): void {
    const next = textinputWheelStep(this.wheelCharset, this.buf[this.pos] ?? '\0', up);
    if (this.pos >= this.buf.length) this.buf += next;
    else this.buf = this.buf.slice(0, this.pos) + next + this.buf.slice(this.pos + 1);
    this.refresh();
  }

  private moveCaret(right: boolean): void {
    if (right) this.pos = Math.min(this.pos + 1, this.buf.length);
    else if (this.pos > 0) this.pos--;
    this.refresh();
  }

  // ---- component callbacks -------------------------------------------------------------
  override init(theme: GuiTheme): void {
    super.init(theme);
    this.text.setFont(this.fontSize !== FontSize.NONE ? this.fontSize : theme.font);
    this.text.setColor(theme.primaryColor);
    this.text.setHAlign(HAlign.LEFT);
    this.text.setWordWrap(false);
    this.text.setShadow(this.textShadow);
    this.text.setShadowColor(this.textShadowColor);
    this.text.setMargin({ left: 0, right: 0, top: 0, bottom: 0 });
    if (this.bgEnabled) this.text.setMargin({ left: 1, right: 1, top: 1, bottom: 1 });
    this.refresh();
    if (this.hHint < 0) {
      const textHeight = this.text.height() + (this.bgEnabled ? 2 : 0);
      this.setSizeHints(this.wHint, textHeight);
    }
  }

  override layout(x: number, y: number, w: number, h: number): void {
    super.layout(x, y, w, h);
    this.text.setHAlign(this.textHAlign);
    if (this.bgEnabled) {
      this.text.setBox(w - 2, h - 2);
      const bg = new Surface(Math.max(1, w - 4), Math.max(1, h), undefined, 0);
      bg.rect(0, 0, w - 4, h, COLOR_MENU_BORDER);
      bg.source = { kind: 'generated', key: 'textinput-bg' };
      this.bgSurface = bg;
    } else {
      this.text.setBox(w, h);
    }
    this.text.layout();
  }

  override render(): void {
    const theme = this.theme;
    if (this.bgEnabled && this.bgSurface) video.draw(this.bgSurface, this.x + 2, this.y);
    if (this.selected) {
      this.setCursor(true);
      this.text.setColor(theme.activeColor);
    } else if (this.disabled) {
      this.setCursor(false);
      this.text.setColor(theme.disabledColor);
    } else {
      this.setCursor(false);
      this.text.setColor(theme.inactiveColor);
    }
    const left = this.bgEnabled ? 2 : 0;
    const top = this.bgEnabled ? 2 : 0;
    this.text.draw(this.x + left, this.y + top);
    if (this.selected && !this.disabled && this.wheelActive() && this.pos < this.buf.length) {
      // Draw the character under the block cursor in black so it stays readable.
      const gp = this.text.glyphPos(this.pos);
      const font = getFont(this.text.font);
      const glyph = font.glyphs[this.buf.charCodeAt(this.pos) - 32];
      if (gp && glyph) drawGlyph(glyph, this.x + left + gp[0], this.y + top + gp[1], 0);
    }
  }

  override action(action: number, source: CtrlType): number {
    if (action !== ACT_STOP && this.lastSource !== source) {
      this.lastSource = source;
      this.dirty = true;
    }
    if (source !== CtrlType.GAMEPAD) {
      switch (action) {
        case ACT_RIGHT:
          this.moveCaret(true);
          return 0;
        case ACT_LEFT:
          this.moveCaret(false);
          return 0;
        case ACT_PUNCH:
          if (this.doneCb) {
            this.doneCb(this);
            return 0;
          }
          break;
        default:
          break;
      }
      return 1;
    }
    if (!this.editing) {
      if (action === ACT_PUNCH) {
        this.setEditing(true);
        return 0;
      }
      return 1;
    }
    switch (action) {
      case ACT_RIGHT:
        this.moveCaret(true);
        return 0;
      case ACT_LEFT:
        this.moveCaret(false);
        return 0;
      case ACT_UP:
        this.wheelScroll(true);
        return 0;
      case ACT_DOWN:
        this.wheelScroll(false);
        return 0;
      case ACT_KICK:
        if (!this.editByDefault) {
          this.setEditing(false);
          return 0;
        }
        return 1;
      case ACT_PUNCH:
        this.doneCb?.(this);
        return 0;
      default:
        break;
    }
    return 1;
  }

  /**
   * Raw keyboard input (reference textinput_event). A browser keydown carries both the SDL_KEYDOWN and the
   * SDL_TEXTINPUT (`e.key` for printable keys) parts. Every key press is consumed.
   */
  override keyEvent(code: string, e: KeyboardEvent): boolean {
    if (this.lastSource !== CtrlType.KEYBOARD) {
      this.lastSource = CtrlType.KEYBOARD;
      this.dirty = true;
    }
    const ch = e.key ?? '';
    const typed = ch.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey;
    if (typed && isValidInput(ch) && (this.filterCb === null || this.filterCb(ch))) {
      this.buf = this.buf.slice(0, this.pos) + ch + this.buf.slice(this.pos);
      this.buf = this.buf.slice(0, Math.max(0, this.maxChars - 1));
      this.pos = Math.min(this.pos + 1, this.buf.length);
      this.refresh();
      return true;
    }
    if (code === 'Backspace') {
      if (this.pos > 0) {
        this.pos--;
        this.buf = this.buf.slice(0, this.pos) + this.buf.slice(this.pos + 1);
      }
      this.refresh();
    } else if (code === 'Delete') {
      this.buf = this.buf.slice(0, this.pos) + this.buf.slice(this.pos + 1);
      this.refresh();
    }
    return true;
  }
}
