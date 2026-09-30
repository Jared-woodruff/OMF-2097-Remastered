// OMF Studio's undo and redo: the project as it was after each round of changes (the changes made within a moment of
// each other, like a name being typed, are one step), up to 80 steps back. A step is a copy of the project's structure
// (moves, animations, sprites, hit points, texts, stats, colors); the bytes of pictures and files are shared, since
// Studio replaces them and never writes into them (sprites' encoded pictures, HD pictures, portraits, widescreen
// backgrounds). The scene files' backgrounds, palettes and shading tables and the sound tables are copied.
import type { AfFile } from '../formats/af';
import { AnimationData } from '../formats/animation';
import type { BkFile } from '../formats/bk';
import type { ArenaDoc, HdDoc, PilotDoc, Project, RobotDoc } from './project';

const LIMIT = 80;
/** How long after a change the round of changes becomes a step (ms). */
const ROUND_MS = 700;

function copyAnimation(a: AnimationData): AnimationData {
  const c = new AnimationData();
  c.startX = a.startX;
  c.startY = a.startY;
  c.nullValue = a.nullValue;
  c.coords = a.coords.map((x) => ({ ...x }));
  c.animString = a.animString;
  c.extraStrings = a.extraStrings.slice();
  c.sprites = a.sprites.map((s) => s.clone());
  return c;
}

function copyAf(af: AfFile): AfFile {
  return {
    ...af,
    moves: af.moves.map((m) => (m ? { ...m, unknown: m.unknown.slice(), animation: copyAnimation(m.animation) } : null)),
    soundTable: af.soundTable.slice(),
  };
}

function copyBk(bk: BkFile): BkFile {
  return {
    ...bk,
    anims: bk.anims.map((a) => (a ? { ...a, animation: copyAnimation(a.animation) } : null)),
    background: bk.background.slice(),
    palettes: bk.palettes.map((p) => p.clone()),
    remaps: bk.remaps.map((r) => r.clone()),
    soundTable: bk.soundTable.slice(),
  };
}

function copyHd(hd: HdDoc | null): HdDoc | null {
  return hd ? { ...hd, colors: [...hd.colors] as HdDoc['colors'], sprites: new Map(hd.sprites) } : null;
}

/** Copies of a robot, an arena or a pilot that editing one never changes the other (see above; also new ones copied from the mod's). */
export const copyRobot = (r: RobotDoc): RobotDoc => ({ id: r.id, info: structuredClone(r.info), af: copyAf(r.af), hd: copyHd(r.hd) });
export const copyArena = (a: ArenaDoc): ArenaDoc => ({ id: a.id, info: structuredClone(a.info), bk: copyBk(a.bk), wid: a.wid, hd: copyHd(a.hd) });
export const copyPilot = (p: PilotDoc): PilotDoc => ({ id: p.id, info: structuredClone(p.info), portrait: p.portrait, face: p.face, hd: copyHd(p.hd) });

/** A copy of a project that its editing never changes (see above). */
export function copyProject(p: Project): Project {
  return {
    key: p.key,
    manifest: structuredClone(p.manifest),
    robots: p.robots.map(copyRobot),
    arenas: p.arenas.map(copyArena),
    pilots: p.pilots.map(copyPilot),
  };
}

export class History {
  private past: Project[] = [];
  private future: Project[] = [];
  /** The project after the last step: what an undo leaves when it goes back one step from here. */
  private last: Project | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private project: Project | null = null;

  /** Starts over with a project just opened. */
  reset(p: Project): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.past = [];
    this.future = [];
    this.project = p;
    this.last = copyProject(p);
  }

  /** The project changed (a moment after its last change, the round of changes becomes a step). */
  changed(p: Project): void {
    this.project = p;
    this.future = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.commit(), ROUND_MS);
  }

  /** Makes the round of changes a step now. */
  commit(): void {
    if (!this.timer || !this.project) return;
    clearTimeout(this.timer);
    this.timer = null;
    if (this.last) {
      this.past.push(this.last);
      if (this.past.length > LIMIT) this.past.shift();
    }
    this.last = copyProject(this.project);
  }

  get canUndo(): boolean {
    return this.past.length > 0 || this.timer !== null;
  }

  get canRedo(): boolean {
    return this.future.length > 0 && this.timer === null;
  }

  /** The project one step back, to edit (null: none). */
  undo(): Project | null {
    this.commit();
    const back = this.past.pop();
    if (!back || !this.last) return null;
    this.future.push(this.last);
    this.last = back;
    return (this.project = copyProject(back));
  }

  /** The project one step forward again, to edit (null: none). */
  redo(): Project | null {
    if (this.timer) return null;
    const next = this.future.pop();
    if (!next || !this.last) return null;
    this.past.push(this.last);
    this.last = next;
    return (this.project = copyProject(next));
  }
}
