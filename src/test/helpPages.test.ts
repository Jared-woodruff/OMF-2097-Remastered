// The help pages (F1 / HELP): the English pages as in the reference (one sheet each), the German pages with their
// mid-sentence color changes laid out on the same lines and broken over more sheets where they are longer than the panel.
import { afterEach, describe, expect, it } from 'vitest';
import { parseHelpText } from '../game/gui/helpHtml';
import { helpSheets, helpTexts } from '../game/scenes/mainmenu/menuHelp';
import type { Text } from '../game/gui/text';
import { loadLanguage } from '../resources/resources';
import { hasGameData, installBrowserShims, loadGameData } from './harness';

/** Height of a sheet's text (what drawDocument moves down). */
const heightOf = (sheet: Text[]) => sheet.filter((t) => t.docAdvance).reduce((s, t) => s + t.height(), 0);

describe.skipIf(!hasGameData)('help pages', () => {
  afterEach(() => loadLanguage('ENGLISH.DAT'));

  it('English: thirteen sheets, one per page, all inside the panel', () => {
    installBrowserShims();
    loadGameData();
    loadLanguage('ENGLISH.DAT');
    const sheets = helpSheets();
    expect(sheets.length).toBe(13);
    for (const s of sheets) expect(heightOf(s)).toBeLessThanOrEqual(165);
    // the reference's blocks: every text starts its own line
    expect(sheets.flat().every((t) => t.docX === 0 && t.docAdvance)).toBe(true);
  });

  it('German: colors change in mid-sentence, long pages go on over more sheets', () => {
    installBrowserShims();
    loadGameData();
    loadLanguage('GERMAN.DAT');
    const sheets = helpSheets();
    expect(sheets.length).toBeGreaterThan(13);
    for (const s of sheets) expect(heightOf(s)).toBeLessThanOrEqual(165);
    const all = sheets.flat();
    // {COLOR:WHITE}HILFE{COLOR:DEFAULT} zeigt...: the word in white, the sentence going on after it on the same line
    const hilfe = all.find((t) => t.str === 'HILFE');
    expect(hilfe?.color).toBe(0x7f);
    expect(hilfe?.docAdvance).toBe(false);
    const after = all[all.indexOf(hilfe!) + 1];
    expect(after.str.startsWith(' zeigt')).toBe(true);
    expect(after.docX).toBeGreaterThan(0);
    // {COLOR:PURPLE}<ESC>{COLOR:DEFAULT}
    expect(all.find((t) => t.str === '<ESC>')?.color).toBe(0xf7);
    // the paragraph after a size tag without its closing brace is there
    expect(all.some((t) => t.str.includes('Nicht nur die die pure Kraft'))).toBe(true);
  });

  it('the HTML help (remastered graphics): each page a title, headings and paragraphs, in mixed case', () => {
    installBrowserShims();
    loadGameData();
    for (const language of ['ENGLISH.DAT', 'GERMAN.DAT']) {
      loadLanguage(language);
      const pages = helpTexts().map(parseHelpText);
      expect(pages.length).toBe(13);
      for (const p of pages) {
        expect(p.title.length).toBeGreaterThan(3);
        expect(p.blocks.some((b) => b.kind === 'text')).toBe(true);
        // no markup is left in the text
        expect(JSON.stringify(p.blocks)).not.toMatch(/\{(SIZE|COLOR|SPACING|CENTER|WIDTH|SHADOWS)/);
      }
      if (language === 'ENGLISH.DAT') {
        expect(pages[0].title).toBe('One Must Fall 2097');
        const pilot = pages[3];
        expect(pilot.title).toBe('Choosing A Pilot');
        expect(pilot.blocks.filter((b) => b.kind === 'heading').map((b) => b.lines[0][0].text.trim())).toEqual(['POWER', 'AGILITY', 'ENDURANCE']);
        const first = pages[0].blocks[0].lines[0].map((r) => r.text).join('');
        expect(first.startsWith('Welcome to One Must Fall 2097.')).toBe(true);
      }
    }
  });
});
