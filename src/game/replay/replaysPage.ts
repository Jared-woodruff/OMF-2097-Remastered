// The replay list: every saved fight (newest first) with its robots, pilots, arena and result. ENTER / A watches the
// selected fight, K keeps it for good (the 40 newest are kept anyway), E saves it as a .REC file, I loads .REC files,
// DELETE deletes it (press twice). ESC / B goes back.
import type { PointerKind } from '../../controller/mouse';
import { pickFiles, saveFile } from '../../platform/files';
import { toast } from '../../platform/toast';
import { Painter } from '../gui/painter';
import { Page, PAGE_ACTIVE, PAGE_NORMAL, PC } from '../gui/page';
import { FontSize, HAlign } from '../gui/text';
import { playMenuSound } from '../gui/widgets';
import { ACT_DOWN, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_UP, HAR_NAMES, type CtrlType } from '../constants';
import { arenaName } from '../roster';
import { video } from '../../video/draw';
import type { Surface } from '../../video/surface';
import { formatTicks } from './hud';
import { AUTO_KEEP, deleteReplay, importReplays, listReplays, replayFileName, setReplayKept, type ReplayRecord } from './store';

const ROW_Y = 36;
const ROW_H = 10;
const ROWS = 9;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function when(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const har = (id: number) => HAR_NAMES[id] ?? '?';

export class ReplaysPage extends Page {
  private list: ReplayRecord[] | null = null;
  private sel = 0;
  private top = 0;
  private status = '';
  private confirmDelete = false;
  private busy = false;
  private bar: Surface | null = null;

  /** `watch` starts watching a fight (the page closes). */
  /** `watch` plays a fight; false when it cannot (its robot or arena is missing: the list stays). */
  constructor(private watch: (r: ReplayRecord) => boolean, private gameSpeed: () => number) {
    super();
  }

  override onOpen(): void {
    void this.reload();
  }

  private async reload(keepId?: number): Promise<void> {
    try {
      this.list = await listReplays();
    } catch {
      this.list = [];
      this.status = 'REPLAYS NEED BROWSER STORAGE, WHICH IS NOT AVAILABLE';
    }
    if (keepId !== undefined) {
      const i = this.list.findIndex((r) => r.id === keepId);
      if (i >= 0) this.sel = i;
    }
    this.sel = Math.max(0, Math.min(this.sel, this.list.length - 1));
    this.scrollToSelection();
  }

  private scrollToSelection(): void {
    if (this.sel < this.top) this.top = this.sel;
    if (this.sel >= this.top + ROWS) this.top = this.sel - ROWS + 1;
    this.top = Math.max(0, this.top);
  }

  private chosen(): ReplayRecord | null {
    return this.list?.[this.sel] ?? null;
  }

  private move(d: number): void {
    if (!this.list?.length) return;
    const n = Math.max(0, Math.min(this.list.length - 1, this.sel + d));
    if (n !== this.sel) playMenuSound(19);
    this.sel = n;
    this.confirmDelete = false;
    this.scrollToSelection();
  }

  private result(r: ReplayRecord): string {
    const m = r.meta;
    if (m.winner < 0) return 'UNFINISHED';
    const w = m.players[m.winner];
    return `${w.name.toUpperCase()} WINS ${m.rounds[m.winner]}-${m.rounds[1 - m.winner]}`;
  }

  private async toggleKeep(): Promise<void> {
    const r = this.chosen();
    if (!r || r.id === undefined) return;
    const kept = !r.meta.kept;
    await setReplayKept(r.id, kept);
    r.meta.kept = kept;
    this.status = kept ? 'KEPT FOR GOOD' : `NO LONGER KEPT (THE ${AUTO_KEEP} NEWEST STAY)`;
    playMenuSound(20);
  }

  private exportSelected(): void {
    const r = this.chosen();
    if (!r) return;
    // (a .REC file has no room for a survival fight's lower starting health: elsewhere it would play out differently)
    if (r.meta.startHealth !== undefined && r.meta.startHealth < 100) {
      this.status = 'THIS FIGHT CAN ONLY BE WATCHED HERE';
      toast('This survival fight started with less than full health, which a .REC file cannot hold: played from the file, it would go differently.', 6000);
      playMenuSound(20);
      return;
    }
    const name = replayFileName(r.meta, har);
    saveFile(name, r.data).then(
      (where) => {
        this.status = `SAVED ${name.toUpperCase()}`;
        if (where !== name) toast(`Saved ${where}`, 5000);
      },
      () => (this.status = 'THE FILE COULD NOT BE SAVED'),
    );
    playMenuSound(20);
  }

  private async importFiles(): Promise<void> {
    const files = await pickFiles('.rec,.REC');
    if (!files.length) return;
    this.busy = true;
    const n = await importReplays(files);
    this.busy = false;
    this.status = n ? `LOADED ${n} FIGHT${n === 1 ? '' : 'S'}` : 'NO RECORDING COULD BE READ';
    this.sel = 0;
    await this.reload();
  }

  private async deleteSelected(): Promise<void> {
    const r = this.chosen();
    if (!r || r.id === undefined) return;
    if (!this.confirmDelete) {
      this.confirmDelete = true;
      this.status = 'PRESS DELETE AGAIN TO DELETE THIS FIGHT';
      return;
    }
    this.confirmDelete = false;
    await deleteReplay(r.id);
    this.status = 'DELETED';
    playMenuSound(20);
    await this.reload();
  }

  override back(): boolean {
    if (this.confirmDelete) {
      this.confirmDelete = false;
      this.status = '';
      return true;
    }
    return false;
  }

  override action(action: number, _source: CtrlType): number {
    if (action & ACT_UP) this.move(-1);
    else if (action & ACT_DOWN) this.move(1);
    else if (action & ACT_LEFT) this.move(-ROWS);
    else if (action & ACT_RIGHT) this.move(ROWS);
    else if (action & ACT_PUNCH) {
      const r = this.chosen();
      if (r && this.watch(r)) {
        playMenuSound(20);
        this.finished = true;
      }
    } else if (action & ACT_KICK) {
      void this.toggleKeep();
    }
    return 1;
  }

  override key(code: string): boolean {
    switch (code) {
      case 'KeyK': void this.toggleKeep(); return true;
      case 'KeyE': this.exportSelected(); return true;
      case 'KeyI': void this.importFiles(); return true;
      case 'Delete': case 'Backspace': void this.deleteSelected(); return true;
      case 'PageUp': this.move(-ROWS); return true;
      case 'PageDown': this.move(ROWS); return true;
      case 'Home': this.move(-1e6); return true;
      case 'End': this.move(1e6); return true;
    }
    return false;
  }

  override pointer(x: number, y: number, kind: PointerKind): boolean {
    if (kind !== 'click' || !this.list) return false;
    const row = Math.floor((y - ROW_Y) / ROW_H);
    if (row < 0 || row >= ROWS || x < 12 || x > 308) return false;
    const i = this.top + row;
    if (i >= this.list.length) return false;
    if (i === this.sel) this.action(ACT_PUNCH, 0 as CtrlType);
    else this.move(i - this.sel);
    return true;
  }

  override render(): void {
    this.drawFrame('REPLAYS');
    const list = this.list;
    if (!list) {
      this.drawText('st', 'LOADING...', 160, 24, FontSize.SMALL, PC.dim, HAlign.CENTER);
      return;
    }
    const kept = list.filter((r) => r.meta.kept).length;
    const head = this.busy ? 'LOADING FILES...' : this.status || (list.length
      ? `${list.length} FIGHT${list.length === 1 ? '' : 'S'}${kept ? `  (${kept} KEPT)` : ''}`
      : 'NO FIGHTS YET: EVERY FIGHT YOU PLAY IS SAVED HERE');
    this.drawText('st', head, 160, 24, FontSize.SMALL, this.confirmDelete ? PC.red : PC.dim, HAlign.CENTER);

    // Rows.
    if (!this.bar) {
      const p = new Painter(292 * 4, (ROW_H - 1) * 4);
      p.roundRect(0, 0, 292 * 4, (ROW_H - 1) * 4, 6, PC.select);
      this.bar = p.toSurface('replays/bar');
      this.bar.renderW = 292;
      this.bar.renderH = ROW_H - 1;
    }
    for (let row = 0; row < ROWS; row++) {
      const i = this.top + row;
      const r = list[i];
      if (!r) break;
      const y = ROW_Y + row * ROW_H;
      const sel = i === this.sel;
      if (sel) video.drawSize(this.bar, 14, y - 2, 292, ROW_H - 1);
      const m = r.meta;
      const color = sel ? PAGE_ACTIVE : PAGE_NORMAL;
      if (m.kept) this.drawText('k', '*', 17, y, FontSize.SMALL, PC.gold);
      this.drawText('d', when(m.created), 24, y, FontSize.SMALL, sel ? PC.white : PC.grey);
      this.drawText('h', `${har(m.players[0].harId)} VS ${har(m.players[1].harId)}`, 104, y, FontSize.SMALL, color);
      const res = m.winner < 0 ? '--' : `P${m.winner + 1} ${m.rounds[m.winner]}-${m.rounds[1 - m.winner]}`;
      this.drawText('r', res, 300, y, FontSize.SMALL, sel ? PC.gold : PC.dim, HAlign.RIGHT);
    }
    if (list.length > ROWS) {
      this.drawText('more', `${this.top + 1}-${Math.min(list.length, this.top + ROWS)} OF ${list.length}`, 300, 24,
        FontSize.SMALL, PC.dim, HAlign.RIGHT);
    }

    // Details of the selected fight.
    const r = this.chosen();
    if (r) {
      const m = r.meta;
      const [a, b] = m.players;
      this.drawText('p1', `${a.name.toUpperCase()} (${har(a.harId)})`, 150, 134, FontSize.SMALL, PC.p1, HAlign.RIGHT);
      this.drawText('vs', 'VS', 160, 134, FontSize.SMALL, PC.dim, HAlign.CENTER);
      this.drawText('p2', `${b.name.toUpperCase()} (${har(b.harId)})`, 171, 134, FontSize.SMALL, PC.p2);
      const arena = arenaName(m.arena).toUpperCase() || `ARENA ${m.arena}`;
      this.drawText('d2', `${m.mode}  -  ${arena}  -  ${formatTicks(m.ticks, this.gameSpeed())}`, 160, 144, FontSize.SMALL, PC.grey, HAlign.CENTER);
      this.drawText('d3', this.result(r), 160, 154, FontSize.SMALL, m.winner < 0 ? PC.dim : PC.gold, HAlign.CENTER);
    }
    this.drawText('h1', 'ENTER WATCH   K KEEP   E SAVE FILE   I LOAD FILES', 160, 172, FontSize.SMALL, PC.dim, HAlign.CENTER);
    this.drawText('h2', 'DEL DELETE   ESC BACK', 160, 182, FontSize.SMALL, PC.dim, HAlign.CENTER);
  }
}
