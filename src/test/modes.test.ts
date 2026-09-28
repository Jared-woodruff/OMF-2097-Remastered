// Arcade, survival and time attack runs, and the records they keep.
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app';
import { AiController } from '../controller/ai';
import { AiDifficulty, HarId, PilotId, SceneId } from '../game/constants';
import { ModeRun, type RunResult } from '../game/modes/run';
import { harData } from '../game/objects/har';
import { ACHIEVEMENTS, recordFight, records, resetRecords } from '../game/records/records';
import { settings } from '../game/settings';
import { createGame, hasGameData, HeadlessRunner } from './harness';

beforeEach(() => resetRecords());

describe.skipIf(!hasGameData)('modes', () => {
  it('arcade: eight fights, better and better, Kreissack last; a lost fight is fought again', () => {
    const gs = createGame(SceneId.MENU, [0, 1], [HarId.JAGUAR, HarId.KATANA]);
    settings().gameplay.difficulty = AiDifficulty.CHAMPION;
    const run = new ModeRun('arcade');
    gs.modeRun = run;
    let shown: RunResult | null = null;
    app.showRunResults = (r) => (shown = r);
    run.setupOpponent(gs);
    const levels: number[] = [];
    const pilots: number[] = [];
    for (let fight = 0; fight < 8; fight++) {
      levels.push((gs.getPlayer(1).ctrl as AiController).difficulty);
      pilots.push(gs.getPlayer(1).pilot.pilotId);
      if (fight === 3) {
        // Lost: the same opponent again.
        const before = gs.getPlayer(1).pilot.pilotId;
        run.fightOver(gs, false, 1000, 0);
        expect(gs.getPlayer(1).pilot.pilotId).toBe(before);
        expect(run.continues).toBe(1);
      }
      run.fightOver(gs, true, 20_000, 80);
      // (the scene changes between fights: a new request is taken)
      gs.nextWaitTicks = 0;
    }
    expect(levels[0]).toBe(AiDifficulty.VETERAN);
    expect(levels[6]).toBe(AiDifficulty.CHAMPION);
    expect(levels[7]).toBe(AiDifficulty.DEADLY);
    expect(pilots[7]).toBe(PilotId.KREISSACK);
    expect(new Set(pilots.slice(0, 7)).size).toBe(7);
    expect(pilots).not.toContain(gs.getPlayer(0).pilot.pilotId);
    expect(shown).not.toBeNull();
    expect(shown!.cleared).toBe(true);
    expect(shown!.ms).toBe(8 * 20_000 + 1000);
    expect(gs.nextId).toBe(SceneId.MENU);
    expect(records().arcade.clears).toBe(1);
    expect(records().achievements.arcade).toBeGreaterThan(0);
    expect(records().achievements['arcade-clean']).toBeUndefined();
  });

  it('survival: health carries over (a quarter back after a win) and one loss ends it', () => {
    const gs = createGame(SceneId.MENU, [0, 1], [HarId.JAGUAR, HarId.KATANA]);
    const run = new ModeRun('survival');
    gs.modeRun = run;
    let shown: RunResult | null = null;
    app.showRunResults = (r) => (shown = r);
    run.setupOpponent(gs);
    expect(gs.matchSettings.rounds).toBe(0);
    run.fightOver(gs, true, 30_000, 40);
    expect(run.health).toBe(65);
    // The arena starts player 1 with that health.
    gs.setupAi(0, AiDifficulty.ROOKIE);
    gs.swapScene(SceneId.ARENA0 + gs.arena);
    const h = harData(gs.findObject(gs.getPlayer(0).harObjId)!);
    expect(h.health / h.healthMax).toBeCloseTo(0.65, 2);
    run.fightOver(gs, true, 30_000, 90);
    expect(run.health).toBe(100);
    run.fightOver(gs, false, 10_000, 0);
    expect(shown!.wins).toBe(2);
    expect(records().survival.best).toBe(2);
  });

  it('time attack: the clock runs while fighting', () => {
    const gs = createGame(SceneId.MENU, [0, 1], [HarId.JAGUAR, HarId.KATANA]);
    gs.setupAi(0, AiDifficulty.ULTIMATE);
    const run = new ModeRun('timeattack');
    gs.modeRun = run;
    run.setupOpponent(gs);
    // The computer plays player 1: one real fight to the end.
    (gs.getPlayer(1).ctrl as AiController).difficulty = AiDifficulty.PUNCHING_BAG;
    gs.swapScene(SceneId.ARENA0 + gs.arena);
    const runner = new HeadlessRunner(gs);
    for (let t = 0; t < 600_000 && gs.nextId !== SceneId.VS && gs.nextId !== SceneId.MENU; t += 100) runner.advance(100);
    expect(run.ms).toBeGreaterThan(1000);
    expect(run.fight).toBeGreaterThanOrEqual(1);
  });

  it('records fights and earns achievements', () => {
    recordFight({ human: true, versus: false, won: true, harId: 0, cpuDifficulty: 5, perfect: true, finish: 'destruction', bestCombo: 5, ticks: 1000 });
    const r = records();
    expect([r.fights, r.wins, r.perfects, r.destructions, r.bestCombo]).toEqual([1, 1, 1, 1, 5]);
    for (const id of ['first-win', 'perfect', 'destruction', 'combo3', 'combo5', 'giant']) expect(r.achievements[id], id).toBeGreaterThan(0);
    expect(r.achievements['all-robots']).toBeUndefined();
    for (let har = 1; har < 10; har++) {
      recordFight({ human: true, versus: false, won: true, harId: har, cpuDifficulty: 1, perfect: false, finish: 'none', bestCombo: 0, ticks: 10 });
    }
    expect(r.achievements['all-robots']).toBeGreaterThan(0);
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(20);
  });
});
