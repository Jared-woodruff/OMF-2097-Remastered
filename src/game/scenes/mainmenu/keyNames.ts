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

/** What a key types on a US keyboard: its letter, digit or sign (KeyA → A, Digit1 and Numpad1 → 1, Minus → -), or null. */
export function usKeyChar(code: string): string | null {
  const m = /^Key([A-Z])$/.exec(code) ?? /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (m) return m[1];
  const sign = NAMES[code];
  return sign?.length === 1 ? sign : null;
}

/** The parts of a key press a name field reads (a KeyboardEvent). */
export type TypedKey = Pick<KeyboardEvent, 'key'> & Partial<Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'metaKey' | 'getModifierState'>>;

/** Letters of another script than the Latin one (Cyrillic, Arabic, Devanagari...: their marks and digits too). */
const LETTERS = /^[\p{L}\p{M}\p{N}]+$/u;
const LATIN_OR_COMMON = /[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;

/**
 * The character a key press types into a name, by the player's keyboard (a French one types A where a US one types
 * Q): the key's character (`e.key`, in capitals unless `upper` is false) when the field takes it (`takes`: the names
 * hold the original fonts' letters, code page 437, or fewer), else that letter without its accent (É → E). A keyboard
 * of another script (Russian, Arabic, Hindi...) types the key's US letter instead, so that Latin names can be typed
 * on any keyboard; so does a key press without its event (`e` undefined) or one an input method keeps. Null: nothing
 * to type (a sign or a letter the field does not take, a dead key, Ctrl or Alt with a key; AltGr's letters are typed).
 */
export function typedChar(code: string, e: TypedKey | undefined, takes: (ch: string) => boolean, upper = true): string | null {
  if (e && (e.ctrlKey || e.altKey || e.metaKey) && !e.getModifierState?.('AltGraph')) return null;
  const key = e?.key === 'Process' || e?.key === 'Unidentified' ? undefined : e?.key;
  if (key !== undefined) {
    if ([...key].length === 1) {
      const ch = upper ? key.toUpperCase() : key;
      if (takes(ch)) return ch;
      const plain = ch.normalize('NFD').replace(/\p{M}+/gu, '');
      if (plain !== ch && [...plain].length === 1 && takes(plain)) return plain;
    }
    // (a key's name, Shift or Dead, a sign, a Latin letter: nothing; another script's letters, لا on an Arabic
    // keyboard's B too: the US letter)
    if (!LETTERS.test(key) || LATIN_OR_COMMON.test(key)) return null;
  }
  const us = usKeyChar(code);
  return us !== null && takes(us) ? us : null;
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
