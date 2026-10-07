// A player of a network game (net/session.ts): the reference's net controller in spirit. Both players get one on both
// computers; each hands out the inputs the session has for its player at the current input step, the same on both
// sides. The local player's also owns their keyboard or gamepad, which the session samples once per step (sent to the
// other game, and played `delay` steps later by both).
import { CtrlType } from '../game/constants';
import type { GameState } from '../game/gameState';
import type { NetSession } from '../net/session';
import { Controller, type CtrlEvent } from './controller';

export class NetController extends Controller {
  /**
   * `device`: the local player's keyboard or gamepad controller (null for the other player). It is polled by the
   * session, not by the scenes, so its inputs are sampled once per step whichever players a scene reads.
   */
  constructor(gs: GameState, readonly session: NetSession, readonly playerId: number, readonly device: Controller | null) {
    super(gs);
    this.type = CtrlType.NETWORK;
    if (device) session.sampleLocal = () => this.sample();
  }

  /** The local player's input now (the device as the scene set this controller up: its robot, key repeat). */
  private sample(): number[] {
    const d = this.device!;
    d.harObjId = this.harObjId;
    d.repeat = this.repeat;
    const ev: CtrlEvent[] = [];
    d.poll(ev);
    const out: number[] = [];
    for (const e of ev) if (e.type === 'action') out.push(e.action);
    return out;
  }

  override poll(ev: CtrlEvent[]): number {
    this.session.pollInto(this.playerId, ev);
    return 0;
  }

  override tick(ticks: number, ev: CtrlEvent[]): number {
    // (the device's key repeat counts down on static ticks)
    this.device?.tick(ticks, []);
    return super.tick(ticks, ev);
  }

  override rumble(magnitude: number, durationMs: number): number {
    return this.device?.rumble(magnitude, durationMs) ?? 0;
  }

  override free(): void {
    this.device?.free();
    super.free();
  }
}
