// Step 1 of `npm run manual`: the game facts the manual prints, straight from the game data (the language file's
// texts, pilot stats, the robots' special moves and their inputs) as JSON for tools/manual/build.mjs.
import { it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadGameData } from '../../src/test/harness';
import { langCount, langGet, loadAf } from '../../src/resources/resources';
import { harMoveList } from '../../src/game/gui/moveList';
import { PILOT_INFO } from '../../src/game/constants';
import { GEN_ROBOTS } from '../../src/gen/roster';

const OUT = process.env.OMF_MANUAL_FACTS;

it.runIf(!!OUT)('dumps the manual facts', () => {
  loadGameData();
  const lang: string[] = [];
  for (let i = 0; i < langCount(); i++) lang.push(langGet(i));
  const generated = GEN_ROBOTS.map((g) => ({ id: g.id, name: g.name, specials: Object.values(g.specialNames ?? {}) }));
  // Every robot's command list, as the pause menu's MOVE LIST shows it (numpad directions, facing right).
  const moves: Record<number, { label: string; kind: string; inputs: string[]; button: string }[]> = {};
  for (let har = 0; har < 15; har++) {
    const af = loadAf(har);
    if (af) moves[har] = harMoveList(af).map((m) => ({ label: m.label, kind: m.kind, inputs: m.inputs, button: m.button }));
  }
  fs.mkdirSync(path.dirname(OUT!), { recursive: true });
  fs.writeFileSync(OUT!, JSON.stringify({ lang, pilots: PILOT_INFO, generated, moves }, null, 1));
});
