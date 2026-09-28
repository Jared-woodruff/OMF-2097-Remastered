// Controls: Xbox controller mapping (two button layouts, 8-way stick), keyboard players picking up a free pad, the menu
// conventions for pads, and the keyboard layouts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { menuPoll, KeyboardController } from '../controller/keyboard';
import { Controller, type CtrlEvent } from '../controller/controller';
import { PadButton, readPad, setPadLayout, setKeyState } from '../controller/input';
import { ACT_DOWN, ACT_ESC, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_UP, CtrlType } from '../game/constants';
import { applyKeyLayout, detectKeyLayout, layoutKeys } from '../game/controls';
import type { GameState } from '../game/gameState';
import { defaultSettings, settings } from '../game/settings';

interface FakePad {
  index: number;
  connected: boolean;
  id: string;
  buttons: { pressed: boolean }[];
  axes: number[];
}

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
