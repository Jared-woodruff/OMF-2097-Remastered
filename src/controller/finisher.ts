// Finisher keys (OPTIONS > CONTROLS > FINISHER KEYS; not in the original game): once a fight is won, one press does the
// robot's scrap, destruction or Fire & Ice move, and what comes before it (DESTRUCTION in the victory pose does the
// scrap first, then the destruction when the scrap lets it). Each move is entered as the player would enter it, the
// moment the robot can take it, so the fight (a network game, a replay) sees ordinary inputs. The special button does
// the next finishing move. The original inputs still work.
import { CAT_DESTRUCTION, CAT_SCRAP, HarState } from '../game/constants';
import type { GameState } from '../game/gameState';
import { harData, isHar } from '../game/objects/har';
import { POS_FIRE_PIT } from '../game/fireIce';
import { afGetMove, type AfMove } from '../resources/resources';
import { Tag } from '../script/tags';
import type { GameObject } from '../game/object';
import { moveActions } from './dummy';

/** How far a finisher goes: the scrap, the destruction (after the scrap), the Fire & Ice move (after both). */
export const enum Finisher {
  NONE = 0,
  SCRAP = 1,
  DESTRUCTION = 2,
  FIRE_ICE = 3,
}

/** Ticks before a move entered is entered again (it did not start: the robot was not ready). */
const RETRY_TICKS = 6;

/** A move's step in a finisher (0: not a finishing move). */
function stepOf(m: AfMove): Finisher {
  if (m.posConstraints & POS_FIRE_PIT) return Finisher.FIRE_ICE;
  if (m.category === CAT_DESTRUCTION) return Finisher.DESTRUCTION;
  if (m.category === CAT_SCRAP) return Finisher.SCRAP;
  return Finisher.NONE;
}

/** The move can be entered (moves that cannot: '!', left out, or played on their own by the robot). */
function enterable(m: AfMove): boolean {
  return /^[PK][1-9]*$/.test(m.moveString);
}

/** The first move of a kind that starts a finisher (not one that only follows another, position constraint 2). */
function firstMove(obj: GameObject, cat: number): AfMove | null {
  const h = harData(obj);
  for (let i = 0; i < 70; i++) {
    const m = afGetMove(h.afData, i);
    if (m && m.category === cat && !(m.posConstraints & 0x2) && enterable(m)) return m;
  }
  return null;
}

/** The arena's fight is decided (finishing moves only come after it). */
function fightOver(gs: GameState): boolean {
  const sc = gs.sc as unknown as { arenaIsOver?: () => number };
  return typeof sc.arenaIsOver === 'function' && sc.arenaIsOver() !== -1;
}

/**
 * The finishing move the robot can take now on the way to `goal`: one its animation names (`jn`: the scrap from some
 * victory poses, a scrap's next part, the destruction, the Fire & Ice move after it), the scrap on its victory pose's
 * `jf` frames, the destruction on its scrap's `jf2` frames. Null: none now.
 */
export function nextFinisherMove(obj: GameObject, goal: Finisher): AfMove | null {
  const h = harData(obj);
  if (obj.frameIsSet(Tag.JN)) {
    const m = afGetMove(h.afData, obj.frameGet(Tag.JN));
    const step = m ? stepOf(m) : Finisher.NONE;
    if (m && step !== Finisher.NONE && step <= goal && enterable(m)) return m;
  }
  if (goal >= Finisher.SCRAP && h.state === HarState.VICTORY && obj.frameIsSet(Tag.JF)) return firstMove(obj, CAT_SCRAP);
  if (goal >= Finisher.DESTRUCTION && h.state === HarState.SCRAP && obj.frameIsSet(Tag.JF2)) return firstMove(obj, CAT_DESTRUCTION);
  return null;
}

/** One player's finisher keys: the finisher asked for, and the move last entered for it. */
export class FinisherKeys {
  private goal = Finisher.NONE;
  private entered = -1;
  private enteredTick = -1;
  private scene = -1;

  /**
   * The keys pressed since the last poll (scrap, destruction, Fire & Ice) and whether the special button went down: the
   * inputs to enter now for the robot `harObjId` (none: an empty list). A key pressed before the fight is won does
   * nothing.
   */
  poll(gs: GameState, harObjId: number, keys: readonly [boolean, boolean, boolean], special: boolean): number[] {
    // (a new fight: nothing asked for)
    if (gs.sceneSerial !== this.scene) {
      this.scene = gs.sceneSerial;
      this.goal = Finisher.NONE;
      this.entered = -1;
    }
    const obj = gs.findObject(harObjId);
    const ready = !!obj && isHar(obj) && fightOver(gs);
    keys.forEach((pressed, i) => {
      if (pressed && ready) this.goal = Math.max(this.goal, (i + 1) as Finisher);
    });
    if (!ready) {
      this.goal = Finisher.NONE;
      return [];
    }
    const h = harData(obj);
    if (h.state === HarState.DONE) {
      this.goal = Finisher.NONE;
      return [];
    }
    // The special button: the next finishing move (the scrap in the victory pose, then the destruction, then Fire & Ice).
    if (special) {
      const next = h.state === HarState.VICTORY ? Finisher.SCRAP : h.state === HarState.SCRAP ? Finisher.DESTRUCTION
        : h.state === HarState.DESTRUCTION ? Finisher.FIRE_ICE : Finisher.NONE;
      this.goal = Math.max(this.goal, next);
    }
    if (this.goal === Finisher.NONE) return [];
    const move = nextFinisherMove(obj, this.goal);
    if (!move || (move.id === this.entered && gs.tick - this.enteredTick < RETRY_TICKS)) return [];
    this.entered = move.id;
    this.enteredTick = gs.tick;
    return moveActions(move.moveString, obj.direction);
  }

  /** The robot is in a fight's finish, where the special button does finishing moves instead of specials. */
  static finishing(gs: GameState, harObjId: number): boolean {
    const obj = gs.findObject(harObjId);
    if (!obj || !isHar(obj) || !fightOver(gs)) return false;
    const s = harData(obj).state;
    return s === HarState.VICTORY || s === HarState.SCRAP || s === HarState.DESTRUCTION;
  }
}
