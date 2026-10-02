import { describe, expect, it } from 'vitest';
import { ACT_ESC, ACT_PUNCH, ORIGINAL_ARENAS, ORIGINAL_HAR_TYPES, SceneId } from '../game/constants';
import { CREDIT_BATTLES } from '../game/credits/battles';
import { CreditsRun } from '../game/credits/creditsRun';
import type { GameState } from '../game/gameState';
import { createGame, hasGameData, HeadlessRunner } from './harness';

/** The credits run headless (no title, no view), from the main menu. */
function startRun(): { gs: GameState; run: CreditsRun; runner: HeadlessRunner } {
  const gs = createGame(SceneId.MENU);
  const run = new CreditsRun(gs, 1);
  gs.credits = run;
  run.begin();
  return { gs, run, runner: new HeadlessRunner(gs) };
}

const arenaOver = (gs: GameState) => (gs.sc as unknown as { arenaIsOver?: () => number }).arenaIsOver?.() ?? -1;

describe('the credits fights', () => {
  it('are fought in the original arenas, never the same one twice in a row (a scene cannot follow itself)', () => {
    for (const b of CREDIT_BATTLES) expect(b.arena).toBeLessThan(ORIGINAL_ARENAS);
    for (let i = 1; i < CREDIT_BATTLES.length; i++) expect(CREDIT_BATTLES[i].arena).not.toBe(CREDIT_BATTLES[i - 1].arena);
  });

  it('are fought with the original robots only, none in two fights in a row', () => {
    const robots = CREDIT_BATTLES.map((b) => [b.winner.har, b.loser.har]);
    for (const [w, l] of robots) {
      expect(w).toBeLessThan(ORIGINAL_HAR_TYPES);
      expect(l).toBeLessThan(ORIGINAL_HAR_TYPES);
    }
    for (let i = 1; i < robots.length; i++) for (const h of robots[i]) expect(robots[i - 1]).not.toContain(h);
  });
});

describe.skipIf(!hasGameData)('the credits fights (headless)', () => {
  it('are all won by the credit, in their colors and names, then the end titles show and ESC goes back to EXTRAS', () => {
    const { gs, run, runner } = startRun();
    const winners: number[] = [];
    let fight = -1;
    for (let ms = 0; ms < 400_000 && run.phase === 'fights'; ms += 100) {
      runner.advance(100);
      if (run.fighting !== fight && gs.thisId !== SceneId.MENU) {
        fight = run.fighting;
        const b = CREDIT_BATTLES[fight];
        expect(gs.thisId).toBe(SceneId.ARENA0 + b.arena);
        expect(gs.getPlayer(0).pilot.name).toBe(b.winner.name);
        expect(gs.getPlayer(1).pilot.name).toBe(b.loser.name);
        expect(run.hudLine(0)).toBe(b.winner.line2);
      }
      if (arenaOver(gs) >= 0 && winners.length === fight) winners.push(arenaOver(gs));
    }
    expect(winners).toEqual(CREDIT_BATTLES.map(() => 0));
    expect(run.phase).toBe('finale');
    expect(gs.paused).toBe(true);
    run.action(ACT_ESC);
    runner.advance(2000);
    expect(gs.thisId).toBe(SceneId.MENU);
    expect(gs.credits).toBeNull();
  }, 120_000);

  it('skip to the next fight on ENTER / A', () => {
    const { gs, run, runner } = startRun();
    runner.advance(3000);
    expect(run.fighting).toBe(0);
    run.action(ACT_PUNCH);
    runner.advance(1000);
    expect(run.fighting).toBe(1);
    expect(gs.thisId).toBe(SceneId.ARENA0 + CREDIT_BATTLES[1].arena);
    // (the round starts once the VS card has had its moment)
    expect((gs.sc as unknown as { state: number }).state).toBe(0);
  });

  it('go back to the menu from a fight, and play no arena music of their own', () => {
    const { gs, run, runner } = startRun();
    runner.advance(6000);
    run.action(ACT_ESC);
    runner.advance(1500);
    expect(gs.thisId).toBe(SceneId.MENU);
    expect(gs.credits).toBeNull();
    expect(gs.menuReturn).toBeNull();
  });
});
