// Development aid (REF_DUMP=<dir> npx vitest run src/gen/dev/refdump): PNG sheets of an original robot's animations,
// as references for the generated robots' poses, plus how the original sprites use the three color ramps.
import path from 'node:path';
import { describe, it } from 'vitest';
import { parseAF } from '../../formats/af';
import { getFile } from '../../resources/files';
import { hasGameData, loadGameData } from '../../test/harness';
import type { IndexedSprite } from '../raster';
import { writeSheet } from './png';

const OUT = process.env.REF_DUMP;
const HAR = Number(process.env.REF_HAR ?? 0);

describe.skipIf(!OUT || !hasGameData)('reference dumps', () => {
  it('writes sheets', () => {
    loadGameData();
    const af = parseAF(getFile(`FIGHTR${HAR}.AF`));
    const ramps = [0, 0, 0, 0];
    af.moves.forEach((m, id) => {
      if (!m) return;
      const sprites: IndexedSprite[] = [];
      for (const s of m.animation.sprites) {
        if (s.isEmpty() || s.width > 1000) continue;
        const px = s.pixels();
        sprites.push({ w: s.width, h: s.height, data: px, x: s.posX, y: s.posY });
        if (id === 11 || id === 9) for (const v of px) if (v) ramps[v < 48 ? v >> 4 : 3]++;
      }
      if (sprites.length) writeSheet(path.join(OUT!, `har${HAR}-move${String(id).padStart(2, '0')}.png`), sprites, 3);
    });
    console.log('ramp pixel counts (idle + damage): r0', ramps[0], 'r1', ramps[1], 'r2', ramps[2], 'other', ramps[3]);
  });
});
