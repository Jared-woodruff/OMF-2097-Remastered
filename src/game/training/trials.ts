// Combo trials of the training lab: for the player's robot, first its special moves one by one, then combos found by
// a search of the game itself (trialData.ts, made by src/gen/dev/comboSearch.test.ts). A trial is done when its moves
// land in order within one combo (as the game counts combos: until the dummy recovers); a dropped combo starts the
// trial over. A demo shows how: the player's robot does the combo by itself.
import { Controller, type CtrlEvent, type HarEvent } from '../../controller/controller';
import { moveActions } from '../../controller/dummy';
import { afGetMove, type Af, type AfMove } from '../../resources/resources';
import { ACT_RIGHT, ACT_STOP, ACT_UP, ARENA_FLOOR, CAT_JUMPING, HarEventType, OBJECT_FACE_LEFT, OBJECT_FACE_RIGHT } from '../constants';
import type { GameState } from '../gameState';
import { drawDir, ICON_SIZE } from '../gui/inputIcons';
import { harMoveList, moveNotation } from '../gui/moveList';
import { FontSize, GLYPH_SHADOW_BOTTOM, GLYPH_SHADOW_RIGHT, Text } from '../gui/text';
import { saveSettings, settings } from '../settings';
import { menuShade } from '../gui/widgets';
import { video } from '../../video/draw';
import { COMBO_TRIALS, SPECIAL_TRIALS, type TrialCombo } from './trialData';
import { recordTrials } from '../records/records';

export interface Trial {
  /** A short title (the trial menu shows it next to the number). */
  title: string;
  moves: AfMove[];
  /** The combo as the search did it (for the demo), or null for a single move. */
  combo: TrialCombo | null;
  /** Where the robots stand for the demo. */
  distance: number;
}

const COLOR_TEXT = 0xe7;
const COLOR_SHADOW = 0xf8;
const COLOR_DONE = 0xa6;
const COLOR_NEXT = 0xcf;
const COLOR_TODO = 0xd9;
const COLOR_WARN = 0xf1;
const COLOR_PUNCH = 0xf2;
const COLOR_KICK = 0xe7;

/** The trials of a robot: its special moves (at most four), then its combos. */
export function robotTrials(harId: number, af: Af): Trial[] {
  const out: Trial[] = [];
  // The special moves that can hit a standing dummy (checked for the game's robots; the workshop's are all tried).
  const known = SPECIAL_TRIALS[harId]?.map(([id]) => id);
  for (const e of harMoveList(af)) {
    if (e.kind !== 'SPECIAL' || out.length >= 4) continue;
    const m = af.moves.find((x) => x && x.moveString === e.moveString && x.category === e.category);
    if (!m || (known ? !known.includes(m.id) : m.damage <= 0 && !m.successorId)) continue;
    const distance = SPECIAL_TRIALS[harId]?.find(([id]) => id === m.id)?.[1] ?? 60;
    out.push({ title: e.label !== e.kind ? e.label : `SPECIAL ${out.length + 1}`, moves: [m], combo: null, distance });
  }
  for (const c of COMBO_TRIALS[harId] ?? []) {
    const moves = c.steps.map(([id]) => afGetMove(af, id)).filter((m): m is AfMove => !!m);
    if (moves.length !== c.steps.length) continue;
    out.push({ title: `${c.jump ? 'JUMP ' : ''}${moves.length} HITS`, moves, combo: c, distance: c.distance });
  }
  return out;
}

export function trialKey(harId: number, index: number): string {
  return `${harId}:${index}`;
}

export function trialDone(harId: number, index: number): boolean {
  return settings().training.trialsDone.includes(trialKey(harId, index));
}

/** Plays a combo's inputs for the player's robot (the demo). */
class DemoController extends Controller {
  plan = new Map<number, number[]>();
  override poll(ev: CtrlEvent[]): number {
    const acts = this.plan.get(this.gs.tick);
    this.plan.delete(this.gs.tick);
    for (const a of acts ?? [ACT_STOP]) ev.push({ type: 'action', action: a, source: this.type });
    return 0;
  }
}

export class TrialRunner {
  /** Steps landed in the current combo. */
  progress = 0;
  done = false;
  private entered = false;
  private doneTicks = 0;
  private demo: { ctrl: DemoController; saved: Controller; start: number } | null = null;
  private texts = new Map<string, Text>();
  private shade = menuShade(240, 33);

  /** `dummyHar`: the dummy's robot (a few combos do not work against some robots). */
  constructor(private gs: GameState, readonly harId: number, readonly trials: Trial[], public index: number, private dummyHar = 0) {}

  get trial(): Trial {
    return this.trials[this.index];
  }

  get demoing(): boolean {
    return this.demo !== null;
  }

  restart(): void {
    this.progress = 0;
    this.entered = false;
    this.done = false;
    this.doneTicks = 0;
  }

  /** The robots' events: the player's moves entered and landed, the dummy recovering (the combo is over). */
  onHarEvent(e: HarEvent): void {
    if (this.done) return;
    const step = this.trial.moves[this.progress];
    if (e.playerId === 0 && e.move && step) {
      if (e.type === HarEventType.ATTACK && e.move.id === step.id) this.entered = true;
      // A projectile's hit counts for the move that threw it.
      const projectile = e.type === HarEventType.LAND_HIT_PROJECTILE;
      if ((e.type === HarEventType.LAND_HIT || projectile) && this.entered && (projectile || e.move.id === step.id)) {
        this.progress++;
        this.entered = false;
        this.scheduleDemo();
        if (this.progress >= this.trial.moves.length) this.complete();
      }
    } else if (e.playerId === 1 && e.type === HarEventType.RECOVER && this.progress > 0) {
      this.progress = 0;
      this.entered = false;
    }
  }

  private complete(): void {
    this.done = true;
    this.doneTicks = 0;
    if (this.demo) return;
    const key = trialKey(this.harId, this.index);
    const t = settings().training;
    if (!t.trialsDone.includes(key)) {
      t.trialsDone.push(key);
      saveSettings();
    }
    recordTrials(t.trialsDone, (har) => (har === this.harId ? this.trials.length : Infinity));
  }

  /** Per tick; returns true when the trial is over and the next one should start. */
  tick(): boolean {
    if (this.demo && (this.done || this.gs.tick - this.demo.start > 500)) this.endDemo();
    if (!this.done) return false;
    return ++this.doneTicks === 90;
  }

  // ---- demo -------------------------------------------------------------------------------------------------------

  /** The player's robot does the combo by itself, from where the search did it. */
  startDemo(): boolean {
    const c = this.trial.combo;
    const gs = this.gs;
    if (this.demo) return false;
    const p1 = gs.getPlayer(0);
    const ctrl = new DemoController(gs);
    ctrl.harObjId = p1.harObjId;
    this.demo = { ctrl, saved: p1.ctrl, start: gs.tick };
    p1.ctrl = ctrl;
    this.restart();
    const a = gs.findObject(p1.harObjId)!, b = gs.findObject(gs.getPlayer(1).harObjId)!;
    const distance = this.trial.distance;
    a.setPos(160 - distance / 2, ARENA_FLOOR);
    b.setPos(160 + distance / 2, ARENA_FLOOR);
    a.direction = OBJECT_FACE_RIGHT;
    b.direction = OBJECT_FACE_LEFT;
    const start = gs.tick + 8;
    if (c?.jump) ctrl.plan.set(start, [ACT_UP | ACT_RIGHT]);
    this.demoStepAt = start;
    this.scheduleDemo();
    return true;
  }

  private demoStepAt = 0;

  /** Enters the demo's next move (after the start, or the step before landed). */
  private scheduleDemo(): void {
    const d = this.demo;
    if (!d || this.progress >= this.trial.moves.length) return;
    const move = this.trial.moves[this.progress];
    const c = this.trial.combo;
    const delay = c ? c.steps[this.progress][1] : 0;
    const base = this.progress === 0 ? this.demoStepAt : this.gs.tick;
    const dir = this.gs.findObject(this.gs.getPlayer(0).harObjId)?.direction ?? OBJECT_FACE_RIGHT;
    d.ctrl.plan.set(base + Math.max(1, delay), moveActions(move.moveString, dir));
  }

  endDemo(): void {
    const d = this.demo;
    if (!d) return;
    this.demo = null;
    const p1 = this.gs.getPlayer(0);
    p1.ctrl = d.saved;
    d.saved.harObjId = p1.harObjId;
    d.ctrl.free();
    this.restart();
  }

  // ---- drawing ----------------------------------------------------------------------------------------------------

  private text(key: string, s: string, color: number, font = FontSize.SMALL): Text {
    const k = `${key}|${s}|${color}|${font}`;
    let t = this.texts.get(k);
    if (!t) {
      t = new Text(font, 0xffff, 0xffff, s).setColor(color).setShadowColor(COLOR_SHADOW)
        .setShadow(GLYPH_SHADOW_RIGHT | GLYPH_SHADOW_BOTTOM).setWordWrap(false);
      if (this.texts.size > 200) this.texts.clear();
      this.texts.set(k, t);
    }
    return t;
  }

  /** Width of a step's inputs (as drawn by drawStep). */
  private stepWidth(m: AfMove): number {
    const n = moveNotation(m.moveString);
    const jump = m.category === CAT_JUMPING ? this.text('j', 'JUMP', COLOR_TEXT).width() + 3 : 0;
    return jump + (n ? n.inputs.length * (ICON_SIZE + 1) : 0) + 8;
  }

  private drawStep(m: AfMove, x: number, y: number, color: number): void {
    const n = moveNotation(m.moveString);
    if (m.category === CAT_JUMPING) {
      const t = this.text('j', 'JUMP', color);
      t.draw(x, y + 1);
      x += t.width() + 3;
    }
    for (const d of n?.inputs ?? []) {
      drawDir(d, x, y, color, COLOR_SHADOW);
      x += ICON_SIZE + 1;
    }
    const button = m.moveString[0];
    this.text('b', button, color === COLOR_TODO ? COLOR_TODO : button === 'P' ? COLOR_PUNCH : COLOR_KICK, FontSize.BIG).draw(x, y);
  }

  render(y: number): void {
    const trial = this.trial;
    // A shaded panel under the trial (the arena can be busy).
    video.drawRemap(this.shade, 40, y - 3, 4, 1, 0);
    const title = `TRIAL ${this.index + 1}/${this.trials.length}   ${trial.title}${trialDone(this.harId, this.index) ? '   (DONE BEFORE)' : ''}`;
    const tt = this.text('t', title, COLOR_TEXT);
    tt.draw(160 - Math.trunc(tt.width() / 2), y);
    // The steps in a row: done in green, the next one highlighted.
    const gap = this.text('g', '>', COLOR_TODO).width() + 6;
    const total = trial.moves.reduce((w, m) => w + this.stepWidth(m), 0) + gap * (trial.moves.length - 1);
    let x = 160 - Math.trunc(total / 2);
    trial.moves.forEach((m, i) => {
      if (i > 0) {
        this.text('g', '>', COLOR_TODO).draw(x - gap + 3, y + 11);
      }
      const color = this.done || i < this.progress ? COLOR_DONE : i === this.progress ? COLOR_NEXT : COLOR_TODO;
      this.drawStep(m, x, y + 10, color);
      x += this.stepWidth(m) + gap;
    });
    const unfit = !this.done && !this.demo && !!trial.combo?.fails.includes(this.dummyHar);
    const status = this.demo ? 'DEMO' : this.done ? 'TRIAL COMPLETE!' : unfit
      ? 'DOES NOT WORK ON THIS DUMMY ROBOT'
      : trial.moves.length > 1 ? 'IN ONE COMBO   F6 DEMO   F4 RESET' : 'HIT THE DUMMY   F6 DEMO';
    const st = this.text('s', status, this.done ? COLOR_DONE : unfit ? COLOR_WARN : COLOR_TODO);
    st.draw(160 - Math.trunc(st.width() / 2), y + 21);
  }
}

