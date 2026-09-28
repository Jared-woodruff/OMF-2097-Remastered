// Robot trade: the HARs Plug offered after the last fight (pilot.harTrades). Focusing one previews it on a temporary
// copy of the pilot; choosing one asks for confirmation. Port of the reference mechlab/lab_menu_trade.c.
import { bkGetInfo, langGet } from '../../../resources/resources';
import { gamePlayerSetPilot } from '../../gameState';
import type { SpriteButton } from '../../gui/spriteButton';
import { FontSize, HAlign, TEXT_TRN_BLUE, TextDirection, VAlign } from '../../gui/text';
import { TrnMenu } from '../../gui/trnMenu';
import type { Component } from '../../gui/widgets';
import type { MechlabScene } from '../mechlab';
import { spriteButtonFromDetails, type ButtonDetails } from './buttonDetails';
import { cFormat } from './common';
import { calculateTradeValue, harPrice } from './harEconomy';
import { labMenuConfirmCreate } from './labMenuConfirm';
import { mechButton } from '../../../gen/mechlabModel';
import { RSprite } from '../../../resources/animation';

/** lab_menu_trade_done(): restores the player's pilot if the trade was abandoned. */
export function labMenuTradeDone(_menu: TrnMenu, submenu: TrnMenu): void {
  const s = submenu.getUserdata() as MechlabScene;
  const p1 = s.gs.getPlayer(0);
  if (p1.pilot !== p1.chr!.pilot) {
    gamePlayerSetPilot(p1, p1.chr!.pilot);
    s.update();
  }
}

/** confirm_trade() */
export function confirmTrade(c: Component, s: MechlabScene): boolean {
  const p1 = s.gs.getPlayer(0);
  const chr = p1.chr!;
  const tradeValue = calculateTradeValue(chr.pilot);
  const harValue = harPrice(p1.pilot.harId);
  chr.pilot.money += tradeValue - harValue;
  chr.pilot.harId = p1.pilot.harId;
  chr.pilot.legSpeed = 0;
  chr.pilot.armSpeed = 0;
  chr.pilot.legPower = 0;
  chr.pilot.armPower = 0;
  chr.pilot.armor = 0;
  chr.pilot.stunResistance = 0;
  gamePlayerSetPilot(p1, chr.pilot);
  s.update();
  (c.parent as TrnMenu).finish();
  return true;
}

/** cancel_trade() */
export function cancelTrade(c: Component, s: MechlabScene): boolean {
  const p1 = s.gs.getPlayer(0);
  gamePlayerSetPilot(p1, p1.chr!.pilot);
  s.update();
  (c.parent as TrnMenu).finish();
  return true;
}

/** lab_menu_trade(): a HAR was chosen; replaces the trade menu with the confirmation. */
export function labMenuTrade(c: SpriteButton, s: MechlabScene): void {
  const p1 = s.gs.getPlayer(0);
  const chr = p1.chr!;
  let tmp = ''; // (uninitialized in the reference when the trade is not affordable)
  const tradeValue = calculateTradeValue(chr.pilot);
  const harValue = harPrice(p1.pilot.harId);
  if (tradeValue === harValue) {
    tmp = cFormat(100, langGet(520), langGet(31 + chr.pilot.harId), langGet(31 + p1.pilot.harId));
  } else if (tradeValue > harValue) {
    const price = `$ ${tradeValue - harValue}K`.slice(0, 14);
    tmp = cFormat(100, langGet(518), langGet(31 + chr.pilot.harId), langGet(31 + p1.pilot.harId), price);
  } else if (tradeValue + p1.pilot.money > harValue) {
    const price = `$ ${harValue - tradeValue}K`.slice(0, 14);
    tmp = cFormat(100, langGet(519), langGet(31 + chr.pilot.harId), price, langGet(31 + p1.pilot.harId));
  }

  const menu = labMenuConfirmCreate(s, (b) => confirmTrade(b, s), (b) => cancelTrade(b, s), tmp);
  menu.setUserdata(s);
  menu.setSubmenuDoneCb(labMenuTradeDone);
  const tradeMenu = c.parent as TrnMenu;
  tradeMenu.finish();
  // Replaces (and frees) the trade menu itself: its done callback does not run.
  (tradeMenu.parent as TrnMenu).setSubmenu(menu);
}

function tradeForFocus(focused: boolean, s: MechlabScene, harId: number): void {
  if (focused) {
    s.gs.getPlayer(0).pilot.harId = harId;
    s.update();
  }
}

/** lab_menu_trade_for_jaguar_focus() ... lab_menu_trade_for_nova_focus(): preview HAR i on the temporary pilot (and the remaster's). */
const FOCUS_CBS = Array.from({ length: 15 }, (_, i) => (_c: SpriteButton, focused: boolean, s: MechlabScene) => tradeForFocus(focused, s, i));

const DETAILS: ButtonDetails<MechlabScene> = {
  cb: labMenuTrade, text: null, dir: TextDirection.HORIZONTAL, halign: HAlign.CENTER, valign: VAlign.TOP,
  margin: { left: 2, right: 0, top: 0, bottom: 0 }, disabled: false,
};

/** lab_menu_trade_create(): also swaps player 1's pilot for an upgrade-less copy used for previews. */
export function labMenuTradeCreate(s: MechlabScene): TrnMenu {
  const mainButtons = bkGetInfo(s.bk, 13)!.ani;
  const handOfDoom = bkGetInfo(s.bk, 29)!.ani;

  const p1 = s.gs.getPlayer(0);
  const pilot = p1.chr!.pilot.clone(); // memcpy of the CHR pilot
  pilot.legSpeed = 0;
  pilot.armSpeed = 0;
  pilot.legPower = 0;
  pilot.armPower = 0;
  pilot.armor = 0;
  pilot.stunResistance = 0;
  gamePlayerSetPilot(p1, pilot);

  let x = 24;
  const y = 148;
  // Initialize menu (no button sheet)
  const menu = new TrnMenu(null, x, y, false);

  // Init GUI buttons with locations from the "select" button sprites (the remaster's robots bring their own)
  for (let i = 0; i < 15; i++) {
    if (i === pilot.harId || ((pilot.harTrades >>> i) & 1) === 0) continue;
    const original = i < mainButtons.spriteCount() ? mainButtons.getSprite(i) : null;
    const extra = original ? null : mechButton(i, mainButtons.getSprite(0)?.surface ?? null, s.bk.palettes[0] ?? null);
    const buttonSprite = original ?? (extra ? new RSprite(i, 2, 2, extra) : null);
    if (!buttonSprite) continue;
    const button = spriteButtonFromDetails(DETAILS, null, buttonSprite.surface, s);
    button.setFont(FontSize.SMALL);
    button.setTextColor(TEXT_TRN_BLUE);
    button.setPosHints(x + buttonSprite.posX, y + buttonSprite.posY);
    x += buttonSprite.width();
    const focus = FOCUS_CBS[i];
    button.setFocusCb((b, focused) => focus(b, focused, s));
    button.setAlwaysDisplay();
    menu.attach(button);
  }

  menu.setUserdata(s);
  menu.setSubmenuDoneCb(labMenuTradeDone);

  // Bind hand animation
  menu.bindHand(handOfDoom, s.gs);
  return menu;
}
