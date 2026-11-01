// The gamepads the desktop app reads itself, on Linux (src-tauri/src/pads.rs): WebKitGTK's Gamepad API misses many
// pads, PlayStation ones among them. The shell sends their state in `pads` events, in the browser's standard layout;
// input.ts reads them in place of navigator.getGamepads(), as Gamepad objects numbered as a browser numbers its pads (a
// new pad takes the lowest free number), with Chromium's kind of id (input.ts reads the pad's vendor from it).

import { shellApi } from '../platform/desktop';

/** A pad as the shell sends it (pads.rs, PadState). */
interface ShellPad {
  /** The shell's number for it (a pad that comes back gets its number again). */
  number: number;
  name: string;
  vendor: number | null;
  product: number | null;
  /** How far each button is in (0 to 1), in the standard layout's order. */
  buttons: number[];
  /** The buttons that count as pressed (bit i: button i). */
  pressed: number;
  axes: number[];
}

/** The part of the desktop shell's API used here. */
export interface ShellPadsApi {
  core: { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> };
  event: { listen<T>(event: string, cb: (e: { payload: T }) => void): Promise<() => void> };
}

/**
 * Whose pads the game reads: the window's (the browser's Gamepad API), the shell's, or none yet (the desktop app, until
 * the shell says whether it reads them: the window's would be the same pads again).
 */
let source: 'window' | 'shell' | 'pending' = 'window';
let api: ShellPadsApi | null = null;
let pads: (Gamepad | null)[] = [];
/** Each pad's number here, by the shell's number for it. */
const numbers = new Map<number, number>();
let starting: Promise<void> | null = null;

/** The pads the shell reads, by their numbers here (null: the window's Gamepad API reads the pads). */
export function shellGamepads(): readonly (Gamepad | null)[] | null {
  if (source === 'window') return null;
  return source === 'shell' ? pads : [];
}

/** Starts reading the shell's pads where it reads them (the desktop app on Linux); input.ts starts it. */
export function startShellPads(): Promise<void> {
  return (starting ??= connect(shellApi()));
}

/** Reads the pads of a shell (tests), from scratch. */
export function connectShellPads(shell: ShellPadsApi | undefined): Promise<void> {
  pads = [];
  numbers.clear();
  return (starting = connect(shell));
}

async function connect(shell: ShellPadsApi | undefined): Promise<void> {
  api = null;
  if (!shell?.event) {
    source = 'window';
    return;
  }
  source = 'pending';
  try {
    const unlisten = await shell.event.listen<ShellPad[]>('pads', ({ payload }) => take(payload));
    if (!(await shell.core.invoke<boolean>('pads_start'))) {
      unlisten();
      source = 'window';
      return;
    }
    api = shell;
    source = 'shell';
    // (a frame's page, OMF Studio's test of a mod, goes before its window does: its listener with it)
    globalThis.addEventListener?.('pagehide', () => unlisten(), { once: true });
  } catch (err) {
    console.warn("[pads] the desktop app's gamepads:", err);
    source = 'window';
  }
}

const hex4 = (n: number) => n.toString(16).padStart(4, '0');

/** Chromium's kind of id: "PS5 Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)". */
function padIdOf(p: ShellPad): string {
  if (p.vendor === null || p.product === null) return p.name;
  return `${p.name} (STANDARD GAMEPAD Vendor: ${hex4(p.vendor)} Product: ${hex4(p.product)})`;
}

/** The shell's pads came (a `pads` event): each keeps its number here, a new one takes the lowest free number. */
function take(list: ShellPad[]): void {
  const timestamp = performance.now();
  const present = new Set(list.map((p) => p.number));
  for (const n of numbers.keys()) if (!present.has(n)) numbers.delete(n);
  const taken = new Set(numbers.values());
  const next: (Gamepad | null)[] = [];
  for (const p of list) {
    let index = numbers.get(p.number);
    if (index === undefined) {
      index = 0;
      while (taken.has(index)) index++;
      numbers.set(p.number, index);
      taken.add(index);
      console.info(`Gamepad connected: #${index} ${padIdOf(p)}`);
    }
    next[index] = {
      id: padIdOf(p), index, connected: true, mapping: 'standard', timestamp, axes: p.axes,
      buttons: p.buttons.map((value, i) => ({ value, pressed: (p.pressed & (1 << i)) !== 0, touched: value > 0 })),
      vibrationActuator: null,
    } as unknown as Gamepad;
  }
  pads = Array.from(next, (g) => g ?? null);
}

/** Rumbles one of the shell's pads (`index`: its number here); false when the window's Gamepad API reads the pads. */
export function shellRumble(index: number, magnitude: number, durationMs: number): boolean {
  if (source === 'window') return false;
  const number = [...numbers].find(([, i]) => i === index)?.[0];
  if (api && number !== undefined) {
    const strength = Math.min(1, Math.max(0, magnitude));
    const ms = Math.min(10_000, Math.max(0, Math.round(durationMs)));
    void api.core.invoke('pads_rumble', { number, strong: strength, weak: strength, ms }).catch(() => undefined);
  }
  return true;
}
