// Records a match while it is played (the reference arena's REC recording): the pilots, the match settings and the
// random seed when the fight starts, then every input a robot receives. The finished recording is stored as a replay
// (replay/store.ts).
import { packAction } from '../../controller/rec';
import {
  REC_CONTROLLER_AI, REC_CONTROLLER_JOYSTICK1, REC_CONTROLLER_JOYSTICK2, REC_CONTROLLER_KEYBOARD1, REC_CONTROLLER_KEYBOARD2,
  REC_GAMEMODE_ARCADE, REC_GAMEMODE_TOURNAMENT, REC_LOOKUP_ACTION, recCreate, recFinish, recMove, recSeedMove, type RecFile,
} from '../../formats/rec';
import { CtrlType } from '../constants';
import type { GameState } from '../gameState';

/** REC controller code of a player's controller (the reference records the right keyboard for player 1). */
function controllerCode(type: CtrlType, player: number): number {
  if (type === CtrlType.AI) return REC_CONTROLLER_AI;
  if (type === CtrlType.GAMEPAD) return player === 0 ? REC_CONTROLLER_JOYSTICK1 : REC_CONTROLLER_JOYSTICK2;
  return player === 0 ? REC_CONTROLLER_KEYBOARD1 : REC_CONTROLLER_KEYBOARD2;
}

export class Recorder {
  readonly rec: RecFile;
  /** The last input written per player (human players' inputs are only written when they change). */
  private last = [-1, -1];
  /**
   * A human player's first input of a tick, held back: it is written when it changed, or when more inputs follow in
   * the same tick (the special button): the replay then gets all of them, as the robot did.
   */
  private pending: ({ tick: number; sda: number; wrote: boolean } | null)[] = [null, null];
  /** Players whose every input is written: the computer, which does not send an input on every tick. */
  private readonly exact: [boolean, boolean];

  constructor(gs: GameState, arenaId: number, arenaPalette: number) {
    const rec = recCreate();
    for (let i = 0; i < 2; i++) {
      const p = gs.getPlayer(i);
      rec.pilots[i].info = p.pilot.clone();
      rec.scores[i] = p.score.score;
    }
    const [c0, c1] = [gs.getPlayer(0).ctrl.type, gs.getPlayer(1).ctrl.type];
    rec.arenaId = arenaId;
    rec.arenaPalette = arenaPalette;
    rec.gameMode = gs.isTournament() ? REC_GAMEMODE_TOURNAMENT : REC_GAMEMODE_ARCADE;
    rec.p1Controller = controllerCode(c0, 0);
    rec.p2Controller = controllerCode(c1, 1);
    rec.p2ControllerStatic = rec.p2Controller;
    const m = gs.matchSettings;
    rec.throwRange = m.throwRange;
    rec.hitPause = m.hitPause;
    rec.blockDamage = m.blockDamage;
    rec.vitality = m.vitality;
    rec.jumpHeight = m.jumpHeight;
    rec.knockDown = m.knockDown;
    rec.rehitMode = m.rehit ? 1 : 0;
    rec.defThrows = m.defensiveThrows ? 1 : 0;
    rec.power = [m.power1, m.power2];
    rec.hazards = m.hazards ? 1 : 0;
    rec.roundType = m.rounds;
    rec.hyperMode = m.fightMode;
    rec.moves.push(recSeedMove(gs.rand.seed));
    this.rec = rec;
    this.exact = [c0 === CtrlType.AI, c1 === CtrlType.AI];
  }

  /** An input a robot received (arena_handle_events -> write_rec_move). */
  record(tick: number, player: number, action: number): void {
    const sda = packAction(action);
    if (this.exact[player]) {
      this.write(tick, player, sda);
      return;
    }
    const p = this.pending[player];
    if (p && p.tick === tick) {
      // More inputs in this tick: all of them are written.
      if (!p.wrote) this.write(p.tick, player, p.sda);
      p.wrote = true;
      this.write(tick, player, sda);
      return;
    }
    this.flush(player);
    this.pending[player] = { tick, sda, wrote: false };
  }

  /** Writes a held back input if it changed. */
  private flush(player: number): void {
    const p = this.pending[player];
    this.pending[player] = null;
    if (p && !p.wrote && this.last[player] !== p.sda) this.write(p.tick, player, p.sda);
  }

  private write(tick: number, player: number, sda: number): void {
    this.last[player] = sda;
    const m = recMove(tick, REC_LOOKUP_ACTION, player);
    m.extra[0] = sda;
    this.rec.moves.push(m);
  }

  /** Ends the recording at the given tick (sd_rec_finish). */
  finish(tick: number): RecFile {
    this.flush(0);
    this.flush(1);
    recFinish(this.rec, tick);
    return this.rec;
  }
}
