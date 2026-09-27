import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseAF } from './af';
import { parseBK } from './bk';
import { parseAltPals, parseFont, parseLanguage, parsePic, parseSounds } from './misc';
import { parseTournament } from './tournament';

const dir = path.resolve(__dirname, '../../public/gamedata');
const has = fs.existsSync(path.join(dir, 'FIGHTR0.AF'));
const load = (f: string) => new Uint8Array(fs.readFileSync(path.join(dir, f)));

describe.skipIf(!has)('original data files', () => {
  it('parses all AF files', () => {
    for (let i = 0; i <= 10; i++) {
      const af = parseAF(load(`FIGHTR${i}.AF`));
      const moves = af.moves.filter((m) => m !== null);
      expect(moves.length).toBeGreaterThan(20);
      expect(af.health).toBeGreaterThan(0);
      for (const m of moves) {
        for (const s of m!.animation.sprites) {
          expect(s.pixels().length).toBe(s.isEmpty() ? 1 : s.width * s.height);
        }
      }
    }
  });

  it('parses all BK files', () => {
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.BK'))) {
      const bk = parseBK(load(f));
      expect(bk.width).toBe(320);
      expect(bk.height).toBe(200);
      expect(bk.palettes.length).toBeGreaterThan(0);
      for (const a of bk.anims) {
        if (!a) continue;
        for (const s of a.animation.sprites) s.pixels();
      }
    }
  });

  it('parses sounds, language, fonts, altpals, pics, tournaments', () => {
    const sounds = parseSounds(load('SOUNDS.DAT'));
    expect(sounds.length).toBeGreaterThan(50);
    const lang = parseLanguage(load('ENGLISH.DAT'));
    expect(lang.length).toBeGreaterThan(900);
    expect(lang.some((l) => /one must fall/i.test(l.text))).toBe(true);
    parseFont(load('CHARSMAL.DAT'), 6);
    parseFont(load('GRAPHCHR.DAT'), 8);
    expect(parseAltPals(load('ALTPALS.DAT')).length).toBe(11);
    for (const f of ['PLAYERS.PIC', 'NORTH_AM.PIC', 'KATUSHAI.PIC', 'WAR.PIC', 'WORLD.PIC']) {
      expect(parsePic(load(f)).length).toBeGreaterThan(0);
    }
    for (const f of ['NORTH_AM.TRN', 'KATUSHAI.TRN', 'WAR.TRN', 'WORLD.TRN']) {
      const trn = parseTournament(load(f), f);
      expect(trn.enemies.length).toBe(trn.enemyCount);
      expect(trn.locales[0].title.length).toBeGreaterThan(0);
    }
  });
});
