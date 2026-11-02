// The VS screen's line saying what starts the fight (issue #16: the screen waits for PUNCH with nothing to say so, and
// was taken for a stuck one): which games show it and what it says, from when, and not over a dialog.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SceneId } from '../game/constants';
import type { GameState } from '../game/gameState';
import type { VsScene } from '../game/scenes/vs';
import type { Text } from '../game/gui/text';
import { createGame, hasGameData, HeadlessRunner } from './harness';

/** The VS screen of a game set up by `setup` (pilots 0 and 1). */
function vsScreen(setup: (gs: GameState) => void): { gs: GameState; vs: VsScene; run: HeadlessRunner } {
  const gs = createGame(SceneId.MELEE);
  setup(gs);
  gs.swapScene(SceneId.VS);
  return { gs, vs: gs.sc as VsScene, run: new HeadlessRunner(gs) };
}

/** The line, if the screen has one. */
const hintOf = (vs: VsScene) => (vs as unknown as { hint: Text | null }).hint;

describe.skipIf(!hasGameData)('the VS screen says what starts the fight', () => {
  afterEach(() => vi.restoreAllMocks());

  it('one player: PRESS PUNCH TO FIGHT, from a moment after the screen comes up', () => {
    const { vs, run } = vsScreen((gs) => gs.setupAi(1));
    const hint = hintOf(vs);
    expect(hint?.str).toBe('PRESS PUNCH TO FIGHT');
    const draw = vi.spyOn(hint!, 'draw');
    run.advance(1000);
    vs.renderOverlay();
    expect(draw).not.toHaveBeenCalled();
    run.advance(600);
    vs.renderOverlay();
    expect(draw).toHaveBeenCalledWith(0, 140);
  });

  it('two players picking the arena: that, then PUNCH', () => {
    const { vs } = vsScreen((gs) => {
      gs.getPlayer(1).selectable = true;
    });
    expect(hintOf(vs)?.str).toBe('PICK THE ARENA (LEFT/RIGHT), THEN PUNCH');
  });

  it('none in demo play, which starts its fights itself', () => {
    const { vs } = vsScreen((gs) => {
      gs.setupAi(0);
      gs.setupAi(1);
    });
    expect(hintOf(vs)).toBeNull();
  });

  it('not over the quit dialog', () => {
    const { vs, run } = vsScreen((gs) => gs.setupAi(1));
    const draw = vi.spyOn(hintOf(vs)!, 'draw');
    run.advance(1600);
    vs.quitDialog.show(true);
    // (the runner draws its frames too)
    draw.mockClear();
    vs.renderOverlay();
    expect(draw).not.toHaveBeenCalled();
    vs.quitDialog.show(false);
    vs.renderOverlay();
    expect(draw).toHaveBeenCalled();
  });
});
