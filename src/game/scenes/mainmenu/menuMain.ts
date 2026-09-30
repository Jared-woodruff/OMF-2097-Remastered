// Main menu entries and their actions (port of the reference mainmenu/menu_main.c).
import { Pilot } from '../../../formats/pilot';
import { AiDifficulty, CtrlType, SceneId } from '../../constants';
import type { GameState } from '../../gameState';
import { Button, Menu } from '../../gui/widgets';
import { settings } from '../../settings';
import type { MainMenuScene } from '../mainmenu';
import { parentMenu } from './common';
import { menuExtrasCreate } from './menuExtras';
import { menuHelpCreate } from './menuHelp';
import { menuModesCreate } from './menuModes';
import { menuOptionsCreate } from './menuOptions';

/**
 * The reference's `if(ctrl_type == KEYBOARD) _setup_keyboard(gs, player, player); else if(GAMEPAD) _setup_joystick(...)`.
 * Player 1 uses key set 0 and player 2 key set 1. Like the reference there is no keyboard fallback for a gamepad that
 * is not connected right now (browsers only expose a pad after one of its buttons is pressed; the controller picks it
 * up then). Only a gamepad setting without a pad index falls back to the keyboard.
 */
export function setupPlayerInput(gs: GameState, player: number): void {
  const k = settings().keys;
  const type = player === 0 ? k.ctrlType1 : k.ctrlType2;
  const pad = player === 0 ? k.gamepad1 : k.gamepad2;
  if (type === CtrlType.GAMEPAD && pad >= 0) gs.setupGamepad(player, pad);
  else gs.setupKeyboard(player, player);
}

/** mainmenu_quit(): the game ends with the credits (which then exit, see the credits scene). */
function mainmenuQuit(s: MainMenuScene): void {
  s.gs.setNext(SceneId.CREDITS);
}

/** mainmenu_1v1(): player 1 against the computer. */
function mainmenu1v1(s: MainMenuScene): void {
  const gs = s.gs;
  setupPlayerInput(gs, 0);
  gs.getPlayer(0).score.setDifficulty(settings().gameplay.difficulty);
  gs.getPlayer(1).score.setDifficulty(settings().gameplay.difficulty);
  gs.setupAi(1);
  gs.matchSettingsReset();
  gs.getPlayer(0).pilot.name = '';
  gs.setNext(SceneId.MELEE);
}

/** mainmenu_1v2(): two human players. */
function mainmenu1v2(s: MainMenuScene): void {
  const gs = s.gs;
  setupPlayerInput(gs, 0);
  setupPlayerInput(gs, 1);
  gs.getPlayer(0).score.setDifficulty(AiDifficulty.CHAMPION);
  gs.getPlayer(1).score.setDifficulty(AiDifficulty.CHAMPION);
  gs.matchSettingsReset();
  gs.getPlayer(0).pilot.name = '';
  gs.setNext(SceneId.MELEE);
}

/** mainmenu_demo(): computer against computer with random pilots and robots. */
export function mainmenuDemo(s: MainMenuScene): void {
  s.gs.matchSettingsReset();
  s.gs.initDemo();
  s.gs.setNext(SceneId.VS);
}

/** mainmenu_soreboard() [sic] */
export function mainmenuScoreboard(s: MainMenuScene): void {
  s.gs.setNext(SceneId.SCOREBOARD);
}

/** mainmenu_mechlab(): tournament play. The reference frees player 2's pilot (the tournament picks the opponents). */
function mainmenuMechlab(s: MainMenuScene): void {
  s.gs.getPlayer(1).pilot = new Pilot();
  s.gs.setNext(SceneId.MECHLAB);
}

/**
 * The main menu. The original's three ways to play come first, then the remaster's: its other modes, its extras (the
 * workshop, replays, records and the original's DEMO and SCOREBOARD), and one OPTIONS menu for the original's
 * CONFIGURATION and GAMEPLAY menus and the remaster's settings.
 */
export function menuMainCreate(s: MainMenuScene): Menu {
  const menu = new Menu();
  menu.attach(new Button('ONE PLAYER GAME', null, false, false, () => mainmenu1v1(s)));
  menu.attach(new Button('TWO PLAYER GAME', null, false, false, () => mainmenu1v2(s)));
  menu.attach(new Button('TOURNAMENT PLAY', null, false, false, () => mainmenuMechlab(s)));
  menu.attach(new Button('MORE MODES', null, false, false, (b) => parentMenu(b).setSubmenu(menuModesCreate(s))));
  menu.attach(new Button('EXTRAS', null, false, false, (b) => parentMenu(b).setSubmenu(menuExtrasCreate(s))));
  menu.attach(new Button('OPTIONS', null, false, false, (b) => parentMenu(b).setSubmenu(menuOptionsCreate(s))));
  menu.attach(new Button('HELP', null, false, false, (b) => parentMenu(b).setSubmenu(menuHelpCreate(s))));
  menu.attach(new Button('QUIT', null, false, false, () => mainmenuQuit(s)));
  return menu;
}
