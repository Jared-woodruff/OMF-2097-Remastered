// Development: picks the seeds of the credits' fights (src/game/credits/battles.ts). For every fight, a range of seeds
// is played headlessly, set up the way the credits set them up (the arena's credits hooks), through to the fight's end:
// who wins, how long the fighting takes, and how good a fight it is to watch: the hits each side lands, the credit's
// lowest health, how often the lead changes hands, the knockdowns, the best combos, and whether it ends on a finishing
// move (SCRAP or DESTRUCTION). Each fight gets a score from those (engagement()); the best seeds the credit wins are
// listed first. The same fight at another frame step checks the outcome does not depend on it. The final blow's and
// the aftermath's ticks are measured as the credits count them (battles.ts blow, done). CREDITS_RULES (JSON, e.g.
// {"power":[7,6]}) tries other rules than CREDITS_RULES in battles.ts; CREDITS_FIGHTS (e.g. "1,3") only some fights;
// CREDITS_SEED_COUNT the seeds tried (60).
//   CREDITS_SEEDS=out.txt npx vitest run src/gen/dev/creditsSeeds.test.ts
import { it } from 'vitest';
import fs from 'node:fs';
import { createGame, HeadlessRunner } from '../../test/harness';
import { HarState, SceneId } from '../../game/constants';
import {
  CREDIT_BATTLES, CREDITS_OWN_END_TICKS, CREDITS_READY_TICK, CREDITS_RULES, setupCreditsBattle, type CreditBattle, type CreditsRules,
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
  /** Game ticks from the arena opening to the final blow (the knockout's slow motion), and to the aftermath's end. */
  blow: number;
  done: number;
  /** Hits landed by the credit and by its opponent. */
  hits: [number, number];
  /** The credit's lowest health (%) during the fight. */
  low: number;
  /** Times the lead (in health) changed hands. */
  leads: number;
  /** Knockdowns suffered by the credit and by its opponent. */
  downs: [number, number];
  /** Best combos (hits in a row) of the credit and of its opponent. */
  combos: [number, number];
  /** How good a fight it is to watch (engagement()). */
  score: number;
}

/**
 * A fight's score: an even fight that goes back and forth, both sides landing hits and knocking each other down, the
 * credit behind at some point and winning it anyway (closely), on a combo or a finishing move, neither short nor long.
 */
export function engagement(r: FightResult): number {
  if (r.winner !== 0) return -1;
  let s = 0;
  s += 3 * Math.min(r.hits[1], 10) + 1.5 * Math.min(r.hits[0], 16);
  s += 9 * Math.min(r.leads, 3);
  s += 5 * Math.min(r.downs[0], 2) + 3 * Math.min(r.downs[1], 3);
  s += 3 * Math.min(Math.max(r.combos[0], r.combos[1]), 5);
  s += r.finish ? 10 : 0;
  // (the credit hurt, and winning it closely)
  s += r.low < 60 ? 8 : 0;
  s += r.health >= 12 && r.health <= 55 ? 10 : r.health > 80 ? -10 : 0;
  // (long enough for a fight, short enough for the song: 13 to 19 seconds of fighting)
  s -= r.fight < 13 ? (13 - r.fight) * 4 : r.fight > 19 ? (r.fight - 19) * 4 : 0;
  return Math.round(s);
}

/** Plays a credits fight through to its end. */
export function playBattle(b: CreditBattle, rules: CreditsRules = CREDITS_RULES, stepMs = 1000 / 60, limitMs = 150_000): FightResult {
  const gs = createGame(SceneId.MENU);
  let over = false;
  gs.credits = {
    readyTick: CREDITS_READY_TICK,
    endTicks: CREDITS_OWN_END_TICKS,
    setupFight: () => setupCreditsBattle(gs, b, rules),
    hudLine: () => '',
    fightOver: () => (over = true),
    action: () => undefined,
    staticTick: () => undefined,
  };
  gs.swapScene(SceneId.ARENA0 + b.arena);
  const t0 = gs.intTick;
  const run = new HeadlessRunner(gs);
  const arena = () => gs.sc as unknown as {
    state: number; finishing: boolean; arenaIsOver(): number; bestCombo: number[]; comboHits: number[];
  };
  const r: FightResult = {
    winner: -1, fight: 0, health: 0, finish: 0, total: 0, blow: 0, done: 0, hits: [0, 0], low: 100, leads: 0, downs: [0, 0],
    combos: [0, 0], score: 0,
  };
  let fightAt = -1;
  let leader = -1;
  const prevState = [0, 0];
  for (let ms = 0; ms < limitMs && !over; ms += stepMs) {
    run.advance(stepMs);
    const a = arena();
    if (fightAt < 0 && a.state === 1) fightAt = ms;
    const hars = [0, 1].map((i) => harData(gs.findObject(gs.getPlayer(i).harObjId)!));
    if (r.winner < 0 && fightAt >= 0) {
      const pct = hars.map((h) => (100 * Math.max(0, h.health)) / h.healthMax);
      r.low = Math.min(r.low, pct[0]);
      // (the lead changes hands when the other side gets ahead by a few percent)
      const d = pct[0] - pct[1];
      const now = d > 4 ? 0 : d < -4 ? 1 : leader;
      if (leader >= 0 && now !== leader) r.leads++;
      leader = now;
      hars.forEach((h, i) => {
        if (h.state === HarState.STANDING_UP && prevState[i] !== HarState.STANDING_UP) r.downs[i]++;
        prevState[i] = h.state;
      });
      for (const i of [0, 1]) r.combos[i] = Math.max(r.combos[i], a.bestCombo[i], a.comboHits[i]);
    }
    // (the final blow: the knockout's slow motion)
    if (!r.blow && gs.speed < rules.speed - 1) r.blow = gs.intTick - t0;
    const winner = a.arenaIsOver();
    if (winner >= 0 && r.winner < 0) {
      const h = hars[winner];
      r.winner = winner;
      r.fight = (ms - fightAt) / 1000;
      r.health = Math.round((100 * Math.max(0, h.health)) / h.healthMax);
    }
    if (r.winner >= 0 && a.finishing) r.done = gs.intTick - t0;
    r.total = ms / 1000;
  }
  r.finish = gs.fightStats.finish;
  r.hits = [gs.fightStats.hitsLanded[0], gs.fightStats.hitsLanded[1]];
  r.low = Math.round(r.low);
  if (!r.done) r.done = r.blow;
  r.score = engagement(r);
  return r;
}

it.runIf(!!process.env.CREDITS_SEEDS)('credits fight seeds', () => {
  const rules: CreditsRules = { ...CREDITS_RULES, ...JSON.parse(process.env.CREDITS_RULES || '{}') };
  const only = process.env.CREDITS_FIGHTS?.split(',').map(Number);
  const count = Number(process.env.CREDITS_SEED_COUNT || 60);
  const out: string[] = [`rules ${JSON.stringify(rules)}`];
  const finishes = ['', ' SCRAP', ' DESTRUCTION'];
  CREDIT_BATTLES.forEach((b, n) => {
    if (only && !only.includes(n + 1)) return;
    const rows: { seed: number; r: FightResult; alt: boolean }[] = [];
    for (let seed = 1; seed <= count; seed++) {
      const r = playBattle({ ...b, seed }, rules);
      const alt = playBattle({ ...b, seed }, rules, 1000 / 144);
      rows.push({ seed, r, alt: alt.winner === r.winner && alt.blow === r.blow && alt.finish === r.finish });
    }
    const wins = rows.filter((x) => x.r.winner === 0).length;
    out.push(`\n${n + 1}. ${b.title} (${b.winner.name} ${b.winner.har} v ${b.loser.name} ${b.loser.har}, arena ${b.arena}): won ${wins}/${count}`);
    rows.sort((x, y) => y.r.score - x.r.score);
    for (const { seed, r, alt } of rows) {
      out.push(`  seed ${String(seed).padStart(3)} ${r.winner === 0 ? 'W' : r.winner === 1 ? 'L' : '-'} score ${String(r.score).padStart(3)}` +
        `  ${r.fight.toFixed(1)}s  left ${r.health}%  low ${r.low}%  hits ${r.hits.join('/')}  leads ${r.leads}` +
        `  downs ${r.downs.join('/')}  combos ${r.combos.join('/')}${finishes[r.finish]}  blow ${r.blow} done ${r.done}` +
        (alt ? '' : '  (DIFFERS AT ANOTHER STEP)'));
    }
    fs.writeFileSync(process.env.CREDITS_SEEDS!, out.join('\n'));
  });
}, 7_200_000);
