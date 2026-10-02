// Development aid (BG_DUMP=<dir> npx vitest run src/gen/dev/bgdump): the original arenas' backgrounds as PNG.
import path from 'node:path';
import { describe, it } from 'vitest';
import { parseBK } from '../../formats/bk';
import { getFile } from '../../resources/files';
import { hasGameData, loadGameData } from '../../test/harness';
import { writePng } from './png';

describe.skipIf(!process.env.BG_DUMP || !hasGameData)('background dump', () => {
  it('dumps', () => {
    loadGameData();
    for (let a = 0; a < 5; a++) {
      const bk = parseBK(getFile(`ARENA${a}.BK`));
      const pal = bk.palettes[0];
      const rgba = new Uint8Array(bk.width * bk.height * 4);
      for (let i = 0; i < bk.width * bk.height; i++) {
        const v = bk.background[i];
        rgba.set([pal.r(v), pal.g(v), pal.b(v), 255], i * 4);
      }
      writePng(path.join(process.env.BG_DUMP!, `arena${a}.png`), bk.width, bk.height, rgba);
    }
  });
});
