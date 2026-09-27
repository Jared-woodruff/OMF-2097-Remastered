// Training dummy: a controller that holds a fixed stance (stand, crouch, jump, block) for training mode.
import { ACT_DOWN, ACT_LEFT, ACT_RIGHT, ACT_STOP, ACT_UP, CtrlType, OBJECT_FACE_RIGHT } from '../game/constants';
import type { GameState } from '../game/gameState';
import { harData } from '../game/objects/har';
import { Controller, type CtrlEvent } from './controller';

export const enum DummyMode {
  STAND = 0,
  CROUCH,
  JUMP,
  BLOCK,
  BLOCK_LOW,
  /** Fights back (the CPU opponent; set up with an AI controller instead of this one). */
  CPU,
}

export const DUMMY_MODE_NAMES = ['STAND', 'CROUCH', 'JUMP', 'BLOCK', 'BLOCK LOW', 'CPU'];

/** Ticks between jumps in JUMP mode. */
const JUMP_INTERVAL = 70;

export class DummyController extends Controller {
  private ticks = 0;

  constructor(gs: GameState, public mode: DummyMode) {
    super(gs);
    this.type = CtrlType.KEYBOARD;
  }

  override dyntick(_ticks: number, _ev: CtrlEvent[]): number {
    this.ticks++;
    return 0;
  }

  override poll(ev: CtrlEvent[]): number {
    this.current = 0;
    const har = this.gs.findObject(this.harObjId);
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
}
