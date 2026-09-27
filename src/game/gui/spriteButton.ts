// Button drawn with a sprite (the lit/pressed look of a button on a tournament menu sheet) and an optional label
// (port of the reference gui/spritebutton.c).
import { video } from '../../video/draw';
import type { Surface } from '../../video/surface';
import { ACT_KICK, ACT_PUNCH, type CtrlType } from '../constants';
import { componentDisable, componentIsDisabled, type FocusableComponent } from './sizer';
import { FontSize, HAlign, Text, TextDirection, VAlign, type TextMargin } from './text';
import { Component, type GuiTheme } from './widgets';

export type SpriteButtonClickCb = (c: SpriteButton) => void;
export type SpriteButtonTickCb = (c: SpriteButton) => void;
export type SpriteButtonFocusCb = (c: SpriteButton, focused: boolean) => void;

export class SpriteButton extends Component implements FocusableComponent {
  supportsFocus = true;
  text: Text | null;
  img: Surface | null;
  /** >0: pressed look for that many ticks; -1: always drawn ("always display"). */
  activeTicks = 0;
  overrideColor = -1;
  verticalAlign = VAlign.MIDDLE;
  horizontalAlign = HAlign.CENTER;
  rowDirection = TextDirection.HORIZONTAL;
  font = FontSize.NONE;
  margins: TextMargin = { left: 0, right: 0, top: 0, bottom: 0 };
  clickCb: SpriteButtonClickCb | null;
  tickCb: SpriteButtonTickCb | null = null;
  focusCb: SpriteButtonFocusCb | null = null;

  /** spritebutton_create() (the userdata of the reference callbacks is captured by the closures). */
  constructor(text: string | null, img: Surface | null, disabled: boolean, cb: SpriteButtonClickCb | null) {
    super();
    componentDisable(this, disabled);
    this.supportsDisable = true;
    this.supportsSelect = true;
    this.supportsFocus = true;
    this.setSizeHints(img ? img.w : 0, img ? img.h : 0);
    this.text = text !== null ? new Text(FontSize.SMALL, 0xffff, 0xffff, text) : null;
    this.clickCb = cb;
    this.img = img;
  }

  // ---- setters (spritebutton_set_*) ------------------------------------------------------------------------
  setHorizontalAlign(a: HAlign): void {
    this.horizontalAlign = a;
  }
  setVerticalAlign(a: VAlign): void {
    this.verticalAlign = a;
  }
  setTextDirection(d: TextDirection): void {
    this.rowDirection = d;
  }
  setFont(f: FontSize): void {
    this.font = f;
  }
  getImg(): Surface | null {
    return this.img;
  }
  setImg(img: Surface | null): void {
    this.img = img;
  }
  setTextColor(color: number): void {
    this.overrideColor = color;
  }
  setTextMargin(m: TextMargin): void {
    this.margins = { ...m };
  }
  setTickCb(cb: SpriteButtonTickCb | null): void {
    this.tickCb = cb;
  }
  setFocusCb(cb: SpriteButtonFocusCb | null): void {
    this.focusCb = cb;
  }
  setAlwaysDisplay(): void {
    this.activeTicks = -1;
  }

  // ---- component callbacks ------------------------------------------------------------------------------------
  override render(): void {
    const theme = this.theme;
    if (componentIsDisabled(this)) {
      if (this.img) video.drawOffset(this.img, this.x, this.y, 5, 0x5f);
    } else if (this.activeTicks !== 0) {
      if (this.img) video.draw(this.img, this.x, this.y);
    }
    if (this.text !== null) {
      this.text.setColor(theme.primaryColor);
      if (this.overrideColor > -1) this.text.setColor(this.overrideColor);
      else if (componentIsDisabled(this)) this.text.setColor(theme.disabledColor);
      else if (this.activeTicks > 0) this.text.setColor(theme.activeColor);
      this.text.draw(this.x, this.y);
    }
  }

  override tick(): void {
    if (this.activeTicks > 0) this.activeTicks--;
    this.tickCb?.(this);
  }

  onFocus(focused: boolean): void {
    this.focusCb?.(this, focused);
  }

  override action(action: number, _source: CtrlType): number {
    if (componentIsDisabled(this)) return 1;
    if (action === ACT_KICK || action === ACT_PUNCH) {
      if (this.activeTicks >= 0) this.activeTicks = 10;
      this.clickCb?.(this);
      return 0;
    }
    return 1;
  }

  override layout(x: number, y: number, w: number, h: number): void {
    super.layout(x, y, w, h);
    const theme: GuiTheme = this.theme;
    if (this.text !== null) {
      this.text.setFont(this.font !== FontSize.NONE ? this.font : theme.font);
      this.text.setColor(this.overrideColor > -1 ? this.overrideColor : theme.primaryColor);
      this.text.setBox(w, h);
      this.text.setHAlign(this.horizontalAlign);
      this.text.setVAlign(this.verticalAlign);
      this.text.setDirection(this.rowDirection);
      this.text.setMargin(this.margins);
      this.text.layout();
    }
  }
}
