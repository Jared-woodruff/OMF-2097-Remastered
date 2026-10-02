// Development: seeds for the README trailer's fights (.captures/readme-media, recorded by the dev URL's seeded quick
// fight: src/game/quickFight.ts). Each matchup is played headlessly the way the page sets it up (the pilots and robots,
// the rules, the seeds, then the arena), for a range of seeds, through to its end: how good a fight it is to watch
// (src/gen/dev/creditsSeeds.test.ts engagement()), and the ticks of its moments: the round's start, the final blow,
// the finishing move and the aftermath's end (game ticks from the arena opening; the recorder turns them into frames).
//   TRAILER_FIGHTS=out.txt npx vitest run src/gen/dev/trailerFights.test.ts   (TRAILER_ONLY=name,name to pick some)
import { it } from 'vitest';
import fs from 'node:fs';
import { createGame, HeadlessRunner } from '../../test/harness';
import { HarState, SceneId } from '../../game/constants';
import { seedQuickFight, setupQuickFight } from '../../game/quickFight';
import { harData } from '../../game/objects/har';
import { engagement, type FightResult } from './creditsSeeds.test';

/** name: [arena, robot 1, robot 2, pilot 1, pilot 2] (the robots with the best HD artwork; the new ones on new arenas). */
export const TRAILER_MATCHUPS: Record<string, [number, number, number, number, number]> = {
  jaguar_shadow: [4, 0, 1, 0, 2],
  katana_pyros: [2, 5, 3, 5, 1],
  nova_chronos: [3, 10, 9, 0, 4],
  thorn_jaguar: [0, 2, 0, 3, 7],
  shadow_thorn: [1, 1, 2, 3, 5],
  pyros_nova: [4, 3, 10, 8, 6],
  chronos_katana: [0, 9, 5, 7, 2],
  glacier_tempest: [6, 11, 12, 3, 6],
  tempest_helix: [5, 12, 13, 6, 2],
  spectre_glacier: [7, 14, 11, 2, 9],
  helix_shadow: [8, 13, 1, 9, 8],
  spectre_tempest: [7, 14, 12, 2, 5],
};

interface TrailerFight extends FightResult {
  /** Ticks: the round's FIGHT! (the fighting starts), the final blow, the finishing move, the aftermath's end. */
  start: number;
  finishAt: number;
}

function params(name: string, seed: number): URLSearchParams {
  const [arena, h1, h2, p1, p2] = TRAILER_MATCHUPS[name];
  return new URLSearchParams(`fight=${arena}&h1=${h1}&h2=${h2}&p1=${p1}&p2=${p2}&seed=${seed}`);
}

/** Plays a seeded quick fight through to its end (as the page does: setupQuickFight, seedQuickFight, the arena). */
export function playQuick(name: string, seed: number, stepMs = 1000 / 60, limitMs = 150_000): TrailerFight {
  const gs = createGame(SceneId.MENU);
  const q = params(name, seed);
  const scene = setupQuickFight(gs, q);
  gs.arena = scene - SceneId.ARENA0;
  seedQuickFight(gs, q);
  gs.swapScene(scene);
  const t0 = gs.intTick;
  const run = new HeadlessRunner(gs);
  const arena = () => gs.sc as unknown as { state: number; finishing: boolean; arenaIsOver(): number; bestCombo: number[]; comboHits: number[] };
  const r: TrailerFight = {
    winner: -1, fight: 0, health: 0, finish: 0, total: 0, blow: 0, done: 0, hits: [0, 0], low: 100, leads: 0, downs: [0, 0],
    combos: [0, 0], score: 0, start: 0, finishAt: 0,
  };
  let fightAt = -1, leader = -1;
  const prevState = [0, 0];
  for (let ms = 0; ms < limitMs; ms += stepMs) {
    run.advance(stepMs);
    const a = arena();
    if (!('arenaIsOver' in a)) break;
    if (fightAt < 0 && a.state === 1) {
      fightAt = ms;
      r.start = gs.intTick - t0;
    }
    const hars = [0, 1].map((i) => harData(gs.findObject(gs.getPlayer(i).harObjId)!));
    const winner = a.arenaIsOver();
    if (r.winner < 0 && fightAt >= 0) {
      // (the lead as the credits' survey counts it: the winner's side is decided at the end)
      const pct = hars.map((h) => (100 * Math.max(0, h.health)) / h.healthMax);
      const d = pct[0] - pct[1];
      const now = d > 4 ? 0 : d < -4 ? 1 : leader;
      if (leader >= 0 && now !== leader) r.leads++;
      leader = now;
      r.low = Math.min(r.low, Math.min(pct[0], pct[1]));
      hars.forEach((h, i) => {
        if (h.state === HarState.STANDING_UP && prevState[i] !== HarState.STANDING_UP) r.downs[i]++;
        prevState[i] = h.state;
      });
      for (const i of [0, 1]) r.combos[i] = Math.max(r.combos[i], a.bestCombo[i], a.comboHits[i]);
    }
    if (!r.blow && gs.speed < 9) r.blow = gs.intTick - t0;
    if (winner >= 0 && r.winner < 0) {
      r.winner = winner;
      r.fight = (ms - fightAt) / 1000;
      r.health = Math.round((100 * Math.max(0, hars[winner].health)) / hars[winner].healthMax);
    }
    if (!r.finishAt && gs.fightStats.finish) r.finishAt = gs.intTick - t0;
    if (r.winner >= 0 && a.finishing) r.done = gs.intTick - t0;
    r.total = ms / 1000;
    // (to the aftermath's end, a few seconds past the knockout)
    if (r.winner >= 0 && r.done && gs.intTick - t0 > r.done + 60) break;
  }
  r.finish = gs.fightStats.finish;
  r.hits = [gs.fightStats.hitsLanded[0], gs.fightStats.hitsLanded[1]];
  r.low = Math.round(r.low);
  // (the score as for a credit, whichever side wins: mirrored when player 2 does)
  const mirrored: FightResult = r.winner === 1
    ? { ...r, winner: 0, hits: [r.hits[1], r.hits[0]], downs: [r.downs[1], r.downs[0]], combos: [r.combos[1], r.combos[0]] }
    : r;
  r.score = engagement(mirrored);
  return r;
}

it.runIf(!!process.env.TRAILER_FIGHTS)('trailer fight seeds', () => {
  const only = process.env.TRAILER_ONLY?.split(',');
  const count = Number(process.env.TRAILER_SEED_COUNT || 40);
  const out: string[] = [];
  const finishes = ['', ' SCRAP', ' DESTRUCTION'];
  for (const name of Object.keys(TRAILER_MATCHUPS)) {
    if (only && !only.includes(name)) continue;
    const rows: { seed: number; r: TrailerFight; same: boolean }[] = [];
    for (let seed = 1; seed <= count; seed++) {
      const r = playQuick(name, seed);
      const alt = playQuick(name, seed, 1000 / 144);
      rows.push({ seed, r, same: alt.winner === r.winner && alt.blow === r.blow && alt.finish === r.finish });
    }
    rows.sort((x, y) => y.r.score - x.r.score);
    out.push(`\n${name} ${JSON.stringify(TRAILER_MATCHUPS[name])}`);
    for (const { seed, r, same } of rows.slice(0, 12)) {
      out.push(`  seed ${String(seed).padStart(3)} P${r.winner + 1} score ${String(r.score).padStart(3)}  ${r.fight.toFixed(1)}s  left ${r.health}%` +
        `  hits ${r.hits.join('/')}  leads ${r.leads}  downs ${r.downs.join('/')}  combos ${r.combos.join('/')}${finishes[r.finish]}` +
        `  ticks: fight ${r.start} blow ${r.blow} finish ${r.finishAt} done ${r.done}${same ? '' : '  (DIFFERS AT ANOTHER STEP)'}`);
    }
    fs.writeFileSync(process.env.TRAILER_FIGHTS!, out.join('\n'));
  }
}, 7_200_000);
