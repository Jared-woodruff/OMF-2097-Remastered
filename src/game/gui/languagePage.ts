// OPTIONS > LANGUAGE: every language the game speaks on one page, each written in itself (and named in the language
// spoken now under it), with AUTOMATIC on top: the system's language (the browser's on the web, Windows' in the desktop
// app). Arrows (or the mouse) pick, ENTER chooses: the game speaks it at once and keeps it (settings.language).
import type { PointerKind } from '../../controller/mouse';
import { lang, setLanguage, systemLanguage, tr } from '../../i18n/i18n';
import { languageInfo, LANGUAGES, type LangCode } from '../../i18n/languages';
import { ACT_DOWN, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_UP, type CtrlType } from '../constants';
import { saveSettings, settings } from '../settings';
import { PC, Page } from './page';
import { FontSize, HAlign } from './text';
import { playMenuSound } from './widgets';

/** The choices: AUTOMATIC, then the languages in the menu's order. */
const CHOICES: ('auto' | LangCode)[] = ['auto', ...LANGUAGES.map((l) => l.code)];
const ROWS = Math.ceil(LANGUAGES.length / 2);
const COL_X = [24, 166];
const TOP = 30;
const FIRST = 50;
const ROW_H = 17;

/** A language's name in the language spoken now ("Japanisch" in German), from the browser's own list. */
function localName(code: LangCode): string {
  try {
    return new Intl.DisplayNames([lang()], { type: 'language' }).of(code)?.toUpperCase() ?? languageInfo(code).english.toUpperCase();
  } catch {
    return languageInfo(code).english.toUpperCase();
  }
}

export class LanguagePage extends Page {
  /** The choice under the cursor (index in CHOICES). */
  private pick = Math.max(0, CHOICES.indexOf(settings().language as 'auto' | LangCode));
  private busy = false;

  /** Where a choice is: AUTOMATIC across the top, the languages in two columns. */
  private cell(i: number): { x: number; y: number; col: number; row: number } {
    if (i === 0) return { x: 160, y: TOP, col: -1, row: -1 };
    const k = i - 1, col = Math.floor(k / ROWS), row = k % ROWS;
    return { x: COL_X[col], y: FIRST + row * ROW_H, col, row };
  }

  private move(action: number): void {
    const c = this.cell(this.pick);
    let next = this.pick;
    if (this.pick === 0) {
      if (action & ACT_DOWN) next = 1;
      else if (action & ACT_UP) next = ROWS;
    } else if (action & (ACT_UP | ACT_DOWN)) {
      const row = c.row + (action & ACT_UP ? -1 : 1);
      next = row < 0 || row >= ROWS || 1 + c.col * ROWS + row > LANGUAGES.length ? 0 : 1 + c.col * ROWS + row;
    } else if (action & (ACT_LEFT | ACT_RIGHT)) {
      const col = 1 - c.col;
      next = Math.min(LANGUAGES.length, 1 + col * ROWS + c.row);
    }
    if (next !== this.pick) {
      this.pick = next;
      playMenuSound(19);
    }
  }

  /** Speaks the choice from now on and keeps it. */
  private choose(i: number): void {
    const choice = CHOICES[i];
    playMenuSound(20);
    if (this.busy || choice === settings().language) return;
    settings().language = choice;
    saveSettings();
    this.busy = true;
    void setLanguage(choice).finally(() => (this.busy = false));
  }

  override action(action: number, _source: CtrlType): number {
    if (action & ACT_PUNCH) this.choose(this.pick);
    else this.move(action);
    return 1;
  }

  override pointer(x: number, y: number, kind: PointerKind): boolean {
    let hit = -1;
    if (y >= TOP - 3 && y < TOP + 12) hit = 0;
    else if (y >= FIRST - 2) {
      const row = Math.floor((y - FIRST + 2) / ROW_H), col = x < 160 ? 0 : 1;
      if (row >= 0 && row < ROWS && 1 + col * ROWS + row <= LANGUAGES.length) hit = 1 + col * ROWS + row;
    }
    if (hit < 0) return false;
    if (kind === 'move' && hit !== this.pick) this.pick = hit;
    if (kind === 'click') {
      this.pick = hit;
      this.choose(hit);
    }
    return true;
  }

  override render(): void {
    this.drawFrame(tr('LANGUAGE'));
    const chosen = settings().language;
    const sys = systemLanguage();
    // AUTOMATIC: the system's language, named in itself.
    const autoColor = this.pick === 0 ? PC.gold : chosen === 'auto' ? PC.green : PC.white;
    this.drawText('auto', `${chosen === 'auto' ? '* ' : ''}${tr('AUTOMATIC: {language}', { language: languageInfo(sys).native })}`, 160, TOP,
      FontSize.BIG, autoColor, HAlign.CENTER);
    LANGUAGES.forEach((l, k) => {
      const i = k + 1;
      const { x, y } = this.cell(i);
      const color = this.pick === i ? PC.gold : chosen === l.code ? PC.green : PC.white;
      this.drawText(`n${l.code}`, `${chosen === l.code ? '* ' : ''}${l.native}`, x, y, FontSize.BIG, color);
      this.drawText(`e${l.code}`, localName(l.code), x + (chosen === l.code ? 12 : 0), y + 9, FontSize.SMALL, this.pick === i ? PC.grey : PC.dim);
    });
    this.drawText('help', tr('AUTOMATIC SPEAKS THE LANGUAGE OF YOUR SYSTEM'), 160, 172, FontSize.SMALL, PC.cyan, HAlign.CENTER);
    this.drawText('h', tr('ENTER CHOOSE   ESC BACK'), 160, 184, FontSize.SMALL, PC.dim, HAlign.CENTER);
  }
}
