import { tr, trKey } from '../../../i18n/i18n';
// Display names for key bindings (KeyboardEvent.code values). The reference shows SDL scancode names
// (SDL_GetScancodeName); these are the same names in the menu's upper case style, at most 12 characters so they fit
// the "%-19s%12s" layout of the custom keyboard menu.

const NAMES: Record<string, string> = {
  ArrowUp: trKey('UP'),
  ArrowDown: trKey('DOWN'),
  ArrowLeft: trKey('LEFT'),
  ArrowRight: trKey('RIGHT'),
  Enter: trKey('ENTER'),
  NumpadEnter: trKey('KEYPAD ENTER'),
  Escape: trKey('ESCAPE'),
  Backspace: trKey('BACKSPACE'),
  Tab: trKey('TAB'),
  Space: trKey('SPACE'),
  ShiftLeft: trKey('LEFT SHIFT'),
  ShiftRight: trKey('RIGHT SHIFT'),
  ControlLeft: trKey('LEFT CTRL'),
  ControlRight: trKey('RIGHT CTRL'),
  AltLeft: trKey('LEFT ALT'),
  AltRight: trKey('RIGHT ALT'),
  MetaLeft: trKey('LEFT GUI'),
  MetaRight: trKey('RIGHT GUI'),
  ContextMenu: trKey('MENU'),
  CapsLock: trKey('CAPS LOCK'),
  NumLock: trKey('NUM LOCK'),
  ScrollLock: trKey('SCROLL LOCK'),
  PrintScreen: trKey('PRINTSCREEN'),
  Pause: trKey('key|PAUSE'),
  Insert: trKey('INSERT'),
  Delete: trKey('key|DELETE'),
  Home: trKey('HOME'),
  End: trKey('key|END'),
  PageUp: trKey('PAGE UP'),
  PageDown: trKey('PAGE DOWN'),
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  IntlBackslash: '<',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
  NumpadDecimal: trKey('KEYPAD .'),
  NumpadAdd: trKey('KEYPAD +'),
  NumpadSubtract: trKey('KEYPAD -'),
  NumpadMultiply: trKey('KEYPAD *'),
  NumpadDivide: trKey('KEYPAD /'),
  NumpadEqual: trKey('KEYPAD ='),
};

/** What the player's keyboard prints on its keys, by code (KeyZ is Y on a German one, KeyQ is A on a French one). */
let layout: ReadonlyMap<string, string> | null = null;

/**
 * Reads the keyboard's layout, where the browser tells it (Chromium, and the desktop app's WebView2); elsewhere the
 * keys keep their US names.
 */
export async function loadKeyboardLayout(): Promise<void> {
  const kb = typeof navigator === 'undefined' ? undefined
    : (navigator as Navigator & { keyboard?: { getLayoutMap?(): Promise<ReadonlyMap<string, string>> } }).keyboard;
  try {
    layout = (await kb?.getLayoutMap?.()) ?? null;
  } catch {
    layout = null;
  }
}

/**
 * The letter or sign a key prints on the player's keyboard, in upper case (null: not known, or not in Latin letters:
 * a Russian or Arabic keyboard prints the US letters too, the ones its players name the keys by).
 */
export function printedKey(code: string): string | null {
  const c = layout?.get(code);
  if (!c || !/^[\p{Script=Latin}\p{P}\p{S}]$/u.test(c)) return null;
  const up = c.toUpperCase();
  return up.length === 1 ? up : c;
}

/** Upper case display name of a KeyboardEvent.code ('KeyA' → 'A', 'Numpad8' → 'KEYPAD 8', 'ShiftRight' → 'RIGHT SHIFT'). */
export function keyName(code: string | undefined): string {
  if (!code) return '';
  const named = NAMES[code];
  // (the signs' keys: what the keyboard prints, as the letters')
  if (named) return named.length === 1 ? printedKey(code) ?? named : tr(named);
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return printedKey(code) ?? m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code);
  if (m) return tr('KEYPAD {key}', { key: m[1] });
  if (/^F\d{1,2}$/.test(code)) return code;
  return code.toUpperCase().slice(0, 12);
}
