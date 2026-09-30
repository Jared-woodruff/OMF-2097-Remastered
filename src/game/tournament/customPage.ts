// MORE MODES > MY TOURNAMENTS: make custom tournaments (tournament/custom.ts). The list shows the six slots; a tournament is
// edited in place: its name (type it), the tournament it is made from, how many opponents, their robots and the prize
// money. They are played from TOURNAMENT PLAY like the others. E / SAVE FILE shares one as a .omftrn file, I loads them.
import type { PointerKind } from '../../controller/mouse';
import { pickFiles, saveFile } from '../../platform/files';
import { loadTournament } from '../../resources/resources';
import { video } from '../../video/draw';
import { Surface } from '../../video/surface';
import { ACT_DOWN, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_UP, type CtrlType } from '../constants';
import { FontSize, HAlign } from '../gui/text';
import { Page, PC } from '../gui/page';
import { playMenuSound } from '../gui/widgets';
import {
  baseTournaments, cleanTitle, CUSTOM_SLOTS, customTournaments, defaultTournament, newRobotsAvailable, PRIZE_NAMES, readTournamentSpec,
  ROBOT_NAMES, setCustomTournament, SIZE_NAMES, type CustomTournamentSpec,
} from './custom';

type Row = 'name' | 'base' | 'size' | 'robots' | 'prize' | 'file';
const ROWS: Row[] = ['name', 'base', 'size', 'robots', 'prize', 'file'];
const LABELS: Record<Row, string> = { name: 'NAME', base: 'MADE FROM', size: 'OPPONENTS', robots: 'THEIR ROBOTS', prize: 'PRIZE MONEY', file: 'SAVE FILE' };

function baseTitle(file: string): string {
  try {
    return (loadTournament(file).locales[0]?.title ?? file).toUpperCase();
  } catch {
    return file;
  }
}

export class CustomTournamentsPage extends Page {
  private slot = -1;
  private sel = 0;
  private row = 0;
  private spec: CustomTournamentSpec = defaultTournament();
  private dot: Surface | null = null;
  private confirmDelete = false;
  private status = '';

  override back(): boolean {
    if (this.confirmDelete) {
      this.confirmDelete = false;
      this.status = '';
      return true;
    }
    if (this.slot >= 0) {
      this.slot = -1;
      this.status = '';
      return true;
    }
    return false;
  }

  private open(slot: number): void {
    const s = customTournaments()[slot];
    this.slot = slot;
    this.spec = s ? { ...s } : { ...defaultTournament(), name: `CUSTOM TOURNAMENT ${slot + 1}` };
    if (!s) this.store();
    this.row = 0;
    this.status = '';
    playMenuSound(20);
  }

  private store(): void {
    if (!setCustomTournament(this.slot, { ...this.spec, name: cleanTitle(this.spec.name) })) {
      this.status = 'ITS TOURNAMENT IS NOT INSTALLED';
    }
  }

  private step(d: number): void {
    const s = this.spec;
    const wrap = (v: number, n: number) => (v + d + n) % n;
    switch (ROWS[this.row]) {
      case 'base': {
        const list = baseTournaments();
        if (!list.length) return;
        s.base = list[wrap(Math.max(0, list.indexOf(s.base)), list.length)];
        break;
      }
      case 'size': s.size = wrap(s.size, SIZE_NAMES.length); break;
      case 'robots':
        if (!newRobotsAvailable()) {
          this.status = 'THE NEW ROBOTS ARE NOT INSTALLED';
          return;
        }
        s.robots = wrap(s.robots, ROBOT_NAMES.length);
        break;
      case 'prize': s.prize = wrap(s.prize, PRIZE_NAMES.length); break;
      default: return;
    }
    this.store();
    playMenuSound(19);
  }

  private exportSpec(spec: CustomTournamentSpec): void {
    const name = `${spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.omftrn`;
    saveFile(name, new TextEncoder().encode(JSON.stringify(spec, null, 2)), 'application/json').then(
      () => (this.status = 'SAVED'),
      () => (this.status = 'THE FILE COULD NOT BE SAVED'),
    );
    playMenuSound(20);
  }

  private async importFiles(): Promise<void> {
    const files = await pickFiles('.omftrn,.json');
    let n = 0;
    for (const f of files) {
      try {
        const spec = readTournamentSpec(JSON.parse(await f.text()));
        const free = customTournaments().findIndex((s) => !s);
        if (!spec || free < 0) continue;
        setCustomTournament(free, spec);
        n++;
      } catch {
        // not a tournament file
      }
    }
    this.status = n ? `LOADED ${n} TOURNAMENT${n === 1 ? '' : 'S'}` : files.length ? 'NOTHING COULD BE LOADED (OR NO FREE SLOT)' : '';
  }

  override action(action: number, _source: CtrlType): number {
    if (this.slot < 0) {
      if (action & ACT_UP) this.sel = (this.sel + CUSTOM_SLOTS - 1) % CUSTOM_SLOTS;
      else if (action & ACT_DOWN) this.sel = (this.sel + 1) % CUSTOM_SLOTS;
      else if (action & (ACT_PUNCH | ACT_KICK)) this.open(this.sel);
      if (action & (ACT_UP | ACT_DOWN)) {
        this.confirmDelete = false;
        playMenuSound(19);
      }
      return 1;
    }
    if (action & ACT_UP) this.row = (this.row + ROWS.length - 1) % ROWS.length;
    else if (action & ACT_DOWN) this.row = (this.row + 1) % ROWS.length;
    else if (action & ACT_LEFT) this.step(-1);
    else if (action & ACT_RIGHT) this.step(1);
    else if (action & ACT_PUNCH && ROWS[this.row] === 'file') this.exportSpec(this.spec);
    if (action & (ACT_UP | ACT_DOWN)) playMenuSound(19);
    return 1;
  }

  override key(code: string): boolean {
    if (this.slot < 0) {
      if (code === 'Delete' || code === 'Backspace') {
        if (!customTournaments()[this.sel]) return true;
        if (!this.confirmDelete) {
          this.confirmDelete = true;
          this.status = 'PRESS DELETE AGAIN TO DELETE THIS TOURNAMENT';
        } else {
          setCustomTournament(this.sel, null);
          this.confirmDelete = false;
          this.status = 'DELETED';
          playMenuSound(20);
        }
        return true;
      }
      if (code === 'KeyE') {
        const s = customTournaments()[this.sel];
        if (s) this.exportSpec(s);
        return true;
      }
      if (code === 'KeyI') {
        void this.importFiles();
        return true;
      }
      return false;
    }
    if (ROWS[this.row] !== 'name') return false;
    const s = this.spec;
    if (code === 'Backspace') s.name = s.name.slice(0, -1);
    else if (code === 'Minus') s.name = `${s.name} `.slice(0, 24);
    else {
      const m = /^Key([A-Z])$/.exec(code) ?? /^Digit([0-9])$/.exec(code);
      if (!m) return false;
      s.name = (s.name + m[1]).slice(0, 24);
    }
    this.store();
    return true;
  }

  override pointer(x: number, y: number, kind: PointerKind): boolean {
    if (kind !== 'click') return false;
    if (this.slot < 0) {
      const i = Math.floor((y - 42) / 16);
      if (i >= 0 && i < CUSTOM_SLOTS && x > 20 && x < 300) {
        if (i === this.sel) this.open(i);
        else this.sel = i;
        return true;
      }
      return false;
    }
    const i = Math.floor((y - 44) / 16);
    if (i >= 0 && i < ROWS.length) {
      if (i === this.row) {
        if (ROWS[i] === 'file') this.exportSpec(this.spec);
        else this.step(x > 200 ? 1 : -1);
      } else {
        this.row = i;
      }
      return true;
    }
    return false;
  }

  private box(x: number, y: number, w: number, h: number, color: number): void {
    this.dot ??= new Surface(1, 1, new Uint8Array([1]), 0);
    video.drawFull(this.dot, x, y, w, h, 0, 0, color - 1, 255, 255, 0, 0);
  }

  override render(): void {
    if (this.slot < 0) this.renderList();
    else this.renderEditor();
  }

  private renderList(): void {
    this.drawFrame('TOURNAMENTS');
    this.drawText('st', this.status || 'YOUR OWN TOURNAMENTS: PLAY THEM FROM TOURNAMENT PLAY', 160, 25, FontSize.SMALL,
      this.confirmDelete ? PC.red : PC.dim, HAlign.CENTER);
    const list = customTournaments();
    for (let i = 0; i < CUSTOM_SLOTS; i++) {
      const s = list[i];
      const y = 42 + i * 16;
      const sel = i === this.sel;
      if (sel) this.box(22, y - 3, 276, 14, PC.select);
      this.drawText(`n${i}`, `${i + 1}`, 30, y, FontSize.SMALL, PC.dim);
      if (s) {
        this.drawText(`s${i}`, s.name, 44, y - 1, FontSize.BIG, sel ? PC.white : PC.grey);
        this.drawText(`d${i}`, `${SIZE_NAMES[s.size]}, ${ROBOT_NAMES[s.robots]}`, 292, y, FontSize.SMALL, sel ? PC.gold : PC.dim, HAlign.RIGHT);
      } else {
        this.drawText(`s${i}`, 'EMPTY: ENTER MAKES A NEW TOURNAMENT', 44, y, FontSize.SMALL, sel ? PC.grey : PC.dark);
      }
    }
    this.drawText('h1', 'ENTER MAKE / EDIT   E SAVE FILE   I LOAD FILES', 160, 172, FontSize.SMALL, PC.dim, HAlign.CENTER);
    this.drawText('h2', 'DEL DELETE   ESC BACK', 160, 182, FontSize.SMALL, PC.dim, HAlign.CENTER);
  }

  private renderEditor(): void {
    const s = this.spec;
    this.drawFrame(`TOURNAMENT ${this.slot + 1}`);
    const value = (r: Row): string => {
      switch (r) {
        case 'name': return s.name || '_';
        case 'base': return baseTitle(s.base);
        case 'size': return SIZE_NAMES[s.size];
        case 'robots': return ROBOT_NAMES[s.robots];
        case 'prize': return PRIZE_NAMES[s.prize];
        default: return '';
      }
    };
    ROWS.forEach((r, i) => {
      const y = 44 + i * 16;
      const sel = i === this.row;
      if (sel) this.box(14, y - 3, 292, 13, PC.select);
      this.drawText(`l${i}`, LABELS[r], 22, y, FontSize.SMALL, r === 'file' ? (sel ? PC.gold : PC.orange) : sel ? PC.white : PC.grey);
      if (r !== 'file') this.drawText(`v${i}`, r === 'name' ? value(r) : `< ${value(r)} >`, 110, y, FontSize.SMALL, sel ? PC.gold : PC.white);
    });
    const hint = this.status || (ROWS[this.row] === 'name' ? 'TYPE A NAME (- FOR A SPACE)   ESC LIST' : '< > CHANGE   ESC LIST');
    this.drawText('h', hint, 160, 150, FontSize.SMALL, this.status ? PC.gold : PC.dim, HAlign.CENTER);
    this.drawText('h2', 'JOIN IT FROM TOURNAMENT PLAY: IT IS IN THE LIST OF TOURNAMENTS', 160, 172, FontSize.SMALL, PC.dim, HAlign.CENTER);
  }
}
