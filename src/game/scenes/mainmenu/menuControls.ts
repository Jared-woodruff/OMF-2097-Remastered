// OPTIONS > CONTROLS: the input entries of the reference's configuration menu (mainmenu/menu_configuration.c: PLAYER 1
// INPUT, PLAYER 2 INPUT) and the remaster's (the controls screen with the key layouts, the special button, rumble and
// the touch pad).
import { app } from '../../../app';
import { Button, Label, Menu, TextSelector } from '../../gui/widgets';
import { settings } from '../../settings';
import type { MainMenuScene } from '../mainmenu';
import { menuDone, parentMenu, settingsChanged } from './common';
import { menuInputCreate } from './menuInput';

export function menuControlsCreate(s: MainMenuScene): Menu {
  const menu = new Menu();
  menu.attach(Label.title('CONTROLS'));
  menu.attach(new Button('PLAYER 1 INPUT', 'Choose the control for player 1: keyboard or joystick.', false, false,
    (b) => parentMenu(b).setSubmenu(menuInputCreate(s, 1))));
  menu.attach(new Button('PLAYER 2 INPUT', 'Choose the control for player 2: keyboard or joystick.', false, false,
    (b) => parentMenu(b).setSubmenu(menuInputCreate(s, 2))));
  menu.attach(new Button('KEYS AND BUTTONS',
    'See the keys and controller buttons of both players, and switch between the classic and a modern keyboard layout (WASD) or the controller button layouts.',
    false, false, () => app.showControls()));
  menu.attach(new TextSelector('SPECIAL BUTTON', 'Special moves in one press: the special button with no direction, forward, ' +
    'back, down or up does the first to fifth special of the robot (the move list shows them). The original inputs still work.',
  () => (settings().keys.specialButton ? 1 : 0), (pos) => (settings().keys.specialButton = pos === 1), ['OFF', 'ON'], settingsChanged));
  menu.attach(new TextSelector('RUMBLE', 'Gamepad vibration when robots are hit, blocked, thrown or slammed into walls.',
    () => (settings().keys.rumble ? 1 : 0), (pos) => (settings().keys.rumble = pos === 1), ['OFF', 'ON'], settingsChanged));
  const touchModes = ['auto', 'on', 'off'] as const;
  menu.attach(new TextSelector('TOUCH PAD', 'On-screen stick and buttons for phones and tablets: AUTO shows them once the ' +
    'screen is touched.', () => touchModes.indexOf(settings().keys.touch), (pos) => (settings().keys.touch = touchModes[pos]),
  ['AUTO', 'ON', 'OFF'], settingsChanged));
  menu.attach(new Button('DONE', 'Go back to the options.', false, false, menuDone));
  return menu;
}
