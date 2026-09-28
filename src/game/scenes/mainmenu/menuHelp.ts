// Help pages (port of the reference mainmenu/menu_help.c): the 13 formatted help texts of the language file. A page
// longer than the panel (the German texts) goes on over more sheets, under its title.
import { video } from '../../../video/draw';
import type { Surface } from '../../../video/surface';
import { ACT_DOWN, ACT_ESC, ACT_UP, type CtrlType } from '../../constants';
import { drawDocument, FontSize, GLYPH_SHADOW_NONE, HAlign, Text, TEXT_BRIGHT_GREEN, textDocument } from '../../gui/text';
import { Menu, MenuBackgroundStyle, menuBackground, menuShade } from '../../gui/widgets';
import type { MainMenuScene } from '../mainmenu';
import { lang } from './common';

const TEXT_SHADOW_GREEN = 254;
const NUM_PAGES = 13;
/** Height of text a sheet holds: the panel is 170 high and the text starts 5 below its top. */
const SHEET_H = 165;

/** The help pages as sheets that fit the panel. */
export function helpSheets(): Text[][] {
  const sheets: Text[][] = [];
  for (let p = 0; p < NUM_PAGES; p++) {
    // (text_margin {10, 0, 0, 0})
    let doc = textDocument(lang(p), FontSize.BIG, 280, 170, TEXT_BRIGHT_GREEN, TEXT_SHADOW_GREEN, HAlign.LEFT,
      GLYPH_SHADOW_NONE, 1, { left: 10 });
    // Rows: the texts up to one that moves down (a line of a laid out paragraph, or a whole block).
    const rowsOf = (texts: Text[]) => {
      const rows: { texts: Text[]; h: number }[] = [];
      let row: Text[] = [];
      for (const t of texts) {
        row.push(t);
        if (t.docAdvance) {
          rows.push({ texts: row, h: t.height() });
          row = [];
        }
      }
      if (row.length) rows.push({ texts: row, h: 0 });
      return rows;
    };
    let rows = rowsOf(doc);
    // A page that does not fit is broken between any two lines.
    if (rows.reduce((s, r) => s + r.h, 0) > SHEET_H) {
      doc = doc.flatMap((t) => (t.docAdvance ? t.lines() : [t]));
      rows = rowsOf(doc);
    }
    let sheet: Text[] = [];
    let y = 0;
    const blank = (r: { texts: Text[] }) => !r.texts.some((t) => /\S/.test(t.str));
    // A heading: a line in the big font (it goes with the text under it).
    const heading = (r: { texts: Text[] }) => r.texts.length === 1 && r.texts[0].font === FontSize.BIG && r.texts[0].rows === 1;
    rows.forEach((r, i) => {
      if (i > 1 && y + r.h > SHEET_H) {
        const carried = i > 2 && heading(rows[i - 1]) && !heading(r) ? rows[i - 1] : null;
        if (carried) sheet.splice(sheet.length - carried.texts.length, carried.texts.length);
        sheets.push(sheet);
        // The page goes on under its title, a small line lower.
        sheet = [...rows[0].texts, new Text(FontSize.SMALL, 10, 10, ' ')];
        y = rows[0].h + 6;
        if (carried) {
          sheet.push(...carried.texts);
          y += carried.h;
        } else if (blank(r)) {
          return;
        }
      }
      sheet.push(...r.texts);
      y += r.h;
    });
    sheets.push(sheet);
  }
  return sheets;
}

/** A menu without entries: renders the current sheet and turns them with up/down (or PAGE UP / PAGE DOWN keys). */
export class HelpMenu extends Menu {
  /** The sheet shown (one per page of the language file, and more for the pages longer than the panel). */
  page = 0;
  doc: Text[] = [];
  private readonly sheets = helpSheets();
  private readonly background1: Surface = menuShade(290, 170);
  private readonly background2: Surface = menuBackground(290, 170, MenuBackgroundStyle.MENU);

  constructor() {
    super();
    this.helpMenuUpdate();
  }

  /** help_menu_update() */
  private helpMenuUpdate(): void {
    this.doc = this.sheets[this.page] ?? [];
  }

  /** menu_help_render() */
  override render(): void {
    video.drawRemap(this.background1, 15, 15, 4, 1, 0);
    video.draw(this.background2, 15, 15);
    drawDocument(this.doc, 15, 20);
  }

  /** menu_help_event(): PAGE UP / PAGE DOWN (only reach here when not bound to player 1, see MainMenuScene.keyEvent). */
  override keyEvent(code: string, _e: KeyboardEvent): boolean {
    if (code === 'PageUp' && this.page > 0) {
      this.page--;
      this.helpMenuUpdate();
      return true;
    } else if (code === 'PageDown' && this.page < this.sheets.length - 1) {
      this.page++;
      this.helpMenuUpdate();
    }
    return false;
  }

  /** menu_help_action() */
  override action(action: number, _source: CtrlType): number {
    if (action === ACT_UP && this.page > 0) {
      this.page--;
      this.helpMenuUpdate();
      return 1;
    } else if (action === ACT_DOWN && this.page < this.sheets.length - 1) {
      this.page++;
      this.helpMenuUpdate();
      return 1;
    } else if (action === ACT_ESC) {
      this.finished = true;
    }
    return 0;
  }
}

export function menuHelpCreate(_s: MainMenuScene): Menu {
  return new HelpMenu();
}
