// Development aid (LINEUP=<out dir> npx vitest run src/gen/dev/lineup): the original robots next to the generated ones,
// in the same poses and pilot colors, to compare their look (LINEUP_MOVES=11:0,10:2,9:0 picks move:sprite pairs).
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'vitest';
import { parseAF } from '../../formats/af';
import { getFile } from '../../resources/files';
import { altPalettes } from '../../resources/resources';
import { extrasFileSync, hasGameData, loadGameData } from '../../test/harness';
import type { IndexedSprite } from '../raster';
import { writeSheet } from './png';

const OUT = process.env.LINEUP;
const MOVES = (process.env.LINEUP_MOVES ?? '11:0').split(',').map((p) => p.split(':').map(Number) as [number, number]);
const HARS = (process.env.LINEUP_HARS ?? '0,1,2,3,4,5,6,7,8,9,10,11,12,13,14').split(',').map(Number);
/** Pilot color choices (primary, secondary, tertiary): Crystal's by default. */
const COLORS = (process.env.LINEUP_COLORS ?? '5,11,8').split(',').map(Number);

describe.skipIf(!OUT || !hasGameData)('robot lineup', () => {
  it('writes the lineup', () => {
    loadGameData();
    const alt = altPalettes()[0].colors;
    // Ramp slot k (0 tertiary, 1 secondary, 2 primary) takes ALTPALS color ramp COLORS[2 - k].
    const colorOf = (i: number): [number, number, number] => {
      if (i === 0 || i >= 48) return [255, 0, 255];
      const src = COLORS[2 - (i >> 4)] * 16 + (i & 15);
      return [alt[src * 3], alt[src * 3 + 1], alt[src * 3 + 2]];
    };
    for (const [move, frame] of MOVES) {
      const sprites: IndexedSprite[] = [];
      for (const id of HARS) {
        const data = id >= 11 ? extrasFileSync(`FIGHTR${id}.AF`)! : getFile(`FIGHTR${id}.AF`);
        const af = parseAF(data);
        const s = af.moves[move]?.animation.sprites.filter((sp) => !sp.isEmpty())[frame];
        if (!s) continue;
        sprites.push({ w: s.width, h: s.height, data: s.pixels(), x: s.posX, y: s.posY });
      }
      writeSheet(path.join(OUT!, `lineup-m${move}-f${frame}.png`), sprites, Number(process.env.LINEUP_ZOOM ?? 3), 6, colorOf);
    }
  });
});
