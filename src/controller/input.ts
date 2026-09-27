// Raw input state: keyboard (by KeyboardEvent.code) and gamepads (Gamepad API).

const down = new Set<string>();
/** Keys pressed since the last `consumePressed` (for edge-triggered UI actions). */
const pressedQueue: string[] = [];
let listeners: ((code: string, e: KeyboardEvent) => void)[] = [];

/** Keys the game uses; the browser default action is suppressed for these. */
const GAME_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter', 'Tab', 'PageUp', 'PageDown', 'Home', 'End',
  'Backspace', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);

export function initInput(target: Window = window): void {
  target.addEventListener('keydown', (e) => {
    if (GAME_KEYS.has(e.code) || e.code.startsWith('Numpad') || e.code.startsWith('Key')) {
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
// Gamepads

export interface PadState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  punch: boolean;
  kick: boolean;
  start: boolean;
  back: boolean;
}

const DEADZONE = 0.45;

export function readPad(index: number): PadState | null {
  const pads = navigator.getGamepads?.() ?? [];
  const p = pads[index];
  if (!p || !p.connected) return null;
  const b = (i: number) => !!p.buttons[i]?.pressed;
  const ax = p.axes[0] ?? 0;
  const ay = p.axes[1] ?? 0;
  return {
    up: b(12) || ay < -DEADZONE,
    down: b(13) || ay > DEADZONE,
    left: b(14) || ax < -DEADZONE,
    right: b(15) || ax > DEADZONE,
    // Standard mapping: A/X (face bottom/left) punch, B/Y (face right/top) kick; shoulders too.
    punch: b(0) || b(2) || b(4),
    kick: b(1) || b(3) || b(5),
    start: b(9),
    back: b(8),
  };
}

export function connectedPads(): number[] {
  const pads = navigator.getGamepads?.() ?? [];
  const out: number[] = [];
  for (const p of pads) if (p && p.connected) out.push(p.index);
  return out;
}

export function rumble(index: number, magnitude: number, durationMs: number): void {
  const p = navigator.getGamepads?.()[index];
  const act = (p as Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } })?.vibrationActuator;
  if (act?.playEffect) {
    void act.playEffect('dual-rumble', { duration: durationMs, strongMagnitude: Math.min(1, magnitude), weakMagnitude: Math.min(1, magnitude) }).catch(() => undefined);
  }
}
