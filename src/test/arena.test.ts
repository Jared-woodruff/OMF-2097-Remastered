import { describe, expect, it } from 'vitest';
import { SceneId } from '../game/constants';
import { setKeyState } from '../controller/input';
import { harData } from '../game/objects/har';
import { createGame, hasGameData, HeadlessRunner } from './harness';

describe.skipIf(!hasGameData)('arena (headless)', () => {
  it('runs a round start and lands hits with keyboard input', () => {
    const gs = createGame(SceneId.MENU);
    gs.swapScene(SceneId.ARENA0);
    const run = new HeadlessRunner(gs);
    run.advance(3500);
    const p2 = gs.findObject(gs.getPlayer(1).harObjId)!;
    const hp0 = harData(p2).health;
    setKeyState('ArrowRight', true);
    run.advance(1200);
    setKeyState('ArrowRight', false);
    for (let i = 0; i < 4; i++) {
      setKeyState('Enter', true);
      run.advance(60);
      setKeyState('Enter', false);
      run.advance(700);
    }
    expect(harData(p2).health).toBeLessThan(hp0);
    expect(gs.fightStats.hitsLanded[0]).toBeGreaterThan(0);
  });

  it('pauses the fight when the window loses focus', () => {
    const gs = createGame(SceneId.MENU);
    gs.swapScene(SceneId.ARENA0);
    const run = new HeadlessRunner(gs);
    run.advance(3500);
    const sc = gs.sc as unknown as { menuVisible: boolean };
    gs.sc.focusLost();
    expect(sc.menuVisible).toBe(true);
    expect(gs.paused).toBe(true);
    // Losing focus again changes nothing; the pause menu resumes as usual.
    gs.sc.focusLost();
    expect(sc.menuVisible).toBe(true);
    setKeyState('Escape', true);
    run.advance(100);
    setKeyState('Escape', false);
    run.advance(100);
    expect(sc.menuVisible).toBe(false);
    expect(gs.paused).toBe(false);
  });
});
