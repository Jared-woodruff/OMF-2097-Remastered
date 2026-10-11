// MAIN MENU > OPTIONS: every setting, by what it is about. It stands for the original's CONFIGURATION and GAMEPLAY
// menus (GAMEPLAY is here as it was; CONFIGURATION's entries went to CONTROLS, GRAPHICS, SOUND and LANGUAGE) and holds
// the remaster's options with them. LANGUAGE opens its own page (gui/languagePage.ts): the fourteen languages and
// AUTOMATIC do not fit a menu.
import { Button, Label, Menu } from '../../gui/widgets';
import type { MainMenuScene } from '../mainmenu';
import { menuDone, parentMenu } from './common';
import { menuControlsCreate } from './menuControls';
import { menuGameplayCreate } from './menuGameplay';
import { menuGraphicsCreate } from './menuGraphics';
import { app } from '../../../app';
import { menuSoundCreate } from './menuSound';
import { tr } from '../../../i18n/i18n';

export function menuOptionsCreate(s: MainMenuScene): Menu {
  const menu = new Menu();
  menu.attach(Label.title(tr('OPTIONS')));
  menu.attach(new Button(tr('GAMEPLAY'), tr('Tweak the game speed, computer intelligence, and other play options.'), false, false,
    (b) => parentMenu(b).setSubmenu(menuGameplayCreate(s))));
  menu.attach(new Button(tr('CONTROLS'), tr('Keyboard or joystick for each player, the key layouts, the special button, rumble and the touch pad.'), false, false, (b) => parentMenu(b).setSubmenu(menuControlsCreate(s))));
  menu.attach(new Button(tr('GRAPHICS'), tr('The classic or the remastered graphics, and the options of each: the classic filters, the HD artwork, the effects.'), false, false, (b) => parentMenu(b).setSubmenu(menuGraphicsCreate(s))));
  menu.attach(new Button(tr('SOUND'), tr('Volumes, the music, the announcer and the sound effects.'), false, false,
    (b) => parentMenu(b).setSubmenu(menuSoundCreate(s))));
  menu.attach(new Button(tr('LANGUAGE'), tr('The language the game speaks: AUTOMATIC follows your system, or choose one of fourteen.'), false, false,
    () => app.showLanguage()));
  menu.attach(new Button(tr('DONE'), tr('Go back to the main menu.'), false, false, menuDone));
  return menu;
}
