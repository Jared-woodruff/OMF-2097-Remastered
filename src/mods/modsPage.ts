// EXTRAS > MODS: the mods that come with the game (the remaster's new robots and arenas, bundled.ts) and the installed
// ones (made with OMF Studio, shared as .omfmod files). ENTER / A turns the selected mod on or off, I installs mod files
// (dropping them on the game does too), E saves the selected one as a file, DELETE removes an installed one (press
// twice). The engine keeps what it loaded, so changes play from the next start: R restarts the game.
import type { PointerKind } from '../controller/mouse';
import { ACT_DOWN, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_UP, type CtrlType } from '../game/constants';
import { Painter } from '../game/gui/painter';
import { Page, PAGE_ACTIVE, PAGE_NORMAL, PC } from '../game/gui/page';
import { FontSize, GLYPH_SHADOW_BOTTOM, GLYPH_SHADOW_RIGHT, HAlign, Text } from '../game/gui/text';
import { playMenuSound } from '../game/gui/widgets';
import { pickFiles, saveFile } from '../platform/files';
import { toast } from '../platform/toast';
import { APP_VERSION } from '../platform/versionLabel';
import { video } from '../video/draw';
import type { Surface } from '../video/surface';
import { bundledEnabled, bundledMods, fetchBundled, setBundledEnabled, type BundledMod } from './bundled';
import { MOD_EXTENSION, readModPackage, type ModPackage } from './package';
import { modState } from './registry';
import { installMod, listMods, removeMod, setModEnabled, type InstalledMod } from './store';
import { ModError } from './types';

const ROW_Y = 36;
const ROW_H = 10;
const ROWS = 6;
/** The longest line that fits the frame (small font). */
const LINE = 46;

/** A mod on the page: an installed one, or one that comes with the game (`bundled`: it has no record, its package is fetched when needed). */
interface ModRow extends Omit<InstalledMod, 'bytes'> {
  bytes: Uint8Array | null;
  bundled: BundledMod | null;
}

/** Rows of the selected mod's description. */
const DESC_ROWS = 3;

/** A description cut to what the page shows (DESC_ROWS rows of the small font), ending with "..." when it goes on. */
function fitted(text: string): string {
  const rows = new Text(FontSize.SMALL, 284, 0xffff, text).lines();
  if (rows.length <= DESC_ROWS) return text;
  return `${rows.slice(0, DESC_ROWS).map((r) => r.str).join('').trimEnd().slice(0, -3).trimEnd()}...`;
}

/** A mod's content and whether it can be played (its package read again). */
interface Details {
  pkg: ModPackage | null;
  error: string | null;
}

/** Installs mod files (from the file picker or dropped on the game); the result for the player. */
export async function installModFiles(files: File[]): Promise<{ installed: string[]; errors: string[] }> {
  const installed: string[] = [], errors: string[] = [];
  for (const f of files) {
    try {
      const pkg = await installMod(new Uint8Array(await f.arrayBuffer()));
      installed.push(pkg.manifest.name);
    } catch (err) {
      errors.push(`${f.name}: ${err instanceof ModError ? err.message : 'it could not be installed.'}`);
    }
  }
  return { installed, errors };
}

export class ModsPage extends Page {
  private list: ModRow[] | null = null;
  private sel = 0;
  private top = 0;
  private status = '';
  private statusBad = false;
  private confirmDelete = false;
  private busy = false;
  /** Something changed that plays from the next start. */
  private changed = false;
  private bar: Surface | null = null;
  private details = new Map<string, Details>();
  private descText = new Text(FontSize.SMALL, 284, 24, '').setColor(PC.grey).setShadowColor(PC.shadow)
    .setShadow(GLYPH_SHADOW_RIGHT | GLYPH_SHADOW_BOTTOM);

  override onOpen(): void {
    void this.reload();
  }

  private async reload(keepId?: string): Promise<void> {
    const installed = await listMods();
    // (the ones that come with the game first, unless a version of one is installed)
    const bundled = (await bundledMods()).filter((b) => !installed.some((m) => m.id === b.id));
    this.list = [
      ...bundled.map((b): ModRow => ({
        id: b.id, name: b.name, version: b.version, author: b.author, description: b.description, enabled: bundledEnabled(b.id), bytes: null,
        installed: 0, bundled: b,
      })),
      ...installed.map((m): ModRow => ({ ...m, bundled: null })),
    ];
    if (keepId !== undefined) {
      const i = this.list.findIndex((m) => m.id === keepId);
      if (i >= 0) this.sel = i;
    }
    this.sel = Math.max(0, Math.min(this.sel, this.list.length - 1));
    this.scrollToSelection();
    void this.loadDetails();
  }

  /** Reads the selected mod's package (its content names, and whether this game can play it). */
  private async loadDetails(): Promise<void> {
    const m = this.chosen();
    // (one that comes with the game: its list names its content)
    if (!m?.bytes || this.details.has(`${m.id}@${m.installed}`)) return;
    const key = `${m.id}@${m.installed}`;
    this.details.set(key, { pkg: null, error: null });
    try {
      this.details.set(key, { pkg: await readModPackage(m.bytes, APP_VERSION), error: null });
    } catch (err) {
      this.details.set(key, { pkg: null, error: err instanceof ModError ? err.message : 'It cannot be read.' });
    }
  }

  private scrollToSelection(): void {
    if (this.sel < this.top) this.top = this.sel;
    if (this.sel >= this.top + ROWS) this.top = this.sel - ROWS + 1;
    this.top = Math.max(0, this.top);
  }

  private chosen(): ModRow | null {
    return this.list?.[this.sel] ?? null;
  }

  private say(text: string, bad = false): void {
    this.status = text;
    this.statusBad = bad;
  }

  private move(d: number): void {
    if (!this.list?.length) return;
    const n = Math.max(0, Math.min(this.list.length - 1, this.sel + d));
    if (n !== this.sel) playMenuSound(19);
    this.sel = n;
    this.confirmDelete = false;
    this.scrollToSelection();
    void this.loadDetails();
  }

  /** What becomes of a mod: playing now, from the next start, or why it cannot be played (`reason`). */
  private state(m: ModRow): { text: string; color: number; reason?: string } {
    const s = modState(m.id);
    const d = this.details.get(`${m.id}@${m.installed}`);
    const loadedNow = !!s?.loaded;
    if (d?.error) return { text: 'IT CANNOT BE PLAYED', color: PC.red, reason: d.error };
    if (m.enabled && s?.error && !this.changed) return { text: 'IT COULD NOT BE LOADED', color: PC.red, reason: s.error };
    if (m.enabled && loadedNow) return { text: 'ON: PLAYING NOW', color: PC.green };
    if (m.enabled) return { text: 'ON FROM THE NEXT START (R RESTARTS)', color: PC.gold };
    if (loadedNow) return { text: 'OFF FROM THE NEXT START (R RESTARTS)', color: PC.gold };
    return { text: 'OFF', color: PC.dim };
  }

  private async toggle(): Promise<void> {
    const m = this.chosen();
    if (!m || this.busy) return;
    if (m.bundled) setBundledEnabled(m.id, !m.enabled);
    else await setModEnabled(m.id, !m.enabled);
    m.enabled = !m.enabled;
    this.changed = true;
    this.say(`${m.name.toUpperCase()} IS ${m.enabled ? 'ON' : 'OFF'} FROM THE NEXT START`);
    playMenuSound(20);
  }

  private async importFiles(): Promise<void> {
    const files = await pickFiles(`${MOD_EXTENSION},.zip`);
    if (!files.length) return;
    this.busy = true;
    const { installed, errors } = await installModFiles(files);
    this.busy = false;
    if (installed.length) this.changed = true;
    if (errors.length) this.say(errors[0].toUpperCase(), true);
    else this.say(installed.length === 1 ? `INSTALLED ${installed[0].toUpperCase()}` : `INSTALLED ${installed.length} MODS`);
    await this.reload();
  }

  private exportSelected(): void {
    const m = this.chosen();
    if (!m || this.busy) return;
    const name = `${m.id}${MOD_EXTENSION}`;
    const bytes = m.bytes ? Promise.resolve(m.bytes) : fetchBundled(m.bundled!);
    bytes.then((data) => saveFile(name, data)).then(
      (where) => {
        this.say(`SAVED ${name.toUpperCase()}`);
        if (where !== name) toast(`Saved ${where}`, 5000);
      },
      () => this.say('THE FILE COULD NOT BE SAVED', true),
    );
    playMenuSound(20);
  }

  private async deleteSelected(): Promise<void> {
    const m = this.chosen();
    if (!m) return;
    if (m.bundled) {
      this.say('IT COMES WITH THE GAME: TURN IT OFF INSTEAD', true);
      return;
    }
    if (!this.confirmDelete) {
      this.confirmDelete = true;
      this.say(`PRESS DELETE AGAIN TO REMOVE ${m.name.toUpperCase()}`, true);
      return;
    }
    this.confirmDelete = false;
    await removeMod(m.id);
    if (modState(m.id)?.loaded) this.changed = true;
    this.say(`REMOVED ${m.name.toUpperCase()}`);
    playMenuSound(20);
    await this.reload();
  }

  override back(): boolean {
    if (this.confirmDelete) {
      this.confirmDelete = false;
      this.say('');
      return true;
    }
    return false;
  }

  override action(action: number, _source: CtrlType): number {
    if (action & ACT_UP) this.move(-1);
    else if (action & ACT_DOWN) this.move(1);
    else if (action & ACT_LEFT) this.move(-ROWS);
    else if (action & ACT_RIGHT) this.move(ROWS);
    else if (action & (ACT_PUNCH | ACT_KICK)) void this.toggle();
    return 1;
  }

  override key(code: string): boolean {
    switch (code) {
      case 'KeyI': void this.importFiles(); return true;
      case 'KeyE': this.exportSelected(); return true;
      case 'KeyR': location.reload(); return true;
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
    this.drawFrame('MODS');
    const list = this.list;
    if (!list) {
      this.drawText('st', 'LOADING...', 160, 24, FontSize.SMALL, PC.dim, HAlign.CENTER);
      return;
    }
    const on = list.filter((m) => m.enabled).length;
    const head = this.busy ? 'INSTALLING...' : this.status || (list.length
      ? `${list.length} MOD${list.length === 1 ? '' : 'S'}, ${on} ON`
      : 'NO MODS YET: I INSTALLS A MOD FILE (OR DROP IT ON THE GAME)');
    this.drawText('st', head, 160, 24, FontSize.SMALL, this.statusBad || this.confirmDelete ? PC.red : PC.dim, HAlign.CENTER);

    if (!this.bar) {
      const p = new Painter(292 * 4, (ROW_H - 1) * 4);
      p.roundRect(0, 0, 292 * 4, (ROW_H - 1) * 4, 6, PC.select);
      this.bar = p.toSurface('mods/bar');
      this.bar.renderW = 292;
      this.bar.renderH = ROW_H - 1;
    }
    for (let row = 0; row < ROWS; row++) {
      const i = this.top + row;
      const m = list[i];
      if (!m) break;
      const y = ROW_Y + row * ROW_H;
      const sel = i === this.sel;
      if (sel) video.drawSize(this.bar, 14, y - 2, 292, ROW_H - 1);
      this.drawText('on', m.enabled ? 'ON' : 'OFF', 18, y, FontSize.SMALL, m.enabled ? PC.green : PC.dim);
      const nv = `${m.name.toUpperCase()}  ${m.version}`.slice(0, 26);
      this.drawText('n', nv, 42, y, FontSize.SMALL, sel ? PAGE_ACTIVE : PAGE_NORMAL);
      // (the author in the room the name leaves; one that comes with the game says so)
      const by = m.bundled ? 'WITH THE GAME' : m.author.toUpperCase();
      if (by) this.drawText('a', by.slice(0, Math.max(8, LINE - 6 - nv.length)), 300, y, FontSize.SMALL, sel ? PC.white : m.bundled ? PC.gold : PC.grey, HAlign.RIGHT);
    }
    if (list.length > ROWS) {
      this.drawText('more', `${this.top + 1}-${Math.min(list.length, this.top + ROWS)} OF ${list.length}`, 300, 24,
        FontSize.SMALL, PC.dim, HAlign.RIGHT);
    }

    // The selected mod: what it adds, its description and what becomes of it.
    const m = this.chosen();
    if (m) {
      const d = this.details.get(`${m.id}@${m.installed}`);
      const pkg = d?.pkg;
      const names = m.bundled ?? (pkg && {
        robots: pkg.robots.map((r) => r.info.name), arenas: pkg.arenas.map((a) => a.info.name), pilots: pkg.pilots.map((p) => p.info.name),
      });
      if (names) {
        const lines = [
          names.robots.length ? `ROBOTS: ${names.robots.join(', ')}` : '',
          names.arenas.length ? `ARENAS: ${names.arenas.join(', ')}` : '',
          names.pilots.length ? `PILOTS: ${names.pilots.join(', ')}` : '',
        ].filter(Boolean);
        lines.forEach((l, i) => this.drawText(`c${i}`, l.length > LINE ? `${l.slice(0, LINE - 3)}...` : l, 18, 100 + i * 8, FontSize.SMALL, PC.cyan));
      }
      const st = this.state(m);
      this.descText.set(fitted(st.reason ? st.reason.toUpperCase() : m.description || '')).setColor(st.reason ? PC.red : PC.grey);
      this.descText.draw(18, 128);
      this.drawText('s', st.text.slice(0, LINE), 160, 158, FontSize.SMALL, st.color, HAlign.CENTER);
    }
    this.drawText('h1', 'ENTER ON/OFF   I INSTALL   E SAVE FILE', 160, 172, FontSize.SMALL, PC.dim, HAlign.CENTER);
    this.drawText('h2', 'DEL REMOVE   R RESTART   ESC BACK', 160, 182, FontSize.SMALL, this.changed ? PC.gold : PC.dim, HAlign.CENTER);
  }
}
