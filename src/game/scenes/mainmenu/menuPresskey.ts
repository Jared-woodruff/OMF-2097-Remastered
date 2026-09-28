// "Press a key for this action" capture of the custom keyboard setup (port of the reference mainmenu/menu_presskey.c).
import { HAlign, TEXT_BRIGHT_GREEN, TEXT_MEDIUM_GREEN } from '../../gui/text';
import { Filler, Label, Menu } from '../../gui/widgets';
import { settings, type KeyBindings } from '../../settings';
import { keyName } from './keyNames';

/** Binding slots in the order of the custom keyboard menu (reference menu_get_key keynum 0..9). */
export const KEY_ACTIONS: readonly (keyof KeyBindings)[] = [
  'jumpUp', 'jumpRight', 'walkRight', 'duckForward', 'duck', 'duckBack', 'walkBack', 'jumpLeft', 'punch', 'kick', 'special',
];
const ACTION_NAMES = ['jump up', 'jump right', 'walk right', 'duck forward', 'duck', 'duck back', 'walk back', 'jump left', 'punch', 'kick',
  'special'];

const COLOR_WARNING = 0xf6;
const WAIT_TICKS = 20;
const WARN_TICKS = 50;

/** Key bindings of player 1 or 2 (reference key1_* / key2_* settings). */
export function playerKeys(player: number): KeyBindings {
  const k = settings().keys;
  return player === 1 ? k.p1 : k.p2;
}

/**
 * is_key_bound(): the first binding (player 1 then player 2, in menu order) that already uses `code`, as the
 * message shown to the user; null when the key is free.
 */
export function isKeyBound(code: string): string | null {
  for (const player of [1, 2]) {
    const keys = playerKeys(player);
    for (let i = 0; i < KEY_ACTIONS.length; i++) {
      if ((keys[KEY_ACTIONS[i]] ?? []).includes(code)) return `${keyName(code)} bound to P${player} ${ACTION_NAMES[i]}.`;
    }
  }
  return null;
}

export class PresskeyMenu extends Menu {
  waitTimeout = WAIT_TICKS;
  warnTimeout = WARN_TICKS;
  readonly text: Label[];

  /**
   * @param player 1 or 2
   * @param slotIndex index into KEY_ACTIONS
   * @param onKey called with the key that ended the capture (the new binding, or Escape when cancelled)
   */
  constructor(readonly player: number, readonly slotIndex: number, private onKey: (code: string) => void) {
    super();
    this.text = [Label.title('PRESS A KEY FOR'), Label.title('THIS ACTION ...'), Label.title('')];
    for (const l of this.text) {
      l.overrideColor = TEXT_BRIGHT_GREEN;
      l.halign = HAlign.CENTER;
      this.attach(l);
    }
    // Deviation: the reference sizes the (empty) warning label for one 3px row, so longer warnings are cut after
    // their first line. Reserve two text rows instead.
    this.text[2].setSizeHints(-1, 2 * 8 + 3);
    this.attach(new Filler());
    this.onTick = () => this.presskeyTick();
  }

  /** menu_presskey_tick() minus the keyboard polling, which happens in keyEvent(). */
  private presskeyTick(): void {
    if (this.warnTimeout > 0) {
      this.warnTimeout--;
      if (this.warnTimeout === 0) {
        for (let i = 0; i < 2; i++) this.text[i].overrideColor = TEXT_MEDIUM_GREEN;
      }
    }
    if (this.waitTimeout > 0) this.waitTimeout--;
  }

  /**
   * The reference polls SDL_GetKeyboardState() every tick once the initial wait is over; here the scene forwards raw
   * key events (Scene.keyEvent), which also lets any key be captured (not only the ones the menu controller knows).
   */
  override keyEvent(code: string, e: KeyboardEvent): boolean {
    if (this.finished || this.waitTimeout > 0 || e.repeat || !code) return true;
    if (code === 'Escape') {
      this.finished = true;
      this.onKey(code);
      return true;
    }
    const keys = playerKeys(this.player);
    const slot = KEY_ACTIONS[this.slotIndex];
    const bound = isKeyBound(code);
    if (bound !== null && !(keys[slot] ?? []).includes(code)) {
      this.text[2].setText(bound);
      for (const l of this.text) l.overrideColor = COLOR_WARNING;
      this.warnTimeout = WARN_TICKS;
      return true;
    }
    // One key per action, like the reference's custom keyboard (this drops any alternate default bindings).
    keys[slot] = [code];
    this.finished = true;
    this.onKey(code);
    return true;
  }
}

/** menu_presskey_create() */
export function menuPresskeyCreate(player: number, slotIndex: number, onKey: (code: string) => void): PresskeyMenu {
  return new PresskeyMenu(player, slotIndex, onKey);
}
