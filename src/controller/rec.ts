// Replays a recorded match's inputs (port of the reference controller/rec_controller.c). Human players' recordings
// only hold the ticks where their input changed (they send an input every tick, so the controller repeats the last
// one in between, as the reference does); the computer's recordings hold every input it sent, and nothing is sent on
// other ticks (the AI does not act every tick, and an extra input would change the fight).
import {
  REC_CONTROLLER_AI, REC_LOOKUP_ACTION, REC_LOOKUP_EXTENDED, SD_ACT_DOWNDOWN, SD_ACT_DOWNLEFT, SD_ACT_DOWNRIGHT, SD_ACT_KICK,
  SD_ACT_LEFTLEFT, SD_ACT_NONE, SD_ACT_PUNCH, SD_ACT_RIGHTRIGHT, SD_ACT_UPLEFT, SD_ACT_UPRIGHT, SD_ACT_UPUP, recSeedOf,
  type RecFile, type RecMove,
} from '../formats/rec';
import { ACT_DOWN, ACT_KICK, ACT_LEFT, ACT_MASK_DIRS, ACT_PUNCH, ACT_RIGHT, ACT_STOP, ACT_UP, CtrlType } from '../game/constants';
import type { GameState } from '../game/gameState';
import { Controller, type CtrlEvent } from './controller';

/** A game action as a REC action byte (the reference arena's write_rec_move). */
export function packAction(action: number): number {
  let sda = 0;
  if (action & ACT_PUNCH) sda |= SD_ACT_PUNCH;
  if (action & ACT_KICK) sda |= SD_ACT_KICK;
  switch (action & ACT_MASK_DIRS) {
    case ACT_UP: sda |= SD_ACT_UPUP; break;
    case ACT_UP | ACT_RIGHT: sda |= SD_ACT_UPRIGHT; break;
    case ACT_RIGHT: sda |= SD_ACT_RIGHTRIGHT; break;
    case ACT_DOWN | ACT_RIGHT: sda |= SD_ACT_DOWNRIGHT; break;
    case ACT_DOWN: sda |= SD_ACT_DOWNDOWN; break;
    case ACT_DOWN | ACT_LEFT: sda |= SD_ACT_DOWNLEFT; break;
    case ACT_LEFT: sda |= SD_ACT_LEFTLEFT; break;
    case ACT_UP | ACT_LEFT: sda |= SD_ACT_UPLEFT; break;
  }
  return sda;
}

/** A REC action byte as a game action (unpack_sd_action). */
export function unpackAction(sda: number): number {
  if (sda === SD_ACT_NONE) return ACT_STOP;
  let action = 0;
  switch (sda & 0xf0) {
    case SD_ACT_UPUP: action |= ACT_UP; break;
    case SD_ACT_UPRIGHT: action |= ACT_UP | ACT_RIGHT; break;
    case SD_ACT_RIGHTRIGHT: action |= ACT_RIGHT; break;
    case SD_ACT_DOWNRIGHT: action |= ACT_DOWN | ACT_RIGHT; break;
    case SD_ACT_DOWNDOWN: action |= ACT_DOWN; break;
    case SD_ACT_DOWNLEFT: action |= ACT_DOWN | ACT_LEFT; break;
    case SD_ACT_LEFTLEFT: action |= ACT_LEFT; break;
    case SD_ACT_UPLEFT: action |= ACT_UP | ACT_LEFT; break;
  }
  if (sda & SD_ACT_PUNCH) action |= ACT_PUNCH;
  if (sda & SD_ACT_KICK) action |= ACT_KICK;
  return action;
}

export class RecController extends Controller {
  private byTick = new Map<number, RecMove[]>();
  private lastTick = -1;
  readonly maxTick: number;

  /**
   * `kind` is how the player was controlled when recording (the game's modes follow it: a recorded fight against the
   * computer plays back as a single player fight); `exact` replays only the recorded inputs (the computer's).
   */
  constructor(gs: GameState, readonly playerId: number, rec: RecFile, kind: CtrlType, readonly exact: boolean) {
    super(gs);
    this.type = kind;
    let max = 0;
    for (const m of rec.moves) {
      if (m.lookupId !== REC_LOOKUP_ACTION && m.lookupId !== REC_LOOKUP_EXTENDED) continue;
      if (m.tick > max) max = m.tick;
      if (m.playerId !== playerId) continue;
      let list = this.byTick.get(m.tick);
      if (!list) this.byTick.set(m.tick, (list = []));
      list.push(m);
    }
    this.maxTick = max;
    this.last = ACT_STOP;
  }

  override poll(ev: CtrlEvent[]): number {
    const ticks = this.gs.tick;
    if (ticks > this.maxTick) {
      this.close(ev);
      return 0;
    }
    if (this.lastTick !== ticks) {
      let found = false;
      for (const m of this.byTick.get(ticks) ?? []) {
        const seed = recSeedOf(m);
        if (seed !== null) {
          this.gs.rand.setSeed(seed);
        } else if (m.lookupId === REC_LOOKUP_ACTION) {
          const action = unpackAction(m.extra[0]);
          ev.push({ type: 'action', action, source: this.type });
          this.last = action;
          found = true;
        }
      }
      if (!found && !this.exact) ev.push({ type: 'action', action: this.last, source: this.type });
    }
    if (ticks > this.lastTick) this.lastTick = ticks;
    return 0;
  }

  /** Rewinding (the playback restarts the fight and runs it up to a tick): the inputs before `tick` are skipped. */
  reset(): void {
    this.lastTick = -1;
    this.last = ACT_STOP;
  }
}

/** The recorded controller of a player (REC header): whether it was the computer. */
export function recWasAi(controller: number): boolean {
  return controller === REC_CONTROLLER_AI;
}
