// Writes the remaster's generated content: the new robots' fighter files and the new arenas' scene files and
// widescreen backgrounds (GEN_OUT=<dir> npx vitest run src/gen/dev/build; `npm run gen` writes them to public/gen).
// An arena with a painting (src/gen/scene/art/ARENAn.png, 576 x 200: the image AI's, from `npm run newart:import`) is
// made from it instead of its rendering. ROBOT=<name> / ARENA=<names or files, comma-separated> limit it to those;
// SKIP_ARENAS=1 / SKIP_ROBOTS=1 skip a kind. Skipped in normal test runs.
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
import type { RenderedImage } from '../scene/render';
import { readPng } from './png';

const OUT = process.env.GEN_OUT;
const ROBOT = process.env.ROBOT?.toUpperCase();
const ARENA = process.env.ARENA?.toUpperCase();
const ARENAS = ARENA?.split(',').map((s) => s.trim());
const ART = path.resolve(__dirname, '../scene/art');

/** An arena's painting at the native widescreen size, if it has one. */
function paintingOf(file: string): RenderedImage | undefined {
  const p = path.join(ART, file.replace(/\.BK$/, '.png'));
  if (!fs.existsSync(p)) return undefined;
  const { w, h, rgba } = readPng(p);
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
  return { w, h, rgb };
}

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
      if (ARENAS && !ARENAS.includes(a.name) && !ARENAS.includes(a.file.replace(/\.BK$/, ''))) continue;
      const built = buildArena(a, ref, Number(process.env.SS ?? 2), paintingOf(a.file));
      fs.writeFileSync(path.join(OUT!, a.file), saveBK(built.bk));
      fs.writeFileSync(path.join(OUT!, a.file.replace(/\.BK$/, '.WID')), saveWide(built.wide, built.image.w, built.image.h));
    }
  }, 1_800_000);
});
