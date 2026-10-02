// Display names for key bindings (KeyboardEvent.code values). The reference shows SDL scancode names
// (SDL_GetScancodeName); these are the same names in the menu's upper case style, at most 12 characters so they fit
// the "%-19s%12s" layout of the custom keyboard menu.

const NAMES: Record<string, string> = {
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  Enter: 'ENTER',
  NumpadEnter: 'KEYPAD ENTER',
  Escape: 'ESCAPE',
  Backspace: 'BACKSPACE',
  Tab: 'TAB',
  Space: 'SPACE',
  ShiftLeft: 'LEFT SHIFT',
  ShiftRight: 'RIGHT SHIFT',
  ControlLeft: 'LEFT CTRL',
  ControlRight: 'RIGHT CTRL',
  AltLeft: 'LEFT ALT',
  AltRight: 'RIGHT ALT',
  MetaLeft: 'LEFT GUI',
  MetaRight: 'RIGHT GUI',
  ContextMenu: 'MENU',
  CapsLock: 'CAPS LOCK',
  NumLock: 'NUM LOCK',
  ScrollLock: 'SCROLL LOCK',
  PrintScreen: 'PRINTSCREEN',
  Pause: 'PAUSE',
  Insert: 'INSERT',
  Delete: 'DELETE',
  Home: 'HOME',
  End: 'END',
  PageUp: 'PAGE UP',
  PageDown: 'PAGE DOWN',
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
  NumpadDecimal: 'KEYPAD .',
  NumpadAdd: 'KEYPAD +',
  NumpadSubtract: 'KEYPAD -',
  NumpadMultiply: 'KEYPAD *',
  NumpadDivide: 'KEYPAD /',
  NumpadEqual: 'KEYPAD =',
};

/** Upper case display name of a KeyboardEvent.code ('KeyA' → 'A', 'Numpad8' → 'KEYPAD 8', 'ShiftRight' → 'RIGHT SHIFT'). */
export function keyName(code: string | undefined): string {
  if (!code) return '';
  const named = NAMES[code];
  if (named) return named;
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code);
  if (m) return `KEYPAD ${m[1]}`;
  if (/^F\d{1,2}$/.test(code)) return code;
  return code.toUpperCase().slice(0, 12);
}
