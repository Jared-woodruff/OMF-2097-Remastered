// The mechlab main menu (arena, training, buy/sell, load/new/delete, sim, quit, new tournament). Port of the
// reference mechlab/lab_menu_main.c.
import { createAiController } from '../../../controller/ai';
import { bkGetInfo, langGet } from '../../../resources/resources';
import { SceneId } from '../../constants';
import { gamePlayerSetPilot } from '../../gameState';
import { componentDisable } from '../../gui/sizer';
import type { SpriteButton } from '../../gui/spriteButton';
import { FontSize, HAlign, TEXT_TRN_BLUE, TextDirection, VAlign } from '../../gui/text';
import { TrnMenu } from '../../gui/trnMenu';
import type { MechlabScene } from '../mechlab';
import { spriteButtonFromDetails, type ButtonDetails } from './buttonDetails';
import { cFormat, DashboardType, tournamentAiDifficulty } from './common';
import { labMenuCustomizeCreate } from './labMenuCustomize';
import { labMenuTrainingCreate } from './labMenuTraining';
import { sgCount } from '../../../resources/sgmanager';

/** lab_menu_main_arena(): fight the next opponent (the pilot ranked just above the player). */
export function labMenuMainArena(_c: SpriteButton, s: MechlabScene): void {
  const enemy = s.nextOpponent();
  if (enemy) {
    // make a new AI controller
    const pilot = enemy.pilot;
    const p1 = s.gs.getPlayer(0);
    if (!s.robotsThere([p1.pilot.harId, pilot.harId])) return;
    const p2 = s.gs.getPlayer(1);
    p2.selectable = false;
    gamePlayerSetPilot(p2, pilot);
    const difficulty = tournamentAiDifficulty(p1.pilot.difficulty);
    p2.setCtrl(createAiController(s.gs, difficulty, pilot, p2.pilot.pilotId));
    // reset the score between matches in tournament mode; assume we used the score by now if we need it for
    // winnings calculations, etc
    p1.score.resetWins();
    p1.score.reset(true);
    // set the score difficulty
    s.gs.getPlayer(0).score.setDifficulty(difficulty);
    s.gs.setNext(SceneId.VS);
  }
}

/** lab_menu_main_quit() */
export function labMenuMainQuit(_c: SpriteButton, s: MechlabScene): void {
  s.gs.setNext(SceneId.MENU);
}

/** lab_menu_main_buy_enter() */
export function labMenuMainBuyEnter(c: SpriteButton, s: MechlabScene): void {
  s.setSelling(false);
  (c.parent as TrnMenu).setSubmenu(labMenuCustomizeCreate(s));
}

/** lab_menu_main_sell_enter() */
export function labMenuMainSellEnter(c: SpriteButton, s: MechlabScene): void {
  s.setSelling(true);
  (c.parent as TrnMenu).setSubmenu(labMenuCustomizeCreate(s));
}

/** lab_menu_main_training_enter() */
export function labMenuMainTrainingEnter(c: SpriteButton, s: MechlabScene): void {
  (c.parent as TrnMenu).setSubmenu(labMenuTrainingCreate(s));
}

/** lab_menu_main_new() */
export function labMenuMainNew(_c: SpriteButton, s: MechlabScene): void {
  s.selectDashboard(DashboardType.NEW_PLAYER);
}

/** lab_menu_main_tournament() */
export function labMenuMainTournament(_c: SpriteButton, s: MechlabScene): void {
  s.selectDashboard(DashboardType.SELECT_TOURNAMENT);
  s.enterTrnselectMenu();
}

/** lab_menu_main_load() */
export function labMenuMainLoad(c: SpriteButton, s: MechlabScene): void {
  const p1 = s.gs.getPlayer(0);
  if (sgCount() === 1 && p1.chr) {
    // one and only loaded
    s.openPopup(langGet(158));
    return;
  } else if (sgCount() === 0) {
    // none to load
    s.openPopup(langGet(157));
    return;
  }
  (c.parent as TrnMenu).setSubmenu(s.chrloadMenuCreate());
}

/** lab_menu_main_delete() */
export function labMenuMainDelete(c: SpriteButton, s: MechlabScene): void {
  const p1 = s.gs.getPlayer(0);
  if (sgCount() === 0 || (sgCount() === 1 && p1.chr)) {
    // none to delete
    s.openPopup(langGet(159));
    return;
  }
  (c.parent as TrnMenu).setSubmenu(s.chrdeleteMenuCreate());
}

/** lab_menu_main_sim() */
export function labMenuMainSim(c: SpriteButton, s: MechlabScene): void {
  s.selectDashboard(DashboardType.SIM);
  (c.parent as TrnMenu).setSubmenu(s.simMenuCreate());
}

const H = TextDirection.HORIZONTAL;
const DETAILS_LIST: ButtonDetails<MechlabScene>[] = [
  // CB, Text, Text direction, Halign, Valign, Margin {left, right, top, bottom}, Start Disabled (unused, see tickers)
  { cb: labMenuMainArena, text: 'ARENA', dir: H, halign: HAlign.CENTER, valign: VAlign.TOP, margin: { left: 0, right: 0, top: 2, bottom: 0 }, disabled: false },
  { cb: labMenuMainTrainingEnter, text: 'TRAINING COURSES', dir: H, halign: HAlign.CENTER, valign: VAlign.MIDDLE, margin: { left: 22, right: 0, top: 0, bottom: 0 }, disabled: false },
  { cb: labMenuMainBuyEnter, text: 'BUY', dir: H, halign: HAlign.CENTER, valign: VAlign.TOP, margin: { left: 0, right: 0, top: 2, bottom: 0 }, disabled: false },
  { cb: labMenuMainSellEnter, text: 'SELL', dir: H, halign: HAlign.CENTER, valign: VAlign.TOP, margin: { left: 0, right: 0, top: 2, bottom: 0 }, disabled: false },
  { cb: labMenuMainLoad, text: 'LOAD', dir: H, halign: HAlign.CENTER, valign: VAlign.MIDDLE, margin: { left: 12, right: 0, top: 0, bottom: 0 }, disabled: false },
  { cb: labMenuMainNew, text: 'NEW', dir: H, halign: HAlign.CENTER, valign: VAlign.MIDDLE, margin: { left: 12, right: 0, top: 0, bottom: 0 }, disabled: false },
  { cb: labMenuMainDelete, text: 'DELETE', dir: H, halign: HAlign.CENTER, valign: VAlign.MIDDLE, margin: { left: 12, right: 0, top: 0, bottom: 0 }, disabled: false },
  { cb: labMenuMainSim, text: 'SIM', dir: H, halign: HAlign.CENTER, valign: VAlign.TOP, margin: { left: 0, right: 0, top: 2, bottom: 0 }, disabled: false },
  { cb: labMenuMainQuit, text: 'QUIT', dir: TextDirection.VERTICAL, halign: HAlign.CENTER, valign: VAlign.MIDDLE, margin: { left: 1, right: 0, top: 0, bottom: 0 }, disabled: false },
  { cb: labMenuMainTournament, text: 'NEW TOURNAMENT', dir: H, halign: HAlign.CENTER, valign: VAlign.MIDDLE, margin: { left: 0, right: 0, top: 0, bottom: 0 }, disabled: false },
];

/** lab_menu_focus_arena() */
export function labMenuFocusArena(_c: SpriteButton, focused: boolean, s: MechlabScene): void {
  if (focused) {
    const enemy = s.nextOpponent();
    if (enemy) s.setHint(cFormat(100, langGet(537), enemy.pilot.name));
  }
}

function focusHint(id: number): (c: SpriteButton, focused: boolean, s: MechlabScene) => void {
  return (_c, focused, s) => {
    if (focused) s.setHint(langGet(id));
  };
}

/** lab_menu_focus_training/buy/sell/load/new/delete/sim/quit/tournament() */
export const labMenuFocusTraining = focusHint(538);
export const labMenuFocusBuy = focusHint(539);
export const labMenuFocusSell = focusHint(540);
export const labMenuFocusLoad = focusHint(541);
export const labMenuFocusNew = focusHint(542);
export const labMenuFocusDelete = focusHint(543);
export const labMenuFocusSim = focusHint(544);
export const labMenuFocusQuit = focusHint(545);
export const labMenuFocusTournament = focusHint(546);

const FOCUS_CBS = [
  labMenuFocusArena, labMenuFocusTraining, labMenuFocusBuy, labMenuFocusSell, labMenuFocusLoad,
  labMenuFocusNew, labMenuFocusDelete, labMenuFocusSim, labMenuFocusQuit, labMenuFocusTournament,
];

function setEnabled(c: SpriteButton, enabled: boolean): void {
  componentDisable(c, !enabled);
  c.supportsSelect = enabled;
}

/** lab_menu_tick_arena(): only with a loaded character that is not the champion yet. */
export function labMenuTickArena(c: SpriteButton, s: MechlabScene): void {
  const p1 = s.gs.getPlayer(0);
  setEnabled(c, !!p1.chr && p1.chr.pilot.rank > 1);
}

/** lab_menu_tick_in_tournament() */
export function labMenuTickInTournament(c: SpriteButton, s: MechlabScene): void {
  const p1 = s.gs.getPlayer(0);
  setEnabled(c, !!p1.chr && p1.chr.pilot.rank !== 0);
}

/** lab_menu_tick_chr_loaded() */
function labMenuTickChrLoaded(c: SpriteButton, s: MechlabScene): void {
  setEnabled(c, !!s.gs.getPlayer(0).chr);
}

const TICK_CBS: (((c: SpriteButton, s: MechlabScene) => void) | null)[] = [
  labMenuTickArena, // arena
  labMenuTickInTournament, // training
  labMenuTickInTournament, // buy
  labMenuTickInTournament, // sell
  null, // load
  null, // new
  null, // delete
  labMenuTickInTournament, // sim
  null, // quit
  labMenuTickChrLoaded, // tournament
];

/** lab_menu_main_create() (`characterLoaded` is unused, like in the reference) */
export function labMenuMainCreate(s: MechlabScene, _characterLoaded: boolean): TrnMenu {
  const mainSheets = bkGetInfo(s.bk, 1)!.ani;
  const mainButtons = bkGetInfo(s.bk, 8)!.ani;
  const handOfDoom = bkGetInfo(s.bk, 29)!.ani;

  // Initialize menu, and set button sheet
  const msprite = mainSheets.getSprite(2)!;
  const menu = new TrnMenu(msprite.surface, msprite.posX, msprite.posY, false);

  // Init GUI buttons with locations from the "select" button sprites
  for (let i = 0; i < mainButtons.spriteCount(); i++) {
    const buttonSprite = mainButtons.getSprite(i)!;
    const button = spriteButtonFromDetails(DETAILS_LIST[i], null, buttonSprite.surface, s);
    button.setFont(FontSize.SMALL);
    button.setTextColor(TEXT_TRN_BLUE);
    button.setPosHints(buttonSprite.posX, buttonSprite.posY);
    const focus = FOCUS_CBS[i];
    button.setFocusCb((b, focused) => focus(b, focused, s));
    const tick = TICK_CBS[i];
    button.setTickCb(tick ? (b) => tick(b, s) : null);
    button.tick();
    menu.attach(button);
  }

  // Bind hand animation
  menu.bindHand(handOfDoom, s.gs);
  return menu;
}
