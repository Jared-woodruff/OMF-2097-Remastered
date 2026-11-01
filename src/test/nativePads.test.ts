// The gamepads the desktop app reads itself on Linux (controller/nativePads.ts, src-tauri/src/pads.rs): read in place of
// the window's, numbered as a browser numbers its pads, named so their family reads right, their rumble sent back, and
// the window's pads read where the shell reads none.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GamepadController, menuPoll } from '../controller/keyboard';
import { Controller, type CtrlEvent } from '../controller/controller';
import { connectedPads, gamepads, PadButton, padFamily, padId, padName, readPad, rumble, setPadLayout } from '../controller/input';
import { connectShellPads, type ShellPadsApi } from '../controller/nativePads';
import { ACT_PUNCH, CtrlType } from '../game/constants';
import type { GameState } from '../game/gameState';

/** A pad as the shell sends it: the standard layout's 17 buttons (the pressed ones at full), the axes as given. */
function shellPad(number: number, name: string, vendor: number | null, product: number | null, pressed: number[] = [], axes = [0, 0, 0, 0]) {
  return {
    number, name, vendor, product, axes,
    buttons: Array.from({ length: 17 }, (_, i) => (pressed.includes(i) ? 1 : 0)),
    pressed: pressed.reduce((bits, i) => bits | (1 << i), 0),
  };
}

const DUALSENSE = (number: number, pressed: number[] = [], axes?: number[]) => shellPad(number, 'PS5 Controller', 0x054c, 0x0ce6, pressed, axes);
const XBOX = (number: number, pressed: number[] = []) => shellPad(number, 'Xbox Series X Controller', 0x045e, 0x0b12, pressed);

/** A shell: `pads_start` answers `on` (a promise to answer later, or a failure), the pads it sends go to its listener. */
function shell(on: boolean | Promise<boolean>) {
  let listener: ((e: { payload: unknown }) => void) | null = null;
  const calls: [string, Record<string, unknown> | undefined][] = [];
  let unlistened = false;
  const api: ShellPadsApi = {
    core: {
      invoke: <T>(cmd: string, args?: Record<string, unknown>) => {
        calls.push([cmd, args]);
        return (cmd === 'pads_start' ? Promise.resolve(on) : Promise.resolve(undefined)) as Promise<T>;
      },
    },
    event: {
      listen: <T>(event: string, cb: (e: { payload: T }) => void) => {
        expect(event).toBe('pads');
        listener = cb as (e: { payload: unknown }) => void;
        return Promise.resolve(() => {
          unlistened = true;
        });
      },
    },
  };
  return {
    api,
    calls,
    send: (list: unknown[]) => listener?.({ payload: list }),
    get unlistened() {
      return unlistened;
    },
  };
}

/** The window's own pad (what the browser's Gamepad API reports), with a rumble motor. */
const windowRumble = vi.fn(() => Promise.resolve('complete'));
const windowPad = {
  index: 0, connected: true, id: 'Window Pad (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', mapping: 'standard',
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === PadButton.A, value: i === PadButton.A ? 1 : 0 })), axes: [0, 0, 0, 0],
  vibrationActuator: { playEffect: windowRumble },
};

beforeEach(() => {
  vi.stubGlobal('navigator', { getGamepads: () => [windowPad] });
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  windowRumble.mockClear();
  setPadLayout('modern');
});

afterEach(async () => {
  await connectShellPads(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the desktop app's own pads", () => {
  it('are read in place of the window\'s, named as Chromium names them, so a PlayStation pad reads as one', async () => {
    const s = shell(true);
    await connectShellPads(s.api);
    expect(gamepads()).toEqual([]);
    s.send([DUALSENSE(5, [PadButton.A, PadButton.DOWN])]);
    expect(connectedPads()).toEqual([0]);
    expect(padId(0)).toBe('PS5 Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)');
    expect(padName(0)).toBe('PS5 Controller');
    expect(padFamily(0)).toBe('playstation');
    // (cross is the bottom button: A's place, which kicks in the modern layout)
    expect(readPad(0)).toMatchObject({ a: true, kick: true, punch: false, down: true, up: false });
    // A pad that doesn't say its vendor goes by its name.
    s.send([shellPad(1, 'Generic Gamepad', null, null)]);
    expect(padId(0)).toBe('Generic Gamepad');
    expect(padFamily(0)).toBe('xbox');
  });

  it('are numbered as a browser numbers its pads: each keeps its number, a new one takes the lowest free one', async () => {
    const s = shell(true);
    await connectShellPads(s.api);
    s.send([DUALSENSE(5), XBOX(2)]);
    expect([padFamily(0), padFamily(1)]).toEqual(['playstation', 'xbox']);
    // The PlayStation pad goes: the Xbox pad stays at 1.
    s.send([XBOX(2, [PadButton.X])]);
    expect(connectedPads()).toEqual([1]);
    expect(gamepads()[0]).toBeNull();
    expect(readPad(1)).toMatchObject({ x: true, punch: true });
    // A third pad takes the free 0; the PlayStation pad, back, takes 2.
    s.send([XBOX(2), shellPad(7, 'Pro Controller', 0x057e, 0x2009), DUALSENSE(5)]);
    expect(connectedPads()).toEqual([0, 1, 2]);
    expect([padFamily(0), padFamily(1), padFamily(2)]).toEqual(['nintendo', 'xbox', 'playstation']);
  });

  it('read their sticks and triggers in the standard layout', async () => {
    const s = shell(true);
    await connectShellPads(s.api);
    s.send([DUALSENSE(0, [], [0.9, -0.1, 0, 0])]);
    expect(readPad(0)).toMatchObject({ right: true, left: false, up: false, down: false });
    s.send([DUALSENSE(0, [PadButton.RT], [-0.7, 0.7, 0, 0])]);
    expect(readPad(0)).toMatchObject({ kick: true, left: true, down: true });
    s.send([DUALSENSE(0, [PadButton.LT])]);
    expect(readPad(0)).toMatchObject({ special: true, kick: false });
  });

  it('drive the menus and the players, and a player follows their pad when it comes back under another number', async () => {
    const s = shell(true);
    await connectShellPads(s.api);
    s.send([DUALSENSE(5, [PadButton.A])]);
    const c = new Controller({ tick: 0 } as unknown as GameState);
    c.setRepeat(1);
    const ev: CtrlEvent[] = [];
    menuPoll(c, ev);
    expect(ev.filter((e) => e.source === CtrlType.GAMEPAD).map((e) => e.action)).toEqual([ACT_PUNCH]);
    const player = new GamepadController({ tick: 0, paused: false } as unknown as GameState, 0);
    try {
      expect(player.padIdent).toBe('PS5 Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)');
      // Unplugged, an Xbox pad came at 0 meanwhile; the PlayStation pad, back, is at 1.
      s.send([XBOX(2)]);
      s.send([XBOX(2), DUALSENSE(5, [PadButton.X])]);
      const fight: CtrlEvent[] = [];
      player.poll(fight);
      expect(player.padIndex).toBe(1);
      expect(fight[0].action & ACT_PUNCH).toBeTruthy();
    } finally {
      player.free();
    }
  });

  it('rumble through the shell, named by its number for the pad', async () => {
    const s = shell(true);
    await connectShellPads(s.api);
    s.send([XBOX(2), DUALSENSE(5)]);
    rumble(1, 1.4, 120.6);
    rumble(3, 0.5, 100);
    expect(s.calls.filter(([cmd]) => cmd === 'pads_rumble')).toEqual([['pads_rumble', { number: 5, strong: 1, weak: 1, ms: 121 }]]);
    expect(windowRumble).not.toHaveBeenCalled();
  });
});

describe("the window's pads", () => {
  it('wait for the shell to say whether it reads the pads, and are read when it does not', async () => {
    let answer: (on: boolean) => void = () => undefined;
    const s = shell(new Promise<boolean>((resolve) => (answer = resolve)));
    const started = connectShellPads(s.api);
    // (the same pads twice, otherwise)
    expect(gamepads()).toEqual([]);
    answer(false);
    await started;
    expect(s.unlistened).toBe(true);
    expect(gamepads()).toEqual([windowPad]);
    expect(readPad(0)).toMatchObject({ a: true });
    rumble(0, 0.5, 80);
    expect(windowRumble).toHaveBeenCalledWith('dual-rumble', { duration: 80, strongMagnitude: 0.5, weakMagnitude: 0.5 });
  });

  it('are read on the web, and when the shell fails', async () => {
    await connectShellPads(undefined);
    expect(gamepads()).toEqual([windowPad]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = shell(Promise.reject(new Error('no such command')));
    await connectShellPads(s.api);
    expect(gamepads()).toEqual([windowPad]);
    expect(warn).toHaveBeenCalled();
  });
});
