// EXTRAS > WORKSHOP: build your own robots from the new robots' parts (gen/workshop.ts). The list shows the eight
// workshop slots; a robot is edited with a live picture of it: its name (type it, or pick one), the frame, the head,
// the special moves, size, weight and colors. TRAINING and FIGHT try it out (it is built into a fighter on the spot),
// E / SAVE FILE shares it as a .omfbot file, I loads robots from files.
import type { PointerKind } from '../../controller/mouse';
import { cleanName, defaultSpec, PART_NAMES, readSpec, SIZE_NAMES, WEIGHT_NAMES, WORKSHOP_SLOTS, workshopPreview,
  workshopRobot, type WorkshopSpec } from '../../gen/workshop';
import { pickFiles, saveFile } from '../../platform/files';
import { toast } from '../../platform/toast';
import { altPalettes } from '../../resources/resources';
import { video } from '../../video/draw';
import { Surface } from '../../video/surface';
import { vga } from '../../video/vga';
import { ACT_DOWN, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_UP, type CtrlType } from '../constants';
import { FontSize, HAlign } from '../gui/text';
import { Page, PC } from '../gui/page';
import { playMenuSound } from '../gui/widgets';
import { ensureWorkshopRobot, harIdOf, setWorkshopSpec, workshopSpecs } from './registry';

/** Palette entries the picture's three color ramps use while the page is open (free in the menu's palette). */
function previewIndex(i: number): number {
  return i <= 32 ? 0x5f + i : 0x2f + (i - 32);
}

const SUGGESTED = ['PROTOTYPE', 'VANGUARD', 'TITAN', 'RAZOR', 'SENTINEL', 'WARDEN', 'NOMAD', 'HAVOC', 'PHANTOM', 'BASTION', 'VIPER',
  'COLOSSUS', 'ZEPHYR', 'ONYX', 'CINDER'];

type Row = 'name' | 'body' | 'head' | 'moves' | 'size' | 'weight' | 'c1' | 'c2' | 'c3' | 'train' | 'fight' | 'file';
const ROWS: Row[] = ['name', 'body', 'head', 'moves', 'size', 'weight', 'c1', 'c2', 'c3', 'train', 'fight', 'file'];
const LABELS: Record<Row, string> = {
  name: 'NAME', body: 'FRAME', head: 'HEAD', moves: 'MOVES', size: 'SIZE', weight: 'WEIGHT', c1: 'COLOR 1', c2: 'COLOR 2',
  c3: 'COLOR 3', train: 'TRY IN TRAINING', fight: 'FIGHT THE COMPUTER', file: 'SAVE FILE',
};

export interface WorkshopHost {
  /** Starts training / a fight with a workshop robot (the page closes). */
  train(slot: number, spec: WorkshopSpec): void;
  fight(slot: number, spec: WorkshopSpec): void;
}

export class WorkshopPage extends Page {
  /** The slot being edited (-1: the list). */
  private slot = -1;
  private sel = 0;
  private row = 0;
  private spec: WorkshopSpec = defaultSpec();
  private preview: Surface | null = null;
  private previewKey = '';
  private dot: Surface | null = null;
  private confirmDelete = false;
  private status = '';

  constructor(private host: WorkshopHost) {
    super();
  }

  override setColors(): void {
    super.setColors();
    this.setPreviewColors();
  }

  /** The picture's color ramps from the robot's three colors (as a pilot's would be). */
  private setPreviewColors(): void {
    const alt = altPalettes()[0];
    // Ramps: 0 tertiary (color 3), 1 secondary (color 2), 2 primary (color 1).
    const src = [this.spec.colors[2], this.spec.colors[1], this.spec.colors[0]];
    for (let i = 1; i < 48; i++) {
      const j = src[i >> 4] * 16 + (i & 15);
      vga.setBaseIndex(previewIndex(i), alt.r(j), alt.g(j), alt.b(j));
    }
    // The game is paused under the page: the live palette is made here.
    vga.render();
  }

  private refreshPreview(): void {
    const key = JSON.stringify([this.spec.body, this.spec.head, this.spec.moves, this.spec.size]);
    if (this.preview && key === this.previewKey) return;
    this.previewKey = key;
    const t = workshopPreview(this.spec);
    const data = new Uint8Array(t.w * t.h);
    for (let k = 0; k < data.length; k++) {
      const v = t.data[k];
      data[k] = v === 0 ? 0 : v < 48 ? previewIndex(v) : v;
    }
    this.preview = new Surface(t.w, t.h, data, 0);
    this.preview.source = { kind: 'generated', key: `workshop/preview/${key}` };
  }

  // ---- input ----

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
    const s = workshopSpecs()[slot];
    this.slot = slot;
    this.spec = s ? { ...s, colors: [...s.colors] as [number, number, number] } : { ...defaultSpec(), name: SUGGESTED[slot % SUGGESTED.length] };
    if (!s) setWorkshopSpec(slot, this.spec);
    this.row = 0;
    this.status = '';
    this.setPreviewColors();
    playMenuSound(20);
  }

  /** The robot changed: stored (it is built again when next used), picture and colors updated. */
  private changed(): void {
    setWorkshopSpec(this.slot, { ...this.spec, colors: [...this.spec.colors] as [number, number, number] });
    this.setPreviewColors();
    playMenuSound(19);
  }

  private step(d: number): void {
    const s = this.spec;
    const wrap = (v: number, n: number) => (v + d + n) % n;
    switch (ROWS[this.row]) {
      case 'name': {
        const i = SUGGESTED.indexOf(s.name);
        s.name = SUGGESTED[wrap(i < 0 ? 0 : i, SUGGESTED.length)];
        break;
      }
      case 'body': s.body = wrap(s.body, PART_NAMES.length); break;
      case 'head': s.head = wrap(s.head, PART_NAMES.length); break;
      case 'moves': s.moves = wrap(s.moves, PART_NAMES.length); break;
      case 'size': s.size = wrap(s.size, SIZE_NAMES.length); break;
      case 'weight': s.weight = wrap(s.weight, WEIGHT_NAMES.length); break;
      case 'c1': s.colors[0] = wrap(s.colors[0], 16); break;
      case 'c2': s.colors[1] = wrap(s.colors[1], 16); break;
      case 'c3': s.colors[2] = wrap(s.colors[2], 16); break;
      default: return;
    }
    this.changed();
  }

  private activate(): void {
    const row = ROWS[this.row];
    if (row === 'train' || row === 'fight') {
      this.status = 'BUILDING...';
      if (!ensureWorkshopRobot(this.slot)) {
        this.status = 'THE ROBOT COULD NOT BE BUILT';
        return;
      }
      playMenuSound(20);
      this.finished = true;
      if (row === 'train') this.host.train(this.slot, this.spec);
      else this.host.fight(this.slot, this.spec);
    } else if (row === 'file') {
      this.exportSpec(this.spec);
    }
  }

  private exportSpec(spec: WorkshopSpec): void {
    const name = `${spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.omfbot`;
    saveFile(name, new TextEncoder().encode(JSON.stringify(spec, null, 2)), 'application/json').then(
      (where) => (this.status = where === name ? `SAVED ${name.toUpperCase()}` : 'SAVED'),
      () => (this.status = 'THE FILE COULD NOT BE SAVED'),
    );
    playMenuSound(20);
  }

  private async importFiles(): Promise<void> {
    const files = await pickFiles('.omfbot,.json');
    let n = 0;
    for (const f of files) {
      try {
        const spec = readSpec(JSON.parse(await f.text()));
        const free = workshopSpecs().findIndex((s) => !s);
        if (!spec || free < 0) continue;
        setWorkshopSpec(free, spec);
        n++;
      } catch {
        // not a robot file
      }
    }
    this.status = n ? `LOADED ${n} ROBOT${n === 1 ? '' : 'S'}` : files.length ? 'NO ROBOT COULD BE LOADED (OR NO FREE SLOT)' : '';
    if (n) toast(`${n} robot${n === 1 ? '' : 's'} added to the workshop.`);
  }

  override action(action: number, _source: CtrlType): number {
    if (this.slot < 0) {
      // The list: eight slots.
      if (action & ACT_UP) this.sel = (this.sel + WORKSHOP_SLOTS - 1) % WORKSHOP_SLOTS;
      else if (action & ACT_DOWN) this.sel = (this.sel + 1) % WORKSHOP_SLOTS;
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
    else if (action & ACT_PUNCH) this.activate();
    if (action & (ACT_UP | ACT_DOWN)) playMenuSound(19);
    return 1;
  }

  override key(code: string): boolean {
    if (this.slot < 0) {
      if (code === 'Delete' || code === 'Backspace') {
        if (!workshopSpecs()[this.sel]) return true;
        if (!this.confirmDelete) {
          this.confirmDelete = true;
          this.status = 'PRESS DELETE AGAIN TO DELETE THIS ROBOT';
        } else {
          setWorkshopSpec(this.sel, null);
          this.confirmDelete = false;
          this.status = 'DELETED';
          playMenuSound(20);
        }
        return true;
      }
      if (code === 'KeyE') {
        const s = workshopSpecs()[this.sel];
        if (s) this.exportSpec(s);
        return true;
      }
      if (code === 'KeyI') {
        void this.importFiles();
        return true;
      }
      return false;
    }
    // Typing a name (on the NAME row).
    if (ROWS[this.row] !== 'name') return false;
    const s = this.spec;
    if (code === 'Backspace') {
      s.name = s.name.slice(0, -1);
    } else {
      const m = /^Key([A-Z])$/.exec(code) ?? /^Digit([0-9])$/.exec(code);
      if (!m) return false;
      s.name = (s.name + m[1]).slice(0, 10);
    }
    setWorkshopSpec(this.slot, { ...s, colors: [...s.colors] as [number, number, number], name: cleanName(s.name || 'ROBOT') });
    return true;
  }

  override pointer(x: number, y: number, kind: PointerKind): boolean {
    if (kind !== 'click') return false;
    if (this.slot < 0) {
      const i = Math.floor((y - 40) / 13);
      if (i >= 0 && i < WORKSHOP_SLOTS && x > 20 && x < 300) {
        if (i === this.sel) this.open(i);
        else this.sel = i;
        return true;
      }
      return false;
    }
    const i = Math.floor((y - 32) / 12);
    if (i >= 0 && i < ROWS.length && x < 180) {
      if (i === this.row) {
        if (i >= ROWS.indexOf('train')) this.activate();
        else this.step(x > 120 ? 1 : -1);
      } else {
        this.row = i;
      }
      return true;
    }
    return false;
  }

  // ---- drawing ----

  private box(x: number, y: number, w: number, h: number, color: number): void {
    this.dot ??= new Surface(1, 1, new Uint8Array([1]), 0);
    video.drawFull(this.dot, x, y, w, h, 0, 0, color - 1, 255, 255, 0, 0);
  }

  override render(): void {
    if (this.slot < 0) this.renderList();
    else this.renderEditor();
  }

  private renderList(): void {
    this.drawFrame('WORKSHOP');
    this.drawText('st', this.status || 'BUILD YOUR OWN ROBOTS FROM THE NEW ROBOTS\' PARTS', 160, 25, FontSize.SMALL,
      this.confirmDelete ? PC.red : PC.dim, HAlign.CENTER);
    const specs = workshopSpecs();
    for (let i = 0; i < WORKSHOP_SLOTS; i++) {
      const s = specs[i];
      const y = 40 + i * 13;
      const sel = i === this.sel;
      if (sel) this.box(22, y - 2, 276, 11, PC.select);
      this.drawText(`n${i}`, `${i + 1}`, 30, y, FontSize.SMALL, PC.dim);
      if (s) {
        this.drawText(`s${i}`, s.name, 44, y, FontSize.BIG, sel ? PC.white : PC.grey);
        const desc = `${PART_NAMES[s.body]} FRAME, ${PART_NAMES[s.moves]} MOVES`;
        this.drawText(`d${i}`, desc, 292, y + 1, FontSize.SMALL, sel ? PC.gold : PC.dim, HAlign.RIGHT);
      } else {
        this.drawText(`s${i}`, 'EMPTY: ENTER BUILDS A NEW ROBOT', 44, y + 1, FontSize.SMALL, sel ? PC.grey : PC.dark);
      }
    }
    this.drawText('h1', 'ENTER BUILD / EDIT   E SAVE FILE   I LOAD FILES', 160, 172, FontSize.SMALL, PC.dim, HAlign.CENTER);
    this.drawText('h2', 'DEL DELETE   ESC BACK', 160, 182, FontSize.SMALL, PC.dim, HAlign.CENTER);
  }

  private renderEditor(): void {
    const s = this.spec;
    this.drawFrame(`WORKSHOP ${this.slot + 1}`);
    const value = (r: Row): string => {
      switch (r) {
        case 'name': return s.name || '_';
        case 'body': return PART_NAMES[s.body];
        case 'head': return PART_NAMES[s.head];
        case 'moves': return PART_NAMES[s.moves];
        case 'size': return SIZE_NAMES[s.size];
        case 'weight': return WEIGHT_NAMES[s.weight];
        default: return '';
      }
    };
    ROWS.forEach((r, i) => {
      const y = 32 + i * 12;
      const sel = i === this.row;
      if (sel) this.box(14, y - 2, 164, 11, PC.select);
      const action = r === 'train' || r === 'fight' || r === 'file';
      this.drawText(`l${i}`, LABELS[r], 20, y, FontSize.SMALL, action ? (sel ? PC.gold : PC.orange) : sel ? PC.white : PC.grey);
      if (r === 'c1' || r === 'c2' || r === 'c3') {
        // A swatch of the ramp (as the robot shows it).
        const ramp = r === 'c1' ? 2 : r === 'c2' ? 1 : 0;
        for (let k = 0; k < 8; k++) this.box(96 + k * 9, y, 8, 7, previewIndex(ramp * 16 + 1 + k * 2));
      } else if (!action) {
        this.drawText(`v${i}`, `< ${value(r)} >`, 96, y, FontSize.SMALL, sel ? PC.gold : PC.white);
      }
    });
    // The robot, as the VS screen will show it.
    this.refreshPreview();
    const p = this.preview!;
    const scale = Math.min(1, 118 / p.h, 124 / p.w);
    const w = Math.round(p.w * scale), h = Math.round(p.h * scale);
    this.box(182, 28, 128, 150, PC.panel);
    video.drawSize(p, 246 - (w >> 1), 176 - h, w, h);
    // Its special moves, top left of the picture.
    const r = workshopRobot(s, harIdOf(this.slot));
    Object.values(r.specialNames).forEach((n, i) => this.drawText(`sp${i}`, n, 186, 32 + i * 8, FontSize.SMALL, PC.cyan));
    const hint = ROWS[this.row] === 'name' ? 'TYPE A NAME, OR < > FOR ONE   ESC LIST' : '< > CHANGE   ENTER CHOOSE   ESC LIST';
    this.drawText('h', this.status || hint, 160, 186, FontSize.SMALL, this.status ? PC.gold : PC.dim, HAlign.CENTER);
  }
}
