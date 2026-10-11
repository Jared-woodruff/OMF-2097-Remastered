// EXTRAS > RECORDS: the player's statistics, the best results of the modes, and achievements (three pages: left and
// right switch them; up and down pick an achievement to read what it asks).
import type { PointerKind } from '../../controller/mouse';
import { ACT_DOWN, ACT_LEFT, ACT_RIGHT, ACT_UP, HAR_NAMES, type CtrlType } from '../constants';
import { FontSize, HAlign } from '../gui/text';
import { Page, PC } from '../gui/page';
import { playMenuSound } from '../gui/widgets';
import { formatMs } from '../modes/run';
import { settings } from '../settings';
import { ACHIEVEMENTS, records } from './records';
import { tr, trn, trKey, lang } from '../../i18n/i18n';

const TABS = [trKey('STATISTICS'), trKey('MODES'), trKey('ACHIEVEMENTS')];

export class RecordsPage extends Page {
  private tab = 0;
  private pick = 0;

  constructor(private msPerTick: () => number) {
    super();
  }

  override action(action: number, _source: CtrlType): number {
    if (action & ACT_LEFT) this.switchTab(-1);
    else if (action & ACT_RIGHT) this.switchTab(1);
    else if (this.tab === 2 && action & (ACT_UP | ACT_DOWN)) {
      this.pick = (this.pick + (action & ACT_UP ? -1 : 1) + ACHIEVEMENTS.length) % ACHIEVEMENTS.length;
      playMenuSound(19);
    }
    return 1;
  }

  private switchTab(d: number): void {
    this.tab = (this.tab + d + TABS.length) % TABS.length;
    playMenuSound(19);
  }

  override pointer(x: number, y: number, kind: PointerKind): boolean {
    if (kind !== 'click') return false;
    if (y < 34) {
      this.switchTab(x < 160 ? -1 : 1);
      return true;
    }
    if (this.tab === 2) {
      const col = x < 160 ? 0 : 1;
      const row = Math.floor((y - 40) / 10);
      const i = col * 10 + row;
      if (row >= 0 && row < 10 && ACHIEVEMENTS[i]) this.pick = i;
      return true;
    }
    return false;
  }

  override render(): void {
    this.drawFrame(tr('RECORDS'));
    TABS.forEach((t, i) => this.drawText(`tab${i}`, tr(t), 60 + i * 100, 25, FontSize.SMALL, i === this.tab ? PC.gold : PC.dim, HAlign.CENTER));
    if (this.tab === 0) this.renderStats();
    else if (this.tab === 1) this.renderModes();
    else this.renderAchievements();
    this.drawText('h', tr('< > PAGE   ESC BACK'), 160, 184, FontSize.SMALL, PC.dim, HAlign.CENTER);
  }

  private row(key: string, label: string, value: string, x: number, y: number): void {
    this.drawText(`${key}l`, label, x, y, FontSize.SMALL, PC.grey, HAlign.RIGHT);
    this.drawText(`${key}v`, value, x + 8, y, FontSize.SMALL, PC.white);
  }

  private renderStats(): void {
    const r = records();
    const rate = r.fights ? `${Math.round((r.wins * 100) / r.fights)}%` : '-';
    const secs = Math.round((r.ticks * this.msPerTick()) / 1000);
    const time = tr('{hours}H {minutes}M', { hours: Math.trunc(secs / 3600), minutes: String(Math.trunc(secs / 60) % 60).padStart(2, '0') });
    const rows: [string, string][] = [
      [tr('FIGHTS'), `${r.fights}`], [tr('WINS'), `${r.wins}  (${rate})`], [tr('LOSSES'), `${r.losses}`], [tr('PERFECT ROUNDS'), `${r.perfects}`],
      [tr('SCRAP FINISHES'), `${r.scraps}`], [tr('DESTRUCTIONS'), `${r.destructions}`], [tr('LONGEST COMBO'), trn(r.bestCombo, '{n} HIT', '{n} HITS')],
      [tr('TIME FIGHTING'), time], [tr('CLIPS SAVED'), `${r.clips}`],
    ];
    rows.forEach(([l, v], i) => this.row(`s${i}`, l, v, 96, 42 + i * 10));
    // The robots played most.
    const robots = Object.entries(r.robots).map(([id, s]) => ({ id: Number(id), ...s })).sort((a, b) => b.fights - a.fights).slice(0, 8);
    this.drawText('rt1', tr('ROBOT'), 178, 42, FontSize.SMALL, PC.dim);
    this.drawText('rt2', tr('FIGHTS'), 266, 42, FontSize.SMALL, PC.dim, HAlign.RIGHT);
    this.drawText('rt3', tr('WINS'), 302, 42, FontSize.SMALL, PC.dim, HAlign.RIGHT);
    robots.forEach((b, i) => {
      const y = 52 + i * 10;
      this.drawText(`rn${i}`, HAR_NAMES[b.id] ?? '?', 178, y, FontSize.SMALL, PC.white);
      this.drawText(`rf${i}`, `${b.fights}`, 266, y, FontSize.SMALL, PC.white, HAlign.RIGHT);
      this.drawText(`rw${i}`, `${b.wins}`, 302, y, FontSize.SMALL, PC.white, HAlign.RIGHT);
    });
    if (!robots.length) this.drawText('none', tr('NO FIGHTS YET'), 178, 52, FontSize.SMALL, PC.dim);
  }

  private renderModes(): void {
    const r = records();
    const trials = settings().training.trialsDone.length;
    const rows: [string, string][] = [
      [tr('ARCADE CLEARED'), trn(r.arcade.clears, '{n} TIME', '{n} TIMES')],
      [tr('ARCADE BEST SCORE'), r.arcade.bestScore ? `${r.arcade.bestScore}` : '-'],
      [tr('ARCADE FASTEST'), r.arcade.fastest ? formatMs(r.arcade.fastest) : '-'],
      [tr('SURVIVAL BEST'), trn(r.survival.best, '{n} WIN', '{n} WINS')],
      [tr('TIME ATTACK BEST'), r.timeattack.best ? formatMs(r.timeattack.best) : '-'],
      [tr('COMBO TRIALS DONE'), `${trials}`],
    ];
    rows.forEach(([l, v], i) => this.row(`m${i}`, l, v, 176, 50 + i * 14));
  }

  private renderAchievements(): void {
    const r = records();
    const n = ACHIEVEMENTS.filter((a) => r.achievements[a.id]).length;
    this.drawText('an', tr('{n} OF {count} EARNED', { n, count: ACHIEVEMENTS.length }), 160, 164, FontSize.SMALL, PC.dim, HAlign.CENTER);
    ACHIEVEMENTS.forEach((a, i) => {
      const done = !!r.achievements[a.id];
      const x = i < 10 ? 20 : 166, y = 40 + (i % 10) * 10;
      const color = i === this.pick ? PC.gold : done ? PC.green : PC.dark;
      this.drawText(`a${i}`, `${done ? '*' : ' '} ${tr(a.title)}`, x, y, FontSize.SMALL, color);
    });
    const a = ACHIEVEMENTS[this.pick];
    const when = r.achievements[a.id];
    const date = when ? `  (${new Date(when).toLocaleDateString(lang()).toUpperCase()})` : '';
    this.drawText('ad', `${tr(a.text).toUpperCase()}${date}`, 160, 148, FontSize.SMALL, when ? PC.green : PC.grey, HAlign.CENTER);
  }
}
