// Custom tournaments: made from an installed tournament, with fewer opponents (the champion always among them), the
// new robots and more prize money; listed with the other tournaments once registered.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ACT_PUNCH, CtrlType, SceneId } from '../game/constants';
import { EXTRA_HAR_IDS } from '../game/roster';
import {
  buildCustomTournament, customTournaments, defaultTitle, fileNameOf, readTournamentSpec, registerCustomTournaments, resetCustomTournaments,
  setCustomTournament,
} from '../game/tournament/custom';
import { localizedLocale } from '../formats/tournament';
import { tr, useLanguage, type LanguageData } from '../i18n/i18n';
import type { LangCode } from '../i18n/languages';
import { loadTournament } from '../resources/resources';
import { trnlistInit, trnLoad } from '../resources/trnmanager';
import { createGame, hasGameData, loadExtras } from './harness';
import { CustomTournamentsPage } from '../game/tournament/customPage';
import { Page } from '../game/gui/page';
import { FontSize, HAlign } from '../game/gui/text';

beforeEach(() => resetCustomTournaments());
afterEach(() => useLanguage('en', { ui: {}, original: null }));

/** A language's remaster and tournament texts (public/lang). */
function files(code: LangCode): LanguageData {
  const json = (p: string) => {
    const file = path.resolve(__dirname, '../../public/lang', p);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
  };
  return { ui: json(`ui/${code}.json`) ?? {}, original: null, trn: json(`trn/${code}.json`) };
}

describe('custom tournament files', () => {
  it('reads descriptions carefully', () => {
    expect(readTournamentSpec(42)).toBeNull();
    const s = readTournamentSpec({ name: 'grand prix!', base: 'war.trn', size: 7, robots: 2, prize: 3 })!;
    expect(s).toMatchObject({ name: 'GRAND PRIX', base: 'WAR.TRN', size: 0, robots: 2, prize: 3 });
    expect(readTournamentSpec({ base: '../x.trn' })!.base).not.toContain('..');
  });

  it('names a new tournament in the game\'s language when a name can hold its letters, else in English', () => {
    useLanguage('de', files('de'));
    expect(defaultTitle(0)).toBe('EIGENES TURNIER 1');
    useLanguage('ru', files('ru'));
    expect(defaultTitle(2)).toBe('CUSTOM TOURNAMENT 3');
    // (a letter the name cannot hold would be lost: Ó)
    useLanguage('pt', { ui: { 'CUSTOM TOURNAMENT {n}': 'TORNEIO PRÓPRIO {n}' }, original: null });
    expect(defaultTitle(0)).toBe('CUSTOM TOURNAMENT 1');
  });
});

describe.skipIf(!hasGameData)('custom tournaments', () => {
  it('keeps the champion and spreads the opponents over the ranks', async () => {
    // (the new robots: their mod is on)
    await loadExtras();
    createGame(SceneId.MENU);
    const base = loadTournament('WORLD.TRN');
    const ranked = base.enemies.filter((p) => !p.secret);
    const t = buildCustomTournament({ v: 1, name: 'TEST CUP', base: 'WORLD.TRN', size: 0, robots: 2, prize: 3 }, 0, base);
    const mine = t.enemies.filter((p) => !p.secret);
    expect(mine.length).toBe(Math.min(6, ranked.length));
    expect(mine[0].name).toBe(ranked[0].name);
    expect(mine[mine.length - 1].name).toBe(ranked[ranked.length - 1].name);
    expect(t.enemies.filter((p) => p.secret).length).toBe(base.enemies.filter((p) => p.secret).length);
    for (const p of mine) expect(EXTRA_HAR_IDS).toContain(p.harId);
    expect(t.winningsMultiplier).toBeCloseTo(base.winningsMultiplier * 2);
    expect(t.locales[0].title).toBe('TEST CUP');
    // The base tournament is untouched.
    expect(base.enemies.filter((p) => !p.secret).map((p) => p.harId)).toEqual(ranked.map((p) => p.harId));
  });

  it('registers a stored tournament: listed and loadable like the others', () => {
    createGame(SceneId.MENU);
    expect(setCustomTournament(2, { v: 1, name: 'LOCAL LEAGUE', base: 'NORTH_AM.TRN', size: 1, robots: 1, prize: 1 })).toBe(true);
    expect(customTournaments()[2]?.name).toBe('LOCAL LEAGUE');
    const list = trnlistInit().map((t) => t.filename);
    expect(list).toContain(fileNameOf(2));
    expect(trnLoad(fileNameOf(2))?.locales[0].title).toBe('LOCAL LEAGUE');
    setCustomTournament(2, null);
    expect(trnlistInit().map((t) => t.filename)).not.toContain(fileNameOf(2));
  });

  it('shows its description where it puts it, under the logo, in every language', () => {
    createGame(SceneId.MENU);
    const base = loadTournament('NORTH_AM.TRN');
    const en = base.locales[0];
    for (const code of ['en', 'de', 'fr', 'ar'] as const) {
      useLanguage(code, files(code));
      const t = buildCustomTournament({ v: 1, name: 'TEST CUP', base: 'NORTH_AM.TRN', size: 0, robots: 0, prize: 1 }, 0, base);
      // (as the tournament chooser shows it: trnSelect.ts)
      const loc = localizedLocale(t)!;
      expect([loc.descWidth, loc.descCenter, loc.descVmove, loc.descColor], code).toEqual([300, 160, en.descVmove, en.descColor]);
      expect(loc.strippedDescription, code).toBe(t.locales[0].description);
      // The installed tournament is laid out by its own markup in each language (German: the file's German text).
      const own = localizedLocale(base)!;
      const want = code === 'de' ? base.locales[1] : en;
      expect([own.descWidth, own.descCenter, own.descVmove], code).toEqual([want.descWidth, want.descCenter, want.descVmove]);
      expect(own.strippedDescription, code).not.toMatch(/\{/);
    }
  });

  it('writes the descriptions in the language of the moment (built again when it changes)', () => {
    createGame(SceneId.MENU);
    registerCustomTournaments();
    setCustomTournament(1, { v: 1, name: 'LOCAL LEAGUE', base: 'NORTH_AM.TRN', size: 1, robots: 0, prize: 3 });
    const description = () => trnLoad(fileNameOf(1))!.locales[0].description;
    const english = description();
    expect(english).toContain('PRIZE MONEY: DOUBLE.');
    expect(english).toContain(loadTournament('NORTH_AM.TRN').locales[0].title.toUpperCase());
    useLanguage('de', files('de'));
    expect(description()).toContain(tr('PRIZE MONEY: {prize}.', { prize: tr('DOUBLE') }));
    // (the tournament it is made from named as it is in German: the file's German title)
    expect(description()).toContain(loadTournament('NORTH_AM.TRN').locales[1].title.toUpperCase());
    useLanguage('en', { ui: {}, original: null });
    expect(description()).toBe(english);
    setCustomTournament(1, null);
  });

  it('takes a name from what the player\'s keyboard types', () => {
    createGame(SceneId.MENU);
    const page = new CustomTournamentsPage();
    // (a new one in the first slot, named CUSTOM TOURNAMENT 1)
    page.action(ACT_PUNCH, CtrlType.KEYBOARD);
    expect(customTournaments()[0]?.name).toBe('CUSTOM TOURNAMENT 1');
    for (let i = 0; i < 24; i++) page.key('Backspace');
    const type = (code: string, key: string) => page.key(code, { key } as KeyboardEvent);
    // A French keyboard's A, M and Q; a German one's - (a space); a Russian one's а on the US F.
    type('KeyQ', 'a');
    type('Semicolon', 'm');
    type('KeyA', 'q');
    type('Slash', '-');
    type('KeyF', 'а');
    expect(customTournaments()[0]?.name).toBe('AMQ F');
    setCustomTournament(0, null);
  });
});

describe.skipIf(!hasGameData)('MY TOURNAMENTS (the page)', () => {
  it('keeps every text inside its frame, with six saved tournaments of the longest names and every message', () => {
    createGame(SceneId.MENU);
    for (let i = 0; i < 6; i++) setCustomTournament(i, { v: 1, name: 'W'.repeat(24), base: 'WORLD.TRN', size: 1, robots: 0, prize: 2 });
    const page = new CustomTournamentsPage();
    const texts: { str: string; left: number; right: number }[] = [];
    const proto = Page.prototype as unknown as { drawText: (...a: unknown[]) => void };
    const draw = proto.drawText;
    proto.drawText = function (this: unknown, key: unknown, str: unknown, x: unknown, y: unknown, font: unknown, color: unknown, align: unknown) {
      const w = (this as { t: (k: unknown, s: unknown, f: unknown, c: unknown) => { width(): number } }).t(key, str, font ?? FontSize.SMALL, color).width();
      const at = x as number;
      const left = align === HAlign.CENTER ? at - w / 2 : align === HAlign.RIGHT ? at - w : at;
      texts.push({ str: String(str), left, right: left + w });
      return draw.call(this, key, str, x, y, font, color, align);
    };
    try {
      const p = page as unknown as { status: string; slot: number; row: number; spec: unknown; render(): void };
      const messages = ['', 'NOTHING COULD BE LOADED (OR NO FREE SLOT)', 'PRESS DELETE AGAIN TO DELETE THIS TOURNAMENT', 'THE NEW ROBOTS ARE NOT INSTALLED'];
      for (const status of messages) {
        p.status = status;
        p.slot = -1;
        p.render();
        p.slot = 0;
        p.spec = customTournaments()[0];
        for (let row = 0; row < 6; row++) {
          p.row = row;
          p.render();
        }
      }
    } finally {
      proto.drawText = draw;
    }
    expect(texts.length).toBeGreaterThan(50);
    // (the frame: native x 8..312, its border one pixel wide)
    const out = texts.filter((t) => t.left < 10 || t.right > 310).map((t) => `${t.str} (${t.left.toFixed(0)}..${t.right.toFixed(0)})`);
    expect(out).toEqual([]);
  });
});
