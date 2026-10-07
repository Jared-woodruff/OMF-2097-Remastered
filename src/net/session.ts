// A network game in progress: both games run the same simulation, in step, and exchange their players' inputs (delay
// based lockstep). The fights are deterministic: the same robots, rules, random seed and inputs play out the same
// (replays rely on it too), so the two games only send each other what their player pressed.
//
// The screens both play in step (the robot select screen, the VS screen and the fights) are "phases": each one the
// games enter is numbered, and a phase's input steps are the scene's input polls (Scene.doInputPoll), counted from
// its start. A player's input sampled at step n is used at step n + delay on both sides (the steps before the delay
// have none), so it has `delay` steps of time to reach the other game; a game whose next step's inputs have not
// arrived waits (the engine skips its dynamic tick, see GameState.dynamicTickReady). The other screens (the victory
// screen) are each game's own: the game that leaves first waits for the other at the next phase.
import type { CtrlEvent } from '../controller/controller';
import { ACT_STOP, CtrlType, isArenaScene, MS_PER_OMF_TICK_SLOWEST, SceneId, STATIC_TICKS } from '../game/constants';
import type { NetLink } from './link';
import { parseMessage, type NetMessage, type NetRules } from './protocol';

/** The screens both games play in step: the robot select screen, the VS screen and the fights. */
export function isSyncedScene(id: SceneId): boolean {
  return id === SceneId.MELEE || id === SceneId.VS || isArenaScene(id);
}

/** Fights compare their state this often (input steps). */
const SUM_EVERY = 30;
/** A ping this often (ms) keeps the connection's silence short when no inputs flow (the victory screen). */
const PING_EVERY_MS = 1000;
/** Nothing heard for this long (ms): the other game is gone. */
const TIMEOUT_MS = 15000;
/** At most this many steps of delay. */
const MAX_DELAY = 12;

/** Why a network game ended. */
export type NetEndKind = 'left' | 'peerLeft' | 'lost' | 'timeout' | 'desync';

export interface NetEnd {
  kind: NetEndKind;
  /** What to tell the player. */
  message: string;
}

export interface NetSessionOptions {
  link: NetLink;
  /** The player this game controls (the host is player 1, index 0). */
  localPlayer: 0 | 1;
  /** Both players' names (player 1, player 2). */
  names: [string, string];
  rules: NetRules;
  seed: number;
  /** The clock (ms; tests pass their own). */
  now?: () => number;
  /** Pings and the timeout run on their own timer (tests call heartbeat() themselves). */
  timers?: boolean;
}

interface RemotePhase {
  scene: number;
  steps: Map<number, number[]>;
}

export class NetSession {
  readonly localPlayer: 0 | 1;
  readonly names: [string, string];
  readonly rules: NetRules;
  readonly seed: number;
  private readonly link: NetLink;
  private readonly now: () => number;
  /** The game is over (the end tells why). */
  ended: NetEnd | null = null;
  /** Called once when the game ends. */
  onEnd: ((end: NetEnd) => void) | null = null;
  /** The local player's input this step (the local NetController's device, see controller/net.ts). */
  sampleLocal: () => number[] = () => [ACT_STOP];
  /** The local player's input is held back (a menu of their own is open over the fight): they stand still. */
  suppressLocal: () => boolean = () => false;
  /** The fight's state as a number (desync detection); null: not compared. */
  checksum: (() => number) | null = null;

  /** The phase under way (0: none yet) and whether the current scene is one. */
  phase = 0;
  synced = false;
  private scene: number = SceneId.NONE;
  private step = 0;
  private delay = 1;
  private localFrames = new Map<number, number[]>();
  private remote = new Map<number, RemotePhase>();
  /** This step's inputs per player (between beginStep and endStep), and which players took theirs. */
  private frame: [number[], number[]] | null = null;
  private taken = [false, false];
  private injected: number[] = [];
  private localSums = new Map<string, number>();
  private remoteSums = new Map<string, number>();
  private peerBye: string | null = null;
  private lastHeard: number;
  private lastPing: number;
  private stalledAt = -1;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** The last round trip time measured (ms). */
  rtt = 0;

  constructor(opts: NetSessionOptions) {
    this.link = opts.link;
    this.localPlayer = opts.localPlayer;
    this.names = opts.names;
    this.rules = opts.rules;
    this.seed = opts.seed >>> 0;
    this.now = opts.now ?? (() => performance.now());
    this.lastHeard = this.lastPing = this.now();
    this.link.setHandlers((text) => this.receive(text), (reason) => this.linkClosed(reason));
    if (opts.timers !== false) this.timer = setInterval(() => this.heartbeat(), 250);
  }

  /** The other player's name. */
  get opponent(): string {
    return this.names[1 - this.localPlayer];
  }

  /** The other end's address. */
  get peer(): string {
    return this.link.peer;
  }

  // ---- phases and steps ------------------------------------------------------------------------------------------

  /** Steps of delay in a scene: the rules' delay in the scene's input steps (both games work it out the same). */
  delayFor(id: SceneId): number {
    const ms = isArenaScene(id)
      ? Math.trunc(8 + MS_PER_OMF_TICK_SLOWEST - ((this.rules.speed + 5) / 15) * MS_PER_OMF_TICK_SLOWEST)
      : STATIC_TICKS;
    return Math.max(1, Math.min(MAX_DELAY, Math.ceil(this.rules.delayMs / Math.max(1, ms))));
  }

  /** A scene opens (GameState.createScene, before the scene is made): a screen played in step starts a phase. */
  sceneChanged(id: SceneId): void {
    this.frame = null;
    this.stalledAt = -1;
    this.localSums.clear();
    this.remoteSums.clear();
    if (this.ended || !isSyncedScene(id)) {
      this.synced = false;
      return;
    }
    this.synced = true;
    this.phase++;
    this.scene = id;
    this.step = 0;
    this.delay = this.delayFor(id);
    this.localFrames.clear();
    this.injected = [];
    for (const p of [...this.remote.keys()]) if (p < this.phase) this.remote.delete(p);
    const r = this.remote.get(this.phase);
    if (r && r.scene !== id) this.desync();
  }

  /** The random seed of the fight starting now (the same in both games). */
  fightSeed(): number {
    let h = (this.seed ^ Math.imul(this.phase, 0x9e3779b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  /** Whether the next input step can run: its inputs from the other game are here (else the game waits). */
  ready(): boolean {
    if (!this.synced || this.ended) return true;
    const ok = this.step < this.delay || !!this.remote.get(this.phase)?.steps.has(this.step);
    if (ok) this.stalledAt = -1;
    else if (this.stalledAt < 0) this.stalledAt = this.now();
    return ok;
  }

  /** The other game is on this screen too (its inputs for this phase have come). */
  peerArrived(): boolean {
    return this.synced && this.remote.has(this.phase);
  }

  /** How long the game has been waiting for the other one (ms; 0: it is not). */
  stalledMs(): number {
    return this.stalledAt < 0 || this.ended ? 0 : this.now() - this.stalledAt;
  }

  /** An input step begins (before the scene polls the players): the local input is sampled and sent. */
  beginStep(): void {
    if (!this.synced || this.ended) return;
    // (sampled whatever happens, so the device's own state, held keys and repeats, goes on as in a local game)
    let local = this.sampleLocal().slice(0, 12);
    if (this.suppressLocal()) local = [ACT_STOP];
    if (this.injected.length) local = local.concat(this.injected).slice(0, 16);
    this.injected = [];
    const target = this.step + this.delay;
    this.localFrames.set(target, local);
    this.send({ t: 'in', p: this.phase, s: target, sc: this.scene, a: local });
    const remote = this.remote.get(this.phase)?.steps.get(this.step);
    if (this.step >= this.delay && !remote) {
      // (the engine waits for them: a step without them would play out differently in the two games)
      this.end({ kind: 'desync', message: 'The game got out of step with the other one: the network game ended.' });
      return;
    }
    const mine = this.localFrames.get(this.step) ?? [ACT_STOP];
    const theirs = remote ?? [ACT_STOP];
    this.frame = this.localPlayer === 0 ? [mine, theirs] : [theirs, mine];
    this.taken = [false, false];
  }

  /** A player's inputs of this step (their controller's poll; once per step). */
  pollInto(player: number, ev: CtrlEvent[]): void {
    if (this.ended) {
      ev.push({ type: 'close', action: 0, source: CtrlType.NETWORK });
      return;
    }
    const f = this.frame;
    if (!f || this.taken[player]) return;
    this.taken[player] = true;
    for (const a of f[player]) ev.push({ type: 'action', action: a, source: CtrlType.NETWORK });
  }

  /** The step is over (after the scene's input poll): fights compare their state now and then. */
  endStep(): void {
    if (!this.frame) return;
    this.frame = null;
    if (isArenaScene(this.scene) && this.checksum && this.step % SUM_EVERY === 0) {
      const h = this.checksum() >>> 0;
      const key = `${this.phase}:${this.step}`;
      this.localSums.set(key, h);
      this.send({ t: 'sum', p: this.phase, s: this.step, h });
      this.compareSums(key);
    }
    this.localFrames.delete(this.step);
    this.remote.get(this.phase)?.steps.delete(this.step);
    this.step++;
  }

  /** An input of the local player's that the scene reads apart from their controls (ESC): sent with the next step. */
  inject(action: number): void {
    if (this.synced && !this.ended && this.injected.length < 4) this.injected.push(action);
  }

  // ---- messages --------------------------------------------------------------------------------------------------

  private send(m: NetMessage): void {
    if (this.ended) return;
    this.link.send(JSON.stringify(m));
  }

  private receive(text: string): void {
    if (this.ended) return;
    const m = parseMessage(text);
    if (!m) return;
    this.lastHeard = this.now();
    switch (m.t) {
      case 'in': {
        if (m.p < this.phase) return;
        let r = this.remote.get(m.p);
        if (!r) this.remote.set(m.p, (r = { scene: m.sc, steps: new Map() }));
        // (the other game is on another screen: the two have gone their own ways)
        if (r.scene !== m.sc || (m.p === this.phase && this.synced && m.sc !== this.scene)) {
          this.desync();
          return;
        }
        r.steps.set(m.s, m.a);
        return;
      }
      case 'sum': {
        const key = `${m.p}:${m.s}`;
        this.remoteSums.set(key, m.h >>> 0);
        this.compareSums(key);
        return;
      }
      case 'ping':
        this.send({ t: 'pong', n: m.n });
        return;
      case 'pong':
        this.rtt = Math.max(0, this.now() - m.n);
        return;
      case 'bye':
        this.peerBye = m.reason;
        if (m.reason === 'desync') this.desync();
        else this.end({ kind: 'peerLeft', message: `${this.opponent} left the game.` });
        return;
    }
  }

  private compareSums(key: string): void {
    const a = this.localSums.get(key), b = this.remoteSums.get(key);
    if (a === undefined || b === undefined) return;
    this.localSums.delete(key);
    this.remoteSums.delete(key);
    if (a !== b) this.desync();
  }

  private desync(): void {
    this.end({ kind: 'desync', message: `The fight got out of sync with ${this.opponent}'s game: the network game ended.` });
  }

  private linkClosed(_reason: string): void {
    if (this.ended) return;
    if (this.peerBye !== null) this.end({ kind: 'peerLeft', message: `${this.opponent} left the game.` });
    else this.end({ kind: 'lost', message: `The connection to ${this.opponent} was lost.` });
  }

  /** Pings now and then, and gives up on a game that stopped answering (called on a timer). */
  heartbeat(): void {
    if (this.ended) return;
    const now = this.now();
    if (now - this.lastHeard > TIMEOUT_MS) {
      this.end({ kind: 'timeout', message: `${this.opponent} stopped answering: the network game ended.` });
      return;
    }
    if (now - this.lastPing >= PING_EVERY_MS) {
      this.lastPing = now;
      this.send({ t: 'ping', n: now });
    }
  }

  // ---- the end ---------------------------------------------------------------------------------------------------

  /**
   * Leaves the game (the other player is told). `byPeer`: the other player's leaving came with their inputs (their ESC
   * on the select screen) before their goodbye did.
   */
  leave(byPeer = false): void {
    if (this.ended) return;
    this.send({ t: 'bye', reason: 'left' });
    if (byPeer) this.end({ kind: 'peerLeft', message: `${this.opponent} left the game.` });
    else this.end({ kind: 'left', message: 'You left the network game.' });
  }

  private end(end: NetEnd): void {
    if (this.ended) return;
    // (the other game hears why: it may not have seen the difference itself)
    if (end.kind === 'desync' && this.peerBye === null) this.send({ t: 'bye', reason: 'desync' });
    this.ended = end;
    this.synced = false;
    this.frame = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.link.close();
    this.onEnd?.(end);
  }
}
