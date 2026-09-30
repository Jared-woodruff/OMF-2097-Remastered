// One-button specials (OPTIONS > CONTROLS > SPECIAL BUTTON): the special button does a special move with its whole input in
// one go, chosen by the direction held (as the robot faces): none, forward, back, down or up for the robot's first to
// fifth special move, and the first air special in the air. The move list shows which is which.
import { ACT_DOWN, ACT_LEFT, ACT_RIGHT, ACT_UP, OBJECT_FACE_LEFT } from '../game/constants';
import type { GameState } from '../game/gameState';
import { harMoveList, type MoveListEntry } from '../game/gui/moveList';
import { harData } from '../game/objects/har';
import type { Af } from '../resources/resources';
import { settings } from '../game/settings';
import { moveActions } from './dummy';

/** The directions (numpad notation, facing right) that pick the first to fifth special. */
export const SPECIAL_SLOTS = ['5', '6', '4', '2', '8'];

const lists = new WeakMap<Af, { ground: MoveListEntry[]; air: MoveListEntry[] }>();

function specialsOf(af: Af): { ground: MoveListEntry[]; air: MoveListEntry[] } {
  let l = lists.get(af);
  if (!l) {
    const all = harMoveList(af);
    l = { ground: all.filter((e) => e.kind === 'SPECIAL'), air: all.filter((e) => e.kind === 'AIR') };
    lists.set(af, l);
  }
  return l;
}

/** The special button's move for each slot of SPECIAL_SLOTS (and the air one), for the move list. */
export function specialButtonMoves(af: Af): { ground: MoveListEntry[]; air: MoveListEntry | null } {
  const l = specialsOf(af);
  return { ground: l.ground.slice(0, SPECIAL_SLOTS.length), air: l.air[0] ?? null };
}

/**
 * The actions of the special the button does now (the directions held pick it), for the robot `harObjId`; null when
 * the button is off or the robot has no special for it.
 */
export function specialButtonActions(gs: GameState, harObjId: number, held: number): number[] | null {
  if (!settings().keys.specialButton) return null;
  const obj = gs.findObject(harObjId);
  if (!obj) return null;
  const l = specialsOf(harData(obj).afData);
  if (obj.isAirborne()) return l.air[0] ? moveActions(l.air[0].moveString, obj.direction) : null;
  if (!l.ground.length) return null;
  const fwd = obj.direction === OBJECT_FACE_LEFT ? ACT_LEFT : ACT_RIGHT;
  const back = fwd === ACT_LEFT ? ACT_RIGHT : ACT_LEFT;
  let slot = 0;
  if (held & ACT_DOWN) slot = 3;
  else if (held & ACT_UP) slot = 4;
  else if (held & fwd) slot = 1;
  else if (held & back) slot = 2;
  const e = l.ground[slot] ?? l.ground[0];
  return moveActions(e.moveString, obj.direction);
}
