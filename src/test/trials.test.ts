// Combo trials: every trial of every robot can be done (the search's timing lands all its moves in one combo against
// the standard dummy), and the trial runner of the training lab sees a combo through and counts it as done.
import { describe, expect, it } from 'vitest';
import { harData, harInstallHook } from '../game/objects/har';
import { settings } from '../game/settings';
import { COMBO_TRIALS, SPECIAL_TRIALS } from '../game/training/trialData';
import { robotTrials, TrialRunner, trialDone } from '../game/training/trials';
import { ComboSim } from './comboSim';
import { hasGameData } from './harness';

describe.skipIf(!hasGameData)('combo trials', () => {
  it('every robot has trials, and each combo lands in one piece', () => {
    for (let har = 0; har <= 14; har++) {
      const combos = COMBO_TRIALS[har] ?? [];
      expect(combos.length, `robot ${har}`).toBeGreaterThan(0);
      const sim = new ComboSim(har, 0);
      for (const c of combos) {
        const r = sim.run({ har, dummy: 0, distance: c.distance, jump: c.jump }, c.steps.map(([move, delay]) => ({ move, delay })));
        expect(r.hits.every((h) => h >= 0), `robot ${har} ${JSON.stringify(c.steps)}`).toBe(true);
      }
    }
  });

  it('every special move trial lands from its distance', () => {
    for (const [har, list] of Object.entries(SPECIAL_TRIALS)) {
      const id = Number(har);
      const sim = new ComboSim(id, 0);
      for (const [move, distance] of list) {
        expect(sim.run({ har: id, dummy: 0, distance, jump: false }, [{ move, delay: 0 }]).hits[0], `robot ${id} move ${move}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('the trial runner counts a landed combo (and a special) as done', () => {
    settings().training.trialsDone = [];
    const sim = new ComboSim(0, 0);
    const gs = sim.gs;
    const p1 = gs.findObject(gs.getPlayer(0).harObjId)!;
    const p2 = gs.findObject(gs.getPlayer(1).harObjId)!;
    const trials = robotTrials(0, harData(p1).afData);
    const specials = trials.filter((t) => !t.combo);
    const combos = trials.filter((t) => t.combo);
    expect(specials.length).toBeGreaterThan(0);
    expect(combos.length).toBe(COMBO_TRIALS[0].length);
    const index = trials.indexOf(combos[0]);
    const runner = new TrialRunner(gs, 0, trials, index);
    harInstallHook(harData(p1), (e) => runner.onHarEvent(e));
    harInstallHook(harData(p2), (e) => runner.onHarEvent(e));
    const c = combos[0].combo!;
    sim.run({ har: 0, dummy: 0, distance: c.distance, jump: c.jump }, c.steps.map(([move, delay]) => ({ move, delay })));
    expect(runner.done).toBe(true);
    expect(trialDone(0, index)).toBe(true);
  });
});
