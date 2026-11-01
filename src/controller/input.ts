// Raw input state: keyboard (by KeyboardEvent.code) and gamepads (Gamepad API, or the desktop app's own on Linux:
// nativePads.ts).

import { shellGamepads, shellRumble, startShellPads } from './nativePads';

const down = new Set<string>();
/** Keys pressed since the last `consumePressed` (for edge-triggered UI actions). */
const pressedQueue: string[] = [];
/** How many times each key went down (a press between two game ticks still counts: see keyPresses). */
const presses = new Map<string, number>();
let listeners: ((code: string, e: KeyboardEvent) => void)[] = [];

/** Keys the game uses; the browser default action is suppressed for these. */
const GAME_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter', 'Tab', 'PageUp', 'PageDown', 'Home', 'End',
  'Backspace', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  // (keys players can bind: '/' opens Firefox's quick find, others scroll or search)
  'Slash', 'Period', 'Comma', 'Semicolon', 'Quote', 'BracketLeft', 'BracketRight', 'Minus', 'Equal', 'Backquote', 'Backslash',
  'IntlBackslash', 'Insert', 'Delete', 'ContextMenu',
]);

export function initInput(target: Window = window): void {
  target.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement | null;
    const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    // Cmd shortcuts are the system's (macOS: a page that cancels Cmd+Q keeps it from the menu bar's Quit); Ctrl+Cmd+F
    // stays the game's fullscreen key.
    const system = e.metaKey && !(e.ctrlKey && e.code === 'KeyF');
    if (system) return;
    if (!typing && (GAME_KEYS.has(e.code) || e.code.startsWith('Numpad') || e.code.startsWith('Key') || e.code.startsWith('Digit'))) {
      // Keep browser shortcuts like Ctrl+R / Ctrl+Shift+I working in dev builds.
      if (!(e.ctrlKey && (e.code === 'KeyR' || e.code === 'KeyI' || e.code === 'KeyJ'))) e.preventDefault();
    }
    // Alt+Enter is the fullscreen hotkey; it must not also act as a game key.
    const hotkey = e.altKey && (e.code === 'Enter' || e.code === 'NumpadEnter');
    if (!e.repeat && !hotkey) {
      down.add(e.code);
      presses.set(e.code, (presses.get(e.code) ?? 0) + 1);
      pressedQueue.push(e.code);
      // Nobody may be consuming edge-triggered presses (e.g. during fights): keep only recent ones.
      if (pressedQueue.length > 64) pressedQueue.splice(0, pressedQueue.length - 64);
    }
    for (const l of listeners) l(e.code, e);
  });
  target.addEventListener('keyup', (e) => {
    down.delete(e.code);
  });
  target.addEventListener('blur', () => down.clear());
  window.addEventListener('gamepadconnected', (e) => {
    console.info(`Gamepad connected: #${(e as GamepadEvent).gamepad.index} ${(e as GamepadEvent).gamepad.id}`);
  });
  void startShellPads();
}

export function onKey(fn: (code: string, e: KeyboardEvent) => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

export function isDown(code: string): boolean {
  return down.has(code);
}

/**
 * How many times a key went down so far. Comparing it between two polls catches a press made while the game did not
 * tick (a knockout's freeze), which the held state misses.
 */
export function keyPresses(code: string): number {
  return presses.get(code) ?? 0;
}

export function anyDown(codes: readonly string[]): boolean {
  for (const c of codes) if (down.has(c)) return true;
  return false;
}

export function consumePressed(): string[] {
  const out = pressedQueue.slice();
  pressedQueue.length = 0;
  return out;
}

/** Simulate key state (used by automated tests / debug hooks). */
export function setKeyState(code: string, pressed: boolean): void {
  if (pressed) {
    if (!down.has(code)) {
      pressedQueue.push(code);
      presses.set(code, (presses.get(code) ?? 0) + 1);
    }
    down.add(code);
  } else {
    down.delete(code);
  }
}

// ---------------------------------------------------------------------------
// Gamepads (the browser's "standard" mapping, which is the Xbox controller's layout)

/** Standard mapping button indices. */
export const PadButton = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
} as const;

/**
 * Which buttons punch and kick: 'modern' like today's fighting games (X, Y and RB punch; A, B and RT kick: punches on
 * the top row, kicks on the bottom row), 'classic' like the original two-button joysticks (A and X punch; B and Y
 * kick).
 */
export type PadLayout = 'modern' | 'classic';
let padLayout: PadLayout = 'modern';

export function setPadLayout(layout: PadLayout): void {
  padLayout = layout;
}

export function getPadLayout(): PadLayout {
  return padLayout;
}

export interface PadState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  punch: boolean;
  kick: boolean;
  /** Face buttons and the two middle buttons, for menus (A confirms, B goes back, Menu pauses). */
  a: boolean;
  b: boolean;
  x: boolean;
  y: boolean;
  start: boolean;
  back: boolean;
  /** The one-button special: LT, and LB (modern layout) or RT (classic layout). */
  special: boolean;
}

/** The connected pads, by index: the browser's, or the ones the desktop app reads itself (Linux: nativePads.ts). */
export function gamepads(): readonly (Gamepad | null)[] {
  return shellGamepads() ?? navigator.getGamepads?.() ?? [];
}

/** Stick deflection below which it counts as centered. */
const DEADZONE = 0.4;

/**
 * The USB vendor and product of a pad, from the id the browser gives it: "... (STANDARD GAMEPAD Vendor: 054c Product:
 * 0ce6)" (Chromium), "054c-0ce6-DualSense Wireless Controller" (Firefox). Null when the id doesn't say (Safari).
 */
export function padUsbIds(id: string): { vendor: number; product: number } | null {
  const m = /Vendor:\s*([0-9a-f]{1,4})\s+Product:\s*([0-9a-f]{1,4})/i.exec(id) ?? /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-/i.exec(id);
  return m ? { vendor: parseInt(m[1], 16), product: parseInt(m[2], 16) } : null;
}

/** Which buttons a pad has printed on it: Xbox (A B X Y), PlayStation (cross circle square triangle) or Nintendo (B A Y X). */
export type PadFamily = 'xbox' | 'playstation' | 'nintendo';

const SONY = 0x054c;
const NINTENDO = 0x057e;

export function padFamilyOf(id: string): PadFamily {
  const vendor = padUsbIds(id)?.vendor;
  if (vendor === SONY || /dualsense|dualshock|playstation|\bps[345]\b|\bsony\b/i.test(id) || /^wireless controller\b/i.test(cleanPadName(id))) {
    return 'playstation';
  }
  if (vendor === NINTENDO || /nintendo|pro controller|joy-?con/i.test(id)) return 'nintendo';
  return 'xbox';
}

/**
 * Where a pad's standard buttons are when the browser reports it in its own order (Gamepad.mapping is '', as with some
 * pads in Firefox, Linux and generic USB pads): standard button i is raw button order[i]. Sony's own order is square,
 * cross, circle, triangle; Nintendo's and generic pads' first four are already by position (bottom, right, left, top).
 * The d-pad of such pads is usually a hat switch, reported as an axis.
 */
const SONY_ORDER = [1, 2, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const BY_POSITION = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
/** The axis browsers report a hat switch on, for the pads above. */
const HAT_AXIS = 9;

/**
 * A hat switch axis: -1 is up, then clockwise in steps of 2/7 (up and right, right, ...); centered it reads outside
 * -1..1 (about 1.29 or 3.29). Returns [up, down, left, right].
 */
export function hatDirections(v: number): [boolean, boolean, boolean, boolean] {
  if (!(v >= -1.05 && v <= 1.05)) return [false, false, false, false];
  const k = Math.round((v + 1) * 3.5) % 8;
  return [k === 7 || k <= 1, k >= 3 && k <= 5, k >= 5 && k <= 7, k >= 1 && k <= 3];
}

/** The axis a pad in its own order reports its d-pad on (-1: none): a known one, or the axis that rests outside -1..1. */
function hatAxis(p: Gamepad, known: boolean): number {
  if (known && p.axes.length > HAT_AXIS) return HAT_AXIS;
  return p.axes.findIndex((v, i) => i >= 2 && Math.abs(v) > 1.05);
}

export function readPad(index: number, layout: PadLayout = padLayout): PadState | null {
  const p = gamepads()[index];
  if (!p || !p.connected) return null;
  // (a pad without a mapping property at all, as the tests' fakes, counts as standard)
  const standard = p.mapping === undefined || p.mapping === 'standard';
  const vendor = standard ? undefined : padUsbIds(p.id)?.vendor;
  const order = vendor === SONY || (!standard && padFamilyOf(p.id) === 'playstation') ? SONY_ORDER : BY_POSITION;
  const raw = (i: number) => !!p.buttons[i]?.pressed;
  let b = raw;
  let [hu, hd, hl, hr] = [false, false, false, false];
  if (!standard) {
    const hat = hatAxis(p, vendor === SONY || vendor === NINTENDO);
    if (hat >= 0) [hu, hd, hl, hr] = hatDirections(p.axes[hat]);
    // (a generic pad without a hat may have its d-pad on buttons 12-15, as the standard layout; a Sony pad has its PS
    // button and touchpad there)
    const dpadButtons = hat < 0 && order === BY_POSITION;
    b = (i: number) => (i < order.length ? raw(order[i]) : dpadButtons && i <= PadButton.RIGHT && raw(i));
  }
  const ax = p.axes[0] ?? 0;
  const ay = p.axes[1] ?? 0;
  // The left stick in eight 45 degree sectors, so diagonals are as easy to hit as straight directions.
  let su = false, sd = false, sl = false, sr = false;
  if (Math.hypot(ax, ay) > DEADZONE) {
    const sector = Math.round(Math.atan2(ay, ax) / (Math.PI / 4));
    sr = sector === 0 || sector === 1 || sector === -1;
    sl = sector === 4 || sector === -4 || sector === 3 || sector === -3;
    sd = sector >= 1 && sector <= 3;
    su = sector <= -1 && sector >= -3;
  }
  const modern = layout === 'modern';
  return {
    up: b(PadButton.UP) || su || hu,
    down: b(PadButton.DOWN) || sd || hd,
    left: b(PadButton.LEFT) || sl || hl,
    right: b(PadButton.RIGHT) || sr || hr,
    punch: modern ? b(PadButton.X) || b(PadButton.Y) || b(PadButton.RB) : b(PadButton.A) || b(PadButton.X) || b(PadButton.LB),
    kick: modern ? b(PadButton.A) || b(PadButton.B) || b(PadButton.RT) : b(PadButton.B) || b(PadButton.Y) || b(PadButton.RB),
    a: b(PadButton.A),
    b: b(PadButton.B),
    x: b(PadButton.X),
    y: b(PadButton.Y),
    start: b(PadButton.MENU),
    back: b(PadButton.VIEW),
    special: b(PadButton.LT) || (modern ? b(PadButton.LB) : b(PadButton.RT)),
  };
}

export function connectedPads(): number[] {
  const out: number[] = [];
  for (const p of gamepads()) if (p && p.connected) out.push(p.index);
  return out;
}

/** A pad's id without what browsers add to the name: Chromium's "(STANDARD GAMEPAD Vendor: ...)", Firefox's "054c-0ce6-". */
export function cleanPadName(id: string): string {
  return id.replace(/\s*\(.*$/, '').replace(/^[0-9a-f]{1,4}-[0-9a-f]{1,4}-/i, '').trim();
}

/** Name of a connected pad (without the driver details browsers append), or ''. */
export function padName(index: number): string {
  return cleanPadName(gamepads()[index]?.id ?? '');
}

/** The id of a connected pad ('' if there is none at that index): it names the pad again when it reconnects elsewhere. */
export function padId(index: number): string {
  const p = gamepads()[index];
  return p && p.connected ? p.id : '';
}

/** Which buttons a connected pad has printed on it (an Xbox pad's when there is no pad at that index). */
export function padFamily(index: number): PadFamily {
  const p = gamepads()[index];
  return p && p.connected ? padFamilyOf(p.id) : 'xbox';
}

export function rumble(index: number, magnitude: number, durationMs: number): void {
  if (shellRumble(index, magnitude, durationMs)) return;
  const p = navigator.getGamepads?.()[index];
  const act = (p as Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } })?.vibrationActuator;
  if (act?.playEffect) {
    void act.playEffect('dual-rumble', { duration: durationMs, strongMagnitude: Math.min(1, magnitude), weakMagnitude: Math.min(1, magnitude) }).catch(() => undefined);
  }
}
