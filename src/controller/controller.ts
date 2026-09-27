// Controllers turn device input (or AI decisions) into game actions (port of the reference controller layer).
import { ACT_ESC, ACT_KICK, ACT_MASK_DIRS, ACT_NONE, ACT_PUNCH, ACT_STOP, CtrlType, HarEventType } from '../game/constants';
import type { GameState } from '../game/gameState';

export interface CtrlEvent {
  type: 'action' | 'close';
  action: number;
  source: CtrlType;
}

export interface HarEvent {
  type: HarEventType;
  playerId: number;
  move?: import('../resources/resources').AfMove | null;
  info?: import('../resources/resources').BkInfo | null;
  wall?: number;
  direction?: number;
}

const DELAY_BUFFER_SIZE = 11;

interface DelayBufferElement {
  tick: number;
  actions: number[];
}

export class Controller {
  gs: GameState;
  type: CtrlType = CtrlType.KEYBOARD;
  delay = 0;
  supportsDelay = false;
  harObjId = 0;
  rtt = 0;
  repeat = 0;
  repeatTick = 0;
  current = 0;
  last = 0;
  queued = ACT_NONE;
  private hooks: ((action: number) => void)[] = [];
  private buffer: DelayBufferElement[] | null = null;

  constructor(gs: GameState) {
    this.gs = gs;
  }

  addHook(fn: (action: number) => void): void {
    this.hooks.push(fn);
  }

  clearHooks(): void {
    this.hooks = [];
  }

  setRepeat(r: number): void {
    this.repeat = r;
  }

  setDelay(delay: number): boolean {
    if (this.supportsDelay && delay > 0 && delay <= 10) {
      if (!this.buffer) {
        this.buffer = [];
        for (let i = 0; i < DELAY_BUFFER_SIZE; i++) this.buffer.push({ tick: 0, actions: [] });
      }
      this.delay = delay;
      return true;
    }
    this.delay = 0;
    return false;
  }

  /** Emits an action, applying menu key-repeat filtering and optional input delay. */
  cmd(action: number, ev: CtrlEvent[]): void {
    this.current |= action;
    action &= ~(this.last & (ACT_KICK | ACT_PUNCH | ACT_ESC));
    if (!this.repeat && action & ACT_MASK_DIRS) {
      if (this.repeatTick === 0 || !(this.last & ACT_MASK_DIRS)) {
        this.repeatTick = 30;
      } else {
        action &= ~ACT_MASK_DIRS;
      }
    }
    if (action === ACT_NONE) action = ACT_STOP;
    for (const h of this.hooks) h(action);
    if (this.delay && this.buffer) {
      const tick = this.gs.tick;
      let buf = this.buffer[(tick + this.delay) % DELAY_BUFFER_SIZE];
      if (buf.tick !== tick + this.delay) {
        buf.tick = tick + this.delay;
        buf.actions = [];
      }
      if (buf.actions.length < 10 && buf.actions[buf.actions.length - 1] !== action) buf.actions.push(action);
      buf = this.buffer[tick % DELAY_BUFFER_SIZE];
      if (buf.tick !== tick) return;
      for (const a of buf.actions) ev.push({ type: 'action', action: a, source: this.type });
      buf.tick = 0;
    } else {
      ev.push({ type: 'action', action, source: this.type });
    }
  }

  close(ev: CtrlEvent[]): void {
    ev.length = 0;
    ev.push({ type: 'close', action: 0, source: this.type });
  }

  /** Static tick (100 Hz). */
  tick(_ticks: number, _ev: CtrlEvent[]): number {
    if (this.repeatTick) this.repeatTick--;
    return this.onTick(_ticks, _ev);
  }

  protected onTick(_ticks: number, _ev: CtrlEvent[]): number {
    return 0;
  }

  /** Dynamic tick (game speed). */
  dyntick(_ticks: number, _ev: CtrlEvent[]): number {
    return 0;
  }

  poll(_ev: CtrlEvent[]): number {
    return 0;
  }

  harHook(_event: HarEvent): number {
    return 0;
  }

  rumble(_magnitude: number, _durationMs: number): number {
    return 0;
  }

  free(): void {
    this.clearHooks();
  }
}
