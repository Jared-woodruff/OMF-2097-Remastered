// The original tournaments' texts in the other languages (public/lang/trn/<code>.json, trnText in i18n.ts): every text
// the game asks trnText() for has its translation in every language's file, and no file keeps a text the tournaments
// do not have. The game asks for each tournament's title, description and ending pages (localizedLocale in
// formats/tournament.ts) and for its pilots' words before a fight (scenes/vs.ts), by their English as the .TRN files
// have it. German has the files' own German, and its file only the texts they leave English (WORLD.TRN's German
// repeats the English, its pilots have no German words).
// The titles are proper names: a language translates the four where its texts translate the tournaments' names
// (北米オープン), or keeps them all English, as the game itself does in German.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { localizedLocale } from '../formats/tournament';
import { loadLanguageData, setLanguageFetcher, trnText, useLanguage } from '../i18n/i18n';
import { LANGUAGES } from '../i18n/languages';
import { listFiles } from '../resources/files';
import { loadTournament } from '../resources/resources';
import { hasGameData, loadGameData } from './harness';

const TRN_DIR = path.resolve(__dirname, '../../public/lang/trn');
/** The languages that translate every tournament text: all but English and German. */
const CODES = LANGUAGES.map((l) => l.code).filter((c) => c !== 'en' && c !== 'de');
const catalogue = (code: string) => JSON.parse(fs.readFileSync(path.join(TRN_DIR, `${code}.json`), 'utf8')) as Record<string, string>;

interface TournamentTexts {
  /** The descriptions, ending pages and pilots' words (by their English), with where each one is. */
  needed: Map<string, string>;
  titles: Map<string, string>;
  /** Those of the needed texts the .TRN files leave English in German: no German, or the English again. */
  germanGaps: Map<string, string>;
}

/** Every text of the original tournaments that the game asks trnText() for. */
function tournamentTexts(): TournamentTexts {
  loadGameData();
  const texts: TournamentTexts = { needed: new Map(), titles: new Map(), germanGaps: new Map() };
  const add = (s: string, german: string | undefined, where: string) => {
    if (!s) return;
    if (!texts.needed.has(s)) texts.needed.set(s, where);
    if ((!german || german === s) && !texts.germanGaps.has(s)) texts.germanGaps.set(s, where);
  };
  for (const file of listFiles('.TRN')) {
    const trn = loadTournament(file);
    const [en, de] = trn.locales;
    if (en.title) texts.titles.set(en.title, `${file} title`);
    add(en.description, de?.description, `${file} description`);
    en.endTexts.forEach((pages, har) => pages.forEach((p, i) => add(p, de?.endTexts[har]?.[i], `${file} ending ${har}/${i}`)));
    trn.enemies.forEach((pilot, i) => add(pilot.quotes[0], pilot.quotes[1], `${file} pilot ${i} (${pilot.name})`));
  }
  return texts;
}

const missingFrom = (t: Record<string, string>, texts: Map<string, string>) =>
  [...texts].filter(([en]) => typeof t[en] !== 'string' || !t[en].trim()).map(([en, where]) => `${where}: ${en.slice(0, 50)}`);

describe.skipIf(!hasGameData)('the tournaments\' texts in every language', () => {
  afterEach(() => useLanguage('en', { ui: {}, original: null }));

  it('are those of the four tournaments of the game', () => {
    const { needed, titles, germanGaps } = tournamentTexts();
    expect(listFiles('.TRN')).toEqual(['KATUSHAI.TRN', 'NORTH_AM.TRN', 'WAR.TRN', 'WORLD.TRN']);
    // (4 descriptions, 19 different ending pages, the words of 77 pilots)
    expect(needed.size).toBe(100);
    expect([...titles.keys()]).toEqual(['Katushai Challenge', 'North American Open', 'WAR Invitational', 'World Championship']);
    // (in German: WORLD.TRN's description, 6 ending pages and 35 pilots' words, ICEMAN's words in NORTH_AM.TRN)
    expect(germanGaps.size).toBe(43);
  });

  it.each(CODES)('%s: has every description, ending page and pilot\'s words', (code) => {
    expect(missingFrom(catalogue(code), tournamentTexts().needed)).toEqual([]);
  });

  it.each(CODES)('%s: translates the four titles or none', (code) => {
    const { titles } = tournamentTexts();
    const t = catalogue(code);
    const translated = [...titles.keys()].filter((en) => typeof t[en] === 'string' && t[en].trim());
    expect([0, titles.size]).toContain(translated.length);
  });

  it.each(CODES)('%s: has no text the tournaments do not have', (code) => {
    const { needed, titles } = tournamentTexts();
    const stale = Object.keys(catalogue(code)).filter((en) => !needed.has(en) && !titles.has(en));
    expect(stale).toEqual([]);
  });

  it('de: has every text the .TRN files leave English', () => {
    expect(missingFrom(catalogue('de'), tournamentTexts().germanGaps)).toEqual([]);
  });

  it('de: has no other text (the files\' own German shows instead, the titles stay English)', () => {
    const { germanGaps } = tournamentTexts();
    expect(Object.keys(catalogue('de')).filter((en) => !germanGaps.has(en))).toEqual([]);
  });

  it('de: is loaded with the language, as the other languages\' files are', async () => {
    setLanguageFetcher(async (p) => JSON.parse(fs.readFileSync(path.join(TRN_DIR, '..', p.replace(/^lang\//, '')), 'utf8')));
    expect((await loadLanguageData('de')).trn).toEqual(catalogue('de'));
  });

  it.each([...CODES, 'de'])('%s: keeps the line breaks of the English (texts laid out in fixed boxes)', (code) => {
    const lines = (s: string) => s.split('\n').length;
    for (const [en, t] of Object.entries(catalogue(code))) expect(lines(t), en.slice(0, 50)).toBe(lines(en));
  });

  it.each(CODES)('%s: is what the game shows', (code) => {
    const t = catalogue(code);
    useLanguage(code, { ui: {}, original: null, trn: t });
    for (const file of listFiles('.TRN')) {
      const trn = loadTournament(file);
      const en = trn.locales[0];
      const loc = localizedLocale(trn)!;
      expect(loc.title).toBe(t[en.title] ?? en.title);
      // TOURNAMENT PLAY: the description, without its markup
      expect(loc.description).toBe(t[en.description]);
      expect(t[en.description]).toContain(loc.strippedDescription);
      expect(loc.strippedDescription).not.toMatch(/^\s*$|\{/);
      // the ending pages (chr.ts) and the pilots' words before a fight (vs.ts)
      loc.endTexts.forEach((pages, har) => pages.forEach((p, i) => {
        const page = en.endTexts[har][i];
        expect(p).toBe(page ? t[page] : page);
      }));
      for (const pilot of trn.enemies) expect(trnText(pilot.quotes[0], pilot.quotes[1])).toBe(t[pilot.quotes[0]]);
    }
  });

  it('de: shows the files\' own German, this file\'s where they leave the English, and no English but the titles', () => {
    const { needed } = tournamentTexts();
    const t = catalogue('de');
    useLanguage('de', { ui: {}, original: null, trn: t });
    for (const file of listFiles('.TRN')) {
      const trn = loadTournament(file);
      const [en, de] = trn.locales;
      // (KATUSHAI, NORTH_AM, WAR: their own German texts, WORLD: none)
      const own = file !== 'WORLD.TRN';
      const loc = localizedLocale(trn)!;
      expect(loc.title).toBe(en.title);
      expect(loc.description).toBe(own ? de.description : t[en.description]);
      expect(loc.strippedDescription).not.toMatch(/^\s*$|\{/);
      loc.endTexts.forEach((pages, har) => pages.forEach((p, i) => {
        const page = en.endTexts[har][i];
        expect(p).toBe(page ? (own ? de.endTexts[har][i] : t[page]) : page);
      }));
      const words = trn.enemies.map((pilot) => {
        const [english, german] = pilot.quotes;
        const shown = trnText(english, german);
        // (ICEMAN's German in NORTH_AM.TRN is the English again)
        expect(shown).toBe(own && german !== english ? german : t[english]);
        return shown;
      });
      const english = [loc.description, ...loc.endTexts.flat(), ...words].filter((s) => needed.has(s));
      expect(english, file).toEqual([]);
    }
  });
});
