// OMF Studio's window: the start screen (new, open, recent projects) and the workspace (the project's robots, arenas
// and pilots on the left, the selected one's editor on the right), with the project's actions on top: build the mod
// file, install it in the game, test it in a fight. Projects save themselves as they change.
import { installMod, setTestMod } from '../mods/store';
import { MOD_EXTENSION, readModPackage } from '../mods/package';
import { buildSampleMod } from '../mods/sample';
import { ModError, ID_PATTERN } from '../mods/types';
import { saveFile } from '../platform/files';
import { APP_VERSION } from '../platform/versionLabel';
import { writeModPackage } from '../mods/package';
import { projectProblems, type Problem, type Target } from './checks';
import { indexedCanvas, robotPalette } from './colors';
import { confirmDialog, field, fill, h, modal, pickFiles, textInput, toast } from './dom';
import { buildProject, newProject, openPackage, projectFromPackage, type Project } from './project';
import { deleteProject, listProjects, loadProject, saveProject } from './storage';
import { robotEditor } from './robot/robotEditor';
import { newRobotDialog } from './robot/newRobot';
import { arenaEditor, newArenaDialog } from './arena/arenaEditor';
import { newPilotDialog, pilotEditor } from './pilot/pilotEditor';
import { testFight } from './test';

export type Selection = Target;

/** What an editor gives back: its element, what to do when it is closed, and how it shows other colors. */
export interface Editor {
  el: HTMLElement;
  close?(): void;
  /** The preview colors changed (without it the editor is made again). */
  recolor?(): void;
}

export class StudioApp {
  project: Project | null = null;
  sel: Selection = { kind: 'mod' };
  /** The pilot colors robots are shown in (primary, secondary, tertiary: the game's color choices 0-15). */
  colors: [number, number, number] = [5, 11, 8];
  private saveTimer = 0;
  private savedText = '';
  private editor: Editor | null = null;
  private sidebar = h('div', { class: 'sidebar' });
  private content = h('div', { class: 'content' });
  private statusText = h('span');
  private saveState = h('span', { class: 'faint' });
  private projectName = h('div', { class: 'project-name' });

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
    void this.showStart();
  }

  // ---- start screen --------------------------------------------------------------------------------------------

  async showStart(): Promise<void> {
    await this.flush();
    this.editor?.close?.();
    this.editor = null;
    this.project = null;
    const recent = await listProjects();
    this.root.classList.remove('ws');
    const choice = (title: string, text: string, onclick: () => void) => h('div', { class: 'choice', onclick }, h('b', null, title), h('span', null, text));
    fill(this.root, h('div', { class: 'start' }, h('div', { class: 'inner' },
      h('h1', { class: 'logo' }, 'OMF STUDIO'),
      h('p', { class: 'tag' }, 'Make robots, arenas and pilots for One Must Fall 2097 Remastered, pixel for pixel in the game\'s own ' +
        'formats, and build them into mods the game plays.'),
      h('div', { class: 'choices' },
        choice('NEW MOD', 'Start an empty mod, then add robots, arenas and pilots to it.', () => this.open(newProject())),
        choice('OPEN A MOD FILE', `Open a ${MOD_EXTENSION} file to change it.`, () => void this.openPicked()),
        choice('OPEN THE SAMPLE', 'A mod with a robot, an arena and a pilot, to see how one is made.', () => void this.openSample())),
      recent.length ? h('h3', { class: 'muted', style: { font: '700 11px var(--title)', letterSpacing: '.16em' } }, 'RECENT PROJECTS') : null,
      h('div', { class: 'recent' }, recent.map((r) => h('div', { class: 'item', onclick: () => void this.openStored(r.key) },
        h('span', null, r.name),
        h('span', { class: 'sub' }, new Date(r.updated).toLocaleString()),
        h('button', {
          class: 'btn small danger', title: 'Delete this project', onclick: async (e: Event) => {
            e.stopPropagation();
            if (await confirmDialog('Delete project', `Delete "${r.name}"? Its mod file, if you built one, stays.`, 'Delete', true)) {
              await deleteProject(r.key);
              void this.showStart();
            }
          },
        }, 'Delete')))),
      h('p', { class: 'faint', style: { marginTop: '30px' } }, `OMF Studio ${APP_VERSION}. Projects are kept on this computer as you ` +
        'work; BUILD saves a mod file to share.'))));
  }

  private async openPicked(): Promise<void> {
    const [f] = await pickFiles(`${MOD_EXTENSION},.zip`);
    if (f) await this.openFile(f);
  }

  async openFile(f: File): Promise<void> {
    try {
      this.open(await openPackage(new Uint8Array(await f.arrayBuffer())));
      this.changed();
    } catch (err) {
      toast(err instanceof ModError ? err.message : `The file could not be opened: ${(err as Error)?.message ?? err}`, true, 6000);
    }
  }

  private async openSample(): Promise<void> {
    const pkg = await buildSampleMod();
    const p = projectFromPackage(await readModPackage(await writeModPackage(pkg)));
    p.manifest.id = 'me.sample-copy';
    p.manifest.name = 'Sample mod (copy)';
    this.open(p);
    this.changed();
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
    const top = h('div', { class: 'topbar' },
      h('div', { class: 'brand', onclick: () => void this.showStart(), style: { cursor: 'pointer' }, title: 'Back to the start screen' }, 'OMF STUDIO'),
      this.projectName,
      h('button', { class: 'btn', onclick: () => this.showChecks(), title: 'What the mod still needs' }, 'Checks'),
      h('button', { class: 'btn', onclick: () => void this.build(), title: `Save the mod as a ${MOD_EXTENSION} file to share` }, 'Build file'),
      h('button', { class: 'btn primary', onclick: () => void this.install(), title: 'Install the mod in the game on this computer' }, 'Install in game'),
      h('button', { class: 'btn go', onclick: () => void this.test(), title: 'Play the mod in the game now' }, '▶ Test'));
    const status = h('div', { class: 'statusbar' }, this.statusText, h('span', { class: 'spacer' }), this.saveState);
    this.root.classList.add('ws');
    fill(this.root, top, h('div', { class: 'workspace' }, this.sidebar, this.content), status);
    this.refresh();
  }

  /** Redraws the sidebar and the editor (after the selection or the project's structure changed). */
  refresh(): void {
    this.renderSidebar();
    this.renderEditor();
    this.updateTitle();
  }

  private updateTitle(): void {
    const p = this.project;
    if (!p) return;
    fill(this.projectName, 'Mod: ', h('b', null, p.manifest.name || '(no name)'), ` · ${p.manifest.id} · version ${p.manifest.version}`);
    const errors = projectProblems(p).filter((x) => x.level === 'error').length;
    fill(this.statusText, errors ? h('span', { style: { color: 'var(--bad)' } }, `${errors} problem${errors === 1 ? '' : 's'} to fix before the game can play it (Checks)`)
      : h('span', { style: { color: 'var(--ok)' } }, 'Ready to play'));
  }

  select(sel: Selection): void {
    this.sel = sel;
    this.refresh();
  }

  private renderSidebar(): void {
    const p = this.project!;
    const is = (k: Selection['kind'], i = -1) => this.sel.kind === k && (i < 0 || ('index' in this.sel && this.sel.index === i));
    const pal = robotPalette(this.colors);
    const robotThumb = (index: number) => {
      const sp = p.robots[index].af.moves[11]?.animation.sprites.find((s) => !s.isEmpty());
      if (!sp) return h('span', { class: 'thumb' });
      const c = indexedCanvas(sp.pixels(), sp.width, sp.height, pal);
      c.className = 'thumb pix';
      return c;
    };
    const section = (title: string, add: () => void, items: HTMLElement[]) => [
      h('h3', null, title, h('button', { class: 'btn', onclick: add, title: `Add ${title.toLowerCase().replace(/s$/, '')}` }, '+ Add')),
      items.length ? items : h('div', { class: 'item empty' }, 'None yet'),
    ];
    fill(this.sidebar,
      h('div', { class: `item${is('mod') ? ' sel' : ''}`, onclick: () => this.select({ kind: 'mod' }) }, '⚙ Mod details'),
      section('ROBOTS', () => void this.addRobot(), p.robots.map((r, i) => h('div', { class: `item${is('robot', i) ? ' sel' : ''}`, onclick: () => this.select({ kind: 'robot', index: i }) },
        robotThumb(i), r.info.name || r.id))),
      section('ARENAS', () => void this.addArena(), p.arenas.map((a, i) => h('div', { class: `item${is('arena', i) ? ' sel' : ''}`, onclick: () => this.select({ kind: 'arena', index: i }) },
        a.info.name || a.id))),
      section('PILOTS', () => void this.addPilot(), p.pilots.map((pl, i) => h('div', { class: `item${is('pilot', i) ? ' sel' : ''}`, onclick: () => this.select({ kind: 'pilot', index: i }) },
        pl.info.name || pl.id))));
  }

  private renderEditor(): void {
    this.editor?.close?.();
    this.editor = null;
    const p = this.project!;
    const s = this.sel;
    let ed: Editor | null = null;
    if (s.kind === 'robot' && p.robots[s.index]) ed = robotEditor(this, p.robots[s.index], s.move);
    else if (s.kind === 'arena' && p.arenas[s.index]) ed = arenaEditor(this, p.arenas[s.index], s.move);
    else if (s.kind === 'pilot' && p.pilots[s.index]) ed = pilotEditor(this, p.pilots[s.index]);
    else ed = { el: this.modEditor() };
    this.editor = ed;
    fill(this.content, ed.el);
    this.content.scrollTop = 0;
  }

  /** The mod's details: its id, name, version, author and description. */
  private modEditor(): HTMLElement {
    const m = this.project!.manifest;
    const idInput = textInput(() => m.id, (v) => {
      m.id = v.trim();
      idInput.style.borderColor = ID_PATTERN.test(m.id) ? '' : 'var(--bad)';
      this.changed(false);
    });
    return h('div', { class: 'page' },
      h('h1', null, 'Mod details'),
      h('p', { class: 'lead' }, 'How the mod is named in the game\'s MODS page. Its id tells it apart from every other mod: an update of ' +
        'the mod keeps the same id, and replaces the older version when it is installed.'),
      h('div', { class: 'card' },
        h('div', { class: 'grid2' },
          field('Name', textInput(() => m.name, (v) => ((m.name = v), this.changed(false)), { maxLength: 40 })),
          field('Id', idInput, 'yourname.mod-name'),
          field('Version', textInput(() => m.version, (v) => ((m.version = v), this.changed(false)), { maxLength: 16 })),
          field('Author', textInput(() => m.author, (v) => ((m.author = v), this.changed(false)), { maxLength: 40 }))),
        h('div', { style: { marginTop: '12px' } }, field('Description', (() => {
          const t = h('textarea', { rows: 4, maxLength: 400 }, m.description);
          t.addEventListener('input', () => ((m.description = t.value), this.changed(false)));
          return t;
        })(), 'up to 400 characters'))),
      this.problemsCard());
  }

  private problemsCard(): HTMLElement {
    const list = projectProblems(this.project!);
    if (!list.length) return h('div', { class: 'card' }, h('h2', null, 'CHECKS'), h('span', { class: 'badge ok' }, 'Nothing to fix: the game can play this mod.'));
    return h('div', { class: 'card' }, h('h2', null, 'CHECKS'), this.problemList(list));
  }

  private problemList(list: Problem[]): HTMLElement {
    return h('ul', { class: 'problems' }, list.map((x) => h('li', { style: { cursor: 'pointer', color: x.level === 'error' ? '' : 'var(--warn)' }, onclick: () => this.select(x.target) },
      x.level === 'error' ? x.text : `${x.text}`)));
  }

  private showChecks(): void {
    const list = projectProblems(this.project!);
    void modal<void>((close) => h('div', { class: 'modal', style: { width: '640px' } },
      h('h2', null, 'Checks'),
      list.length ? h('div', null, h('p', { class: 'muted' }, 'Red: the game cannot play the mod until it is fixed. Yellow: the game makes up for it. ' +
        'Click one to go there.'), (() => {
        const ul = this.problemList(list);
        ul.addEventListener('click', () => close(null));
        return ul;
      })()) : h('p', null, h('span', { class: 'badge ok' }, 'Nothing to fix: the game can play this mod.')),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close(null) }, 'Close'))));
  }

  // ---- adding content --------------------------------------------------------------------------------------------

  private async addRobot(): Promise<void> {
    const r = await newRobotDialog(this);
    if (!r) return;
    this.project!.robots.push(r);
    this.changed();
    this.select({ kind: 'robot', index: this.project!.robots.length - 1 });
  }

  private async addArena(): Promise<void> {
    const a = await newArenaDialog(this);
    if (!a) return;
    this.project!.arenas.push(a);
    this.changed();
    this.select({ kind: 'arena', index: this.project!.arenas.length - 1 });
  }

  private async addPilot(): Promise<void> {
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

  /** The project changed: it is saved a moment later. `structure`: the sidebar and titles change too. */
  changed(structure = true): void {
    if (!this.project) return;
    fill(this.saveState, 'Saving…');
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.saveNow(), 1200);
    if (structure) this.renderSidebar();
    this.updateTitle();
  }

  private async saveNow(): Promise<void> {
    this.saveTimer = 0;
    const p = this.project;
    if (!p) return;
    try {
      await saveProject(p);
      this.savedText = `Saved ${new Date().toLocaleTimeString()}`;
      fill(this.saveState, this.savedText);
    } catch (err) {
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

  private async build(): Promise<void> {
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

  private async install(): Promise<void> {
    const bytes = await this.checkedBuild();
    if (!bytes) return;
    try {
      await installMod(bytes);
      toast(`${this.project!.manifest.name} is installed: it plays the next time the game starts (EXTRAS > MODS turns it on or off).`, false, 6000);
    } catch (err) {
      toast(err instanceof ModError ? err.message : 'The mod could not be installed.', true);
    }
  }

  private async test(): Promise<void> {
    const bytes = await this.checkedBuild();
    if (!bytes) return;
    await setTestMod(bytes);
    testFight(this, this.project!);
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
