// BUY / SELL menu: HAR colors, upgrade kits and the robot trade. Port of the reference
// mechlab/lab_menu_customize.c (calculate_trade_value, har_price and sell_highest_value_upgrade are in harEconomy.ts).
import { ensureMechIcon } from '../../../gen/mechlabModel';
import type { Pilot } from '../../../formats/pilot';
import { bkGetInfo, harName, langGet } from '../../../resources/resources';
import { componentDisable } from '../../gui/sizer';
import { SpriteButton } from '../../gui/spriteButton';
import { FontSize, HAlign, TEXT_TRN_BLUE, TextDirection, VAlign } from '../../gui/text';
import { TrnMenu } from '../../gui/trnMenu';
import { Label } from '../../gui/widgets';
import { PRIMARY, SECONDARY, setPilotColor, TERTIARY } from '../../pilotColors';
import { scoreFormat } from '../../score';
import type { MechlabScene } from '../mechlab';
import { spriteButtonFromDetails, type ButtonDetails } from './buttonDetails';
import { cFormat } from './common';
import {
  ARM_LEG_MULTIPLIER, ARMOR_MULTIPLIER, calculateTradeValue, HAR_PRICES, MAX_ARM_POWER, MAX_ARM_SPEED, MAX_ARMOR, MAX_LEG_POWER,
  MAX_LEG_SPEED, MAX_STUN_RES, STUN_RES_MULTIPLIER, upgradeCost,
} from './harEconomy';
import { labMenuTradeCreate } from './labMenuTrade';

// Module-level labels of the current customize menu (reference static globals)
let headerLabel: Label | null = null;
let detailsLabel: Label | null = null;

/** One HAR upgrade kit: pilot field, price multiplier, max levels per HAR and the texts of its focus handler. */
interface UpgradeKit {
  get(p: Pilot): number;
  set(p: Pilot, v: number): void;
  multiplier: number;
  max: number[];
  /** header label title ("ARM POWER:" ...) */
  title: string;
  /** hint string ids (selling, buying) and the %s argument (null: hint used as is) */
  sellHint: number;
  buyHint: number;
  hintArg: string | null;
}

const ARM_POWER_KIT: UpgradeKit = {
  get: (p) => p.armPower, set: (p, v) => (p.armPower = v), multiplier: ARM_LEG_MULTIPLIER, max: MAX_ARM_POWER,
  title: 'ARM POWER:', sellHint: 553, buyHint: 554, hintArg: 'arm',
};
const LEG_POWER_KIT: UpgradeKit = {
  get: (p) => p.legPower, set: (p, v) => (p.legPower = v), multiplier: ARM_LEG_MULTIPLIER, max: MAX_LEG_POWER,
  title: 'LEG POWER:', sellHint: 555, buyHint: 556, hintArg: 'leg',
};
const ARM_SPEED_KIT: UpgradeKit = {
  get: (p) => p.armSpeed, set: (p, v) => (p.armSpeed = v), multiplier: ARM_LEG_MULTIPLIER, max: MAX_ARM_SPEED,
  title: 'ARM SPEED:', sellHint: 557, buyHint: 558, hintArg: 'arm',
};
const LEG_SPEED_KIT: UpgradeKit = {
  get: (p) => p.legSpeed, set: (p, v) => (p.legSpeed = v), multiplier: ARM_LEG_MULTIPLIER, max: MAX_LEG_SPEED,
  title: 'LEG SPEED:', sellHint: 559, buyHint: 560, hintArg: 'leg',
};
const ARMOR_KIT: UpgradeKit = {
  get: (p) => p.armor, set: (p, v) => (p.armor = v), multiplier: ARMOR_MULTIPLIER, max: MAX_ARMOR,
  title: 'ARMOR PLATE:', sellHint: 561, buyHint: 562, hintArg: null,
};
const STUN_RES_KIT: UpgradeKit = {
  get: (p) => p.stunResistance, set: (p, v) => (p.stunResistance = v), multiplier: STUN_RES_MULTIPLIER, max: MAX_STUN_RES,
  title: 'STUN RES.:', sellHint: 563, buyHint: 564, hintArg: null,
};

function playerPilot(s: MechlabScene): Pilot {
  return s.gs.getPlayer(0).pilot;
}

/** lab_menu_customize_done() */
export function labMenuCustomizeDone(c: SpriteButton, _s: MechlabScene): void {
  (c.parent as TrnMenu).finish();
}

/** lab_menu_customize_color_main() */
export function labMenuCustomizeColorMain(_c: SpriteButton, s: MechlabScene): void {
  const chr = s.gs.getPlayer(0).chr!;
  setPilotColor(chr.pilot, PRIMARY, (chr.pilot.color1 + 1) % 17);
  s.update();
}

/** lab_menu_customize_color_secondary() */
export function labMenuCustomizeColorSecondary(_c: SpriteButton, s: MechlabScene): void {
  const chr = s.gs.getPlayer(0).chr!;
  setPilotColor(chr.pilot, SECONDARY, (chr.pilot.color2 + 1) % 17);
  s.update();
}

/** lab_menu_customize_color_third() */
export function labMenuCustomizeColorThird(_c: SpriteButton, s: MechlabScene): void {
  const chr = s.gs.getPlayer(0).chr!;
  setPilotColor(chr.pilot, TERTIARY, (chr.pilot.color3 + 1) % 17);
  s.update();
}

/** Buys (or sells, when selling) one level of an upgrade kit (lab_menu_customize_arm_power & co). */
function customizeKit(c: SpriteButton, s: MechlabScene, kit: UpgradeKit): void {
  const pilot = playerPilot(s);
  const level = kit.get(pilot);
  if (s.getSelling()) {
    const price = upgradeCost(pilot.harId, level, kit.multiplier);
    if (price > 0) {
      pilot.money = Math.trunc(pilot.money + price * 0.85) | 0; // int32 += double
      kit.set(pilot, level - 1);
      s.update();
    }
  } else {
    const price = upgradeCost(pilot.harId, level + 1, kit.multiplier);
    pilot.money -= price;
    kit.set(pilot, level + 1);
    s.update();
  }
  focusKit(c, true, s, kit);
}

/** Enables the kit button when it can be sold / afforded (lab_menu_customize_check_*_price). */
function checkKitPrice(c: SpriteButton, s: MechlabScene, kit: UpgradeKit): void {
  const pilot = playerPilot(s);
  const level = kit.get(pilot);
  if (s.getSelling()) {
    const price = upgradeCost(pilot.harId, level, kit.multiplier);
    componentDisable(c, price < 1);
  } else {
    const price = upgradeCost(pilot.harId, level + 1, kit.multiplier);
    componentDisable(c, price > pilot.money || level + 1 > kit.max[pilot.harId]);
  }
}

/** Header / details / hint texts of a kit (lab_menu_focus_arm_power & co). */
function focusKit(_c: SpriteButton, focused: boolean, s: MechlabScene, kit: UpgradeKit): void {
  if (!focused) return;
  const pilot = playerPilot(s);
  const level = kit.get(pilot);
  if (s.getSelling()) {
    headerLabel?.setText(`${kit.title}\n\nSALES PRICE:`);
    const price = upgradeCost(pilot.harId, level, kit.multiplier);
    if (price < 1) {
      detailsLabel?.setText('Unavailable\n\nUnavailable');
    } else {
      const priceStr = scoreFormat(Math.trunc(price * 0.85));
      detailsLabel?.setText(cFormat(200, 'Level %d\n\n$ %sK', level, priceStr));
    }
    s.setHint(kit.hintArg !== null ? cFormat(200, langGet(kit.sellHint), kit.hintArg) : langGet(kit.sellHint));
  } else {
    headerLabel?.setText(`${kit.title}\n\nUPGRADE COST:`);
    const price = upgradeCost(pilot.harId, level + 1, kit.multiplier);
    if (level >= kit.max[pilot.harId]) {
      detailsLabel?.setText('Unavailable\n\nUnavailable');
    } else {
      detailsLabel?.setText(cFormat(200, 'Level %d\n\n$ %sK', level + 1, scoreFormat(price)));
    }
    s.setHint(kit.hintArg !== null ? cFormat(200, langGet(kit.buyHint), kit.hintArg) : langGet(kit.buyHint));
  }
}

/** lab_menu_customize_arm_power() */
export function labMenuCustomizeArmPower(c: SpriteButton, s: MechlabScene): void {
  customizeKit(c, s, ARM_POWER_KIT);
}
/** lab_menu_customize_check_arm_power_price() */
export function labMenuCustomizeCheckArmPowerPrice(c: SpriteButton, s: MechlabScene): void {
  checkKitPrice(c, s, ARM_POWER_KIT);
}
/** lab_menu_customize_leg_power() */
export function labMenuCustomizeLegPower(c: SpriteButton, s: MechlabScene): void {
  customizeKit(c, s, LEG_POWER_KIT);
}
/** lab_menu_customize_check_leg_power_price() */
export function labMenuCustomizeCheckLegPowerPrice(c: SpriteButton, s: MechlabScene): void {
  checkKitPrice(c, s, LEG_POWER_KIT);
}
/** lab_menu_customize_arm_speed() */
export function labMenuCustomizeArmSpeed(c: SpriteButton, s: MechlabScene): void {
  customizeKit(c, s, ARM_SPEED_KIT);
}
/** lab_menu_customize_check_arm_speed_price() */
export function labMenuCustomizeCheckArmSpeedPrice(c: SpriteButton, s: MechlabScene): void {
  checkKitPrice(c, s, ARM_SPEED_KIT);
}
/** lab_menu_customize_leg_speed() */
export function labMenuCustomizeLegSpeed(c: SpriteButton, s: MechlabScene): void {
  customizeKit(c, s, LEG_SPEED_KIT);
}
/** lab_menu_customize_check_leg_speed_price() */
export function labMenuCustomizeCheckLegSpeedPrice(c: SpriteButton, s: MechlabScene): void {
  checkKitPrice(c, s, LEG_SPEED_KIT);
}
/** lab_menu_customize_armor() */
export function labMenuCustomizeArmor(c: SpriteButton, s: MechlabScene): void {
  customizeKit(c, s, ARMOR_KIT);
}
/** lab_menu_customize_check_armor_price() */
export function labMenuCustomizeCheckArmorPrice(c: SpriteButton, s: MechlabScene): void {
  checkKitPrice(c, s, ARMOR_KIT);
}
/** lab_menu_customize_stun_resistance() */
export function labMenuCustomizeStunResistance(c: SpriteButton, s: MechlabScene): void {
  customizeKit(c, s, STUN_RES_KIT);
}
/** lab_menu_customize_check_stun_resistance_price() */
export function labMenuCustomizeCheckStunResistancePrice(c: SpriteButton, s: MechlabScene): void {
  checkKitPrice(c, s, STUN_RES_KIT);
}

/** lab_menu_customize_trade() */
export function labMenuCustomizeTrade(c: SpriteButton, s: MechlabScene): void {
  (c.parent as TrnMenu).setSubmenu(labMenuTradeCreate(s));
}

/** HARs of the trade list the player can afford now (current HAR excluded). */
function affordableTrades(pilot: Pilot): number[] {
  const tradeValue = calculateTradeValue(pilot);
  const trades: number[] = [];
  for (let i = 0; i < 15; i++) {
    if (i === pilot.harId) continue; // don't trade for the current HAR
    if ((pilot.harTrades >>> i) & 1 && HAR_PRICES[i] < tradeValue + pilot.money) trades.push(i);
  }
  return trades;
}

/** lab_menu_customize_check_trade_robot() */
export function labMenuCustomizeCheckTradeRobot(c: SpriteButton, s: MechlabScene): void {
  componentDisable(c, affordableTrades(playerPilot(s)).length === 0);
}

const NO_MARGIN = { left: 0, right: 0, top: 0, bottom: 0 };
const H = TextDirection.HORIZONTAL;

const DETAILS_LIST: ButtonDetails<MechlabScene>[] = [
  { cb: labMenuCustomizeColorMain, text: null, dir: H, halign: HAlign.CENTER, valign: VAlign.MIDDLE, margin: NO_MARGIN, disabled: false }, // Blue
  { cb: labMenuCustomizeColorThird, text: null, dir: H, halign: HAlign.CENTER, valign: VAlign.MIDDLE, margin: NO_MARGIN, disabled: false }, // Yellow
  { cb: labMenuCustomizeColorSecondary, text: null, dir: H, halign: HAlign.CENTER, valign: VAlign.MIDDLE, margin: NO_MARGIN, disabled: false }, // Red
  { cb: labMenuCustomizeArmPower, text: 'ARM POWER', dir: H, halign: HAlign.CENTER, valign: VAlign.MIDDLE, margin: { left: 1, right: 0, top: 0, bottom: 0 }, disabled: false },
  { cb: labMenuCustomizeLegPower, text: 'LEG POWER', dir: H, halign: HAlign.CENTER, valign: VAlign.MIDDLE, margin: { left: 1, right: 0, top: 0, bottom: 0 }, disabled: false },
  { cb: labMenuCustomizeArmSpeed, text: 'ARM SPEED', dir: H, halign: HAlign.CENTER, valign: VAlign.MIDDLE, margin: { left: 1, right: 0, top: 0, bottom: 0 }, disabled: false },
  { cb: labMenuCustomizeLegSpeed, text: 'LEG SPEED', dir: H, halign: HAlign.CENTER, valign: VAlign.MIDDLE, margin: { left: 1, right: 0, top: 0, bottom: 0 }, disabled: false },
  { cb: labMenuCustomizeArmor, text: 'ARMOR', dir: H, halign: HAlign.CENTER, valign: VAlign.MIDDLE, margin: { left: 1, right: 0, top: 0, bottom: 0 }, disabled: false },
  { cb: labMenuCustomizeStunResistance, text: 'STUN RES.', dir: H, halign: HAlign.CENTER, valign: VAlign.MIDDLE, margin: NO_MARGIN, disabled: false },
  { cb: labMenuCustomizeTrade, text: 'TRADE ROBOT', dir: H, halign: HAlign.CENTER, valign: VAlign.MIDDLE, margin: NO_MARGIN, disabled: false },
  { cb: labMenuCustomizeDone, text: 'DONE', dir: TextDirection.VERTICAL, halign: HAlign.CENTER, valign: VAlign.MIDDLE, margin: { left: 1, right: 0, top: 0, bottom: 0 }, disabled: false },
];

const TICKERS: (((c: SpriteButton, s: MechlabScene) => void) | null)[] = [
  null,
  null,
  null,
  labMenuCustomizeCheckArmPowerPrice,
  labMenuCustomizeCheckLegPowerPrice,
  labMenuCustomizeCheckArmSpeedPrice,
  labMenuCustomizeCheckLegSpeedPrice,
  labMenuCustomizeCheckArmorPrice,
  labMenuCustomizeCheckStunResistancePrice,
  labMenuCustomizeCheckTradeRobot,
  null,
];

function focusColor(focused: boolean, s: MechlabScene, sellHint: number, buyHint: number): void {
  if (focused) {
    s.setHint(langGet(s.getSelling() ? sellHint : buyHint));
    headerLabel?.setText('');
    detailsLabel?.setText('');
  }
  s.spinHar(!focused);
}

/** lab_menu_focus_blue() */
export function labMenuFocusBlue(_c: SpriteButton, focused: boolean, s: MechlabScene): void {
  focusColor(focused, s, 547, 548);
}

/** lab_menu_focus_yellow() */
export function labMenuFocusYellow(_c: SpriteButton, focused: boolean, s: MechlabScene): void {
  focusColor(focused, s, 551, 552);
}

/** lab_menu_focus_red() */
export function labMenuFocusRed(_c: SpriteButton, focused: boolean, s: MechlabScene): void {
  focusColor(focused, s, 549, 550);
}

/** lab_menu_focus_trade() */
export function labMenuFocusTrade(_c: SpriteButton, focused: boolean, s: MechlabScene): void {
  if (!focused) return;
  s.setHint(langGet(565));
  const trades = affordableTrades(playerPilot(s));
  // check if there's anything for trade
  if (trades.length === 0) {
    headerLabel?.setText(langGet(488));
    detailsLabel?.setText('');
  } else {
    headerLabel?.setText(langGet(461));
    // The reference formats 1..5 names (its buffer holds 5; the VS screen never offers more) and nothing otherwise.
    const names = trades.map((i) => harName(i));
    detailsLabel?.setText(names.length <= 5 ? names.join('\n').slice(0, 199) : '');
  }
}

/** lab_menu_focus_done() */
export function labMenuFocusDone(_c: SpriteButton, focused: boolean, s: MechlabScene): void {
  if (focused) {
    s.setHint(langGet(s.getSelling() ? 567 : 568));
    headerLabel?.setText('');
    detailsLabel?.setText('');
  }
}

const FOCUS_CBS: ((c: SpriteButton, focused: boolean, s: MechlabScene) => void)[] = [
  labMenuFocusBlue,
  labMenuFocusYellow,
  labMenuFocusRed,
  (c, f, s) => focusKit(c, f, s, ARM_POWER_KIT),
  (c, f, s) => focusKit(c, f, s, LEG_POWER_KIT),
  (c, f, s) => focusKit(c, f, s, ARM_SPEED_KIT),
  (c, f, s) => focusKit(c, f, s, LEG_SPEED_KIT),
  (c, f, s) => focusKit(c, f, s, ARMOR_KIT),
  (c, f, s) => focusKit(c, f, s, STUN_RES_KIT),
  labMenuFocusTrade,
  labMenuFocusDone,
];

/**
 * lab_menu_har_picture_tick(): follows HAR trades. Like the reference, only the image and its position hints change:
 * the button keeps its laid out position until the menu is laid out again.
 */
function labMenuHarPictureTick(currentPicture: SpriteButton, s: MechlabScene): void {
  if ((currentPicture.parent as TrnMenu).isFading()) return;
  const correctPicture = bkGetInfo(s.bk, 5)!.ani;
  ensureMechIcon(correctPicture, playerPilot(s).harId);
  const correctSprite = correctPicture.getSprite(playerPilot(s).harId);
  if (correctSprite && currentPicture.getImg() !== correctSprite.surface) {
    currentPicture.setImg(correctSprite.surface);
    currentPicture.setPosHints(correctSprite.posX, correctSprite.posY);
  }
}

/** lab_menu_customize_create() */
export function labMenuCustomizeCreate(s: MechlabScene): TrnMenu {
  const mainSheets = bkGetInfo(s.bk, 1)!.ani;
  const mainButtons = bkGetInfo(s.bk, 3)!.ani;
  const handOfDoom = bkGetInfo(s.bk, 29)!.ani;
  const harPicture = bkGetInfo(s.bk, 5)!.ani;

  // Initialize menu, and set button sheet
  const msprite = mainSheets.getSprite(0)!;
  const menu = new TrnMenu(msprite.surface, msprite.posX, msprite.posY, false);

  // Init GUI buttons with locations from the "select" button sprites
  for (let i = 0; i < mainButtons.spriteCount(); i++) {
    const buttonSprite = mainButtons.getSprite(i)!;
    const button = spriteButtonFromDetails(DETAILS_LIST[i], null, buttonSprite.surface, s);
    button.setFont(FontSize.SMALL);
    button.setTextColor(TEXT_TRN_BLUE);
    button.setPosHints(buttonSprite.posX, buttonSprite.posY);
    const ticker = TICKERS[i];
    button.setTickCb(ticker ? (b) => ticker(b, s) : null);
    const focus = FOCUS_CBS[i];
    button.setFocusCb((b, focused) => focus(b, focused, s));
    button.tick();
    menu.attach(button);
  }

  // (MECHLAB.BK has the original robots' pictures; the others get theirs made)
  ensureMechIcon(harPicture, playerPilot(s).harId);
  const bsprite = harPicture.getSprite(playerPilot(s).harId) ?? harPicture.getSprite(0)!;
  const button = new SpriteButton(null, bsprite.surface, false, null);
  button.setPosHints(bsprite.posX, bsprite.posY);
  button.supportsSelect = false;
  button.setAlwaysDisplay();
  button.setTickCb((b) => labMenuHarPictureTick(b, s));
  menu.attach(button);

  headerLabel = new Label('');
  headerLabel.letterSpacing = 2;
  headerLabel.overrideColor = 0xa5;
  headerLabel.font = FontSize.SMALL;
  headerLabel.setSizeHints(90, 80);
  headerLabel.setPosHints(210, 150);
  menu.attach(headerLabel);

  detailsLabel = new Label('');
  detailsLabel.letterSpacing = 2;
  detailsLabel.overrideColor = 0xa7;
  detailsLabel.font = FontSize.SMALL;
  detailsLabel.setSizeHints(90, 80);
  detailsLabel.setPosHints(210, 158);
  menu.attach(detailsLabel);

  // Bind hand animation
  menu.bindHand(handOfDoom, s.gs);
  return menu;
}
