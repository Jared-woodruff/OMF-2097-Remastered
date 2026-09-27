// Difficulty choice of a new pilot (aluminum/iron/steel/heavy metal). Port of the reference
// mechlab/lab_menu_difficultyselect.c.
import { bkGetInfo, langGet } from '../../../resources/resources';
import type { SpriteButton } from '../../gui/spriteButton';
import { FontSize, HAlign, TEXT_MEDIUM_GREEN, TEXT_TRN_BLUE, TextDirection, VAlign } from '../../gui/text';
import { TrnMenu } from '../../gui/trnMenu';
import { Label } from '../../gui/widgets';
import type { MechlabScene } from '../mechlab';
import { spriteButtonFromDetails, type ButtonDetails } from './buttonDetails';

function setDifficulty(c: SpriteButton, s: MechlabScene, difficulty: number): void {
  const player1 = s.gs.getPlayer(0);
  player1.pilot.difficulty = difficulty;
  (c.parent as TrnMenu).finish();
}

/** lab_menu_difficultyselect_aluminium() */
export function labMenuDifficultyselectAluminium(c: SpriteButton, s: MechlabScene): void {
  setDifficulty(c, s, 0);
}

/** lab_menu_difficultyselect_iron() */
export function labMenuDifficultyselectIron(c: SpriteButton, s: MechlabScene): void {
  setDifficulty(c, s, 1);
}

/** lab_menu_difficultyselect_steel() */
export function labMenuDifficultyselectSteel(c: SpriteButton, s: MechlabScene): void {
  setDifficulty(c, s, 2);
}

/** lab_menu_difficultyselect_heavy() */
export function labMenuDifficultyselectHeavy(c: SpriteButton, s: MechlabScene): void {
  setDifficulty(c, s, 3);
}

const NO_MARGIN = { left: 0, right: 0, top: 0, bottom: 0 };

const DETAILS_LIST: ButtonDetails<MechlabScene>[] = [
  { cb: labMenuDifficultyselectAluminium, text: null, dir: TextDirection.HORIZONTAL, halign: HAlign.CENTER, valign: VAlign.MIDDLE, margin: NO_MARGIN, disabled: false },
  { cb: labMenuDifficultyselectIron, text: null, dir: TextDirection.HORIZONTAL, halign: HAlign.CENTER, valign: VAlign.MIDDLE, margin: NO_MARGIN, disabled: false },
  { cb: labMenuDifficultyselectSteel, text: null, dir: TextDirection.HORIZONTAL, halign: HAlign.CENTER, valign: VAlign.MIDDLE, margin: NO_MARGIN, disabled: false },
  { cb: labMenuDifficultyselectHeavy, text: null, dir: TextDirection.HORIZONTAL, halign: HAlign.CENTER, valign: VAlign.MIDDLE, margin: NO_MARGIN, disabled: false },
];

/** lab_menu_difficultyselect_create() */
export function labMenuDifficultyselectCreate(s: MechlabScene): TrnMenu {
  const mainSheets = bkGetInfo(s.bk, 1)!.ani;
  const mainButtons = bkGetInfo(s.bk, 2)!.ani;
  const handOfDoom = bkGetInfo(s.bk, 29)!.ani;

  // Initialize menu, and set button sheet
  const msprite = mainSheets.getSprite(6)!;
  const menu = new TrnMenu(msprite.surface, msprite.posX, msprite.posY, false);

  // Init GUI buttons with locations from the "select" button sprites
  for (let i = 0; i < mainButtons.spriteCount(); i++) {
    const buttonSprite = mainButtons.getSprite(i)!;
    const button = spriteButtonFromDetails(DETAILS_LIST[i], langGet(444 + i), buttonSprite.surface, s);
    button.setFont(FontSize.SMALL);
    button.setTextColor(TEXT_TRN_BLUE);
    button.setPosHints(buttonSprite.posX, buttonSprite.posY);
    menu.attach(button);
  }

  // Add text label
  const label = new Label('SELECT A DIFFICULTY LEVEL');
  label.overrideColor = TEXT_MEDIUM_GREEN;
  label.font = FontSize.SMALL;
  label.setPosHints(87, 155);
  label.setSizeHints(150, 10);
  menu.attach(label);

  // Bind hand animation
  menu.bindHand(handOfDoom, s.gs);
  return menu;
}
