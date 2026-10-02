// Development aid (GEN_SHEETS=<dir with FIGHTR1x.AF> npx vitest run src/gen/dev/gensheet): contact sheets of every
// move of the generated fighter files, one PNG per robot.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'vitest';
import { parseAF } from '../../formats/af';
import { GEN_ROBOTS } from '../roster';
import type { IndexedSprite } from '../raster';
import { rampColors, writeSheet } from './png';

const DIR = process.env.GEN_SHEETS;

describe.skipIf(!DIR)('generated sheets', () => {
  it('writes sheets', () => {
    for (const r of GEN_ROBOTS) {
      const file = path.join(DIR!, `FIGHTR${r.id}.AF`);
      if (!fs.existsSync(file)) continue;
      const af = parseAF(new Uint8Array(fs.readFileSync(file)));
      af.moves.forEach((m, id) => {
        if (!m) return;
        const sprites: IndexedSprite[] = m.animation.sprites.filter((s) => !s.isEmpty()).map((s) => {
          const px = s.pixels().slice();
          // Mark hit points in white.
          for (const c of m.animation.coords) {
            const idx = m.animation.sprites.indexOf(s);
            if (c.frameId !== idx) continue;
            const x = c.x - s.posX, y = c.y - s.posY;
            if (x >= 0 && y >= 0 && x < s.width && y < s.height) px[y * s.width + x] = 255;
          }
          return { w: s.width, h: s.height, data: px, x: s.posX, y: s.posY };
        });
        const colors = rampColors(r.colors);
        const colorOf = (i: number): [number, number, number] => (i === 255 ? [255, 255, 255] : colors(i));
        if (sprites.length) writeSheet(path.join(DIR!, `${r.name.toLowerCase()}-m${String(id).padStart(2, '0')}.png`), sprites, 3, 6, colorOf);
      });
    }
  });
});
