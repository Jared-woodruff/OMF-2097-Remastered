// Finds the combo trials of every robot (COMBO_SEARCH=1 npx vitest run src/gen/dev/comboSearch.test.ts): combos of
// two and three moves (from the ground, or starting with a jump-in attack) are tried at every timing against a
// standing dummy (src/test/comboSim.ts), kept when every link has a timing window of at least two ticks and they work
// against nearly every robot as the dummy, and a varied few per robot are written to src/game/training/trialData.ts
// (then check them with src/gen/dev/trialVerify.test.ts).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAT_HIGH, CAT_JUMPING, CAT_LOW, CAT_MEDIUM } from '../../game/constants';
import { harData } from '../../game/objects/har';
import type { AfMove } from '../../resources/resources';
import { ComboSim, type ComboStep } from '../../test/comboSim';
import { hasGameData } from '../../test/harness';

const ROBOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const DUMMIES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const DISTANCES = [40, 56, 72];
const JUMP_DISTANCES = [96, 116, 136];
const MAX_DELAY = 22;
const MIN_WINDOW = 2;

interface Found {
  steps: ComboStep[];
  distance: number;
  jump: boolean;
  damage: number;
  /** Timing window (ticks) of each step after the first. */
  windows: number[];
  dummies: number;
}

/** The longest run of consecutive values, and its middle. */
function bestWindow(ok: number[]): { size: number; mid: number } {
  let best = { size: 0, mid: -1 };
  for (let i = 0; i < ok.length;) {
    let j = i;
    while (j + 1 < ok.length && ok[j + 1] === ok[j] + 1) j++;
    const size = j - i + 1;
    if (size > best.size) best = { size, mid: ok[i + Math.floor((size - 1) / 2)] };
    i = j + 1;
  }
  return best;
}

const isSpecial = (m: AfMove) => m.moveString.length >= 3;

function searchRobot(har: number): Found[] {
  const sim = new ComboSim(har, 0);
  const af = harData(sim.gs.findObject(sim.gs.getPlayer(0).harObjId)!).afData;
  const valid = (m: AfMove | null): m is AfMove => !!m && /^[PK][1-9]*$/.test(m.moveString) && m.damage > 0 && !(m.posConstraints & 2);
  const ground = af.moves.filter((m): m is AfMove => valid(m) && [CAT_LOW, CAT_MEDIUM, CAT_HIGH].includes(m.category));
  const air = af.moves.filter((m): m is AfMove => valid(m) && m.category === CAT_JUMPING && m.moveString.length <= 2);
  const found: Found[] = [];
  const all = (hits: number[]) => hits.every((h) => h >= 0);

  /** Tries `m` at every delay after the given steps; returns the window. */
  const extend = (distance: number, jump: boolean, steps: ComboStep[], m: AfMove) => {
    const ok: number[] = [];
    for (let k = 0; k <= MAX_DELAY; k++) {
      if (all(sim.run({ har, dummy: 0, distance, jump }, [...steps, { move: m.id, delay: k }]).hits)) ok.push(k);
    }
    return bestWindow(ok);
  };

  const grow = (distance: number, jump: boolean, start: ComboStep[], windows: number[], depth: number) => {
    for (const m of ground) {
      const w = extend(distance, jump, start, m);
      if (w.size < MIN_WINDOW) continue;
      const steps = [...start, { move: m.id, delay: w.mid }];
      const r = sim.run({ har, dummy: 0, distance, jump }, steps);
      found.push({ steps, distance, jump, damage: r.damage, windows: [...windows, w.size], dummies: 0 });
      if (depth > 1) grow(distance, jump, steps, [...windows, w.size], depth - 1);
    }
  };

  // Ground starters.
  for (const d of DISTANCES) {
    for (const a of ground) {
      const start = [{ move: a.id, delay: 0 }];
      if (!all(sim.run({ har, dummy: 0, distance: d, jump: false }, start).hits)) continue;
      grow(d, false, start, [], 2);
    }
  }
  // Jump-ins: the latest button press that still hits (a deep jump-in), then ground moves.
  for (const d of JUMP_DISTANCES) {
    for (const a of air) {
      const ok: number[] = [];
      for (let t = 3; t <= 45; t++) if (all(sim.run({ har, dummy: 0, distance: d, jump: true }, [{ move: a.id, delay: t }]).hits)) ok.push(t);
      const w = bestWindow(ok);
      if (w.size < MIN_WINDOW) continue;
      const press = ok.filter((t) => t <= w.mid + Math.floor(w.size / 2)).pop()!;
      grow(d, true, [{ move: a.id, delay: press }], [], 2);
    }
  }

  // Against the other robots (with the same timing).
  const sims = new Map<number, ComboSim>();
  for (const f of found) {
    for (const dummy of DUMMIES) {
      let s = sims.get(dummy);
      if (!s) sims.set(dummy, (s = dummy === 0 ? sim : new ComboSim(har, dummy)));
      if (all(s.run({ har, dummy, distance: f.distance, jump: f.jump }, f.steps).hits)) f.dummies++;
    }
  }
  return found;
}

/** A varied few, easy to hard: the easiest link, one ending in a special, three hits, a jump-in, the most damage. */
function pick(har: number, found: Found[]): Found[] {
  const sim = new ComboSim(har, 0);
  const af = harData(sim.gs.findObject(sim.gs.getPlayer(0).harObjId)!).afData;
  const move = (id: number) => af.moves[id]!;
  const good = found.filter((f) => f.dummies >= DUMMIES.length - 2);
  const key = (f: Found) => `${f.jump ? 'J' : ''}${f.steps.map((s) => s.move).join('-')}`;
  const minW = (f: Found) => Math.min(...f.windows);
  const byEase = (a: Found, b: Found) => minW(b) - minW(a) || b.damage - a.damage;
  const out: Found[] = [];
  const take = (list: Found[]) => {
    const f = list.find((x) => !out.some((o) => key(o) === key(x)));
    if (f) out.push(f);
  };
  const two = good.filter((f) => f.steps.length === 2 && !f.jump);
  take([...two].sort(byEase));
  take(two.filter((f) => isSpecial(move(f.steps[1].move))).sort(byEase));
  const three = good.filter((f) => f.steps.length === 3 && !f.jump);
  take([...three].sort(byEase));
  take(three.filter((f) => isSpecial(move(f.steps[2].move))).sort(byEase));
  take(good.filter((f) => f.jump).sort((a, b) => b.steps.length - a.steps.length || byEase(a, b)));
  take([...good].sort((a, b) => b.damage - a.damage || byEase(a, b)));
  return out.sort((a, b) => a.steps.length - b.steps.length || minW(b) - minW(a));
}

describe.skipIf(!process.env.COMBO_SEARCH || !hasGameData)('combo trial search', () => {
  it('finds and writes the combo trials', () => {
    const lines: string[] = [];
    const log: string[] = [];
    for (const har of ROBOTS) {
      const t0 = performance.now();
      const found = searchRobot(har);
      const picked = pick(har, found);
      log.push(`HAR ${har}: ${found.length} combos, ${picked.length} picked (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
      for (const f of picked) log.push(`  ${f.jump ? 'JUMP ' : ''}${f.steps.map((s) => `${s.move}@${s.delay}`).join(' > ')} d=${f.distance} dmg=${f.damage} win=${f.windows.join('/')} dummies=${f.dummies}`);
      const entries = picked.map((f) => `    { steps: [${f.steps.map((s) => `[${s.move}, ${s.delay}]`).join(', ')}], distance: ${f.distance}, ` +
        `jump: ${f.jump}, damage: ${f.damage}, window: ${Math.min(...f.windows)}, fails: [] },`);
      lines.push(`  ${har}: [\n${entries.join('\n')}\n  ],`);
    }
    const file = `// Generated by src/gen/dev/comboSearch.test.ts (COMBO_SEARCH=1): the combo trials of every robot. Each step is a move
// (animation id) and the ticks after the step before landed (the first step: after the start, or after the jump) at
// which the search entered it; \`distance\` is where the robots stood, \`window\` the narrowest timing window in ticks.
export interface TrialCombo {
  steps: [move: number, delay: number][];
  distance: number;
  jump: boolean;
  damage: number;
  window: number;
  fails: number[];
}

export const COMBO_TRIALS: Record<number, TrialCombo[]> = {
${lines.join('\n')}
};
`;
    fs.writeFileSync(path.resolve(__dirname, '../../game/training/trialData.ts'), file);
    fs.writeFileSync(path.resolve(__dirname, '../../../.captures/combo-search.txt'), log.join('\n'));
    expect(lines.length).toBe(ROBOTS.length);
  }, 3_600_000);
});
