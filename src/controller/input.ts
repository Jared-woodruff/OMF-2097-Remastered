// Raw input state: keyboard (by KeyboardEvent.code) and gamepads (Gamepad API).

const down = new Set<string>();
/** Keys pressed since the last `consumePressed` (for edge-triggered UI actions). */
const pressedQueue: string[] = [];
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
    if (!typing && (GAME_KEYS.has(e.code) || e.code.startsWith('Numpad') || e.code.startsWith('Key') || e.code.startsWith('Digit'))) {
      // Keep browser shortcuts like Ctrl+R / Ctrl+Shift+I working in dev builds.
      if (!(e.ctrlKey && (e.code === 'KeyR' || e.code === 'KeyI' || e.code === 'KeyJ'))) e.preventDefault();
    }
    // Alt+Enter is the fullscreen hotkey; it must not also act as a game key.
    const hotkey = e.altKey && (e.code === 'Enter' || e.code === 'NumpadEnter');
    if (!e.repeat && !hotkey) {
      down.add(e.code);
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
    if (!down.has(code)) pressedQueue.push(code);
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

/** Stick deflection below which it counts as centered. */
const DEADZONE = 0.4;

export function readPad(index: number, layout: PadLayout = padLayout): PadState | null {
  const pads = navigator.getGamepads?.() ?? [];
  const p = pads[index];
  if (!p || !p.connected) return null;
  const b = (i: number) => !!p.buttons[i]?.pressed;
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
    up: b(PadButton.UP) || su,
    down: b(PadButton.DOWN) || sd,
    left: b(PadButton.LEFT) || sl,
    right: b(PadButton.RIGHT) || sr,
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
  const pads = navigator.getGamepads?.() ?? [];
  const out: number[] = [];
  for (const p of pads) if (p && p.connected) out.push(p.index);
  return out;
}

/** Name of a connected pad (without the driver details browsers append), or ''. */
export function padName(index: number): string {
  const id = navigator.getGamepads?.()[index]?.id ?? '';
  return id.replace(/\s*\(.*$/, '').trim();
}

export function rumble(index: number, magnitude: number, durationMs: number): void {
  const p = navigator.getGamepads?.()[index];
  const act = (p as Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } })?.vibrationActuator;
  if (act?.playEffect) {
    void act.playEffect('dual-rumble', { duration: durationMs, strongMagnitude: Math.min(1, magnitude), weakMagnitude: Math.min(1, magnitude) }).catch(() => undefined);
  }
}
