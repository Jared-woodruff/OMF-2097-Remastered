// Table-driven sprite button setup of the mechlab menus (port of the reference mechlab/button_details.c).
import type { Surface } from '../../../video/surface';
import { SpriteButton } from '../../gui/spriteButton';
import type { HAlign, TextDirection, TextMargin, VAlign } from '../../gui/text';

export interface ButtonDetails<T> {
  /** Click callback; `userdata` is what the reference passes as the callback's void pointer. */
  cb: ((c: SpriteButton, userdata: T) => void) | null;
  text: string | null;
  dir: TextDirection;
  halign: HAlign;
  valign: VAlign;
  /** {left, right, top, bottom} (the reference table comments label them differently; this is the struct order) */
  margin: TextMargin;
  /** Start disabled (unused, the menus use tick callbacks instead) */
  disabled: boolean;
}

/** sprite_button_from_details() */
export function spriteButtonFromDetails<T>(details: ButtonDetails<T>, text: string | null, img: Surface | null, userdata: T): SpriteButton {
  const cb = details.cb;
  const b = new SpriteButton(text !== null ? text : details.text, img, details.disabled, cb ? (c) => cb(c, userdata) : null);
  b.setVerticalAlign(details.valign);
  b.setHorizontalAlign(details.halign);
  b.setTextDirection(details.dir);
  b.setTextMargin(details.margin);
  return b;
}
