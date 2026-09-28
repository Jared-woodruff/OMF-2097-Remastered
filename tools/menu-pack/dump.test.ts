// Step 1 of `npm run menu:export`: dumps the main menu's original picture (MAIN.BK: the background's palette indices,
// its palette and the two spotlight animations) as JSON for tools/menu-pack/export.py.
import { it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GAMEDATA_DIR } from '../../src/test/harness';
import { parseBK } from '../../src/formats/bk';
import { resolveMissingSprites } from '../../src/formats/animation';
import { decodeSprite } from '../../src/formats/sprite';

const OUT = process.env.OMF_MENUPACK_WORK;

it.runIf(!!OUT)('dumps MAIN.BK for the menu layer pack', () => {
  const bk = parseBK(new Uint8Array(fs.readFileSync(path.join(GAMEDATA_DIR, 'MAIN.BK'))));
  resolveMissingSprites(bk.anims.filter((a) => a !== null).map((a) => a!.animation));
  const anims = [10, 11].map((id) => bk.anims[id]!.animation.sprites.map((s) => ({
    x: s.posX, y: s.posY, w: s.width, h: s.height, data: Array.from(decodeSprite(s.data, s.width, s.height)),
  })));
  fs.mkdirSync(OUT!, { recursive: true });
  fs.writeFileSync(path.join(OUT!, 'mainbk.json'), JSON.stringify({
    w: bk.width, h: bk.height, data: Array.from(bk.background), palette: Array.from(bk.palettes[0].colors), anims,
  }));
});
