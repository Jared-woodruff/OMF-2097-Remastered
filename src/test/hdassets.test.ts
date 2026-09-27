// The imported HD artwork (public/hd, optional) must be found for the surfaces the game actually creates.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { hasGameData, loadGameData } from './harness';
import { loadAf, loadBk, loadPic } from '../resources/resources';
import { pixelHash } from '../video/hd/pixelHash';
import { Surface } from '../video/surface';

const INDEX = path.resolve(__dirname, '../../public/hd/index.json');
const installed = hasGameData && fs.existsSync(INDEX);

describe.skipIf(!installed)('HD artwork', () => {
  it('maps the game\'s sprites, backgrounds and portraits to their artwork', () => {
    loadGameData();
    const index = JSON.parse(fs.readFileSync(INDEX, 'utf8')) as { entries: { hash: string; kind: string; bundle: string }[] };
    const hashes = new Set(index.entries.map((e) => e.hash));
    const missing: string[] = [];
    let found = 0;
    const check = (s: Surface | null, what: string) => {
      if (!s || (s.w === 1 && s.h === 1)) return;
      if (hashes.has(pixelHash(s.w, s.h, s.data.subarray(0, s.w * s.h)))) found++;
      else missing.push(what);
    };
    for (let h = 0; h <= 10; h++) {
      const af = loadAf(h);
      for (const m of af.moves) m?.ani.sprites.forEach((sp, i) => check(sp.surface, `FIGHTR${h}.AF/${m.id}/${i}`));
    }
    const bkFiles = fs.readdirSync(path.resolve(__dirname, '../../public/gamedata')).filter((f) => f.endsWith('.BK'));
    for (const f of bkFiles) {
      const bk = loadBk(f);
      const flat = bk.background.data.every((v) => v === bk.background.data[0]);
      if (!flat) check(bk.background, `${f}/bg`);
      for (const [id, info] of bk.infos) info.ani.sprites.forEach((sp, i) => check(sp.surface, `${f}/${id}/${i}`));
    }
    for (const f of ['PLAYERS.PIC', 'NORTH_AM.PIC', 'KATUSHAI.PIC', 'WAR.PIC', 'WORLD.PIC']) {
      loadPic(f).forEach((p, i) => check(p.sprite.isEmpty() ? null : Surface.fromSprite(p.sprite), `${f}/${i}`));
    }
    // Scene animations that are color effects (glow masks, index-add overlays) have no artwork by design.
    const unexpected = missing.filter((m) => !/^(ARENA4\.BK\/(13|15|20|21)|INTRO\.BK\/(16|17)|VS\.BK\/(6|9)|CREDITS\.BK\/2[0-7])\//.test(m));
    expect(unexpected).toEqual([]);
    expect(found).toBeGreaterThan(3000);
  });
});
