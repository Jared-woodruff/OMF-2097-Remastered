// Writes the remaster's generated content: the new robots' fighter files and the new arenas' scene files and
// widescreen backgrounds (GEN_OUT=<dir> npx vitest run src/gen/dev/build; `npm run gen` writes them to public/gen).
// ROBOT=<name> / ARENA=<name> limit it to one of them; SKIP_ARENAS=1 / SKIP_ROBOTS=1 skip a kind. Skipped in normal
// test runs.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'vitest';
import { saveAF } from '../../formats/af';
import { parseBK, saveBK } from '../../formats/bk';
import { getFile } from '../../resources/files';
import { hasGameData, loadGameData } from '../../test/harness';
import { buildFighter } from '../fighter/build';
import { fighterOf, GEN_ROBOTS } from '../roster';
import { GEN_ARENAS } from '../scene/arenas';
import { buildArena, saveWide } from '../scene/build';

const OUT = process.env.GEN_OUT;
const ROBOT = process.env.ROBOT?.toUpperCase();
const ARENA = process.env.ARENA?.toUpperCase();

describe.skipIf(!OUT)('generated content', () => {
  it.skipIf(!!process.env.SKIP_ROBOTS || !!ARENA)('writes the fighter files', () => {
    fs.mkdirSync(OUT!, { recursive: true });
    for (const r of GEN_ROBOTS) {
      if (ROBOT && r.name !== ROBOT) continue;
      const { af } = buildFighter(fighterOf(r));
      af.fighterId = r.id;
      af.upwardsJumpFrameLimit = 2;
      fs.writeFileSync(path.join(OUT!, `FIGHTR${r.id}.AF`), saveAF(af));
    }
  }, 600_000);

  it.skipIf(!!process.env.SKIP_ARENAS || !!ROBOT || !hasGameData)('writes the arena files', () => {
    fs.mkdirSync(OUT!, { recursive: true });
    loadGameData();
    const ref = parseBK(getFile('ARENA0.BK'));
    for (const a of GEN_ARENAS) {
      if (ARENA && a.name !== ARENA) continue;
      const built = buildArena(a, ref, Number(process.env.SS ?? 2));
      fs.writeFileSync(path.join(OUT!, a.file), saveBK(built.bk));
      fs.writeFileSync(path.join(OUT!, a.file.replace(/\.BK$/, '.WID')), saveWide(built.wide, built.image.w, built.image.h));
    }
  }, 1_800_000);
});
