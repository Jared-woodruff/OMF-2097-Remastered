// OPTIONS > CONTROLS > FINISHER KEYS (not in the original game): the finisher keys on or off, and both players' keys
// for the scrap, the destruction and the Fire & Ice move (controller/finisher.ts).
import { Button, Label, Menu, TextSelector, type Component } from '../../gui/widgets';
import { settings } from '../../settings';
import type { MainMenuScene } from '../mainmenu';
import { menuDone, parentMenu, settingsChanged } from './common';
import { keyName } from './keyNames';
import { KeyRow } from './menuKeyboard';
import { BINDING_ACTIONS, menuPresskeyCreate, playerKeys } from './menuPresskey';
import { tr, trKey } from '../../../i18n/i18n';

/** The rows: player, binding slot (BINDING_ACTIONS index), label. */
const ROWS: [number, number, string][] = [
  [1, 11, trKey('P{player} SCRAP')], [1, 12, trKey('P{player} DESTRUCTION')], [1, 13, trKey('P{player} FIRE & ICE')],
  [2, 11, trKey('P{player} SCRAP')], [2, 12, trKey('P{player} DESTRUCTION')], [2, 13, trKey('P{player} FIRE & ICE')],
];

function keyOf(player: number, slot: number): string {
  return keyName(playerKeys(player)[BINDING_ACTIONS[slot]]?.[0]);
}

export function menuFinisherKeysCreate(s: MainMenuScene): Menu {
  const menu = new Menu();
  const rows: KeyRow[] = [];
  const update = () => ROWS.forEach(([player, slot, label], i) => rows[i].setRow(tr(label, { player }), keyOf(player, slot)));
  const setKey = (c: Component, player: number, slot: number) => {
    parentMenu(c).setSubmenu(menuPresskeyCreate(player, slot, (code) => {
      // (the captured key does not act on the menu too: see the custom keyboard setup)
      s.swallowKey = code;
      if (code !== 'Escape') settingsChanged();
    }));
  };
  menu.padding = 2;
  menu.attach(Label.title(tr('FINISHER KEYS')));
  menu.attach(new TextSelector(tr('FINISHER KEYS'),
    tr('Once a fight is won, one press does your robot\'s finishing move: SCRAP, DESTRUCTION (the scrap first) or FIRE & ICE (in the Fire Pit). The special button does the next one. The original inputs still work.'),
    () => (settings().keys.finisherKeys ? 1 : 0), (pos) => (settings().keys.finisherKeys = pos === 1), [tr('OFF'), tr('ON')], settingsChanged));
  ROWS.forEach(([player, slot, label], i) => {
    rows[i] = new KeyRow(tr(label, { player }), tr('Choose the key for this finishing move.'), false, false, (b) => setKey(b, player, slot));
    rows[i].key.set(keyOf(player, slot));
    menu.attach(rows[i]);
  });
  menu.attach(new Button(tr('DONE'), tr('Go back to the controls.'), false, false, menuDone));
  menu.onSubmenuDone = () => update();
  return menu;
}
