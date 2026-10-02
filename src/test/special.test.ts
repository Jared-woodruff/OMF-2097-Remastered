// One-button specials: the special button does the robot's special moves by the direction held (as the robot faces),
// and a fight with them plays back the same as a replay.
import { afterEach, describe, expect, it } from 'vitest';
import { setKeyState } from '../controller/input';
import { specialButtonMoves } from '../controller/special';
import { HarEventType, HarId, SceneId } from '../game/constants';
import { harData, harInstallHook } from '../game/objects/har';
import { settings } from '../game/settings';
import { createGame, hasGameData, HeadlessRunner } from './harness';

const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Slash'];

afterEach(() => {
  for (const k of KEYS) setKeyState(k, false);
});

describe.skipIf(!hasGameData)('special button', () => {
  it('picks the special by the direction held', () => {
    const gs = createGame(SceneId.MENU, [0, 1], [HarId.JAGUAR, HarId.KATANA]);
    gs.setupKeyboard(0, 0);
    gs.setupKeyboard(1, 1);
    gs.matchSettings.rounds = 0;
    gs.swapScene(SceneId.ARENA0);
    const run = new HeadlessRunner(gs);
    run.advance(3000);
    const p1 = gs.findObject(gs.getPlayer(0).harObjId)!;
    const h = harData(p1);
    const specials = specialButtonMoves(h.afData).ground;
    expect(specials.length).toBeGreaterThan(1);
    const started: string[] = [];
    harInstallHook(h, (e) => {
      if (e.type === HarEventType.ATTACK && e.move) started.push(e.move.moveString);
    });
    // Jaguar faces right: no direction is the first special, forward (right) the second.
    for (const [dir, slot] of [[null, 0], ['ArrowRight', 1]] as const) {
      if (dir) setKeyState(dir, true);
      run.advance(60);
      setKeyState('Slash', true);
      run.advance(60);
      setKeyState('Slash', false);
      if (dir) setKeyState(dir, false);
      run.advance(2500);
      expect(started.at(-1)).toBe(specials[slot].moveString);
    }
    // Off: the key does nothing.
    settings().keys.specialButton = false;
    const n = started.length;
    setKeyState('Slash', true);
    run.advance(100);
    setKeyState('Slash', false);
    run.advance(500);
    expect(started.length).toBe(n);
    settings().keys.specialButton = true;
  });
});
