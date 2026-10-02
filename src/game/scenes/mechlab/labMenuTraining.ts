// Pilot training courses (power, agility, endurance). Port of the reference mechlab/lab_menu_training.c.
import { bkGetInfo, langGet } from '../../../resources/resources';
import { componentDisable } from '../../gui/sizer';
import type { SpriteButton } from '../../gui/spriteButton';
import { FontSize, HAlign, TEXT_TRN_BLUE, TextDirection, VAlign } from '../../gui/text';
import { TrnMenu } from '../../gui/trnMenu';
import { Label } from '../../gui/widgets';
import { scoreFormat } from '../../score';
import type { MechlabScene } from '../mechlab';
import { spriteButtonFromDetails, type ButtonDetails } from './buttonDetails';

// "I don't care anymore, sorry" (reference: module-level labels of the current training menu)
let label1: Label | null = null;
let label2: Label | null = null;

const PRICES = [
  50, 80, 120, 180, 240, 300, 450, 600, 800, 1100, 1500, 2500,
  4000, 7000, 10000, 14000, 20000, 28000, 40000, 55000, 75000, 100000, 140000, 200000,
];

type Stat = 'power' | 'agility' | 'endurance';

function train(c: SpriteButton, s: MechlabScene, stat: Stat): void {
  const pilot = s.gs.getPlayer(0).pilot;
  const price = PRICES[pilot[stat]];
  pilot.money -= price;
  pilot[stat]++;
  s.update();
}

/** Price check of a course: disabled at the maximum level or when unaffordable (never re-enabled, like the reference). */
function checkPrice(c: SpriteButton, s: MechlabScene, stat: Stat): void {
  const pilot = s.gs.getPlayer(0).pilot;
  if (pilot[stat] > 23) {
    componentDisable(c, true);
    return;
  }
  const price = PRICES[pilot[stat]];
  if (price > pilot.money) componentDisable(c, true);
}

/** lab_menu_training_power() */
export function labMenuTrainingPower(c: SpriteButton, s: MechlabScene): void {
  train(c, s, 'power');
  labMenuFocusPower(c, true, s);
}

/** lab_menu_training_check_power_price() */
export function labMenuTrainingCheckPowerPrice(c: SpriteButton, s: MechlabScene): void {
  checkPrice(c, s, 'power');
}

/** lab_menu_training_agility() */
export function labMenuTrainingAgility(c: SpriteButton, s: MechlabScene): void {
  train(c, s, 'agility');
  labMenuFocusAgility(c, true, s);
}

/** lab_menu_training_check_agility_price() */
export function labMenuTrainingCheckAgilityPrice(c: SpriteButton, s: MechlabScene): void {
  checkPrice(c, s, 'agility');
}

/** lab_menu_training_endurance() */
export function labMenuTrainingEndurance(c: SpriteButton, s: MechlabScene): void {
  train(c, s, 'endurance');
  labMenuFocusEndurance(c, true, s);
}

/** lab_menu_training_check_endurance_price() */
export function labMenuTrainingCheckEndurancePrice(c: SpriteButton, s: MechlabScene): void {
  checkPrice(c, s, 'endurance');
}

/** lab_menu_training_done() */
export function labMenuTrainingDone(c: SpriteButton, _s: MechlabScene): void {
  (c.parent as TrnMenu).finish();
}

const DETAILS_LIST: ButtonDetails<MechlabScene>[] = [
  { cb: labMenuTrainingPower, text: 'POWER', dir: TextDirection.HORIZONTAL, halign: HAlign.CENTER, valign: VAlign.TOP, margin: { left: 0, right: 0, top: 2, bottom: 0 }, disabled: false },
  { cb: labMenuTrainingAgility, text: 'AGILITY', dir: TextDirection.HORIZONTAL, halign: HAlign.CENTER, valign: VAlign.TOP, margin: { left: 0, right: 0, top: 2, bottom: 0 }, disabled: false },
  { cb: labMenuTrainingEndurance, text: 'ENDUR.', dir: TextDirection.HORIZONTAL, halign: HAlign.CENTER, valign: VAlign.TOP, margin: { left: 0, right: 0, top: 2, bottom: 0 }, disabled: false },
  { cb: labMenuTrainingDone, text: 'DONE', dir: TextDirection.VERTICAL, halign: HAlign.CENTER, valign: VAlign.MIDDLE, margin: { left: 1, right: 0, top: 0, bottom: 0 }, disabled: false },
];

function focusCourse(s: MechlabScene, stat: Stat, titleId: number, hintId: number): void {
  const pilot = s.gs.getPlayer(0).pilot;
  label1?.setText(langGet(titleId));
  if (pilot[stat] > 23) {
    label2?.setText('UNAVAILABLE');
  } else {
    // char price_str[16]; snprintf(tmp, 32, "$ %sK", price_str)
    label2?.setText(`$ ${scoreFormat(PRICES[pilot[stat]]).slice(0, 15)}K`.slice(0, 31));
  }
  s.setHint(langGet(hintId));
}

function labMenuFocusPower(_c: SpriteButton, focused: boolean, s: MechlabScene): void {
  if (focused) focusCourse(s, 'power', 512, 533);
}

function labMenuFocusAgility(_c: SpriteButton, focused: boolean, s: MechlabScene): void {
  if (focused) focusCourse(s, 'agility', 513, 534);
}

function labMenuFocusEndurance(_c: SpriteButton, focused: boolean, s: MechlabScene): void {
  if (focused) focusCourse(s, 'endurance', 514, 535);
}

/** lab_menu_focus_training_done() */
export function labMenuFocusTrainingDone(_c: SpriteButton, focused: boolean, s: MechlabScene): void {
  if (focused) {
    label1?.setText('');
    label2?.setText('');
    s.setHint(langGet(536));
  }
}

const FOCUS_CBS = [labMenuFocusPower, labMenuFocusAgility, labMenuFocusEndurance, labMenuFocusTrainingDone];

/** lab_menu_training_create() */
export function labMenuTrainingCreate(s: MechlabScene): TrnMenu {
  const mainSheets = bkGetInfo(s.bk, 1)!.ani;
  const mainButtons = bkGetInfo(s.bk, 9)!.ani;
  const handOfDoom = bkGetInfo(s.bk, 29)!.ani;

  // Initialize menu, and set button sheet
  const msprite = mainSheets.getSprite(1)!;
  const menu = new TrnMenu(msprite.surface, msprite.posX, msprite.posY, false);

  // Init GUI buttons with locations from the "select" button sprites
  for (let i = 0; i < mainButtons.spriteCount(); i++) {
    const buttonSprite = mainButtons.getSprite(i)!;
    const button = spriteButtonFromDetails(DETAILS_LIST[i], null, buttonSprite.surface, s);
    button.setFont(FontSize.SMALL);
    button.setTextColor(TEXT_TRN_BLUE);
    button.setPosHints(buttonSprite.posX, buttonSprite.posY);
    if (i === 0) button.setTickCb((b) => labMenuTrainingCheckPowerPrice(b, s));
    else if (i === 1) button.setTickCb((b) => labMenuTrainingCheckAgilityPrice(b, s));
    else if (i === 2) button.setTickCb((b) => labMenuTrainingCheckEndurancePrice(b, s));
    button.tick();
    const focus = FOCUS_CBS[i];
    button.setFocusCb((b, focused) => focus(b, focused, s));
    menu.attach(button);
  }

  label1 = new Label('');
  label1.overrideColor = 0xa5;
  label1.font = FontSize.SMALL;
  label1.setSizeHints(90, 110);
  label1.setPosHints(200, 148);
  menu.attach(label1);

  label2 = new Label('');
  label2.overrideColor = 0xa7;
  label2.font = FontSize.SMALL;
  label2.setSizeHints(90, 110);
  label2.setPosHints(200, 186);
  menu.attach(label2);

  // Bind hand animation
  menu.bindHand(handOfDoom, s.gs);
  return menu;
}
