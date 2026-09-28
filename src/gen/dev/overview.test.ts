// Development aid (OVERVIEW=<out dir> npx vitest run src/gen/dev/overview): every move of each generated robot on one
// page (a row per move, its distinct sprites left to right), to check all the poses at a glance after model changes.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'vitest';
import { parseAF } from '../../formats/af';
import { GEN_ROBOTS } from '../roster';
import { rampColors, writePng } from './png';

const OUT = process.env.OVERVIEW;

describe.skipIf(!OUT)('robot overview', () => {
  it('writes a page per robot', () => {
    for (const r of GEN_ROBOTS) {
      if (process.env.ROBOT && r.name !== process.env.ROBOT.toUpperCase()) continue;
      const af = parseAF(new Uint8Array(fs.readFileSync(path.join('public/gen', `FIGHTR${r.id}.AF`))));
      const color = rampColors(r.colors);
      const Z = Number(process.env.ZOOM ?? 2);
      const rows: { id: number; sprites: { w: number; h: number; x: number; y: number; px: Uint8Array }[] }[] = [];
      af.moves.forEach((m, id) => {
        if (!m || id >= 60) return;
        const seen = new Set<unknown>();
        const sprites = m.animation.sprites.filter((s) => !s.isEmpty() && !seen.has(s) && seen.add(s)).map((s) => ({ w: s.width, h: s.height, x: s.posX, y: s.posY, px: s.pixels() }));
        if (sprites.length) rows.push({ id, sprites });
      });
      const rowH = (row: (typeof rows)[number]) => Math.max(...row.sprites.map((s) => s.y + s.h)) - Math.min(...row.sprites.map((s) => s.y)) + 4;
      const W = Math.max(...rows.map((row) => row.sprites.reduce((a, s) => a + s.w + 3, 14))) * Z;
      const H = rows.reduce((a, row) => a + rowH(row), 0) * Math.round(Z * 1.2);
      const rgba = new Uint8Array(W * H * 4);
      for (let i = 0; i < W * H; i++) rgba.set([24, 26, 34, 255], i * 4);
      const zy = Math.round(Z * 1.2);
      let oy = 0;
      for (const row of rows) {
        const top = Math.min(...row.sprites.map((s) => s.y));
        // Move id as a strip of marks at the left (tens: long, units: short).
        for (let k = 0; k < Math.floor(row.id / 10); k++) for (let y = 0; y < 6 * zy; y++) rgba.set([255, 255, 255, 255], ((oy * zy + 2 + y) * W + (2 + k * 3) * Z) * 4);
        for (let k = 0; k < row.id % 10; k++) for (let y = 0; y < 3 * zy; y++) rgba.set([255, 200, 0, 255], ((oy * zy + 10 * zy + y) * W + (2 + k * 2) * Z) * 4);
        let ox = 14;
        for (const s of row.sprites) {
          for (let y = 0; y < s.h; y++) {
            for (let x = 0; x < s.w; x++) {
              const v = s.px[y * s.w + x];
              if (!v) continue;
              const c = color(v);
              for (let dy = 0; dy < zy; dy++) for (let dx = 0; dx < Z; dx++) rgba.set([c[0], c[1], c[2], 255], (((oy + s.y - top + 2) * zy + y * zy + dy) * W + (ox + x) * Z + dx) * 4);
            }
          }
          ox += s.w + 3;
        }
        oy += rowH(row);
        for (let x = 0; x < W; x++) rgba.set([50, 54, 70, 255], ((oy * zy - 1) * W + x) * 4);
      }
      writePng(path.join(OUT!, `overview-${r.name.toLowerCase()}.png`), W, H, rgba);
    }
  });
});
