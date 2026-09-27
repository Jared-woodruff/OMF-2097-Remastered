import { ACT_DOWN, ACT_ESC, ACT_KICK, ACT_LEFT, ACT_NONE, ACT_PUNCH, ACT_RIGHT, ACT_STOP, ACT_UP, CtrlType } from '../game/constants';
import type { GameState } from '../game/gameState';
import type { KeyBindings } from '../game/settings';
import { Controller, type CtrlEvent } from './controller';
import { anyDown, isDown, readPad, rumble } from './input';

/** Converts a set of pressed directions/buttons to an action exactly like the reference keyboard poll. */
function resolveAction(
  jumpLeft: boolean, duckBack: boolean, jumpRight: boolean, duckForward: boolean,
  walkBack: boolean, walkRight: boolean, jumpUp: boolean, duck: boolean, punch: boolean, kick: boolean,
): number {
  let action = 0;
  if (jumpLeft) action = ACT_UP | ACT_LEFT;
  else if (duckBack) action = ACT_DOWN | ACT_LEFT;
  else if (jumpRight) action = ACT_UP | ACT_RIGHT;
  else if (duckForward) action = ACT_DOWN | ACT_RIGHT;
  else if (walkBack && jumpUp) action = ACT_UP | ACT_LEFT;
  else if (walkBack && duck) action = ACT_DOWN | ACT_LEFT;
  else if (walkRight && jumpUp) action = ACT_UP | ACT_RIGHT;
  else if (walkRight && duck) action = ACT_DOWN | ACT_RIGHT;
  else if (walkRight) action = ACT_RIGHT;
  else if (walkBack) action = ACT_LEFT;
  else if (jumpUp) action = ACT_UP;
  else if (duck) action = ACT_DOWN;
  if (punch) action |= ACT_PUNCH;
  if (kick) action |= ACT_KICK;
  return action;
}

export class KeyboardController extends Controller {
  /** Extra bindings merged in (e.g. player 2's keys when player 2 is the CPU). */
  extra: KeyBindings[] = [];

  constructor(gs: GameState, public keys: KeyBindings) {
    super(gs);
    this.type = CtrlType.KEYBOARD;
    this.supportsDelay = true;
  }

  private held(sel: (k: KeyBindings) => string[]): boolean {
    if (anyDown(sel(this.keys))) return true;
    for (const e of this.extra) if (anyDown(sel(e))) return true;
    return false;
  }

  override poll(ev: CtrlEvent[]): number {
    this.current = 0;
    const action = resolveAction(
      this.held((k) => k.jumpLeft), this.held((k) => k.duckBack), this.held((k) => k.jumpRight), this.held((k) => k.duckForward),
      this.held((k) => k.walkBack), this.held((k) => k.walkRight), this.held((k) => k.jumpUp), this.held((k) => k.duck),
      this.held((k) => k.punch), this.held((k) => k.kick),
    );
    this.cmd(action === 0 ? ACT_STOP : action, ev);
    this.last = this.current;
    return 0;
  }
}

export class GamepadController extends Controller {
  constructor(gs: GameState, public padIndex: number) {
    super(gs);
    this.type = CtrlType.GAMEPAD;
    this.supportsDelay = true;
  }

  override poll(ev: CtrlEvent[]): number {
    this.current = 0;
    const p = readPad(this.padIndex);
    let action = 0;
    if (p) {
      const upLeft = p.up && p.left, upRight = p.up && p.right, downLeft = p.down && p.left, downRight = p.down && p.right;
      action = resolveAction(upLeft, downLeft, upRight, downRight, p.left, p.right, p.up, p.down, p.punch, p.kick);
    }
    this.cmd(action === 0 ? ACT_STOP : action, ev);
    this.last = this.current;
    return 0;
  }

  override rumble(magnitude: number, durationMs: number): number {
    rumble(this.padIndex, magnitude, durationMs);
    return 0;
  }
}

/**
 * Menu navigation from any keyboard or gamepad (arrows/enter/escape and pad d-pad/buttons), like the reference
 * game_state_menu_poll: keyboard events are reported with a keyboard source, pad events with a gamepad source
 * (text inputs use that to offer the gamepad letter wheel).
 */
export function menuPoll(ctrl: Controller, ev: CtrlEvent[]): void {
  ctrl.type = CtrlType.KEYBOARD;
  if (ctrl.queued !== ACT_NONE) {
    ctrl.cmd(ctrl.queued, ev);
    ctrl.queued = ACT_NONE;
  }
  if (isDown('ArrowRight') || isDown('Numpad6')) ctrl.cmd(ACT_RIGHT, ev);
  if (isDown('ArrowLeft') || isDown('Numpad4')) ctrl.cmd(ACT_LEFT, ev);
  if (isDown('ArrowUp') || isDown('Numpad8')) ctrl.cmd(ACT_UP, ev);
  if (isDown('ArrowDown') || isDown('Numpad2')) ctrl.cmd(ACT_DOWN, ev);
  if (isDown('Enter') || isDown('NumpadEnter')) ctrl.cmd(ACT_PUNCH, ev);
  if (isDown('ShiftRight') || isDown('Numpad0')) ctrl.cmd(ACT_KICK, ev);
  if (isDown('Escape')) ctrl.cmd(ACT_ESC, ev);
  ctrl.type = CtrlType.GAMEPAD;
  const pads = navigator.getGamepads?.() ?? [];
  for (const gp of pads) {
    if (!gp || !gp.connected) continue;
    const p = readPad(gp.index);
    if (!p) continue;
    if (p.right) ctrl.cmd(ACT_RIGHT, ev);
    if (p.left) ctrl.cmd(ACT_LEFT, ev);
    if (p.up) ctrl.cmd(ACT_UP, ev);
    if (p.down) ctrl.cmd(ACT_DOWN, ev);
    if (p.punch || p.start) ctrl.cmd(ACT_PUNCH, ev);
    if (p.kick) ctrl.cmd(ACT_KICK, ev);
    if (p.back) ctrl.cmd(ACT_ESC, ev);
  }
}
