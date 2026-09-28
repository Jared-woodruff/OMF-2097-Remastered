// The training lab of a training fight: frame data and hitboxes (lab.ts), recording the dummy and playing it back,
// the dummy's reversal, and the hotkeys (F4 reset positions, F5 record / stop, F6 play the recording, F8 frame data,
// F9 hitboxes). The arena forwards its ticks, the robots' events and the dummy's inputs.
import type { Controller, HarEvent } from '../../controller/controller';
import { DummyController, DummyMode, type DummyTape, type Reversal } from '../../controller/dummy';
import { ACT_STOP } from '../constants';
import type { GameState } from '../gameState';
import { harMoveList } from '../gui/moveList';
import { FontSize, GLYPH_SHADOW_BOTTOM, GLYPH_SHADOW_RIGHT, HAlign, Text } from '../gui/text';
import type { GameObject } from '../object';
import { harData } from '../objects/har';
import { saveSettings, settings } from '../settings';
import { FrameMeter, renderHitboxes } from './lab';
import { robotTrials, TrialRunner, type Trial } from './trials';
import { TAG_HUD, video } from '../../video/draw';

/** The longest recording (game ticks, about 25 seconds). */
const MAX_RECORD_TICKS = 900;

/** The dummy's recording (kept in the settings). */
function getTape(): DummyTape | null {
  const t = settings().training.tape;
  return t?.frames?.length ? t : null;
}

export interface LabHost {
  harObj(i: number): GameObject;
  resetTrainingPositions(): void;
  setTrainingDummy(mode: DummyMode): void;
  trainingDummy(): DummyMode;
}

export interface ReversalChoice {
  label: string;
  value: Reversal;
  key: string;
}

/** A direction in words (as if facing right). */
const DIR_WORDS: Record<string, string> = { 1: 'DB', 2: 'D', 3: 'DF', 4: 'B', 5: 'N', 6: 'F', 7: 'UB', 8: 'U', 9: 'UF' };

function reversalKey(r: Reversal): string {
  return r.kind === 'move' ? `move:${r.moveString}` : r.kind;
}

export class TrainingLab {
  readonly meter: FrameMeter;
  private rec: { frames: number[][]; facing: number; playerCtrl: Controller; dummyCtrl: Controller; stand: DummyController } | null = null;
  private note = '';
  private noteTicks = 0;
  private noteText = new Text(FontSize.SMALL, 320, 7, '').setColor(0xe7).setShadowColor(0xf8)
    .setShadow(GLYPH_SHADOW_RIGHT | GLYPH_SHADOW_BOTTOM).setWordWrap(false).setHAlign(HAlign.CENTER);
  /** The combo trial under way, and the dummy's setup from before it (restored when the trials stop). */
  trial: TrialRunner | null = null;
  private beforeTrials: { mode: DummyMode } | null = null;

  constructor(private gs: GameState, private host: LabHost) {
    this.meter = new FrameMeter(gs);
    this.configureDummy();
  }

  /** The dummy's controller, when it is not the CPU. */
  dummy(): DummyController | null {
    const c = this.gs.getPlayer(1).ctrl;
    return c instanceof DummyController ? c : null;
  }

  get recording(): boolean {
    return this.rec !== null;
  }

  get hasTape(): boolean {
    return getTape() !== null;
  }

  /** Gives the dummy the recording and the chosen reversal (after it was created or replaced). */
  configureDummy(): void {
    const d = this.dummy();
    if (!d) return;
    d.tape = getTape();
    const key = settings().training.reversal;
    d.reversal = this.reversalChoices().find((c) => c.key === key)?.value ?? { kind: 'off' };
  }

  /** What the dummy can answer with: nothing, a jump, the recording, or one of its robot's special moves and throws. */
  reversalChoices(): ReversalChoice[] {
    const out: ReversalChoice[] = [
      { label: 'OFF', value: { kind: 'off' }, key: 'off' },
      { label: 'JUMP', value: { kind: 'jump' }, key: 'jump' },
      { label: 'RECORDING', value: { kind: 'tape' }, key: 'tape' },
    ];
    const obj = this.host.harObj(1);
    for (const m of harMoveList(harData(obj).afData)) {
      if (m.kind !== 'SPECIAL' && m.kind !== 'THROW') continue;
      const words = `${m.inputs.map((d) => DIR_WORDS[d] ?? d).join(' ')}${m.inputs.length ? '+' : ''}${m.button}`;
      const label = m.label !== m.kind ? m.label : m.kind === 'THROW' ? `THROW ${words}` : words;
      const value: Reversal = { kind: 'move', moveString: m.moveString };
      if (!out.some((c) => c.key === reversalKey(value))) out.push({ label, value, key: reversalKey(value) });
    }
    return out;
  }

  reversalIndex(): number {
    const key = settings().training.reversal;
    return Math.max(0, this.reversalChoices().findIndex((c) => c.key === key));
  }

  setReversalIndex(i: number): void {
    const c = this.reversalChoices()[i];
    if (!c) return;
    settings().training.reversal = c.key;
    saveSettings();
    this.configureDummy();
  }

  flash(note: string, ticks = 150): void {
    this.note = note;
    this.noteTicks = ticks;
  }

  // ---- recording the dummy ------------------------------------------------------------------------------------

  /** The player takes over the dummy's robot (their own stands still) and records what it should do. */
  startRecording(): void {
    if (this.rec) return;
    const gs = this.gs;
    if (!this.dummy()) this.host.setTrainingDummy(DummyMode.STAND);
    const p1 = gs.getPlayer(0), p2 = gs.getPlayer(1);
    const playerCtrl = p1.ctrl, dummyCtrl = p2.ctrl;
    const stand = new DummyController(gs, DummyMode.STAND);
    stand.harObjId = p1.harObjId;
    stand.setRepeat(1);
    // Swapped without freeing: both come back when the recording stops.
    p1.ctrl = stand;
    playerCtrl.harObjId = p2.harObjId;
    p2.ctrl = playerCtrl;
    this.rec = { frames: [], facing: this.host.harObj(1).direction, playerCtrl, dummyCtrl, stand };
    this.flash('', 0);
  }

  stopRecording(): void {
    const r = this.rec;
    if (!r) return;
    this.rec = null;
    const gs = this.gs;
    const p1 = gs.getPlayer(0), p2 = gs.getPlayer(1);
    p1.ctrl = r.playerCtrl;
    r.playerCtrl.harObjId = p1.harObjId;
    p2.ctrl = r.dummyCtrl;
    r.dummyCtrl.harObjId = p2.harObjId;
    r.stand.free();
    // Idle ticks before the first input and after the last one are left out.
    const idle = (f: number[]) => f.every((a) => a === 0 || a === ACT_STOP);
    let a = 0, b = r.frames.length;
    while (a < b && idle(r.frames[a])) a++;
    while (b > a && idle(r.frames[b - 1])) b--;
    const frames = r.frames.slice(a, b);
    if (!frames.length) {
      this.flash('NOTHING RECORDED');
      return;
    }
    settings().training.tape = { frames, facing: r.facing };
    saveSettings();
    this.host.setTrainingDummy(DummyMode.PLAYBACK);
    settings().training.dummy = DummyMode.PLAYBACK;
    this.configureDummy();
    this.flash(`RECORDED ${(frames.length * this.gs.msPerDyntick() / 1000).toFixed(1)} S   DUMMY: PLAYBACK`);
  }

  toggleRecording(): void {
    if (this.rec) this.stopRecording();
    else this.startRecording();
  }

  /** Plays the recording once. */
  playTape(): void {
    const d = this.dummy();
    if (!getTape()) {
      this.flash('RECORD THE DUMMY FIRST (F5)');
      return;
    }
    if (!d) this.host.setTrainingDummy(DummyMode.STAND);
    this.configureDummy();
    this.dummy()?.play();
  }

  /** The dummy's inputs of this tick (player 2), while recording. */
  record(player: number, actions: number[]): void {
    if (!this.rec || player !== 1) return;
    this.rec.frames.push(actions);
    if (this.rec.frames.length >= MAX_RECORD_TICKS) this.stopRecording();
  }

  // ---- combo trials ---------------------------------------------------------------------------------------------

  /** The player's robot (whose trials are offered). */
  trialHar(): number {
    return harData(this.host.harObj(0)).id;
  }

  /** The trials of the player's robot. */
  trials(): Trial[] {
    const obj = this.host.harObj(0);
    return robotTrials(harData(obj).id, harData(obj).afData);
  }

  /** Starts a trial (the dummy stands still meanwhile); `demo` shows it first. */
  startTrial(index: number, demo = false): void {
    const trials = this.trials();
    if (!trials[index]) return;
    this.stopRecording();
    if (!this.beforeTrials) this.beforeTrials = { mode: this.host.trainingDummy() };
    this.trial?.endDemo();
    if (this.host.trainingDummy() !== DummyMode.STAND) this.host.setTrainingDummy(DummyMode.STAND);
    const d = this.dummy();
    if (d) d.reversal = { kind: 'off' };
    this.host.resetTrainingPositions();
    this.meter.reset();
    this.trial = new TrialRunner(this.gs, this.trialHar(), trials, index, harData(this.host.harObj(1)).id);
    if (demo) this.trial.startDemo();
  }

  /** Stops the trials: the dummy does what it did before. */
  stopTrials(): void {
    if (!this.trial) return;
    this.trial.endDemo();
    this.trial = null;
    const b = this.beforeTrials;
    this.beforeTrials = null;
    if (b) this.host.setTrainingDummy(b.mode);
    this.configureDummy();
  }

  // ---- ticks, events, keys, drawing ----------------------------------------------------------------------------

  tick(objs: GameObject[]): void {
    this.meter.tick(objs);
    if (this.noteTicks > 0) this.noteTicks--;
    const t = this.trial;
    if (t?.tick()) {
      // Done: on to the next trial (after the last one, the trials are over).
      if (t.index + 1 < t.trials.length) {
        this.startTrial(t.index + 1);
      } else {
        this.stopTrials();
        this.flash('ALL TRIALS COMPLETE!', 240);
      }
    }
  }

  onHarEvent(e: HarEvent): void {
    this.meter.onHarEvent(e);
    this.trial?.onHarEvent(e);
  }

  /** Training hotkeys; returns true when used. */
  keyEvent(code: string): boolean {
    const t = settings().training;
    switch (code) {
      case 'F4':
        this.host.resetTrainingPositions();
        this.meter.reset();
        this.trial?.endDemo();
        this.trial?.restart();
        return true;
      case 'F5':
        if (!this.trial) this.toggleRecording();
        return true;
      case 'F6':
        if (this.trial) {
          this.host.resetTrainingPositions();
          this.trial.startDemo();
        } else {
          this.playTape();
        }
        return true;
      case 'F8':
        t.frameData = !t.frameData;
        saveSettings();
        this.flash(`FRAME DATA ${t.frameData ? 'ON' : 'OFF'}`, 90);
        return true;
      case 'F9':
        t.hitboxes = !t.hitboxes;
        saveSettings();
        this.flash(`HITBOXES ${t.hitboxes ? 'ON' : 'OFF'}`, 90);
        return true;
    }
    return false;
  }

  /** Over the robots (hitboxes), under the HUD. */
  renderWorld(): void {
    if (settings().training.hitboxes) renderHitboxes(this.gs);
  }

  render(): void {
    video.setTag(TAG_HUD);
    if (settings().training.frameData) this.meter.render();
    this.trial?.render(60);
    let note = this.noteTicks > 0 ? this.note : '';
    if (this.rec) {
      const secs = (this.rec.frames.length * this.gs.msPerDyntick()) / 1000;
      note = `RECORDING THE DUMMY ${secs.toFixed(1)} S   -   F5 OR PAUSE STOPS`;
    }
    if (note) {
      this.noteText.set(note);
      this.noteText.draw(0, this.trial ? 92 : 62);
    }
  }
}
