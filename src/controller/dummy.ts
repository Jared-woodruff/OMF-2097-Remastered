// Training dummy: a controller that holds a fixed stance (stand, crouch, jump, block), plays back what the player
// recorded for it, and can answer with a reversal (a move, a jump or the recording) the moment it recovers from a hit,
// a block or a knockdown.
import { ACT_DOWN, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_STOP, ACT_UP, ANIM_CROUCHING, ANIM_IDLE, ANIM_WALKING, CtrlType,
  HarState, OBJECT_FACE_LEFT, OBJECT_FACE_RIGHT } from '../game/constants';
import type { GameState } from '../game/gameState';
import { harData } from '../game/objects/har';
import type { GameObject } from '../game/object';
import { Controller, type CtrlEvent } from './controller';

export const enum DummyMode {
  STAND = 0,
  CROUCH,
  JUMP,
  BLOCK,
  BLOCK_LOW,
  /** Fights back (the CPU opponent; set up with an AI controller instead of this one). */
  CPU,
  /** Plays the recording over and over. */
  PLAYBACK,
}

export const DUMMY_MODE_NAMES = ['STAND', 'CROUCH', 'JUMP', 'BLOCK', 'BLOCK LOW', 'CPU', 'PLAYBACK'];

/** Ticks between jumps in JUMP mode. */
const JUMP_INTERVAL = 70;
/** Ticks between two runs of the recording in PLAYBACK mode. */
const PLAYBACK_GAP = 40;

/** What the player recorded for the dummy: the actions of every tick, and which way the dummy faced. */
export interface DummyTape {
  frames: number[][];
  facing: number;
}

/** The dummy's answer when it can act again after a hit, a block or a knockdown. */
export type Reversal =
  | { kind: 'off' }
  | { kind: 'jump' }
  | { kind: 'tape' }
  | { kind: 'move'; moveString: string };

/** The actions that enter a move string (button last, with the final direction), for a robot facing `direction`. */
export function moveActions(moveString: string, direction: number): number[] {
  const button = moveString[0] === 'K' ? ACT_KICK : ACT_PUNCH;
  const dirs = [...moveString.slice(1)].reverse().map((c) => dirAction(c, direction));
  if (!dirs.length) return [button];
  dirs[dirs.length - 1] |= button;
  return dirs;
}

/** A numpad direction (as if facing right) as an action for a robot facing `direction`. */
function dirAction(c: string, direction: number): number {
  const fwd = direction === OBJECT_FACE_LEFT ? ACT_LEFT : ACT_RIGHT;
  const back = direction === OBJECT_FACE_LEFT ? ACT_RIGHT : ACT_LEFT;
  switch (c) {
    case '8': return ACT_UP;
    case '2': return ACT_DOWN;
    case '6': return fwd;
    case '4': return back;
    case '9': return ACT_UP | fwd;
    case '7': return ACT_UP | back;
    case '3': return ACT_DOWN | fwd;
    case '1': return ACT_DOWN | back;
  }
  return ACT_STOP;
}

/** Left and right swapped (a recording played back facing the other way). */
export function mirrorAction(a: number): number {
  const l = a & ACT_LEFT, r = a & ACT_RIGHT;
  return (a & ~(ACT_LEFT | ACT_RIGHT)) | (l ? ACT_RIGHT : 0) | (r ? ACT_LEFT : 0);
}

/** Being hit, blocking, knocked down or getting up: the robot cannot act. */
export function harReeling(obj: GameObject): boolean {
  const s = harData(obj).state;
  return s === HarState.RECOIL || s === HarState.STUNNED || s === HarState.STANDING_UP || s === HarState.BLOCKSTUN ||
    s === HarState.WALLDAMAGE;
}

/** On the floor and free to act (standing, walking or crouching, no move under way). */
export function harCanAct(obj: GameObject): boolean {
  const h = harData(obj);
  const id = obj.curAnimation?.id;
  return !h.executingMove && !obj.isAirborne() && (id === ANIM_IDLE || id === ANIM_CROUCHING || id === ANIM_WALKING) &&
    h.state >= HarState.STANDING && h.state <= HarState.CROUCHBLOCK;
}

export class DummyController extends Controller {
  private ticks = 0;
  /** The recording to play in PLAYBACK mode, or as a reversal. */
  tape: DummyTape | null = null;
  reversal: Reversal = { kind: 'off' };
  /** Playing the recording: the tick in it, and whether it is mirrored. */
  private playPos = -1;
  private mirror = false;
  private gap = 0;
  private wasReeling = false;
  /** Reversals done (for the training readout). */
  reversals = 0;

  constructor(gs: GameState, public mode: DummyMode) {
    super(gs);
    this.type = CtrlType.KEYBOARD;
  }

  get playing(): boolean {
    return this.playPos >= 0;
  }

  /** Plays the recording once from the start (facing the way it was recorded, mirrored if the dummy now faces the other way). */
  play(): boolean {
    const har = this.gs.findObject(this.harObjId);
    if (!this.tape?.frames.length || !har) return false;
    this.playPos = 0;
    this.mirror = har.direction !== this.tape.facing;
    return true;
  }

  stop(): void {
    this.playPos = -1;
  }

  override dyntick(_ticks: number, _ev: CtrlEvent[]): number {
    this.ticks++;
    return 0;
  }

  override poll(ev: CtrlEvent[]): number {
    this.current = 0;
    const har = this.gs.findObject(this.harObjId);
    if (har) this.reversalCheck(har, ev);
    if (ev.length) {
      this.last = this.current;
      return 0;
    }
    if (this.mode === DummyMode.PLAYBACK && !this.playing && this.tape?.frames.length && har) {
      // Between runs the dummy stands; the next run starts once it can act.
      if (this.gap > 0) this.gap--;
      else if (harCanAct(har)) this.play();
    }
    if (this.playing) {
      const frame = this.tape!.frames[this.playPos++];
      for (const a of frame) this.cmd(this.mirror ? mirrorAction(a) : a, ev);
      if (!frame.length) this.cmd(ACT_STOP, ev);
      if (this.playPos >= this.tape!.frames.length) {
        this.playPos = -1;
        this.gap = PLAYBACK_GAP;
      }
      this.last = this.current;
      return 0;
    }
    // Holding "back" blocks: away from the direction the dummy faces. The dummy only does it while an attack is on its
    // way (otherwise it would walk away to the wall).
    const back = har && har.direction === OBJECT_FACE_RIGHT ? ACT_LEFT : ACT_RIGHT;
    const enemyId = this.gs.getPlayer(0).harObjId === this.harObjId ? this.gs.getPlayer(1).harObjId : this.gs.getPlayer(0).harObjId;
    const enemy = this.gs.findObject(enemyId);
    const threat = (!!enemy && harData(enemy).executingMove !== 0) || this.gs.getProjectiles().length > 0;
    let action = ACT_STOP;
    switch (this.mode) {
      case DummyMode.CROUCH:
        action = ACT_DOWN;
        break;
      case DummyMode.JUMP:
        if (this.ticks % JUMP_INTERVAL < 3) action = ACT_UP;
        break;
      case DummyMode.BLOCK:
        if (threat) action = back;
        break;
      case DummyMode.BLOCK_LOW:
        action = threat ? ACT_DOWN | back : ACT_DOWN;
        break;
    }
    this.cmd(action, ev);
    this.last = this.current;
    return 0;
  }

  /**
   * The first tick the dummy can act after reeling: the reversal goes out now. A move's whole input goes in this tick
   * (as a player would have entered it during the recovery, with the button buffered), so it comes out on the first
   * possible frame.
   */
  private reversalCheck(har: GameObject, ev: CtrlEvent[]): void {
    if (harReeling(har) || (har.isAirborne() && harData(har).state === HarState.RECOIL)) {
      this.wasReeling = true;
      return;
    }
    if (!this.wasReeling || !harCanAct(har)) return;
    this.wasReeling = false;
    const r = this.reversal;
    if (r.kind === 'off') return;
    this.reversals++;
    if (r.kind === 'tape') {
      this.play();
      return;
    }
    this.stop();
    const actions = r.kind === 'jump' ? [ACT_UP] : moveActions(r.moveString, har.direction);
    // Each action a separate event: the robot takes them one after the other within this tick.
    for (const a of actions) {
      this.current |= a;
      ev.push({ type: 'action', action: a, source: this.type });
    }
  }
}
