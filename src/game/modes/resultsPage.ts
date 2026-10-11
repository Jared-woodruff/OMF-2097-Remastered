// How an arcade, survival or time attack run went, shown over the main menu when it is over.
import { FontSize, HAlign } from '../gui/text';
import { Page, PC } from '../gui/page';
import { playMenuSound } from '../gui/widgets';
import type { CtrlType } from '../constants';
import { records } from '../records/records';
import { formatMs, RUN_NAMES, type RunResult } from './run';
import { announce } from '../../audio/announcer';
import { tr, trn } from '../../i18n/i18n';

export class RunResultsPage extends Page {
  constructor(private r: RunResult) {
    super();
  }

  override onOpen(): void {
    if (this.r.record) announce('newrecord');
  }

  override action(_action: number, _source: CtrlType): number {
    playMenuSound(20);
    this.finished = true;
    return 1;
  }

  override pointer(_x: number, _y: number, kind: import('../../controller/mouse').PointerKind): boolean {
    if (kind === 'click') this.action(0, 0 as CtrlType);
    return true;
  }

  override render(): void {
    const r = this.r;
    const rec = records();
    this.drawFrame(tr(RUN_NAMES[r.kind]));
    const title = r.kind === 'survival' ? (r.wins ? trn(r.wins, '{n} WIN IN A ROW', '{n} WINS IN A ROW') : tr('NO WINS THIS TIME'))
      : r.cleared ? (r.kind === 'arcade' ? tr('ARCADE CLEARED!') : tr('TIME ATTACK DONE!')) : tr('THE RUN IS OVER');
    this.drawText('t', title, 160, 40, FontSize.BIG, r.cleared || r.wins ? PC.gold : PC.grey, HAlign.CENTER);
    const lines: [string, string][] = [];
    if (r.kind === 'arcade') {
      lines.push([tr('FIGHTS WON'), tr('{n} OF {total}', { n: r.wins, total: 8 })], [tr('CONTINUES'), `${r.continues}`], [tr('SCORE'), `${r.score}`], [tr('TIME'), formatMs(r.ms)]);
      lines.push([tr('BEST SCORE'), `${rec.arcade.bestScore}`], [tr('CLEARED'), trn(rec.arcade.clears, '{n} TIME', '{n} TIMES')]);
    } else if (r.kind === 'survival') {
      lines.push([tr('WINS'), `${r.wins}`], [tr('TIME'), formatMs(r.ms)], [tr('SCORE'), `${r.score}`], [tr('BEST'), trn(rec.survival.best, '{n} WIN', '{n} WINS')]);
    } else {
      lines.push([tr('FIGHTS WON'), tr('{n} OF {total}', { n: r.wins, total: 5 })], [tr('LOST AND FOUGHT AGAIN'), `${r.continues}`], [tr('TIME'), formatMs(r.ms)]);
      lines.push([tr('BEST TIME'), rec.timeattack.best ? formatMs(rec.timeattack.best) : '-']);
    }
    lines.forEach(([label, value], i) => {
      const y = 70 + i * 12;
      this.drawText(`l${i}`, label, 150, y, FontSize.SMALL, PC.grey, HAlign.RIGHT);
      this.drawText(`v${i}`, value, 170, y, FontSize.SMALL, PC.white);
    });
    if (r.record) this.drawText('rec', tr('A NEW RECORD!'), 160, 150, FontSize.BIG, PC.green, HAlign.CENTER);
    this.drawText('h', tr('PRESS ANY BUTTON'), 160, 180, FontSize.SMALL, PC.dim, HAlign.CENTER);
  }
}
