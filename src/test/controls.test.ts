// Controls: Xbox controller mapping (two button layouts, 8-way stick), pads reported in their own order (PlayStation,
// Nintendo, generic: their buttons by place, their hat switch), pad names and families, a pad followed to another index,
// keyboard players picking up a free pad, the menu conventions for pads, and the keyboard layouts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GamepadController, menuPoll, KeyboardController } from '../controller/keyboard';
import { Controller, type CtrlEvent } from '../controller/controller';
import { cleanPadName, hatDirections, PadButton, padFamilyOf, padUsbIds, readPad, setPadLayout, setKeyState } from '../controller/input';
import { ACT_DOWN, ACT_ESC, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_UP, CtrlType } from '../game/constants';
import { applyKeyLayout, detectKeyLayout, layoutKeys, resolvePad } from '../game/controls';
import { GameState } from '../game/gameState';
import { defaultSettings, settings } from '../game/settings';

interface FakePad {
  index: number;
  connected: boolean;
  id: string;
  mapping?: string;
  buttons: { pressed: boolean }[];
  axes: number[];
}

/** A pad as a browser reports it in the pad's own order (mapping ''): raw button numbers, axes as given. */
function rawPad(index: number, id: string, pressed: number[], axes: number[]): FakePad {
  return { index, connected: true, id, mapping: '', buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) })), axes };
}

/** A hat switch axis at rest, and pointing up / right / down / left (and up-right). */
const HAT = { rest: 1.2857, up: -1, upRight: -1 + 2 / 7, right: -1 + 4 / 7, down: -1 + 8 / 7, left: -1 + 12 / 7 };

/** Ten axes, the d-pad's hat on axis 9 (as browsers report Sony and Nintendo pads in their own order). */
const withHat = (hat: number, sticks: [number, number] = [0, 0]) => [...sticks, 0, -1, -1, 0, 0, 0, 0, hat];

let pads: (FakePad | null)[] = [];

function pad(index: number, pressed: number[] = [], axes: [number, number] = [0, 0]): FakePad {
  return {
    index, connected: true, id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })), axes: [...axes, 0, 0],
  };
}

beforeEach(() => {
  pads = [];
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  Object.assign(settings(), defaultSettings());
  setPadLayout('modern');
});

afterEach(() => {
  for (const code of ['KeyW', 'KeyJ', 'ArrowUp', 'Enter']) setKeyState(code, false);
  vi.unstubAllGlobals();
});

describe('Xbox controller', () => {
  it('maps punch to X / Y / RB and kick to A / B / RT (modern), or A / X and B / Y (classic)', () => {
    pads = [pad(0, [PadButton.X])];
    expect(readPad(0)).toMatchObject({ punch: true, kick: false, x: true });
    pads = [pad(0, [PadButton.RT])];
    expect(readPad(0)).toMatchObject({ punch: false, kick: true });
    pads = [pad(0, [PadButton.A])];
    expect(readPad(0)).toMatchObject({ punch: false, kick: true, a: true });
    setPadLayout('classic');
    expect(readPad(0)).toMatchObject({ punch: true, kick: false });
    pads = [pad(0, [PadButton.Y])];
    expect(readPad(0)).toMatchObject({ punch: false, kick: true });
  });

  it('reads the left stick in eight directions', () => {
    const dir = (x: number, y: number) => {
      pads = [pad(0, [], [x, y])];
      const p = readPad(0)!;
      return `${p.up ? 'U' : ''}${p.down ? 'D' : ''}${p.left ? 'L' : ''}${p.right ? 'R' : ''}`;
    };
    expect(dir(0, 0)).toBe('');
    expect(dir(0.2, -0.2)).toBe(''); // dead zone
    expect(dir(1, 0)).toBe('R');
    expect(dir(0.7, 0.7)).toBe('DR');
    expect(dir(0, 1)).toBe('D');
    expect(dir(-0.7, 0.7)).toBe('DL');
    expect(dir(-1, 0.1)).toBe('L');
    expect(dir(-0.7, -0.7)).toBe('UL');
    expect(dir(0.1, -1)).toBe('U');
    expect(dir(0.7, -0.7)).toBe('UR');
    // The d-pad works too.
    pads = [pad(0, [PadButton.UP, PadButton.RIGHT])];
    expect(readPad(0)).toMatchObject({ up: true, right: true });
  });
});

describe('pads in their own order', () => {
  const DUALSENSE_FIREFOX = '054c-0ce6-DualSense Wireless Controller';

  it('a PlayStation pad: cross confirms, circle goes back, square and triangle are the left and top buttons', () => {
    // (Sony's own order: square 0, cross 1, circle 2, triangle 3)
    pads = [rawPad(0, DUALSENSE_FIREFOX, [1], withHat(HAT.rest))];
    expect(readPad(0)).toMatchObject({ a: true, b: false, x: false, kick: true, punch: false });
    pads = [rawPad(0, DUALSENSE_FIREFOX, [2], withHat(HAT.rest))];
    expect(readPad(0)).toMatchObject({ a: false, b: true });
    pads = [rawPad(0, DUALSENSE_FIREFOX, [0], withHat(HAT.rest))];
    expect(readPad(0)).toMatchObject({ x: true, punch: true });
    pads = [rawPad(0, DUALSENSE_FIREFOX, [3], withHat(HAT.rest))];
    expect(readPad(0)).toMatchObject({ y: true, punch: true });
    // Options pauses, L2 is the special button; the PS button and the touchpad (12, 13) are no d-pad.
    pads = [rawPad(0, DUALSENSE_FIREFOX, [9], withHat(HAT.rest))];
    expect(readPad(0)).toMatchObject({ start: true });
    pads = [rawPad(0, DUALSENSE_FIREFOX, [6], withHat(HAT.rest))];
    expect(readPad(0)).toMatchObject({ special: true });
    pads = [rawPad(0, DUALSENSE_FIREFOX, [12, 13], withHat(HAT.rest))];
    expect(readPad(0)).toMatchObject({ up: false, down: false });
  });

  it('reads the d-pad from the hat switch', () => {
    const dir = (hat: number) => {
      pads = [rawPad(0, DUALSENSE_FIREFOX, [], withHat(hat))];
      const p = readPad(0)!;
      return `${p.up ? 'U' : ''}${p.down ? 'D' : ''}${p.left ? 'L' : ''}${p.right ? 'R' : ''}`;
    };
    expect(dir(HAT.rest)).toBe('');
    expect(dir(HAT.up)).toBe('U');
    expect(dir(HAT.upRight)).toBe('UR');
    expect(dir(HAT.right)).toBe('R');
    expect(dir(HAT.down)).toBe('D');
    expect(dir(HAT.left)).toBe('L');
    expect(dir(1)).toBe('UL');
    expect(hatDirections(3.2857)).toEqual([false, false, false, false]);
    // and the stick still moves
    pads = [rawPad(0, DUALSENSE_FIREFOX, [], withHat(HAT.rest, [1, 0]))];
    expect(readPad(0)).toMatchObject({ right: true });
  });

  it('a Nintendo pad and a generic one: their buttons by place, the hat found where it rests', () => {
    pads = [rawPad(0, '057e-2009-Pro Controller', [0], withHat(HAT.down))];
    expect(readPad(0)).toMatchObject({ a: true, down: true });
    // a generic pad's hat on another axis (at rest it reads outside -1..1); without a hat, the d-pad on 12-15
    pads = [rawPad(0, '0079-0011-USB Gamepad', [1], [0, 0, 0, 0, 3.2857])];
    expect(readPad(0)).toMatchObject({ b: true, up: false });
    pads = [rawPad(0, '0079-0011-USB Gamepad', [], [0, 0, 0, 0, -1])];
    expect(readPad(0)).toMatchObject({ up: false });
    pads = [rawPad(0, '0e8f-0003-Gamepad', [PadButton.LEFT], [0, 0])];
    expect(readPad(0)).toMatchObject({ left: true });
  });
});

describe('pad names and families', () => {
  it('reads the vendor from Chromium and Firefox ids, the family from the vendor or the name', () => {
    expect(padUsbIds('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toEqual({ vendor: 0x054c, product: 0x0ce6 });
    expect(padUsbIds('54c-ce6-DualSense Wireless Controller')).toEqual({ vendor: 0x054c, product: 0x0ce6 });
    expect(padUsbIds('DualSense Wireless Controller')).toBeNull();
    expect(padFamilyOf('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)')).toBe('playstation');
    expect(padFamilyOf('DualSense Wireless Controller')).toBe('playstation');
    expect(padFamilyOf('Sony Interactive Entertainment DualSense Wireless Controller')).toBe('playstation');
    expect(padFamilyOf('057e-2009-Pro Controller')).toBe('nintendo');
    expect(padFamilyOf('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('xbox');
    expect(padFamilyOf('Microsoft X-Box 360 pad')).toBe('xbox');
    expect(cleanPadName('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('Xbox 360 Controller');
    expect(cleanPadName('054c-0ce6-DualSense Wireless Controller')).toBe('DualSense Wireless Controller');
  });
});

describe('a pad chosen for a player', () => {
  const gs = { tick: 0, paused: false } as unknown as GameState;
  const poll = (c: Controller) => {
    const ev: CtrlEvent[] = [];
    c.poll(ev);
    return ev.map((e) => e.action);
  };
  const named = (index: number, id: string, pressed: number[] = []) => ({ ...pad(index, pressed), id });

  it('is followed to another index when it comes back there, unless another player holds it', () => {
    pads = [named(0, 'Pad A'), named(1, 'Pad B')];
    const a = new GamepadController(gs, 0, 'Pad A');
    const b = new GamepadController(gs, 1, 'Pad B');
    try {
      // Pad A went away and came back after Pad B, at index 2.
      pads = [null, named(1, 'Pad B'), named(2, 'Pad A', [PadButton.X])];
      expect(poll(a)[0] & ACT_PUNCH).toBeTruthy();
      expect(a.padIndex).toBe(2);
      expect(b.padIndex).toBe(1);
      // Two pads of the same kind: one player's pad is not taken by the other's controller.
      pads = [named(0, 'Same'), named(1, 'Same')];
      const c = new GamepadController(gs, 0, 'Same');
      const d = new GamepadController(gs, 1, 'Same');
      pads = [null, named(1, 'Same')];
      poll(c);
      expect(c.padIndex).toBe(0);
      expect(d.padIndex).toBe(1);
      c.free();
      d.free();
    } finally {
      a.free();
      b.free();
    }
  });

  it('takes its place in the settings along: a keyboard player does not pick it up as a free pad', () => {
    const k = settings().keys;
    const saved = structuredClone(k);
    Object.assign(k, { ctrlType1: CtrlType.GAMEPAD, gamepad1: 0, gamepad1Id: 'Pad A', ctrlType2: CtrlType.KEYBOARD, autoPads: true });
    pads = [named(0, 'Pad A')];
    const a = new GamepadController(gs, 0, 'Pad A');
    const kb = GameState.prototype.keyboardController.call(gs, 1, 1);
    try {
      expect(kb.pad()).toBe(-1);
      // Pad A reconnects under another index: player 1 follows it, and it stays theirs alone.
      pads = [null, named(1, 'Pad A', [PadButton.X])];
      expect(poll(a)[0] & ACT_PUNCH).toBeTruthy();
      expect([a.padIndex, k.gamepad1]).toEqual([1, 1]);
      expect(kb.pad()).toBe(-1);
      // (a second pad is the keyboard player's)
      pads = [named(0, 'Pad B'), named(1, 'Pad A')];
      expect(kb.pad()).toBe(0);
    } finally {
      a.free();
      kb.free();
      Object.assign(k, saved);
    }
  });

  it("is found again by its id in the settings (resolvePad), not on the other player's pad", () => {
    pads = [named(0, 'Other'), named(1, 'Mine')];
    expect(resolvePad(0, 'Mine', -1)).toBe(1);
    expect(resolvePad(1, 'Mine', -1)).toBe(1);
    expect(resolvePad(0, 'Gone', -1)).toBe(0);
    pads = [named(0, 'Twin'), named(1, 'Twin')];
    expect(resolvePad(3, 'Twin', 0)).toBe(1);
  });
});

describe('keyboard players and pads', () => {
  const gs = { tick: 0 } as unknown as GameState;
  const poll = (c: Controller) => {
    const ev: CtrlEvent[] = [];
    c.poll(ev);
    return ev.map((e) => e.action);
  };

  it('play with the first free pad (player 1) or the second (player 2)', () => {
    const p1 = new KeyboardController(gs, settings().keys.p1);
    p1.padSlot = 0;
    const p2 = new KeyboardController(gs, settings().keys.p2);
    p2.padSlot = 1;
    pads = [pad(0, [PadButton.X]), pad(1, [PadButton.A], [0, 1])];
    expect(poll(p1)[0] & ACT_PUNCH).toBeTruthy();
    const a2 = poll(p2)[0];
    expect(a2 & ACT_KICK).toBeTruthy();
    expect(a2 & ACT_DOWN).toBeTruthy();
    // A pad chosen for player 2 in the input menu is not free: player 1 skips it.
    p1.reservedPads = () => [0];
    expect(p1.pad()).toBe(1);
    // The keyboard still works alongside.
    pads = [];
    setKeyState('ArrowUp', true);
    expect(poll(p1)[0] & ACT_UP).toBeTruthy();
  });
});

describe('menus with a pad', () => {
  const run = (opts: Parameters<typeof menuPoll>[2], buttons: number[], axes: [number, number] = [0, 0]) => {
    pads = [pad(0, buttons, axes)];
    const c = new Controller({ tick: 0 } as unknown as GameState);
    c.setRepeat(1);
    const ev: CtrlEvent[] = [];
    menuPoll(c, ev, opts);
    return ev.filter((e) => e.source === CtrlType.GAMEPAD).map((e) => e.action);
  };

  it('A confirms, B goes back, X / Y are the second button, Menu confirms', () => {
    expect(run({}, [PadButton.A])).toEqual([ACT_PUNCH]);
    expect(run({}, [PadButton.B])).toEqual([ACT_ESC]);
    expect(run({}, [PadButton.Y])).toEqual([ACT_KICK]);
    expect(run({}, [PadButton.MENU])).toEqual([ACT_PUNCH]);
    expect(run({}, [PadButton.VIEW])).toEqual([ACT_ESC]);
    expect(run({}, [], [-1, 0])).toEqual([ACT_LEFT]);
    expect(run({}, [PadButton.RIGHT])).toEqual([ACT_RIGHT]);
  });

  it('leave the face buttons to the players in fights, where Menu pauses', () => {
    expect(run({ playerScene: true, startIsEsc: true }, [PadButton.B, PadButton.A])).toEqual([]);
    expect(run({ playerScene: true, startIsEsc: true }, [PadButton.MENU])).toEqual([ACT_ESC]);
    expect(run({ playerScene: true }, [PadButton.VIEW])).toEqual([ACT_ESC]);
  });
});

describe('keyboard layouts', () => {
  it('switch between the classic and the modern layout, in place', () => {
    const k = settings().keys;
    const p1 = k.p1;
    expect(detectKeyLayout()).toBe('classic');
    applyKeyLayout('modern');
    expect(k.p1).toBe(p1);
    expect(k.p1.jumpUp).toEqual(['KeyW']);
    expect(k.p1.punch).toContain('KeyJ');
    expect(k.p2.walkBack).toEqual(['ArrowLeft']);
    expect(detectKeyLayout()).toBe('modern');
    k.p1.kick = ['KeyL'];
    expect(detectKeyLayout()).toBe('custom');
    applyKeyLayout('classic');
    expect(k.p1).toEqual(layoutKeys('classic', 0));
    expect(detectKeyLayout()).toBe('classic');
  });

  it('do not share keys between the players', () => {
    for (const layout of ['classic', 'modern'] as const) {
      const a = Object.values(layoutKeys(layout, 0)).flat();
      const b = Object.values(layoutKeys(layout, 1)).flat();
      expect(a.filter((c) => b.includes(c))).toEqual([]);
    }
  });
});
