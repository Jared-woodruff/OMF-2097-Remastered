// Move list (pause menu) and the training input display.
import { describe, expect, it } from 'vitest';
import { ACT_DOWN, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_STOP, ACT_UP } from '../game/constants';
import { actionDir, InputDisplay } from '../game/gui/inputDisplay';
import { dirIcon } from '../game/gui/inputIcons';
import { harMoveList, moveNotation } from '../game/gui/moveList';
import { loadAf } from '../resources/resources';
import { hasGameData, loadGameData } from './harness';

describe('move notation', () => {
  it('lists the directions in the order they are entered', () => {
    // Move strings hold the directions most recent first.
    expect(moveNotation('P6321')).toEqual({ inputs: ['1', '2', '3', '6'], button: 'P' });
    expect(moveNotation('K41')).toEqual({ inputs: ['1', '4'], button: 'K' });
    expect(moveNotation('P6')).toEqual({ inputs: ['6'], button: 'P' });
    expect(moveNotation('P23698')).toEqual({ inputs: ['8', '9', '6', '3', '2'], button: 'P' });
  });

  it('shows returns to neutral only where they matter', () => {
    // Between taps of the same direction a release is implied; between different ones and before the button it is not.
    expect(moveNotation('P656')?.inputs).toEqual(['6', '6']);
    expect(moveNotation('P65656')?.inputs).toEqual(['6', '6', '6']);
    expect(moveNotation('P5652')?.inputs).toEqual(['2', '5', '6', '5']);
    expect(moveNotation('P525')?.inputs).toEqual(['2', '5']);
    expect(moveNotation('P85252')?.inputs).toEqual(['2', '2', '5', '8']);
    expect(moveNotation('P4789654')?.inputs).toEqual(['4', '5', '6', '9', '8', '7', '4']);
  });

  it('rejects internal move strings', () => {
    for (const s of ['!', 'n', '0', 'LINK17', '"!"', '']) expect(moveNotation(s)).toBeNull();
  });

  it('has an icon for every direction', () => {
    for (const d of '123456789') expect(dirIcon(d)?.w).toBe(7);
    expect(dirIcon('0')).toBeNull();
    // The arrows point where they should: the tip of "forward" is on the right, "up" on top.
    const right = dirIcon('6')!, up = dirIcon('8')!;
    expect(right.data[3 * 7 + 6]).toBe(1);
    expect(right.data[3 * 7]).toBe(1);
    expect(up.data[3]).toBe(1);
    expect(up.data[6]).toBe(0);
  });
});

describe.skipIf(!hasGameData)('robot move lists', () => {
  it('lists throws, specials, air moves and finishers of each robot', () => {
    loadGameData();
    const jaguar = harMoveList(loadAf(0)).map((e) => `${e.label} ${e.inputs.join('')}${e.button}`);
    expect(jaguar).toEqual(['THROW 6P', 'SPECIAL 1236P', 'SPECIAL 36P', 'SPECIAL 14P', 'AIR 36P', 'SCRAP 2258P', 'DESTRUCT 258K']);
    for (let har = 0; har < 11; har++) {
      const list = harMoveList(loadAf(har));
      expect(list.filter((e) => e.label === 'SPECIAL').length, `robot ${har}`).toBeGreaterThan(1);
      expect(list.some((e) => e.label === 'SCRAP'), `robot ${har}`).toBe(true);
      expect(list.length, `robot ${har}`).toBeLessThanOrEqual(10);
    }
  });
});

describe('input display', () => {
  it('reads directions from actions', () => {
    expect(actionDir(ACT_STOP)).toBe('5');
    expect(actionDir(ACT_RIGHT)).toBe('6');
    expect(actionDir(ACT_DOWN | ACT_LEFT)).toBe('1');
    expect(actionDir(ACT_UP | ACT_RIGHT | ACT_PUNCH)).toBe('9');
  });

  it('logs changes with their duration, mirrored when facing left', () => {
    const d = new InputDisplay();
    d.record([ACT_DOWN], false);
    d.record([ACT_DOWN], false);
    d.record([ACT_DOWN | ACT_RIGHT], false);
    d.record([], false); // held back by the input delay: same input
    d.record([ACT_RIGHT | ACT_PUNCH], false);
    d.record([ACT_RIGHT], false);
    d.record([ACT_STOP], false);
    expect(d.rows.map((r) => `${r.dir}${r.buttons}${r.ticks}`)).toEqual(['51', '6P2', '32', '22']);
    // Facing left, pressing left is "forward".
    d.record([ACT_LEFT | ACT_KICK], true);
    expect(d.rows[0]).toEqual({ dir: '6', buttons: 'K', ticks: 1 });
    for (let i = 0; i < 20; i++) d.record([ACT_UP], false);
    expect(d.rows.length).toBe(6);
    for (let i = 0; i < 200; i++) d.record([ACT_UP], false);
    expect(d.rows[0].ticks).toBe(99);
  });
});
