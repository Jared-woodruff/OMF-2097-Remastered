// Development: picks the seeds of the credits' fights (src/game/credits/battles.ts). For every fight, a range of seeds
// is played headlessly, set up the way the credits set them up (the arena's credits hooks), through to the fight's end:
// who wins, how long the fighting takes, how much health the credit has left, and whether it ends on a finishing move
// (SCRAP or DESTRUCTION: the brutal ones). The same fight at another frame step checks the outcome does not depend on
// it. CREDITS_RULES (JSON, e.g. {"power":[8,5]}) tries other rules than CREDITS_RULES in battles.ts.
//   CREDITS_SEEDS=out.txt npx vitest run src/gen/dev/creditsSeeds.test.ts
import { it } from 'vitest';
import fs from 'node:fs';
import { createGame, HeadlessRunner } from '../../test/harness';
import { SceneId } from '../../game/constants';
import {
  CREDIT_BATTLES, CREDITS_END_TICKS, CREDITS_READY_TICK, CREDITS_RULES, setupCreditsBattle, type CreditBattle, type CreditsRules,
} from '../../game/credits/battles';
import { harData } from '../../game/objects/har';

export interface FightResult {
  winner: number;
  /** Seconds of fighting, from "Fight!" to the knockout. */
  fight: number;
  /** The winner's health left (%). */
  health: number;
  /** 0: none, 1: SCRAP, 2: DESTRUCTION. */
  finish: number;
  /** Seconds from the arena opening to the fight's end (faded out). */
  total: number;
}

/** Plays a credits fight through to its end. */
export function playBattle(b: CreditBattle, rules: CreditsRules = CREDITS_RULES, stepMs = 1000 / 60, limitMs = 120_000): FightResult {
  const gs = createGame(SceneId.MENU);
  let over = false;
  gs.credits = {
    readyTick: CREDITS_READY_TICK,
    endTicks: CREDITS_END_TICKS,
    setupFight: () => setupCreditsBattle(gs, b, rules),
    hudLine: () => '',
    fightOver: () => (over = true),
    action: () => undefined,
  };
  gs.swapScene(SceneId.ARENA0 + b.arena);
  const run = new HeadlessRunner(gs);
  const arena = () => gs.sc as unknown as { state: number; arenaIsOver(): number };
  const r: FightResult = { winner: -1, fight: 0, health: 0, finish: 0, total: 0 };
  let fightAt = -1;
  for (let ms = 0; ms < limitMs && !over; ms += stepMs) {
    run.advance(stepMs);
    if (fightAt < 0 && arena().state === 1) fightAt = ms;
    const winner = arena().arenaIsOver();
    if (winner >= 0 && r.winner < 0) {
      const h = harData(gs.findObject(gs.getPlayer(winner).harObjId)!);
      r.winner = winner;
      r.fight = (ms - fightAt) / 1000;
      r.health = Math.round((100 * Math.max(0, h.health)) / h.healthMax);
    }
    r.total = ms / 1000;
  }
  r.finish = gs.fightStats.finish;
  return r;
}

it.runIf(!!process.env.CREDITS_SEEDS)('credits fight seeds', () => {
  const rules: CreditsRules = { ...CREDITS_RULES, ...JSON.parse(process.env.CREDITS_RULES || '{}') };
  const out: string[] = [`rules ${JSON.stringify(rules)}`];
  const finishes = ['', ' SCRAP', ' DESTRUCTION'];
  for (const b of CREDIT_BATTLES) {
    const rows: string[] = [];
    let wins = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = playBattle({ ...b, seed }, rules);
      const alt = playBattle({ ...b, seed }, rules, 1000 / 144);
      if (r.winner === 0) wins++;
      rows.push(`${seed}:${r.winner === 0 ? 'W' : r.winner === 1 ? 'L' : '-'}${r.fight.toFixed(1)}s/${r.health}%${finishes[r.finish]}` +
        (alt.winner !== r.winner || Math.abs(alt.fight - r.fight) > 0.1 || alt.finish !== r.finish ? ` (alt ${alt.winner} ${alt.fight.toFixed(1)})` : ''));
    }
    out.push(`${b.title} (${wins}/40): ${rows.join('  ')}`);
  }
  fs.writeFileSync(process.env.CREDITS_SEEDS!, out.join('\n'));
}, 1_800_000);
