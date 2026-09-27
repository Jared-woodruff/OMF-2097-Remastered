// Configuration menu (port of the reference mainmenu/menu_configuration.c).
import { Button, Filler, Label, Menu, TextSelector } from '../../gui/widgets';
import { settings } from '../../settings';
import type { MainMenuScene } from '../mainmenu';
import { menuDone, parentMenu, settingsChanged } from './common';
import { menuAudioCreate } from './menuAudio';
import { menuInputCreate } from './menuInput';
import { menuLanguageCreate } from './menuLanguage';
import { menuVideoCreate } from './menuVideo';

export function menuConfigurationCreate(s: MainMenuScene): Menu {
  const menu = new Menu();
  menu.attach(Label.title('CONFIGURATION'));
  menu.attach(new Filler());
  menu.attach(new Button('LANGUAGE', 'Forstar du ikke engelsk?', false, false,
    (b) => parentMenu(b).setSubmenu(menuLanguageCreate(s))));
  menu.attach(new Button('PLAYER 1 INPUT', 'Choose the control for player 1: keyboard or joystick.', false, false,
    (b) => parentMenu(b).setSubmenu(menuInputCreate(s, 1))));
  menu.attach(new Button('PLAYER 2 INPUT', 'Choose the control for player 2: keyboard or joystick.', false, false,
    (b) => parentMenu(b).setSubmenu(menuInputCreate(s, 2))));
  menu.attach(new Button('VIDEO OPTIONS', 'Various options for visual effects and detail levels.', false, false,
    (b) => parentMenu(b).setSubmenu(menuVideoCreate(s))));
  menu.attach(new Button('AUDIO OPTIONS', 'Various options for audio effects and volume.', false, false,
    (b) => parentMenu(b).setSubmenu(menuAudioCreate(s))));
  menu.attach(new TextSelector('RUMBLE', 'Gamepad vibration when robots are hit, blocked, thrown or slammed into walls.',
    () => (settings().keys.rumble ? 1 : 0), (pos) => (settings().keys.rumble = pos === 1), ['OFF', 'ON'], settingsChanged));
  menu.attach(new Button('DONE', 'Leave configuration.', false, false, menuDone));
  return menu;
}
