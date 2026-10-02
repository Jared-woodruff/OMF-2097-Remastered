// Development: a survey of the finishing moves. Plays AI fights to their end (src/test/finisherPlay.ts) for every
// robot as the winner, in every arena, and lists each scrap and destruction: whether it catches the beaten robot, how
// close the robots come as drawn, whether the winner runs into a wall. Shadow's finishers work from a distance (its
// shadows do the catching), so they are APART by design.
//   FINISHERS=out.txt npx vitest run src/gen/dev/finisherCheck.test.ts
// FIN_WINNERS=0,5 / FIN_ARENAS=0,1 / FIN_SEEDS=1,2 limit it; FIN_TRACE=1 adds a per-tick trace from each knockout;
// FIN_CREDITS=1 checks the credits' own fights instead.
import fs from 'node:fs';
import { it } from 'vitest';
import { CREDIT_BATTLES } from '../../game/credits/battles';
import { playFinish, type Finisher } from '../../test/finisherPlay';

const NAMES = ['JAGUAR', 'SHADOW', 'THORN', 'PYROS', 'ELECTRA', 'KATANA', 'SHREDDER', 'FLAIL', 'GARGOYLE', 'CHRONOS', 'NOVA', 'GLACIER', 'TEMPEST', 'HELIX', 'SPECTRE'];

const how = (f: Finisher) =>
  `${f.kind} ${f.caught < 0 ? 'NOT CAUGHT' : f.minGap > 1 ? `APART (gap >= ${f.minGap})` : `touching ${f.touching}/${f.ticks} ticks`}` +
  `${f.wall ? ', winner at a wall' : ''} (winner ${f.wx}, loser ${f.lx}; jumps ${Math.round(f.winnerJump)} / ${Math.round(f.maxJump)})`;

it.skipIf(!process.env.FINISHERS)('finishing moves', () => {
  const list = (v: string | undefined, all: number[]) => (v ? v.split(',').map(Number) : all);
  const trace: string[] | undefined = process.env.FIN_TRACE ? [] : undefined;
  const lines: string[] = [];
  const t0 = Date.now();
  let total = 0, uncaught = 0, apart = 0, walls = 0, stuck = 0;
  const count = (who: string, r: ReturnType<typeof playFinish>) => {
    for (const f of r.finishers) {
      total++;
      if (f.caught < 0) uncaught++;
      else if (f.minGap > 1) apart++;
      if (f.wall) walls++;
      lines.push(`${who} ${how(f)}${r.winner !== 0 ? ` (won by player ${r.winner + 1})` : ''}`);
    }
    if (!r.over) stuck++;
    if (!r.finishers.length) lines.push(`${who} no finisher (won by player ${r.winner + 1})`);
    if (!r.over) lines.push(`${who} STUCK: the fight never ended`);
  };
  if (process.env.FIN_CREDITS) {
    for (const c of CREDIT_BATTLES) {
      count(`credits ${NAMES[c.winner.har].padEnd(8)} vs ${NAMES[c.loser.har].padEnd(8)} arena ${c.arena}:`,
        playFinish(c.winner.har, c.loser.har, c.arena, c.seed, { credit: c, trace }));
    }
  } else {
    for (const w of list(process.env.FIN_WINNERS, NAMES.map((_, i) => i))) {
      for (const arena of list(process.env.FIN_ARENAS, [0, 1, 2, 3, 4, 5, 6, 7, 8])) {
        for (const seed of list(process.env.FIN_SEEDS, [1, 2])) {
          const l = (w + 1 + ((seed * 7 + arena * 3) % 14)) % 15;
          count(`${NAMES[w].padEnd(8)} vs ${NAMES[l].padEnd(8)} arena ${arena} seed ${seed}:`, playFinish(w, l, arena, seed, { trace }));
        }
      }
    }
  }
  lines.push(`${total} finishers: ${uncaught} not caught, ${apart} never touching, ${walls} with the winner at a wall, ` +
    `${stuck} fights stuck; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  fs.writeFileSync(process.env.FINISHERS!, lines.join('\n') + '\n' + (trace ?? []).join('\n'));
}, 3_600_000);
