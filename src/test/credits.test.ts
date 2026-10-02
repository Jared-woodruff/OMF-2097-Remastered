import { describe, expect, it } from 'vitest';
import { setKeyState } from '../controller/input';
import { SceneId } from '../game/constants';
import { CreditsScene } from '../game/scenes/credits';
import { drawList, FBUFOPT_CREDITS } from '../video/draw';
import { createGame, hasGameData, HeadlessRunner } from './harness';

describe.skipIf(!hasGameData)('credits (headless)', () => {
  it('runs the CREDITS.BK sequence in the credits framebuffer mode, then quits', () => {
    const gs = createGame(SceneId.MENU);
    let quit = 0;
    gs.onQuit = () => quit++;
    gs.swapScene(SceneId.CREDITS);
    expect(gs.sc).toBeInstanceOf(CreditsScene);
    expect(gs.objects.map((r) => r.obj.curAnimation?.id)).toEqual([20]);
    const run = new HeadlessRunner(gs);
    const seen = new Set<number>();
    for (let t = 0; t < 44000; t += 1000) {
      run.advance(1000);
      expect(drawList.framebufferOptions).toBe(FBUFOPT_CREDITS);
      for (const r of gs.objects) if (r.obj.curAnimation) seen.add(r.obj.curAnimation.id);
      expect(gs.run).toBe(true);
    }
    // Animation 20 chains through the credit pages (21..27).
    for (const id of [20, 21, 22, 23]) expect(seen.has(id)).toBe(true);
    run.advance(2000); // 4500 ticks
    expect(gs.nextId).toBe(SceneId.NONE);
    run.advance(1000);
    expect(gs.run).toBe(false);
    expect(quit).toBeGreaterThan(0);
  });

  it('can be skipped', () => {
    const gs = createGame(SceneId.MENU);
    gs.swapScene(SceneId.CREDITS);
    const run = new HeadlessRunner(gs);
    run.advance(2000);
    setKeyState('Enter', true);
    run.advance(60);
    setKeyState('Enter', false);
    expect(gs.nextId).toBe(SceneId.NONE);
  });
});
