// How an arcade, survival or time attack run went, shown over the main menu when it is over.
import { FontSize, HAlign } from '../gui/text';
import { Page, PC } from '../gui/page';
import { playMenuSound } from '../gui/widgets';
import type { CtrlType } from '../constants';
import { records } from '../records/records';
import { formatMs, RUN_NAMES, type RunResult } from './run';
import { announce } from '../../audio/announcer';

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
    this.drawFrame(RUN_NAMES[r.kind]);
    const title = r.kind === 'survival' ? (r.wins ? `${r.wins} WIN${r.wins === 1 ? '' : 'S'} IN A ROW` : 'NO WINS THIS TIME')
      : r.cleared ? (r.kind === 'arcade' ? 'ARCADE CLEARED!' : 'TIME ATTACK DONE!') : 'THE RUN IS OVER';
    this.drawText('t', title, 160, 40, FontSize.BIG, r.cleared || r.wins ? PC.gold : PC.grey, HAlign.CENTER);
    const lines: [string, string][] = [];
    if (r.kind === 'arcade') {
      lines.push(['FIGHTS WON', `${r.wins} OF 8`], ['CONTINUES', `${r.continues}`], ['SCORE', `${r.score}`], ['TIME', formatMs(r.ms)]);
      lines.push(['BEST SCORE', `${rec.arcade.bestScore}`], ['CLEARED', `${rec.arcade.clears} TIME${rec.arcade.clears === 1 ? '' : 'S'}`]);
    } else if (r.kind === 'survival') {
      lines.push(['WINS', `${r.wins}`], ['TIME', formatMs(r.ms)], ['SCORE', `${r.score}`], ['BEST', `${rec.survival.best} WINS`]);
    } else {
      lines.push(['FIGHTS WON', `${r.wins} OF 5`], ['LOST AND FOUGHT AGAIN', `${r.continues}`], ['TIME', formatMs(r.ms)]);
      lines.push(['BEST TIME', rec.timeattack.best ? formatMs(rec.timeattack.best) : '-']);
    }
    lines.forEach(([label, value], i) => {
      const y = 70 + i * 12;
      this.drawText(`l${i}`, label, 150, y, FontSize.SMALL, PC.grey, HAlign.RIGHT);
      this.drawText(`v${i}`, value, 170, y, FontSize.SMALL, PC.white);
    });
    if (r.record) this.drawText('rec', 'A NEW RECORD!', 160, 150, FontSize.BIG, PC.green, HAlign.CENTER);
    this.drawText('h', 'PRESS ANY BUTTON', 160, 180, FontSize.SMALL, PC.dim, HAlign.CENTER);
  }
}
