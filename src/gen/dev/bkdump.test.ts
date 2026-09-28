import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'vitest';
import { parseBK } from '../../formats/bk';
import { getFile } from '../../resources/files';
import { hasGameData, loadGameData } from '../../test/harness';
import { writePng } from './png';

const OUT = process.env.BK_DUMP;
const FILES = (process.env.BK_FILES ?? 'MELEE.BK:1,VS.BK:5,VS.BK:3').split(',');

describe.skipIf(!OUT || !hasGameData)('bk dump', () => {
  it('dumps', () => {
    loadGameData();
    for (const spec of FILES) {
      const [file, anim] = spec.split(':');
      const bk = parseBK(getFile(file));
      const pal = bk.palettes[0];
      const a = bk.anims[Number(anim)]!;
      a.animation.sprites.forEach((s, i) => {
        if (s.isEmpty()) return;
        const px = s.pixels();
        const rgba = new Uint8Array(s.width * s.height * 4);
        const hist = new Map<number, number>();
        for (let k = 0; k < px.length; k++) {
          const v = px[k];
          hist.set(v, (hist.get(v) ?? 0) + 1);
          rgba.set([pal.r(v), pal.g(v), pal.b(v), v ? 255 : 0], k * 4);
        }
        writePng(path.join(OUT!, `${file}-${anim}-${i}.png`), s.width, s.height, rgba);
        const keys = [...hist.keys()].sort((x, y) => x - y);
        fs.appendFileSync(path.join(OUT!, 'bkdump.txt'), `${file} anim ${anim} sprite ${i} pos ${s.posX},${s.posY} size ${s.width}x${s.height} indices ${keys[0]}..${keys[keys.length - 1]} (${keys.length} distinct)\n`);
      });
    }
  });
});
