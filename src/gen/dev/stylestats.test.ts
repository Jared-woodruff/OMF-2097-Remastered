// Development aid (STYLE_STATS=1 npx vitest run src/gen/dev/stylestats): how each robot's sprites use the three color
// ramps and their shades, and its build (height, widths at chest / waist / legs), original robots vs generated ones.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'vitest';
import { parseAF } from '../../formats/af';
import { getFile } from '../../resources/files';
import { hasGameData, loadGameData } from '../../test/harness';

const NAMES = ['JAGUAR', 'SHADOW', 'THORN', 'PYROS', 'ELECTRA', 'KATANA', 'SHREDDER', 'FLAIL', 'GARGOYLE', 'CHRONOS', 'NOVA', 'GLACIER', 'TEMPEST', 'HELIX', 'SPECTRE'];

describe.skipIf(!process.env.STYLE_STATS || !hasGameData)('style stats', () => {
  it('prints', () => {
    loadGameData();
    const rows: string[] = [];
    for (let id = 0; id < 15; id++) {
      const data = id >= 11 ? new Uint8Array(fs.readFileSync(path.join('public/gen', `FIGHTR${id}.AF`))) : getFile(`FIGHTR${id}.AF`);
      const af = parseAF(data);
      const ramp = [0, 0, 0];
      const shade = new Array(16).fill(0);
      let edgeSum = 0, edgeN = 0, gradSum = 0, gradN = 0;
      // All sprites of the idle, walk and damage animations.
      for (const mv of [11, 10, 9]) {
        for (const s of af.moves[mv]?.animation.sprites ?? []) {
          if (s.isEmpty()) continue;
          const px = s.pixels();
          const at = (x: number, y: number) => (x < 0 || y < 0 || x >= s.width || y >= s.height ? 0 : px[y * s.width + x]);
          for (let y = 0; y < s.height; y++) {
            for (let x = 0; x < s.width; x++) {
              const v = at(x, y);
              if (!v || v >= 48) continue;
              ramp[v >> 4]++;
              shade[v & 15]++;
              const edge = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1);
              if (edge) {
                edgeSum += v & 15;
                edgeN++;
              }
              const r = at(x + 1, y);
              if (r && r < 48 && r >> 4 === v >> 4) {
                gradSum += Math.abs((r & 15) - (v & 15));
                gradN++;
              }
            }
          }
        }
      }
      const n = ramp[0] + ramp[1] + ramp[2];
      const pct = (k: number) => ((100 * k) / n).toFixed(0).padStart(3);
      const mean = shade.reduce((a, c, i) => a + c * i, 0) / n;
      const hist = shade.map((c) => Math.round((100 * c) / n)).join(' ');
      // Build of the first idle frame: height and widths at 3/4 (chest), 55% (waist) and 25% (legs) of the height.
      const s0 = af.moves[11]!.animation.sprites.find((s) => !s.isEmpty())!;
      const p0 = s0.pixels();
      const rowWidth = (y: number) => {
        let a = -1, b = -1;
        for (let x = 0; x < s0.width; x++) if (p0[y * s0.width + x]) { if (a < 0) a = x; b = x; }
        return a < 0 ? 0 : b - a + 1;
      };
      let top = 0, bottom = s0.height - 1;
      while (top < s0.height && rowWidth(top) === 0) top++;
      while (bottom > 0 && rowWidth(bottom) === 0) bottom--;
      const h = bottom - top + 1;
      const w = (f: number) => rowWidth(Math.round(bottom - f * h));
      // Filled fraction of the bounding box (slim builds leave more air).
      let filled = 0;
      for (const v of p0) if (v) filled++;
      rows.push(`${NAMES[id].padEnd(9)} ramps(t/s/p)%${pct(ramp[0])}${pct(ramp[1])}${pct(ramp[2])}  mean ${mean.toFixed(1)}  edge ${(edgeSum / edgeN).toFixed(1)}  grad ${(gradSum / gradN).toFixed(2)}  h ${h} w75 ${w(0.75)} w55 ${w(0.55)} w25 ${w(0.25)} fill ${(filled / (s0.width * h)).toFixed(2)} | ${hist}`);
    }
    console.log(rows.join('\n'));
  });
});
