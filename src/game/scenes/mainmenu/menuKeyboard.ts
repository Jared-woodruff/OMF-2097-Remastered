// Custom keyboard setup (port of the reference mainmenu/menu_keyboard.c).
import { CtrlType } from '../../constants';
import { Button, Label, Menu, type Component } from '../../gui/widgets';
import { settings } from '../../settings';
import type { MainMenuScene } from '../mainmenu';
import { parentMenu, settingsChanged } from './common';
import { keyName } from './keyNames';
import { KEY_ACTIONS, menuPresskeyCreate, playerKeys } from './menuPresskey';

const KEYNAMES = ['JUMP UP', 'JUMP RIGHT', 'WALK RIGHT', 'DUCK FORWARD', 'DUCK', 'DUCK BACK', 'WALK BACK', 'JUMP LEFT', 'PUNCH', 'KICK',
  'SPECIAL'];

/** The reference gui_frame of this menu (it is linked into the input menu with menu_link_menu). */
export const KEYBOARD_FRAME = { x: 25, y: 5, w: 270, h: 140 } as const;

/** snprintf("%-19s%12s", keynames[i], key): action name left aligned, bound key right aligned. */
function keyText(player: number, i: number): string {
  return KEYNAMES[i].padEnd(19) + keyName(playerKeys(player)[KEY_ACTIONS[i]]?.[0]).padStart(12);
}

export function menuKeyboardCreate(s: MainMenuScene, selectedPlayer: number): Menu {
  const menu = new Menu();
  const keys: Button[] = [];
  const menuUpdateKeys = () => {
    for (let i = 0; i < KEY_ACTIONS.length; i++) keys[i].setText(keyText(selectedPlayer, i));
  };
  // menu_keyboard_set_key(): capture a new key for this action.
  const setKey = (c: Component, i: number) => {
    parentMenu(c).setSubmenu(menuPresskeyCreate(selectedPlayer, i, (code) => {
      // Deviation: ignore menu input until the captured key is released, otherwise binding e.g. ENTER or an arrow
      // key would also act on the menu (the reference reopens the capture / moves the cursor in that case).
      s.swallowKey = code;
      if (code !== 'Escape') settingsChanged();
    }));
  };
  // Eleven keys (the remaster adds the special button): rows a little closer than the original's ten.
  menu.padding = 2;
  menu.attach(Label.title('CUSTOM KEYBOARD SETUP'));
  for (let i = 0; i < KEY_ACTIONS.length; i++) {
    keys[i] = new Button(keyText(selectedPlayer, i), null, false, false, (b) => setKey(b, i));
    menu.attach(keys[i]);
  }
  menu.attach(new Button('DONE', 'Leave custom keyboard setup.', false, false, (b) => {
    // menu_keyboard_done()
    parentMenu(b).finished = true;
    const k = settings().keys;
    if (selectedPlayer === 1) k.ctrlType1 = CtrlType.KEYBOARD;
    else k.ctrlType2 = CtrlType.KEYBOARD;
    settingsChanged();
  }));
  // menu_keyboard_keypress_done()
  menu.onSubmenuDone = () => menuUpdateKeys();
  return menu;
}
