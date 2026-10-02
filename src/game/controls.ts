// Control layouts: the original keyboard layout, a modern one, and the gamepad button layouts (see controller/input.ts).
import { setPadLayout } from '../controller/input';
import { CtrlType } from './constants';
import { defaultSettings, MODERN_SPECIAL_KEYS, settings, type KeyBindings } from './settings';

export type KeyLayout = 'classic' | 'modern';

const none: string[] = [];

/**
 * The modern keyboard layout: WASD and J / K for player 1 (F / G too, for two players on one keyboard), the arrow keys
 * and , / . for player 2; L / H and / are the special buttons. Diagonal jumps and ducks are two keys at once (W + D jumps forward when facing right).
 */
const MODERN: { p1: KeyBindings; p2: KeyBindings } = {
  p1: {
    jumpUp: ['KeyW'], jumpRight: none, walkRight: ['KeyD'], duckForward: none, duck: ['KeyS'], duckBack: none,
    walkBack: ['KeyA'], jumpLeft: none, punch: ['KeyJ', 'KeyF'], kick: ['KeyK', 'KeyG'], special: MODERN_SPECIAL_KEYS.p1,
  },
  p2: {
    jumpUp: ['ArrowUp'], jumpRight: none, walkRight: ['ArrowRight'], duckForward: none, duck: ['ArrowDown'], duckBack: none,
    walkBack: ['ArrowLeft'], jumpLeft: none, punch: ['Comma', 'Numpad1'], kick: ['Period', 'Numpad2'], special: MODERN_SPECIAL_KEYS.p2,
  },
};

function copy(k: KeyBindings): KeyBindings {
  return Object.fromEntries(Object.entries(k).map(([a, codes]) => [a, [...codes]])) as unknown as KeyBindings;
}

/** The key bindings of a layout for player 1 (0) or 2 (1). */
export function layoutKeys(layout: KeyLayout, player: number): KeyBindings {
  if (layout === 'modern') return copy(player === 0 ? MODERN.p1 : MODERN.p2);
  const d = defaultSettings().keys;
  return copy(player === 0 ? d.p1 : d.p2);
}

/** Switches both players to a keyboard layout (in place: the players' controllers see the new keys at once). */
export function applyKeyLayout(layout: KeyLayout): void {
  const k = settings().keys;
  Object.assign(k.p1, layoutKeys(layout, 0));
  Object.assign(k.p2, layoutKeys(layout, 1));
  k.layout = layout;
}

function same(a: KeyBindings, b: KeyBindings): boolean {
  return (Object.keys(a) as (keyof KeyBindings)[]).every((act) => a[act].join() === b[act].join());
}

/** The layout the current bindings match, or 'custom' (keys rebound by the player). */
export function detectKeyLayout(): KeyLayout | 'custom' {
  const k = settings().keys;
  for (const layout of ['classic', 'modern'] as KeyLayout[]) {
    if (same(k.p1, layoutKeys(layout, 0)) && same(k.p2, layoutKeys(layout, 1))) return layout;
  }
  return 'custom';
}

/** Applies the gamepad settings to the input layer. */
export function applyPadSettings(): void {
  setPadLayout(settings().keys.padLayout);
}

/**
 * Which free gamepad (one not chosen for a player in the input menu) a keyboard player reads besides the keyboard, or
 * -1: the keyboard players in order take the free pads in order (player 2 alone on the keyboard takes the first).
 */
export function autoPadSlot(playerId: number): number {
  const k = settings().keys;
  if (!k.autoPads) return -1;
  const keyboardPlayers = [k.ctrlType1, k.ctrlType2].map((t, i) => (t === CtrlType.GAMEPAD ? -1 : i)).filter((i) => i >= 0);
  return keyboardPlayers.indexOf(playerId);
}
