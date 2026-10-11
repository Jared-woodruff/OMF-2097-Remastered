// Custom keyboard setup (port of the reference mainmenu/menu_keyboard.c).
import { CtrlType } from '../../constants';
import { FontSize, getFont, HAlign, Text } from '../../gui/text';
import { Button, Label, Menu, type Component, type GuiTheme } from '../../gui/widgets';
import { settings } from '../../settings';
import type { MainMenuScene } from '../mainmenu';
import { parentMenu, settingsChanged } from './common';
import { keyName } from './keyNames';
import { KEY_ACTIONS, menuPresskeyCreate, playerKeys } from './menuPresskey';
import { langInfo, tr, trKey } from '../../../i18n/i18n';

const KEYNAMES = [trKey('JUMP UP'), trKey('JUMP RIGHT'), trKey('WALK RIGHT'), trKey('DUCK FORWARD'), trKey('DUCK'), trKey('DUCK BACK'), trKey('WALK BACK'),
  trKey('JUMP LEFT'), trKey('PUNCH'), trKey('KICK'), trKey('SPECIAL')];

/** The reference gui_frame of this menu (it is linked into the input menu with menu_link_menu). */
export const KEYBOARD_FRAME = { x: 25, y: 5, w: 270, h: 140 } as const;

/** The reference's row, snprintf("%-19s%12s", keynames[i], key): 31 letters, centered. */
const ROW_CELLS = 31;

/**
 * A key's row as the reference's "%-19s%12s": the action from the row's left, its key at the right end (right to left,
 * the other way round). Two texts: translated, the actions are not a letter's width a letter.
 */
class KeyRow extends Button {
  readonly key = new Text(FontSize.BIG, 0xffff, 0xffff);

  setRow(action: string, key: string): void {
    this.setText(action);
    this.key.set(key);
  }

  override init(theme: GuiTheme): void {
    super.init(theme);
    this.key.setFont(theme.font);
  }

  override layout(x: number, y: number, w: number, h: number): void {
    super.layout(x, y, w, h);
    const side = Math.max(0, (w - ROW_CELLS * getFont(this.text.font).w) >> 1);
    const rtl = langInfo().rtl === true;
    this.text.setHAlign(rtl ? HAlign.RIGHT : HAlign.LEFT).setMargin({ left: side, right: side });
    this.key.setBox(w, h).setHAlign(rtl ? HAlign.LEFT : HAlign.RIGHT).setMargin({ left: side, right: side });
  }

  override render(): void {
    super.render();
    this.key.setColor(this.text.color).draw(this.x, this.y);
  }
}

function keyOf(player: number, i: number): string {
  return keyName(playerKeys(player)[KEY_ACTIONS[i]]?.[0]);
}

export function menuKeyboardCreate(s: MainMenuScene, selectedPlayer: number): Menu {
  const menu = new Menu();
  const keys: KeyRow[] = [];
  const menuUpdateKeys = () => {
    for (let i = 0; i < KEY_ACTIONS.length; i++) keys[i].setRow(tr(KEYNAMES[i]), keyOf(selectedPlayer, i));
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
  menu.attach(Label.title(tr('CUSTOM KEYBOARD SETUP')));
  for (let i = 0; i < KEY_ACTIONS.length; i++) {
    keys[i] = new KeyRow(tr(KEYNAMES[i]), null, false, false, (b) => setKey(b, i));
    keys[i].key.set(keyOf(selectedPlayer, i));
    menu.attach(keys[i]);
  }
  menu.attach(new Button(tr('DONE'), tr('Leave custom keyboard setup.'), false, false, (b) => {
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
