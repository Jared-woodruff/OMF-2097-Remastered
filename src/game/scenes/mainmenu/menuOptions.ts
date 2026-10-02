// MAIN MENU > OPTIONS: every setting, by what it is about. It stands for the original's CONFIGURATION and GAMEPLAY
// menus (GAMEPLAY is here as it was; CONFIGURATION's entries went to CONTROLS, GRAPHICS, SOUND and LANGUAGE) and holds
// the remaster's options with them.
import { Button, Label, Menu } from '../../gui/widgets';
import type { MainMenuScene } from '../mainmenu';
import { menuDone, parentMenu } from './common';
import { menuControlsCreate } from './menuControls';
import { menuGameplayCreate } from './menuGameplay';
import { menuGraphicsCreate } from './menuGraphics';
import { menuLanguageCreate } from './menuLanguage';
import { menuSoundCreate } from './menuSound';

export function menuOptionsCreate(s: MainMenuScene): Menu {
  const menu = new Menu();
  menu.attach(Label.title('OPTIONS'));
  menu.attach(new Button('GAMEPLAY', 'Tweak the game speed, computer intelligence, and other play options.', false, false,
    (b) => parentMenu(b).setSubmenu(menuGameplayCreate(s))));
  menu.attach(new Button('CONTROLS', 'Keyboard or joystick for each player, the key layouts, the special button, rumble and ' +
    'the touch pad.', false, false, (b) => parentMenu(b).setSubmenu(menuControlsCreate(s))));
  menu.attach(new Button('GRAPHICS', 'The classic or the remastered graphics, and the options of each: the classic filters, ' +
    'the HD artwork, the effects.', false, false, (b) => parentMenu(b).setSubmenu(menuGraphicsCreate(s))));
  menu.attach(new Button('SOUND', 'Volumes, the music, the announcer and the sound effects.', false, false,
    (b) => parentMenu(b).setSubmenu(menuSoundCreate(s))));
  menu.attach(new Button('LANGUAGE', 'Forstar du ikke engelsk?', false, false, (b) => parentMenu(b).setSubmenu(menuLanguageCreate(s))));
  menu.attach(new Button('DONE', 'Go back to the main menu.', false, false, menuDone));
  return menu;
}
