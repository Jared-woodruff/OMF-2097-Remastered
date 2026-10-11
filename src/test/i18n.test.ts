// Languages (src/i18n, game/gui/glyphs.ts): which language the game speaks by default and when chosen, the remaster's
// texts in it, the original game's texts in every language, and the text engine that draws them all: the original
// fonts' letters and the ones made in their style, words and characters of the other scripts, wrapping Chinese and
// laying Arabic out from the right.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACT_DOWN, ACT_PUNCH, CtrlType } from '../game/constants';
import { LanguagePage } from '../game/gui/languagePage';
import { keyName, loadKeyboardLayout } from '../game/scenes/mainmenu/keyNames';
import { lang, loadLanguageData, setLanguageFetcher, setOriginalTextsLoader, tr, trn, useLanguage } from '../i18n/i18n';
import { LANGUAGES, pickLanguage, type LangCode } from '../i18n/languages';
import { cp437ToUnicode, unicodeToCp437 } from '../i18n/cp437';
import { defaultSettings, loadSettings, settings } from '../game/settings';
import { fontGlyph, isRtlText, shapeText, UnitKind } from '../game/gui/glyphs';
import { FontSize, getFont, HAlign, Text } from '../game/gui/text';
import { langGet, loadOriginalTexts } from '../resources/resources';
import { hasGameData, installBrowserShims, loadGameData } from './harness';

const LANG_DIR = path.resolve(__dirname, '../../public/lang');
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(LANG_DIR, p), 'utf8')) as unknown;

describe('the language by default', () => {
  it('is the first of the system languages the game has, any variety of it', () => {
    expect(pickLanguage(['pt-BR', 'en-US'])).toBe('pt');
    expect(pickLanguage(['nl-NL', 'de-AT', 'en'])).toBe('de');
    expect(pickLanguage(['zh-Hans-CN'])).toBe('zh');
    expect(pickLanguage(['zh_TW'])).toBe('zh');
    expect(pickLanguage(['ja'])).toBe('ja');
    expect(pickLanguage(['ar-EG'])).toBe('ar');
    expect(pickLanguage(['nl', 'fi'])).toBe('en');
    expect(pickLanguage([])).toBe('en');
  });

  it('has the fourteen languages, each with its own name', () => {
    expect(LANGUAGES.map((l) => l.code).sort()).toEqual(['ar', 'bn', 'da', 'de', 'en', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'sv', 'zh']);
    expect(LANGUAGES.find((l) => l.code === 'ar')!.rtl).toBe(true);
  });
});

describe('the language setting', () => {
  afterEach(() => localStorage.removeItem('omf2097r.settings'));

  it('is automatic for new players', () => {
    installBrowserShims();
    expect(defaultSettings().language).toBe('auto');
  });

  it('keeps a German choice and lets the old English default follow the system', () => {
    installBrowserShims();
    localStorage.setItem('omf2097r.settings', JSON.stringify({ language: 'GERMAN.DAT', revision: 5 }));
    expect(loadSettings().language).toBe('de');
    localStorage.setItem('omf2097r.settings', JSON.stringify({ language: 'ENGLISH.DAT', revision: 5 }));
    expect(loadSettings().language).toBe('auto');
    localStorage.setItem('omf2097r.settings', JSON.stringify({ language: 'ja', revision: 6 }));
    expect(loadSettings().language).toBe('ja');
    localStorage.setItem('omf2097r.settings', JSON.stringify({ language: 'xx', revision: 6 }));
    expect(loadSettings().language).toBe('auto');
  });

  it('is what the LANGUAGE page chooses: spoken at once and kept', async () => {
    installBrowserShims();
    setLanguageFetcher(async (p) => read(p.replace(/^lang\//, '')));
    Object.assign(settings(), defaultSettings());
    const page = new LanguagePage();
    page.action(ACT_DOWN, CtrlType.KEYBOARD); // AUTOMATIC -> the first language (Dansk)
    page.action(ACT_PUNCH, CtrlType.KEYBOARD);
    expect(settings().language).toBe('da');
    await vi.waitFor(() => expect(lang()).toBe('da'));
    expect(loadSettings().language).toBe('da');
    expect(tr('LANGUAGE')).not.toBe('LANGUAGE');
    useLanguage('en', { ui: {}, original: null });
  });
});

describe('the remaster texts', () => {
  afterEach(() => useLanguage('en', { ui: {}, original: null }));

  it('are English without a translation, with their placeholders filled in', () => {
    expect(tr('{name} WINS', { name: 'CRYSTAL' })).toBe('CRYSTAL WINS');
    expect(trn(1, '{n} WIN', '{n} WINS')).toBe('1 WIN');
    expect(trn(3, '{n} WIN', '{n} WINS')).toBe('3 WINS');
  });

  it('use the translation, by the language plural rules', () => {
    useLanguage('ru', { ui: { '{name} WINS': '{name} ПОБЕЖДАЕТ', '{n} WINS': { one: '{n} ПОБЕДА', few: '{n} ПОБЕДЫ', many: '{n} ПОБЕД', other: '{n} ПОБЕДЫ' } }, original: null });
    expect(lang()).toBe('ru');
    expect(tr('{name} WINS', { name: 'CRYSTAL' })).toBe('CRYSTAL ПОБЕЖДАЕТ');
    expect(trn(1, '{n} WIN', '{n} WINS')).toBe('1 ПОБЕДА');
    expect(trn(3, '{n} WIN', '{n} WINS')).toBe('3 ПОБЕДЫ');
    expect(trn(5, '{n} WIN', '{n} WINS')).toBe('5 ПОБЕД');
    expect(tr('NOT TRANSLATED')).toBe('NOT TRANSLATED');
  });
});

describe('code page 437', () => {
  it('turns the files texts into Unicode and back', () => {
    expect(cp437ToUnicode('F\x81R')).toBe('FÜR'.replace('Ü', 'ü'));
    expect(unicodeToCp437('für')).toBe('f\x81r');
    expect(unicodeToCp437('日本')).toBe('??');
  });
});

describe.skipIf(!hasGameData)('the original texts in every language', () => {
  const english = () => {
    loadGameData();
    loadOriginalTexts('en', null);
    return Array.from({ length: 1013 }, (_, i) => langGet(i));
  };

  it('come from the game files in English and German', () => {
    const en = english();
    expect(en[56]).toMatch(/Stadium/i);
    loadOriginalTexts('de', null);
    // (the German file, in Unicode: its umlauts were code page 437 bytes)
    expect([...Array(1013).keys()].some((i) => /[äöüÄÖÜß]/.test(langGet(i)))).toBe(true);
    expect([...Array(1013).keys()].some((i) => /[\x80-\x9f]/.test(langGet(i)))).toBe(false);
    loadOriginalTexts('en', null);
  });

  const translated = LANGUAGES.map((l) => l.code).filter((c) => c !== 'en' && c !== 'de' && fs.existsSync(path.join(LANG_DIR, `${c}.json`)));

  it.each(translated)('%s: every text, with the markup, numbers and names the game fills in', (code) => {
    const en = english();
    const t = read(`${code}.json`) as string[];
    expect(t).toHaveLength(1013);
    const printf = (s: string) => s.match(/%(?:l?[idux]|s|%)/g) ?? [];
    const tags = (s: string) => s.match(/\{[A-Z][^}]*\}/g) ?? [];
    for (let i = 0; i < 1013; i++) {
      expect(printf(t[i]), `${code} #${i}`).toEqual(printf(en[i]));
      expect(tags(t[i]), `${code} #${i}`).toEqual(tags(en[i]));
      for (const m of en[i].match(/~[1-5]/g) ?? []) expect(t[i], `${code} #${i} ${m}`).toContain(m);
    }
    // In the game: the translation, and English where it is empty.
    loadOriginalTexts(code, t);
    expect(langGet(56)).toBe(t[56] || en[56]);
    loadOriginalTexts('en', null);
  });

  it.each(translated.filter((c) => LANGUAGES.find((l) => l.code === c)!.script === 'latin'))('%s: the original fonts draw every letter', (code) => {
    loadGameData();
    const t = read(`${code}.json`) as string[];
    const missing = new Set<string>();
    for (const font of [getFont(FontSize.SMALL), getFont(FontSize.BIG)]) {
      for (const s of t) for (const u of shapeText(s, font)) if (u.hires) missing.add(s.slice(u.start, u.end));
    }
    expect([...missing]).toEqual([]);
  });

  it('loads a language from its files (the remaster texts, the original ones)', async () => {
    loadGameData();
    setLanguageFetcher(async (p) => read(p.replace(/^lang\//, '')));
    setOriginalTextsLoader(loadOriginalTexts);
    const code = translated[0] as LangCode | undefined;
    if (!code) return;
    const data = await loadLanguageData(code);
    expect(data.original).toHaveLength(1013);
    const en = english();
    useLanguage(code, data);
    expect(lang()).toBe(code);
    expect(langGet(56)).toBe(data.original![56] || en[56]);
    useLanguage('en', { ui: {}, original: null });
    expect(langGet(56)).toBe(en[56]);
    expect(lang()).toBe('en');
  });
});

describe.skipIf(!hasGameData)('the text engine', () => {
  it('lays English out as the original did: one cell per letter', () => {
    loadGameData();
    const t = new Text(FontSize.SMALL, 60, 100, 'ONE MUST FALL 2097 IS BACK');
    const g = t.glyphs();
    expect(g.map((i) => i.x).slice(0, 4)).toEqual([0, 6, 12, 18]);
    // (wrapped after the last space that fits: 10 cells)
    expect(t.lines().map((l) => l.str)).toEqual(['ONE MUST', 'FALL 2097', 'IS BACK']);
  });

  it('makes the Latin letters the fonts lack in their style', () => {
    loadGameData();
    for (const font of [getFont(FontSize.SMALL), getFont(FontSize.BIG)]) {
      for (const ch of 'ÃÕÊÔÚÍÓÀÈÌÒÙØøãõêôúíóàèìòùñÑ¡¿«»') {
        const g = fontGlyph(font, ch);
        expect(g, ch).not.toBeNull();
        expect(g!.w).toBe(font.w);
        // (an accent or a stroke: not the plain letter)
        const plain = fontGlyph(font, ch.normalize('NFD')[0]);
        if (plain && ch.normalize('NFD').length > 1) expect([...g!.data].join(''), ch).not.toBe([...plain.data].join(''));
      }
    }
    // The big font's own á, ó, ñ have no accents: they are made too.
    const big = getFont(FontSize.BIG);
    expect(fontGlyph(big, 'ñ')!.data.slice(0, 16).some((v) => v)).toBe(true);
    // The small font has capitals only: its letters are the capitals'.
    const small = getFont(FontSize.SMALL);
    expect(fontGlyph(small, 'ã')).toBe(fontGlyph(small, 'Ã'));
    expect(fontGlyph(small, 'ä')).toBe(fontGlyph(small, 'Ä'));
  });

  it('draws the other scripts with the system fonts, a word (or a Chinese character) at a time', () => {
    loadGameData();
    const font = getFont(FontSize.BIG);
    const ru = shapeText('ПРИВЕТ, МИР', font);
    expect(ru.map((u) => u.kind)).toEqual([UnitKind.CHAR, UnitKind.SPACE, UnitKind.CHAR]);
    expect(ru[0].hires).toBe(true);
    const zh = shapeText('一必须倒下', font);
    expect(zh).toHaveLength(5);
    // (one cell each: the translations' columns are laid out so)
    expect(zh.every((u) => u.w === font.w && u.hires)).toBe(true);
    const hi = shapeText('रोबोट लड़ाई', font);
    expect(hi.filter((u) => u.kind === UnitKind.CHAR)).toHaveLength(2);
  });

  it('wraps Chinese between characters, not before its closing punctuation', () => {
    loadGameData();
    const t = new Text(FontSize.SMALL, 6 * 5, 100, '欢迎来到二零九七年，准备战斗。');
    const lines = t.lines().map((l) => l.str);
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(6);
    for (const l of lines) expect('，。').not.toContain(l[0]);
    expect(lines.join('')).toBe('欢迎来到二零九七年，准备战斗。');
  });

  it('lays Arabic out from the right, Latin names in it left to right', () => {
    loadGameData();
    expect(isRtlText('فاز CRYSTAL')).toBe(true);
    expect(isRtlText('CRYSTAL فاز')).toBe(false);
    const t = new Text(FontSize.SMALL, 200, 20, 'فاز JAGUAR الآن').setHAlign(HAlign.LEFT);
    const g = t.glyphs();
    // Right aligned in its box; the first word (فاز) is the rightmost, JAGUAR reads left to right in the middle.
    expect(Math.max(...g.map((i) => i.x + i.w))).toBeGreaterThan(190);
    const xs = g.map((i) => i.x);
    // (the original font's letters: not its space, not the system font's words)
    const latin = g.filter((i) => /^small\/\d+$/.test(i.glyph.source!.key) && i.glyph.source!.key !== 'small/0');
    expect(latin).toHaveLength(6);
    expect(latin.map((i) => i.x)).toEqual([...latin.map((i) => i.x)].sort((a, b) => a - b));
    expect(xs[xs.length - 1]).toBeGreaterThan(latin[5].x);
  });
});

describe('the names of the keys', () => {
  const withLayout = async (map: Record<string, string> | null) => {
    Object.defineProperty(navigator, 'keyboard', {
      configurable: true, value: map && { getLayoutMap: async () => new Map(Object.entries(map)) },
    });
    await loadKeyboardLayout();
  };
  afterEach(() => withLayout(null));

  it('are what the player\'s keyboard prints: Y and Z swap on a German one, the signs are its own', async () => {
    await withLayout({ KeyZ: 'y', KeyY: 'z', KeyA: 'a', Semicolon: 'ö', Minus: 'ß', BracketLeft: 'ü', Digit1: '1' });
    expect(['KeyZ', 'KeyY', 'KeyA', 'Semicolon', 'Minus', 'BracketLeft', 'Digit1'].map(keyName)).toEqual(['Y', 'Z', 'A', 'Ö', 'ß', 'Ü', '1']);
    await withLayout({ KeyQ: 'a', KeyA: 'q', Digit1: '&' });
    expect(['KeyQ', 'KeyA', 'Digit1'].map(keyName)).toEqual(['A', 'Q', '1']);
  });

  it('stay the US letters where the keyboard does not tell, or prints another script', async () => {
    await withLayout(null);
    expect(['KeyZ', 'Semicolon'].map(keyName)).toEqual(['Z', ';']);
    await withLayout({ KeyQ: 'й', Semicolon: 'ж' });
    expect(['KeyQ', 'Semicolon'].map(keyName)).toEqual(['Q', ';']);
  });
});

describe('the translations of the remaster texts', () => {
  const codes = LANGUAGES.map((l) => l.code).filter((c) => fs.existsSync(path.join(LANG_DIR, 'ui', `${c}.json`)));

  it('are found in the code (tr, trn and trKey), each with its plural form where it has one', async () => {
    // @ts-expect-error (a plain script)
    const { collectKeys } = await import('../../tools/i18n.mjs');
    const keys = collectKeys() as Map<string, { files: Set<string>; one?: string }>;
    expect(keys.size).toBeGreaterThan(800);
    expect(keys.get('ONE PLAYER GAME')?.files.size).toBeGreaterThan(0);
    expect(keys.get('{n} WINS')?.one).toBe('{n} WIN');
    // (no text of the code's own: CSS, file names)
    for (const k of keys.keys()) expect(k, k).not.toMatch(/^\d+px|rgba\(|\.(png|json)$/);
  });

  it.each(codes)('%s: placeholders and plural forms as the game fills them in', async (code) => {
    // @ts-expect-error (a plain script)
    const { checkLanguage, collectKeys } = await import('../../tools/i18n.mjs');
    const { errors } = checkLanguage(code, collectKeys());
    expect(errors).toEqual([]);
  });

  it.each(LANGUAGES.map((l) => l.code).filter((c) => fs.existsSync(path.join(LANG_DIR, 'trn', `${c}.json`))))('%s: the tournaments keep their markup', (code) => {
    const t = read(`trn/${code}.json`) as Record<string, string>;
    const tags = (s: string) => (s.match(/\{[A-Z][^}]*\}/g) ?? []).join('');
    for (const [en, v] of Object.entries(t)) expect(tags(v), en.slice(0, 40)).toBe(tags(en));
  });
});
