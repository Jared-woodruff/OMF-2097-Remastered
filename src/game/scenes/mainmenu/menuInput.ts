// Input device selection for player 1 or 2 (port of the reference mainmenu/menu_input.c).
import { connectedPads } from '../../../controller/input';
import { CtrlType } from '../../constants';
import { Button, Filler, Label, Menu } from '../../gui/widgets';
import { defaultSettings, settings } from '../../settings';
import type { MainMenuScene } from '../mainmenu';
import { menuDone, menuLinkMenu, parentMenu, settingsChanged } from './common';
import { KEYBOARD_FRAME, menuKeyboardCreate } from './menuKeyboard';

/**
 * RIGHT KEYBOARD / LEFT KEYBOARD (menu_set_right_keyboard / menu_set_left_keyboard): the chosen layout goes to the
 * selected player and the other layout to the other player, both players become keyboard controlled. The layouts are
 * our default bindings (right = arrows/numpad, ENTER, RIGHT SHIFT; left = QWE/AD/ZXC, LEFT CTRL, LEFT SHIFT).
 */
function setKeyboardLayout(s: MainMenuScene, selectedPlayer: number, right: boolean): void {
  const k = settings().keys;
  const d = defaultSettings().keys;
  const mine = right ? d.p1 : d.p2;
  const other = right ? d.p2 : d.p1;
  if (selectedPlayer === 1) {
    k.p1 = mine;
    k.p2 = other;
  } else {
    k.p2 = mine;
    k.p1 = other;
  }
  k.ctrlType1 = CtrlType.KEYBOARD;
  k.ctrlType2 = CtrlType.KEYBOARD;
  s.gs.reconfigureControllers();
  settingsChanged();
}

/** menu_set_joystick1 / menu_set_joystick2: use the nth connected gamepad. */
function setJoystick(s: MainMenuScene, selectedPlayer: number, nth: number): void {
  const pad = connectedPads()[nth];
  if (pad === undefined) return;
  const k = settings().keys;
  if (selectedPlayer === 1) {
    k.ctrlType1 = CtrlType.GAMEPAD;
    k.gamepad1 = pad;
  } else {
    k.ctrlType2 = CtrlType.GAMEPAD;
    k.gamepad2 = pad;
  }
  s.gs.reconfigureControllers();
  settingsChanged();
}

function padName(nth: number): string {
  const index = connectedPads()[nth];
  if (index === undefined) return '';
  const id = navigator.getGamepads?.()[index]?.id ?? '';
  // Gamepad ids look like "Xbox 360 Controller (XInput STANDARD GAMEPAD)"; keep the readable part.
  return id.replace(/\s*\(.*$/, '').slice(0, 40);
}

export function menuInputCreate(s: MainMenuScene, playerId: number): Menu {
  const menu = new Menu();
  menu.attach(Label.title(`CHOOSE INPUT\nDEVICE FOR\nPLAYER ${playerId}`));
  menu.attach(new Filler());
  menu.attach(new Button('RIGHT KEYBOARD',
    'This will use the arrow keys or the numeric keypad for movement, enter for punch and right shift for kick.',
    false, false, () => setKeyboardLayout(s, playerId, true)));
  menu.attach(new Button('LEFT KEYBOARD',
    "This will set 'q', 'w', and 'e' for jumping directions, 'a' and 'd' for left and right and 'z', 'x' and 'c' " +
    'for ducking. Left ctrl and left shift control punching and kicking.',
    false, false, () => setKeyboardLayout(s, playerId, false)));
  menu.attach(new Button('CUSTOM KEYBOARD', 'Invent your own keyboard settings.', false, false, (b) => {
    // menu_set_custom_keyboard(): the keyboard menu has its own, wider frame.
    const f = KEYBOARD_FRAME;
    menuLinkMenu(parentMenu(b), menuKeyboardCreate(s, playerId), f.x, f.y, f.w, f.h);
  }));
  const joy1 = new Button('JOYSTICK 1', 'Use joystick 1.', false, false, () => setJoystick(s, playerId, 0));
  const joy2 = new Button('JOYSTICK 2', 'Use joystick 2.', false, false, () => setJoystick(s, playerId, 1));
  const joys = [joy1, joy2];
  const joyHelp = ['', ''];
  // The reference disables the joystick entries when there are not enough joysticks. Browsers only report a gamepad
  // after one of its buttons is pressed, so re-check while the menu is shown and enable entries as pads appear.
  const updateJoysticks = () => {
    const count = connectedPads().length;
    joys.forEach((j, i) => {
      if (count > i) {
        j.setDisabled(false);
        const name = padName(i);
        const help = `Use joystick ${i + 1}.${name ? ` (${name})` : ''}`;
        if (help !== joyHelp[i]) {
          joyHelp[i] = help;
          j.setHelp(help);
        }
      } else if (menu.current() !== j) {
        j.setDisabled(true);
      }
    });
  };
  updateJoysticks();
  menu.attach(joy1);
  menu.attach(joy2);
  // Not ported: INPUT DELAY (local netplay practice; there is no netplay in this version).
  menu.attach(new Button('DONE', 'Leave without changing anything.', false, false, menuDone));
  menu.onTick = updateJoysticks;
  return menu;
}
