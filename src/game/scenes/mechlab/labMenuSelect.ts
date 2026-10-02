// "SELECT" menu with left/right arrows (photo, tournament, pilot and opponent choosers). Moving the hand onto an arrow
// runs its callback; the hand then returns to SELECT. Port of the reference mechlab/lab_menu_select.c.
import { bkGetInfo, langGet } from '../../../resources/resources';
import { componentDisable } from '../../gui/sizer';
import { SpriteButton } from '../../gui/spriteButton';
import { FontSize, TEXT_MEDIUM_GREEN, TEXT_TRN_BLUE } from '../../gui/text';
import { TrnMenu } from '../../gui/trnMenu';
import { Label, type Component } from '../../gui/widgets';
import type { MechlabScene } from '../mechlab';

/** lab_menu_select_cb: returns whether the SELECT button should be enabled (left/right callbacks). */
export type LabMenuSelectCb = (c: Component) => boolean;

/** lab_menu_select_t */
export interface LabMenuSelectT {
  cb: LabMenuSelectCb;
  button: SpriteButton | null;
}

/** lab_menu_select_choose() */
export function labMenuSelectChoose(c: SpriteButton, sel: LabMenuSelectT): void {
  sel.cb(c);
  (c.parent as TrnMenu).finish();
}

/** lab_menu_focus_left() */
export function labMenuFocusLeft(c: SpriteButton, focused: boolean, left: LabMenuSelectT): void {
  if (focused) {
    componentDisable(c, true);
    const en = left.cb(c);
    if (left.button) componentDisable(left.button, !en);
  } else {
    componentDisable(c, false);
  }
}

/** lab_menu_focus_right() */
export function labMenuFocusRight(c: SpriteButton, focused: boolean, right: LabMenuSelectT): void {
  if (focused) {
    componentDisable(c, true);
    const en = right.cb(c);
    if (right.button) componentDisable(right.button, !en);
  } else {
    componentDisable(c, false);
  }
}

/** lab_menu_select_create() (the callbacks' userdata is captured by the closures). */
export function labMenuSelectCreate(
  s: MechlabScene, select: LabMenuSelectCb, left: LabMenuSelectCb, right: LabMenuSelectCb, title: string, returnHand: boolean,
): TrnMenu {
  const mainSheets = bkGetInfo(s.bk, 1)!.ani;
  const mainButtons = bkGetInfo(s.bk, 7)!.ani;
  const handOfDoom = bkGetInfo(s.bk, 29)!.ani;

  // Initialize menu, and set button sheet
  const msprite = mainSheets.getSprite(4)!;
  const menu = new TrnMenu(msprite.surface, msprite.posX, msprite.posY, returnHand);

  const selector: LabMenuSelectT = { cb: select, button: null };

  let bsprite = mainButtons.getSprite(0)!;
  const selButton = new SpriteButton(langGet(223), bsprite.surface, false, (c) => labMenuSelectChoose(c, selector));
  selButton.setFont(FontSize.SMALL);
  selButton.setTextColor(TEXT_TRN_BLUE);
  selButton.setSizeHints(bsprite.width(), bsprite.height());
  selButton.setPosHints(bsprite.posX, bsprite.posY);
  menu.attach(selButton);

  const goleft: LabMenuSelectT = { cb: left, button: selButton };
  bsprite = mainButtons.getSprite(1)!;
  let button = new SpriteButton(null, bsprite.surface, false, null);
  button.setSizeHints(bsprite.width(), bsprite.height());
  button.setPosHints(bsprite.posX, bsprite.posY);
  button.setFocusCb((c, focused) => labMenuFocusLeft(c, focused, goleft));
  menu.attach(button);

  const goright: LabMenuSelectT = { cb: right, button: selButton };
  bsprite = mainButtons.getSprite(2)!;
  button = new SpriteButton(null, bsprite.surface, false, null);
  button.setSizeHints(bsprite.width(), bsprite.height());
  button.setPosHints(bsprite.posX, bsprite.posY);
  button.setFocusCb((c, focused) => labMenuFocusRight(c, focused, goright));
  menu.attach(button);

  // Add text label
  const label = Label.title(title);
  label.font = FontSize.SMALL;
  label.overrideColor = TEXT_MEDIUM_GREEN;
  label.setPosHints(87, 155);
  label.setSizeHints(150, 10);
  menu.attach(label);

  // Bind hand animation
  menu.bindHand(handOfDoom, s.gs);
  return menu;
}
