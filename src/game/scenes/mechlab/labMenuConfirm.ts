// YES/NO confirmation menu (HAR trades). Port of the reference mechlab/lab_menu_confirm.c.
import { bkGetInfo, langGet } from '../../../resources/resources';
import { SpriteButton } from '../../gui/spriteButton';
import { FontSize } from '../../gui/text';
import { TrnMenu } from '../../gui/trnMenu';
import { Label } from '../../gui/widgets';
import type { MechlabScene } from '../mechlab';
import type { LabMenuSelectCb, LabMenuSelectT } from './labMenuSelect';

/** lab_menu_confirm_yes() */
export function labMenuConfirmYes(c: SpriteButton, sel: LabMenuSelectT): void {
  sel.cb(c);
  (c.parent as TrnMenu).finish();
}

/** lab_menu_confirm_no() */
export function labMenuConfirmNo(c: SpriteButton, sel: LabMenuSelectT): void {
  sel.cb(c);
  (c.parent as TrnMenu).finish();
}

/** lab_menu_confirm_create() */
export function labMenuConfirmCreate(s: MechlabScene, yes: LabMenuSelectCb, no: LabMenuSelectCb, title: string): TrnMenu {
  const mainSheets = bkGetInfo(s.bk, 1)!.ani;
  const mainButtons = bkGetInfo(s.bk, 6)!.ani;
  const handOfDoom = bkGetInfo(s.bk, 29)!.ani;

  // Initialize menu, and set button sheet
  const msprite = mainSheets.getSprite(3)!;
  const menu = new TrnMenu(msprite.surface, msprite.posX, msprite.posY, false);

  const yesgo: LabMenuSelectT = { cb: yes, button: null };
  let bsprite = mainButtons.getSprite(0)!;
  const buttonYes = new SpriteButton(langGet(229), bsprite.surface, false, (c) => labMenuConfirmYes(c, yesgo));
  buttonYes.setFont(FontSize.SMALL);
  buttonYes.setPosHints(bsprite.posX, bsprite.posY);
  menu.attach(buttonYes);

  const nogo: LabMenuSelectT = { cb: no, button: null };
  bsprite = mainButtons.getSprite(1)!;
  const buttonNo = new SpriteButton(langGet(228), bsprite.surface, false, (c) => labMenuConfirmNo(c, nogo));
  buttonNo.setFont(FontSize.SMALL);
  buttonNo.setPosHints(bsprite.posX, bsprite.posY);
  menu.attach(buttonNo);

  // Add text label (theme font and color)
  const label = new Label(title);
  label.setPosHints(10, 155);
  label.setSizeHints(300, 10);
  menu.attach(label);

  // Bind hand animation
  menu.bindHand(handOfDoom, s.gs);
  return menu;
}
