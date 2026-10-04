import { ACT_DOWN, ACT_ESC, ACT_KICK, ACT_LEFT, ACT_NONE, ACT_PUNCH, ACT_RIGHT, ACT_STOP, ACT_UP, CtrlType } from '../game/constants';
import type { GameState } from '../game/gameState';
import type { KeyBindings } from '../game/settings';
import { Controller, type CtrlEvent } from './controller';
import { anyDown, connectedPads, isDown, readPad, rumble } from './input';
import { specialButtonActions } from './special';
import { touchPad } from '../platform/touch';
import { settings } from '../game/settings';

/**
 * The special button went down: the special move's whole input follows the tick's action, one event per input, so the
 * robot takes them in this tick (see controller/special.ts).
 */
function pushSpecial(ctrl: Controller, pressed: boolean, wasPressed: boolean, action: number, ev: CtrlEvent[]): void {
  if (!pressed || wasPressed) return;
  const actions = specialButtonActions(ctrl.gs, ctrl.harObjId, action);
  if (!actions) return;
  for (const a of actions) {
    ctrl.current |= a;
    ev.push({ type: 'action', action: a, source: ctrl.type });
  }
}

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

/**
 * Keyboard player. It also plays with a gamepad when one is free: the first free pad for player 1, the second for
 * player 2 (pads assigned to a player in the input menu are not free), so a controller works without any setup.
 */
export class KeyboardController extends Controller {
  /** Extra bindings merged in (e.g. player 2's keys when player 2 is the CPU). */
  extra: KeyBindings[] = [];
  /** Which free gamepad this player also reads (-1: none), and the pads that are not free. */
  padSlot = -1;
  reservedPads: () => number[] = () => [];
  private specialHeld = false;

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

  /** The gamepad this player reads besides the keyboard, or -1. */
  pad(): number {
    if (this.padSlot < 0) return -1;
    const reserved = this.reservedPads();
    return connectedPads().filter((i) => !reserved.includes(i))[this.padSlot] ?? -1;
  }

  override poll(ev: CtrlEvent[]): number {
    this.current = 0;
    const padIndex = this.pad();
    const pad = padIndex >= 0 ? readPad(padIndex) : null;
    // Player 1 also plays with the touch controls.
    const touch = this.keys === settings().keys.p1 ? touchPad() : null;
    const p = touch ? {
      up: touch.up || !!pad?.up, down: touch.down || !!pad?.down, left: touch.left || !!pad?.left, right: touch.right || !!pad?.right,
      punch: touch.punch || !!pad?.punch, kick: touch.kick || !!pad?.kick, special: touch.special || !!pad?.special,
    } : pad;
    const pu = !!p?.up, pd = !!p?.down, pl = !!p?.left, pr = !!p?.right;
    const action = resolveAction(
      this.held((k) => k.jumpLeft) || (pu && pl), this.held((k) => k.duckBack) || (pd && pl),
      this.held((k) => k.jumpRight) || (pu && pr), this.held((k) => k.duckForward) || (pd && pr),
      this.held((k) => k.walkBack) || pl, this.held((k) => k.walkRight) || pr, this.held((k) => k.jumpUp) || pu,
      this.held((k) => k.duck) || pd, this.held((k) => k.punch) || !!p?.punch, this.held((k) => k.kick) || !!p?.kick,
    );
    this.cmd(action === 0 ? ACT_STOP : action, ev);
    const special = this.held((k) => k.special ?? []) || !!p?.special;
    pushSpecial(this, special, this.specialHeld, action, ev);
    this.specialHeld = special;
    this.last = this.current;
    return 0;
  }

  override rumble(magnitude: number, durationMs: number): number {
    const padIndex = this.pad();
    if (padIndex >= 0) rumble(padIndex, magnitude, durationMs);
    return 0;
  }
}

export class GamepadController extends Controller {
  private specialHeld = false;

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
    const special = !!p?.special;
    pushSpecial(this, special, this.specialHeld, action, ev);
    this.specialHeld = special;
    this.last = this.current;
    return 0;
  }

  override rumble(magnitude: number, durationMs: number): number {
    rumble(this.padIndex, magnitude, durationMs);
    return 0;
  }
}

/** How a scene uses the pads besides its menus. */
export interface MenuPollOptions {
  /**
   * The players' controllers are read in this scene too (character select, VS screen, a running fight): the pads'
   * face buttons belong to the players, so only the View button goes back.
   */
  playerScene?: boolean;
  /** The Menu button toggles the pause menu (fights) instead of confirming. */
  startIsEsc?: boolean;
}

/** The keys menuPoll reads (the others are free for the menus' text boxes). */
export const MENU_POLL_KEYS: ReadonlySet<string> = new Set([
  'ArrowRight', 'Numpad6', 'ArrowLeft', 'Numpad4', 'ArrowUp', 'Numpad8', 'ArrowDown', 'Numpad2', 'Enter', 'NumpadEnter',
  'ShiftRight', 'Numpad0', 'Escape',
]);

/**
 * Menu navigation from any keyboard or gamepad (arrows/enter/escape and pad d-pad/buttons), like the reference
 * game_state_menu_poll: keyboard events are reported with a keyboard source, pad events with a gamepad source
 * (text inputs use that to offer the gamepad letter wheel). Pads follow the Xbox conventions: A confirms, B goes back,
 * X and Y are the second button (kick), Menu confirms (or pauses in fights), View goes back.
 */
export function menuPoll(ctrl: Controller, ev: CtrlEvent[], opts: MenuPollOptions = {}): void {
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
    if (p.back) ctrl.cmd(ACT_ESC, ev);
    if (p.start) ctrl.cmd(opts.startIsEsc ? ACT_ESC : ACT_PUNCH, ev);
    if (opts.playerScene) continue;
    if (p.right) ctrl.cmd(ACT_RIGHT, ev);
    if (p.left) ctrl.cmd(ACT_LEFT, ev);
    if (p.up) ctrl.cmd(ACT_UP, ev);
    if (p.down) ctrl.cmd(ACT_DOWN, ev);
    if (p.a) ctrl.cmd(ACT_PUNCH, ev);
    if (p.x || p.y) ctrl.cmd(ACT_KICK, ev);
    if (p.b) ctrl.cmd(ACT_ESC, ev);
  }
}
