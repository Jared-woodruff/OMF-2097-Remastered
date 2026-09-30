// OMF Studio's window: the start screen (new, open, recent projects) and the workspace (the mod and its robots, arenas
// and pilots on the left, the selected one's page on the right), with the project's state and actions on top: whether
// the game can play it (the checks), build the mod file, install it in the game, test it in a fight. Projects save
// themselves as they change.
import { installMod, setTestMod } from '../mods/store';
import { MOD_EXTENSION, readModPackage } from '../mods/package';
import { buildSampleMod } from '../mods/sample';
import { ModError } from '../mods/types';
import { saveFile } from '../platform/files';
import { APP_VERSION } from '../platform/versionLabel';
import { writeModPackage } from '../mods/package';
import { projectProblems, type Problem, type Target } from './checks';
import { confirmDialog, fill, h, icon, modal, pickFiles, toast, type IconName } from './dom';
import { modHome, problemList } from './home';
import { buildProject, newProject, openPackage, projectFromPackage, type Project } from './project';
import { History } from './history';
import { deleteProject, listProjects, loadProject, saveProject } from './storage';
import { robotEditor } from './robot/robotEditor';
import { newRobotDialog } from './robot/newRobot';
import { arenaEditor, newArenaDialog } from './arena/arenaEditor';
import { newPilotDialog, pilotEditor } from './pilot/pilotEditor';
import { extrasPackage } from './extras';
import { testFight } from './test';
import { A, contentPicture, hero, timeAgo, type ContentKind } from './ui';

export type Selection = Target;

/** What an editor gives back: its element, what to do when it is closed, and how it shows other colors. */
export interface Editor {
  el: HTMLElement;
  close?(): void;
  /** The preview colors changed (without it the editor is made again). */
  recolor?(): void;
  /** Where it is (the move, animation or tab: Selection's `move`), to open it there again (after an undo). */
  where?(): number | undefined;
}

export class StudioApp {
  project: Project | null = null;
  sel: Selection = { kind: 'mod' };
  /** The pilot colors robots are shown in (primary, secondary, tertiary: the game's color choices 0-15). */
  colors: [number, number, number] = [5, 11, 8];
  private saveTimer = 0;
  private editor: Editor | null = null;
  /** Undo and redo (history.ts), and their buttons. */
  private history = new History();
  private undoButton = h('button', { class: 'btn icon ghost', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', onclick: () => this.undo() }, icon('undo'));
  private redoButton = h('button', { class: 'btn icon ghost', title: 'Redo (Ctrl+Y)', 'aria-label': 'Redo', onclick: () => this.redo() }, icon('redo'));
  private sidebar = h('div', { class: 'sidebar' });
  private content = h('div', { class: 'content' });
  private statusChip = h('button', { class: 'status-chip', onclick: () => this.showChecks(), title: 'What the game needs to play the mod (the checks)' });
  private saveState = h('span', { class: 'save-state' });
  private crumbs = h('div', { class: 'crumbs' });
  /** The mod's name in the list (kept up to date as it is typed). */
  private homeName = h('b');
  /** The list's marks of what has something to fix, by "kind:index". */
  private marks = new Map<string, HTMLElement>();
  /** The page's parts that show what the checks say (they hear of every change). */
  private statusListeners: ((problems: Problem[]) => void)[] = [];

  constructor(private root: HTMLElement) {
    window.addEventListener('beforeunload', () => {
      if (this.saveTimer) void this.saveNow();
    });
    // Mod files dropped on Studio open as projects.
    window.addEventListener('dragover', (e) => e.dataTransfer?.types.includes('Files') && e.preventDefault());
    window.addEventListener('drop', (e) => {
      const f = Array.from(e.dataTransfer?.files ?? []).find((x) => x.name.toLowerCase().endsWith(MOD_EXTENSION));
      if (!f) return;
      e.preventDefault();
      void this.openFile(f);
    });
    document.addEventListener('keydown', (e) => this.key(e));
    void this.showStart();
  }

  /**
   * Ctrl+S saves now (Studio saves as it goes anyway); Ctrl+Z and Ctrl+Y (or Ctrl+Shift+Z) undo and redo, unless a text
   * field or a dialog (the pixel editor has its own) has them; Enter or Space chooses the row, tab or choice that has
   * the focus.
   */
  private key(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    // (a dialog open: only what is in it; the pixel editor's Space moves its view)
    const dialogs = document.querySelectorAll('.modal-back');
    const dialog = dialogs[dialogs.length - 1];
    const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey;
    if (ctrl && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (this.project) void this.flush().then(() => toast('Saved. Studio saves as you work; Build file makes the mod file to share.'));
      return;
    }
    const typing = !!t && (t.tagName === 'TEXTAREA' || t.isContentEditable || (t.tagName === 'INPUT' && /^(text|number|search|)$/.test((t as HTMLInputElement).type)));
    if (ctrl && this.project && !dialog && !typing && ['z', 'y'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      if (e.key.toLowerCase() === 'y' || e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && t?.getAttribute?.('role') === 'button' && t.tagName === 'DIV' && (!dialog || dialog.contains(t))) {
      e.preventDefault();
      t.click();
    }
  }

  // ---- start screen --------------------------------------------------------------------------------------------

  async showStart(): Promise<void> {
    await this.flush();
    this.editor?.close?.();
    this.editor = null;
    this.project = null;
    this.statusListeners = [];
    const recent = await listProjects();
    this.root.classList.remove('ws');
    const choice = (ic: IconName, title: string, text: string, onclick: () => void) =>
      h('div', { class: 'choice', onclick }, icon(ic), h('b', null, title), h('span', null, text));
    const step = (n: string, title: string, text: string) => h('div', { class: 'step' }, h('div', { class: 'n' }, n), h('b', null, title), h('span', null, text));
    fill(this.root, h('div', { class: 'start' }, h('div', { class: 'inner' },
      hero('Make robots, arenas and pilots for One Must Fall 2097 Remastered, pixel for pixel in the game\'s own formats, and play them in the game.'),
      h('div', { class: 'choices big' },
        choice('plus', 'NEW MOD', 'Start an empty mod, then add robots, arenas and pilots to it.', () => this.open(newProject())),
        choice('folder', 'OPEN A MOD FILE', `Change a mod: open its ${MOD_EXTENSION} file, or drop it here.`, () => void this.openPicked()),
        choice('sample', 'OPEN THE SAMPLE', 'A mod with a robot, an arena and a pilot, to see how one is made.', () => void this.openSample()),
        choice('robot', 'THE NEW ROBOTS AND ARENAS', 'The remaster\'s four robots and four arenas are a mod like any other: open a copy of ' +
          'it to see how they are made, or to change them.', () => void this.openExtras())),
      recent.length ? [h('div', { class: 'section-title' }, 'CONTINUE'), h('div', { class: 'recent' }, recent.map((r) => h('div', {
        class: 'item', title: `Open ${r.name}`, onclick: () => void this.openStored(r.key),
      },
      icon('folder'),
      h('span', { class: 'name' }, r.name || '(no name)'),
      h('span', { class: 'sub', title: new Date(r.updated).toLocaleString() }, `saved ${timeAgo(r.updated)}`),
      h('button', {
        class: 'btn small ghost icon', title: 'Delete this project', 'aria-label': 'Delete this project', onclick: async (e: Event) => {
          e.stopPropagation();
          if (await confirmDialog('Delete project', `Delete "${r.name}"? Its mod file, if you built one, stays.`, 'Delete', true)) {
            await deleteProject(r.key);
            void this.showStart();
          }
        },
      }, icon('trash')))))] : null,
      h('div', { class: 'section-title' }, 'HOW IT WORKS'),
      h('div', { class: 'steps' },
        step('01', 'Make', 'Robots, arenas and pilots: copy one of the game\'s, build one, or draw your own.'),
        step('02', 'Test', 'Play them in the real game, right from Studio, as often as you like.'),
        step('03', 'Share', 'Install the mod in the game, or build its file to give to others.')),
      h('p', { class: 'foot' }, `OMF Studio ${APP_VERSION}. Projects are kept on this computer as you work.`))));
  }

  private async openPicked(): Promise<void> {
    const [f] = await pickFiles(`${MOD_EXTENSION},.zip`);
    if (f) await this.openFile(f);
  }

  async openFile(f: File): Promise<void> {
    try {
      this.open(await openPackage(new Uint8Array(await f.arrayBuffer())));
      this.scheduleSave();
    } catch (err) {
      toast(err instanceof ModError ? err.message : `The file could not be opened: ${(err as Error)?.message ?? err}`, true, 6000);
    }
  }

  private async openSample(): Promise<void> {
    try {
      const pkg = await buildSampleMod(await extrasPackage());
      const p = projectFromPackage(await readModPackage(await writeModPackage(pkg)));
      p.manifest.id = 'me.sample-copy';
      p.manifest.name = 'Sample mod (copy)';
      this.open(p);
      this.scheduleSave();
    } catch (err) {
      toast(`The sample could not be made: ${(err as Error)?.message ?? err}`, true, 6000);
    }
  }

  /** A copy of the new robots and arenas' mod (the one that comes with the game), to see how it is made or change it. */
  private async openExtras(): Promise<void> {
    try {
      toast('Opening the new robots and arenas…');
      const p = projectFromPackage(await extrasPackage());
      p.manifest.id = 'me.new-robots-and-arenas';
      p.manifest.name = 'New robots and arenas (copy)';
      this.open(p);
      this.scheduleSave();
    } catch (err) {
      toast(`The new robots and arenas could not be opened: ${(err as Error)?.message ?? err}`, true, 6000);
    }
  }

  private async openStored(key: string): Promise<void> {
    try {
      const p = await loadProject(key);
      if (p) this.open(p);
    } catch (err) {
      toast(err instanceof ModError ? err.message : 'The project could not be opened.', true);
    }
  }

  // ---- workspace -----------------------------------------------------------------------------------------------

  open(p: Project): void {
    this.project = p;
    this.sel = { kind: 'mod' };
    this.history.reset(p);
    this.updateUndo();
    const top = h('div', { class: 'topbar' },
      h('div', { class: 'brand', onclick: () => void this.showStart(), title: 'Back to the start screen (every project)' },
        h('span', { class: 'chrome' }, 'OMF'), h('b', null, 'STUDIO')),
      this.crumbs,
      h('span', { class: 'undo-redo' }, this.undoButton, this.redoButton),
      this.saveState,
      this.statusChip,
      h('span', { class: 'divider' }),
      h('button', { class: 'btn', onclick: () => void this.build(), title: `Save the mod as a ${MOD_EXTENSION} file to share` }, icon('box'), 'Build file'),
      h('button', { class: 'btn primary', onclick: () => void this.install(), title: 'Install the mod in the game on this computer' }, icon('install'), 'Install in game'),
      h('button', { class: 'btn go', onclick: () => void this.test(), title: 'Play the mod in the game now' }, '▶ Test'));
    this.root.classList.add('ws');
    fill(this.saveState);
    fill(this.root, top, h('div', { class: 'workspace' }, this.sidebar, this.content));
    this.refresh();
  }

  /** Redraws the list and the page (after the selection or the project's structure changed). */
  refresh(): void {
    this.renderSidebar();
    this.renderEditor();
    this.updateTitle();
  }

  /** What the checks say, everywhere it shows: the top bar, the list's marks, the page's parts that listen. */
  private updateTitle(): void {
    const p = this.project;
    if (!p) return;
    const problems = projectProblems(p);
    const errors = problems.filter((x) => x.level === 'error');
    this.statusChip.className = `status-chip ${errors.length ? 'bad' : 'ok'}`;
    fill(this.statusChip, errors.length ? [icon('alert'), `${errors.length} to fix`] : [icon('check'), 'Ready to play']);
    fill(this.homeName, p.manifest.name || '(no name)');
    const s = this.sel;
    const here = s.kind === 'robot' ? p.robots[s.index] : s.kind === 'arena' ? p.arenas[s.index] : s.kind === 'pilot' ? p.pilots[s.index] : null;
    fill(this.crumbs, h('a', { onclick: () => this.select({ kind: 'mod' }), title: 'The mod\'s page' }, p.manifest.name || '(no name)'),
      here ? [h('span', { class: 'sep' }, '›'), h('span', { class: 'here' }, here.info.name || here.id)] : null);
    this.markProblems(problems);
    for (const fn of this.statusListeners) fn(problems);
  }

  /** Marks in the list what has something to fix. */
  private markProblems(problems: Problem[]): void {
    const bad = new Set(problems.filter((x) => x.level === 'error' && 'index' in x.target)
      .map((x) => `${x.target.kind}:${(x.target as { index: number }).index}`));
    for (const [k, mark] of this.marks) mark.hidden = !bad.has(k);
  }

  /** Calls `fn` with what the checks say now and after every change, while the page shows. */
  onStatus(fn: (problems: Problem[]) => void): void {
    this.statusListeners.push(fn);
    if (this.project) fn(projectProblems(this.project));
  }

  /** Shows in `el` what the checks say about one robot, arena or pilot. */
  watchStatus(el: HTMLElement, kind: ContentKind, index: number): void {
    this.onStatus((problems) => {
      const mine = problems.filter((x) => x.target.kind === kind && 'index' in x.target && x.target.index === index);
      const errors = mine.filter((x) => x.level === 'error').length, notes = mine.length - errors;
      fill(el, errors ? h('span', { class: 'badge bad', title: 'See the checks', onclick: () => this.showChecks() }, `${errors} to fix`)
        : notes ? h('span', { class: 'badge warn', title: 'See the checks', onclick: () => this.showChecks() }, `${notes} note${notes === 1 ? '' : 's'}`)
          : h('span', { class: 'badge ok' }, '✓ Ready'));
    });
  }

  select(sel: Selection): void {
    this.sel = sel;
    this.refresh();
  }

  private renderSidebar(): void {
    const p = this.project!;
    const is = (k: Selection['kind'], i = -1) => this.sel.kind === k && (i < 0 || ('index' in this.sel && this.sel.index === i));
    this.marks.clear();
    const item = (kind: ContentKind, index: number, name: string) => {
      const pic = contentPicture(this, kind, index);
      const mark = h('span', { class: 'dot', title: 'Something to fix (see the checks)' });
      this.marks.set(`${kind}:${index}`, mark);
      return h('div', { class: `item${is(kind, index) ? ' sel' : ''}`, title: name, onclick: () => this.select({ kind, index }) },
        h('span', { class: `thumb${pic.cover ? ' cover' : ''}` }, pic.el), h('span', { class: 'name' }, name), mark);
    };
    const section = (title: string, kind: ContentKind, names: string[], add: () => void) => [
      h('h3', { title }, icon(kind), h('span', { class: 'label' }, title), h('span', { class: 'count' }, String(names.length)),
        h('button', { class: 'btn small', onclick: add, title: `Add ${A[kind]} to the mod` }, '+', h('span', { class: 'label' }, ' Add'))),
      names.length ? names.map((name, i) => item(kind, i, name))
        : h('div', { class: 'item add', title: `Add ${A[kind]}`, onclick: add }, icon('plus'), h('span', { class: 'name' }, `Add ${A[kind]}`)),
    ];
    fill(this.sidebar,
      h('div', { class: `home-item${is('mod') ? ' sel' : ''}`, title: 'The mod\'s page: what it needs, what it holds, its details', onclick: () => this.select({ kind: 'mod' }) },
        icon('home'), h('div', { class: 't' }, h('small', null, 'Mod'), this.homeName)),
      section('ROBOTS', 'robot', p.robots.map((r) => r.info.name || r.id), () => void this.addRobot()),
      section('ARENAS', 'arena', p.arenas.map((a) => a.info.name || a.id), () => void this.addArena()),
      section('PILOTS', 'pilot', p.pilots.map((pl) => pl.info.name || pl.id), () => void this.addPilot()));
    this.markProblems(projectProblems(p));
  }

  private renderEditor(): void {
    this.editor?.close?.();
    this.editor = null;
    this.statusListeners = [];
    const p = this.project!;
    const s = this.sel;
    let ed: Editor | null = null;
    if (s.kind === 'robot' && p.robots[s.index]) ed = robotEditor(this, p.robots[s.index], s.move);
    else if (s.kind === 'arena' && p.arenas[s.index]) ed = arenaEditor(this, p.arenas[s.index], s.move);
    else if (s.kind === 'pilot' && p.pilots[s.index]) ed = pilotEditor(this, p.pilots[s.index], s.move);
    else ed = { el: modHome(this) };
    this.editor = ed;
    fill(this.content, ed.el);
    this.content.scrollTop = 0;
  }

  /** The checks: everything the game needs to play the mod, and what it makes up for. */
  showChecks(): void {
    const list = projectProblems(this.project!);
    void modal<void>((close) => h('div', { class: 'modal', style: { width: '660px' } },
      h('h2', null, 'Checks'),
      list.length ? [h('p', { class: 'muted' }, 'Red: the game cannot play the mod until it is fixed. Yellow: the game makes up for it. Click one to go there.'),
        problemList(this, list, () => close(null))]
        : h('p', null, h('span', { class: 'badge ok' }, '✓ Nothing to fix: the game can play this mod.')),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close(null) }, 'Close'))));
  }

  // ---- adding content --------------------------------------------------------------------------------------------

  async addRobot(): Promise<void> {
    const r = await newRobotDialog(this);
    if (!r) return;
    this.project!.robots.push(r);
    this.changed();
    this.select({ kind: 'robot', index: this.project!.robots.length - 1 });
    // (a copy of one of the new robots comes with its painted pictures)
    if (r.info.workshop && !r.hd?.sprites.size) toast('Its HD pictures can be rendered from its 3D model: HD ARTWORK, on its overview.', false, 6000);
  }

  async addArena(): Promise<void> {
    const a = await newArenaDialog(this);
    if (!a) return;
    this.project!.arenas.push(a);
    this.changed();
    this.select({ kind: 'arena', index: this.project!.arenas.length - 1 });
  }

  async addPilot(): Promise<void> {
    const pl = await newPilotDialog(this);
    if (!pl) return;
    this.project!.pilots.push(pl);
    this.changed();
    this.select({ kind: 'pilot', index: this.project!.pilots.length - 1 });
  }

  /** Removes the selected robot, arena or pilot (asks first). */
  async removeSelected(): Promise<void> {
    const p = this.project!, s = this.sel;
    if (s.kind === 'mod') return;
    const list = s.kind === 'robot' ? p.robots : s.kind === 'arena' ? p.arenas : p.pilots;
    const item = list[s.index];
    if (!item || !(await confirmDialog('Remove', `Remove ${item.info.name || item.id} from the mod?`, 'Remove', true))) return;
    list.splice(s.index, 1);
    this.changed();
    this.select({ kind: 'mod' });
  }

  // ---- saving, building, testing ---------------------------------------------------------------------------------

  /** The project changed: it is saved a moment later (and can be undone). `structure`: the sidebar and titles change too. */
  changed(structure = true): void {
    if (!this.project) return;
    this.history.changed(this.project);
    this.updateUndo();
    this.scheduleSave();
    if (structure) this.renderSidebar();
    this.updateTitle();
  }

  /** Saves the project a moment later. */
  private scheduleSave(): void {
    fill(this.saveState, icon('clock'), 'Saving…');
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.saveNow(), 1200);
  }

  /** Goes back one step (the page stays where it is, if what it shows is still there). */
  undo(): void {
    const p = this.history.undo();
    if (p) this.restore(p, 'Undone');
    else toast('Nothing to undo.');
  }

  /** Goes forward again one step that was undone. */
  redo(): void {
    const p = this.history.redo();
    if (p) this.restore(p, 'Redone');
    else toast('Nothing to redo.');
  }

  private restore(p: Project, what: string): void {
    const where = this.editor?.where?.();
    const scroll = this.content.querySelector('.ed-body')?.scrollTop ?? this.content.scrollTop;
    this.project = p;
    const s = this.sel;
    if (s.kind !== 'mod') {
      const list: unknown[] = s.kind === 'robot' ? p.robots : s.kind === 'arena' ? p.arenas : p.pilots;
      this.sel = s.index < list.length ? { kind: s.kind, index: s.index, move: where } : { kind: 'mod' };
    }
    this.refresh();
    const body = this.content.querySelector('.ed-body');
    if (body) body.scrollTop = scroll;
    else this.content.scrollTop = scroll;
    this.updateUndo();
    this.scheduleSave();
    toast(what, false, 1200);
  }

  private updateUndo(): void {
    this.undoButton.disabled = !this.history.canUndo;
    this.redoButton.disabled = !this.history.canRedo;
  }

  private async saveNow(): Promise<void> {
    this.saveTimer = 0;
    const p = this.project;
    if (!p) return;
    try {
      await saveProject(p);
      this.saveState.title = `Saved at ${new Date().toLocaleTimeString()} (on this computer)`;
      fill(this.saveState, icon('check'), 'Saved');
    } catch (err) {
      this.saveState.title = '';
      fill(this.saveState, h('span', { style: { color: 'var(--bad)' } }, `Not saved: ${(err as Error)?.message ?? err}`));
    }
  }

  /** Saves now if a save is pending. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      await this.saveNow();
    }
  }

  /** The mod's file, checked like the game checks it (null after telling what is wrong). */
  private async checkedBuild(): Promise<Uint8Array | null> {
    const p = this.project!;
    const errors = projectProblems(p).filter((x) => x.level === 'error');
    if (errors.length) {
      this.showChecks();
      return null;
    }
    try {
      const bytes = await buildProject(p);
      await readModPackage(bytes, APP_VERSION);
      return bytes;
    } catch (err) {
      toast(err instanceof ModError ? err.message : `The mod could not be built: ${(err as Error)?.message ?? err}`, true, 6000);
      return null;
    }
  }

  async build(): Promise<void> {
    const bytes = await this.checkedBuild();
    if (!bytes) return;
    const name = `${this.project!.manifest.id}${MOD_EXTENSION}`;
    try {
      const where = await saveFile(name, bytes);
      toast(`Built ${where}`);
    } catch {
      toast('The file could not be saved.', true);
    }
  }

  async install(): Promise<void> {
    const bytes = await this.checkedBuild();
    if (!bytes) return;
    try {
      await installMod(bytes);
      toast(`${this.project!.manifest.name} is installed: it plays the next time the game starts (EXTRAS > MODS turns it on or off).`, false, 6000);
    } catch (err) {
      toast(err instanceof ModError ? err.message : 'The mod could not be installed.', true);
    }
  }

  /** Tests the mod in the game (`prefer`: a robot, arena or pilot of it chosen for the test). */
  async test(prefer?: { kind: ContentKind; index: number }): Promise<void> {
    const bytes = await this.checkedBuild();
    if (!bytes) return;
    await setTestMod(bytes);
    const p = this.project!;
    const list = prefer ? (prefer.kind === 'robot' ? p.robots : prefer.kind === 'arena' ? p.arenas : p.pilots) : [];
    const id = prefer && list[prefer.index]?.id;
    void testFight(this, p, prefer && id ? { [prefer.kind]: `mod:${id}` } : {});
  }

  // ---- shared helpers for the editors ---------------------------------------------------------------------------

  /** Sets the colors robots are shown in (the sidebar and the editor redraw). */
  setColors(c: [number, number, number]): void {
    this.colors = c;
    this.renderSidebar();
    if (this.editor?.recolor) this.editor.recolor();
    else this.renderEditor();
  }

  /** Opens a project that was built from a file (drag and drop, open). */
  async openBytes(bytes: Uint8Array): Promise<void> {
    this.open(await openPackage(bytes));
  }

  /** Whether the selection is a given robot (editors use it to stay put while redrawing). */
  isSelected(kind: Selection['kind'], index: number): boolean {
    return this.sel.kind === kind && 'index' in this.sel && this.sel.index === index;
  }
}
