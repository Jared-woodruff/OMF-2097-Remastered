// Network games (src/net): two games in this process, joined by a loopback link with latency and running at different
// frame rates, play a whole round of the select screen, the VS screen and a fight; both must see the same fight, tick
// for tick. Also the handshake's checks, leaving, losing the connection, and a fight that gets out of sync; the help
// over a network game, a game that stalls or ends before it began, and the LAN page.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Controller, type CtrlEvent } from '../controller/controller';
import { setKeyState } from '../controller/input';
import { Engine } from '../engine';
import { ACT_DOWN, ACT_ESC, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_STOP, ACT_UP, CtrlType, SceneId } from '../game/constants';
import { registerScene, type GameState } from '../game/gameState';
import { HelpOverlay, helpOverlayHeld } from '../game/gui/helpOverlay';
import { harData } from '../game/objects/har';
import { MeleeScene } from '../game/scenes/melee';
import type { VsScene } from '../game/scenes/vs';
import { settings } from '../game/settings';
import { modArenas, resetMods } from '../mods/registry';
import { contentMismatch, guestHandshake, hostHandshake, readMatchSettings, rejectText } from '../net/handshake';
import { setLanBackend, type LanBackend, type LanGame } from '../net/lan';
import { LanPage, networkHint } from '../net/lanPage';
import { LoopbackPair, type NetLink } from '../net/link';
import { hostRules, netContent, startNetGame } from '../net/netplay';
import { cleanName, NET_PROTOCOL, parseMessage, type NetContent } from '../net/protocol';
import { NetSession, type NetEnd } from '../net/session';
import { netStatusOf } from '../net/statusBar';
import { APP_VERSION } from '../platform/versionLabel';
import { drawList } from '../video/draw';
import { vga } from '../video/vga';
import { createGame, hasExtras, hasGameData, loadExtras } from './harness';

/** A player pressing what a function of the poll count says (the tests' players). */
class Scripted extends Controller {
  private n = 0;
  constructor(gs: GameState, private next: (n: number) => number) {
    super(gs);
  }
  override poll(ev: CtrlEvent[]): number {
    this.current = 0;
    const a = this.next(this.n++);
    this.cmd(a === 0 ? ACT_STOP : a, ev);
    this.last = this.current;
    return 0;
  }
}

/** A player pressing what is queued, one input a poll (nothing in between). */
function taps(): { queue: number[]; next: (n: number) => number } {
  const queue: number[] = [];
  return { queue, next: () => queue.shift() ?? 0 };
}

/** A player mashing buttons (each game's from its own seed). */
function masher(seed: number): (n: number) => number {
  const dirs = [0, 0, ACT_UP, ACT_DOWN, ACT_LEFT, ACT_RIGHT, ACT_UP | ACT_RIGHT, ACT_UP | ACT_LEFT, ACT_DOWN | ACT_LEFT, ACT_DOWN | ACT_RIGHT];
  let r = seed >>> 0;
  let held = 0;
  let left = 0;
  return () => {
    if (left-- <= 0) {
      r = (Math.imul(r, 1103515245) + 12345) >>> 0;
      const v = r >>> 8;
      held = dirs[v % dirs.length];
      if ((v >>> 5) % 4 === 0) held |= ACT_PUNCH;
      else if ((v >>> 9) % 5 === 0) held |= ACT_KICK;
      left = (v >>> 13) % 6;
    }
    return held;
  };
}

/** Rules for the tests that need no game files (the original game's match settings, speed 7, the LAN delay). */
function testRules() {
  return {
    match: { throwRange: 100, hitPause: 4, blockDamage: 0, vitality: 100, jumpHeight: 100, knockDown: 0, rehit: false, defensiveThrows: false,
      power1: 5, power2: 5, hazards: true, rounds: 1, fightMode: 0, sim: false },
    speed: 7, delayMs: 40,
  };
}

/** A fight's state at a tick, as the replay tests compare it. */
function snapshot(gs: GameState): string {
  return [0, 1].map((i) => {
    const o = gs.findObject(gs.getPlayer(i).harObjId);
    if (!o) return '-';
    const h = harData(o);
    return [o.posX.toFixed(3), o.posY.toFixed(3), o.velX.toFixed(3), o.velY.toFixed(3), h.health, h.endurance, h.state,
      o.curAnimation?.id ?? -1, o.curSpriteId].join(',');
  }).join(' | ');
}

interface Side {
  gs: GameState;
  session: NetSession;
  engine: Engine;
  /** Fight states by phase and tick. */
  trace: Map<string, string>;
  end: NetEnd | null;
  /** Milliseconds per frame. */
  frame: number;
  next: number;
}

/** Two games joined by a loopback link with `latency` ms, the host drawing a frame every 16 ms, the guest every 23. */
function netGame(latency: number, players: [(n: number) => number, (n: number) => number], tweak?: (rules: ReturnType<typeof hostRules>) => void) {
  const pair = new LoopbackPair(latency);
  const games = [createGame(SceneId.MENU), createGame(SceneId.MENU)];
  const rules = hostRules(games[0]);
  rules.match.rounds = 0;
  tweak?.(rules);
  let clock = 0;
  const sides: Side[] = games.map((gs, i) => {
    const session = new NetSession({
      link: i === 0 ? pair.a : pair.b, localPlayer: i as 0 | 1, names: ['HOST', 'GUEST'], rules, seed: 0xc0ffee, now: () => clock,
      timers: false,
    });
    const side: Side = { gs, session, engine: new Engine(gs, { render() {} }), trace: new Map(), end: null, frame: i === 0 ? 16 : 23, next: 0 };
    startNetGame(gs, session, { device: new Scripted(gs, players[i]), onEnd: (e) => (side.end = e) });
    const tick = gs.dynamicTick.bind(gs);
    gs.dynamicTick = () => {
      tick();
      if (gs.sc.isArena()) side.trace.set(`${session.phase}:${gs.tick}`, snapshot(gs));
    };
    return side;
  });
  /** Runs both games for `ms` of the clock, or until `until` holds. */
  const run = (ms: number, until: () => boolean = () => false) => {
    const end = clock + ms;
    while (clock < end && !until()) {
      const side = sides[0].next <= sides[1].next ? sides[0] : sides[1];
      clock = side.next;
      pair.run(clock);
      side.engine.advance(side.frame);
      drawList.begin();
      side.gs.render();
      side.next += side.frame;
      if (clock % 1000 < side.frame) for (const s of sides) s.session.heartbeat();
    }
  };
  return { pair, sides, run, now: () => clock };
}

describe('net protocol', () => {
  it('reads only well formed messages', () => {
    expect(parseMessage('{"t":"in","p":1,"s":4,"sc":10,"a":[16,2]}')).toEqual({ t: 'in', p: 1, s: 4, sc: 10, a: [16, 2] });
    expect(parseMessage('{"t":"in","p":1,"s":4,"sc":10,"a":["x"]}')).toBeNull();
    expect(parseMessage('{"t":"in","p":1.5,"s":4,"sc":10,"a":[]}')).toBeNull();
    expect(parseMessage('{"t":"evil"}')).toBeNull();
    expect(parseMessage('not json')).toBeNull();
    expect(parseMessage('{"t":"bye","reason":"left"}')).toEqual({ t: 'bye', reason: 'left' });
    // (a ping carries a clock reading: any number, not a word or an infinity)
    expect(parseMessage('{"t":"ping","n":1234.5678}')).toEqual({ t: 'ping', n: 1234.5678 });
    expect(parseMessage('{"t":"ping","n":"soon"}')).toBeNull();
    expect(parseMessage('{"t":"pong","n":1e999}')).toBeNull();
  });

  it('pings are read and answered (not more than now and then), and the answer measures the round trip', () => {
    const pair = new LoopbackPair(10);
    let clock = 1000.25;
    const rules = testRules();
    const session = (link: NetLink, localPlayer: 0 | 1) =>
      new NetSession({ link, localPlayer, names: ['HOST', 'GUEST'], rules, seed: 1, now: () => clock, timers: false });
    const host = session(pair.a, 0);
    const guest = session(pair.b, 1);
    const answers = vi.spyOn(pair.b, 'send');
    const pongs = () => answers.mock.calls.filter(([t]) => t.includes('"pong"')).length;
    // (the clock is not a whole number of milliseconds: the ping is)
    clock += 1000;
    host.heartbeat();
    pair.run(pair.now + 10);
    expect(pongs()).toBe(1);
    clock += 20;
    pair.run(pair.now + 10);
    expect(host.rtt).toBeCloseTo(20.25);
    // A game pinging faster than it should is not answered each time.
    for (let i = 0; i < 10; i++) pair.a.send('{"t":"ping","n":5}');
    pair.run(pair.now + 10);
    expect(pongs()).toBe(1);
    clock += 300;
    pair.a.send('{"t":"ping","n":6}');
    pair.run(pair.now + 10);
    expect(pongs()).toBe(2);
    // Pings alone keep a game that is not waiting for inputs going (the victory screen): nothing else comes for a minute.
    for (let i = 0; i < 60; i++) {
      clock += 1000;
      host.heartbeat();
      guest.heartbeat();
      pair.run(pair.now + 20);
    }
    expect(host.ended ?? guest.ended).toBeNull();
  });

  it('a link nobody listens to lets go of a flood of messages, and closes', () => {
    const pair = new LoopbackPair(0);
    // (a game sends a few messages before the other listens: those wait for it)
    pair.a.send('{"t":"ping","n":1}');
    pair.run();
    let got: string[] = [];
    pair.b.setHandlers((t) => got.push(t), () => {});
    expect(got).toHaveLength(1);
    pair.b.detach();
    for (let i = 0; i < 1500; i++) pair.a.send('{"t":"ping","n":1}');
    pair.run();
    got = [];
    let closed = '';
    pair.b.setHandlers((t) => got.push(t), (reason) => (closed = reason));
    expect(got).toEqual([]);
    expect(closed).toMatch(/too much/);
    pair.run();
    expect(pair.a.closed).toBe(true);
  });

  it('cleans names and match settings', () => {
    expect(cleanName('  jared <script> woodruff ')).toBe('JARED SCRIPT');
    expect(readMatchSettings({ throwRange: 100, hitPause: 4, blockDamage: 0, vitality: 1e9, jumpHeight: 100, knockDown: 0, rehit: false,
      defensiveThrows: false, power1: 5, power2: 99, hazards: true, rounds: 1, fightMode: 0 })).toMatchObject({ vitality: 1000, power2: 8, sim: false });
    expect(readMatchSettings({ throwRange: 'far' })).toBeNull();
  });

  it('says why two games cannot play together', () => {
    const c: NetContent = { robots: [0, 1, 2], arenas: [0, 1], pilots: [], files: 'abc' };
    expect(contentMismatch(c, { ...c })).toBeNull();
    expect(contentMismatch(c, { ...c, robots: [0, 1, 2, 11] })).toMatch(/different robots/);
    expect(contentMismatch(c, { ...c, arenas: [0] })).toMatch(/different arenas/);
    expect(contentMismatch(c, { ...c, files: 'abd' })).toMatch(/files differ/);
  });
});

describe('net handshake', () => {
  const content: NetContent = { robots: [0], arenas: [0], pilots: [], files: 'f' };
  const rules = {
    match: { throwRange: 100, hitPause: 4, blockDamage: 0, vitality: 100, jumpHeight: 100, knockDown: 0, rehit: false, defensiveThrows: false,
      power1: 5, power2: 5, hazards: true, rounds: 1, fightMode: 0, sim: false },
    speed: 7, delayMs: 40,
  };

  /** Runs the loopback until both promises settle. */
  async function settle<A, B>(pair: LoopbackPair, a: Promise<A>, b: Promise<B>): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> {
    const both = Promise.allSettled([a, b]);
    for (let i = 0; i < 20; i++) {
      pair.run(pair.now + 10);
      await new Promise((r) => setTimeout(r, 0));
    }
    return both as Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]>;
  }

  it('starts a game with the rules of the host, and the messages after it wait for the game', async () => {
    const pair = new LoopbackPair(5);
    const [h, g] = await settle(pair,
      hostHandshake(pair.a, { name: 'HOST', version: '1.0', content, rules, seed: 77 }),
      guestHandshake(pair.b, 'guest', '1.0', content));
    expect(h).toEqual({ status: 'fulfilled', value: 'GUEST' });
    expect(g.status).toBe('fulfilled');
    if (g.status !== 'fulfilled') return;
    expect(g.value.hostName).toBe('HOST');
    expect(g.value.name).toBe('GUEST');
    expect(g.value.seed).toBe(77);
    expect(g.value.rules.speed).toBe(7);
    expect(g.value.rules.match).toEqual(rules.match);
    // (sent right after the welcome: kept for the session)
    pair.a.send('{"t":"ping","n":5}');
    pair.run(pair.now + 10);
    const got: string[] = [];
    pair.b.setHandlers((t) => got.push(t), () => {});
    expect(got).toEqual(['{"t":"ping","n":5}']);
  });

  it('tells two players of the same name apart', async () => {
    const pair = new LoopbackPair(1);
    const [h, g] = await settle(pair,
      hostHandshake(pair.a, { name: 'PLAYER', version: '1.0', content, rules, seed: 1 }),
      guestHandshake(pair.b, 'player', '1.0', content));
    expect(h).toEqual({ status: 'fulfilled', value: 'PLAYER 2' });
    expect(g.status === 'fulfilled' && g.value.name).toBe('PLAYER 2');
  });

  it('turns away another version or other content, saying why', async () => {
    const cases: [string, NetContent, RegExp][] = [
      ['0.9', content, /different versions/],
      ['1.0', { ...content, arenas: [0, 5] }, /different arenas/],
    ];
    for (const [version, theirs, reason] of cases) {
      const pair = new LoopbackPair(1);
      const [h, g] = await settle(pair,
        hostHandshake(pair.a, { name: 'HOST', version: '1.0', content, rules, seed: 1 }),
        guestHandshake(pair.b, 'GUEST', version, theirs));
      expect(h.status).toBe('rejected');
      expect(g.status).toBe('rejected');
      if (g.status === 'rejected') expect(String(g.reason)).toMatch(reason);
    }
    expect(NET_PROTOCOL).toBeGreaterThan(0);
  });

  it('says in the game\'s language that a game is already being played, or that the other game went', async () => {
    // (the desktop app's answer to a second guest, src-tauri/src/lan.rs BUSY)
    const pair = new LoopbackPair(1);
    const joining = guestHandshake(pair.b, 'GUEST', '1.0', content);
    pair.a.send('{"t":"reject","reason":"That game is already being played.","code":"busy"}');
    const [, g] = await settle(pair, Promise.resolve(), joining);
    expect(g.status === 'rejected' && String(g.reason)).toMatch(/THAT GAME IS ALREADY BEING PLAYED/);
    expect(rejectText('busy')).toBe('THAT GAME IS ALREADY BEING PLAYED.');
    const gone = new LoopbackPair(1);
    const left = guestHandshake(gone.b, 'GUEST', '1.0', content);
    gone.a.close();
    const [, l] = await settle(gone, Promise.resolve(), left);
    expect(l.status === 'rejected' && String(l.reason)).toMatch(/closed the connection/);
  });
});

describe('net session', () => {
  it('lets go of inputs and sums no game would send (far off screens and steps): they cannot pile up', () => {
    const pair = new LoopbackPair(0);
    const rules = {
      match: { throwRange: 100, hitPause: 4, blockDamage: 0, vitality: 100, jumpHeight: 100, knockDown: 0, rehit: false, defensiveThrows: false,
        power1: 5, power2: 5, hazards: true, rounds: 1, fightMode: 0, sim: false },
      speed: 7, delayMs: 40,
    };
    const session = new NetSession({ link: pair.a, localPlayer: 0, names: ['HOST', 'GUEST'], rules, seed: 1, timers: false });
    const send = (m: object) => pair.b.send(JSON.stringify(m));
    for (let i = 0; i < 500; i++) {
      send({ t: 'in', p: 1000 + i, s: 0, sc: SceneId.MELEE, a: [] });
      send({ t: 'in', p: 1, s: 100000 + i, sc: SceneId.MELEE, a: [] });
      send({ t: 'sum', p: 0, s: 100000 + i, h: i });
    }
    // (the other game on the next screen first: kept for when this one gets there)
    send({ t: 'in', p: 1, s: 3, sc: SceneId.MELEE, a: [ACT_PUNCH] });
    pair.run();
    const inner = session as unknown as { remote: Map<number, { steps: Map<number, number[]> }>; remoteSums: Map<string, number> };
    expect([...inner.remote.keys()]).toEqual([1]);
    expect([...inner.remote.get(1)!.steps.keys()]).toEqual([3]);
    expect(inner.remoteSums.size).toBe(0);
    expect(session.ended).toBeNull();
  });

  it('is over before it began when the other game left meanwhile (its goodbye waited in the link): no timer is left running', () => {
    const pair = new LoopbackPair(0);
    pair.b.send('{"t":"bye","reason":"left"}');
    pair.run();
    const session = new NetSession({ link: pair.a, localPlayer: 0, names: ['HOST', 'GUEST'], rules: testRules(), seed: 1 });
    expect(session.ended?.kind).toBe('peerLeft');
    expect((session as unknown as { timer: unknown }).timer).toBeNull();
  });

  it('gives up on a game that answers its pings but sends no inputs, after a long wait for them', () => {
    const pair = new LoopbackPair(0);
    let clock = 0;
    const session = new NetSession({ link: pair.a, localPlayer: 0, names: ['HOST', 'GUEST'], rules: testRules(), seed: 1, now: () => clock, timers: false });
    session.sceneChanged(SceneId.MELEE);
    // (the steps that need no inputs of the other game yet, then the wait for them)
    while (session.ready()) {
      session.beginStep();
      session.endStep();
    }
    for (let s = 1; s <= 59; s++) {
      clock = s * 1000;
      pair.b.send(`{"t":"ping","n":${clock}}`);
      pair.run();
      session.heartbeat();
      session.ready();
    }
    expect(session.late()).toBe(true);
    expect(session.ended).toBeNull();
    clock = 61000;
    pair.b.send(`{"t":"ping","n":${clock}}`);
    pair.run();
    session.heartbeat();
    expect(session.ended?.kind).toBe('timeout');
  });
});

describe.skipIf(!hasGameData)('network games', () => {
  it('both games play the same select screen, VS screen and fight, tick for tick', () => {
    const net = netGame(12, [masher(1), masher(2)]);
    const [host, guest] = net.sides;
    // The select screen: both players pick a pilot and a robot.
    net.run(120000, () => host.gs.thisId === SceneId.VS && guest.gs.thisId === SceneId.VS);
    expect(host.gs.thisId).toBe(SceneId.VS);
    expect(guest.gs.thisId).toBe(SceneId.VS);
    for (let i = 0; i < 2; i++) {
      const a = host.gs.getPlayer(i).pilot, b = guest.gs.getPlayer(i).pilot;
      expect([b.pilotId, b.harId, b.power, b.agility, b.endurance]).toEqual([a.pilotId, a.harId, a.power, a.agility, a.endurance]);
      expect(b.name).toBe(['HOST', 'GUEST'][i]);
    }
    // The host picks the arena; the fight runs to its end in both.
    net.run(60000, () => host.gs.sc.isArena() && guest.gs.sc.isArena());
    expect(guest.gs.thisId).toBe(host.gs.thisId);
    expect(host.gs.matchSettings).toEqual(guest.gs.matchSettings);
    net.run(600000, () => !host.gs.sc.isArena() && !guest.gs.sc.isArena() && host.trace.size > 0);
    expect(host.end).toBeNull();
    expect(guest.end).toBeNull();
    expect(host.trace.size).toBeGreaterThan(500);
    let compared = 0;
    for (const [k, v] of host.trace) {
      if (!guest.trace.has(k)) continue;
      expect(guest.trace.get(k), k).toBe(v);
      compared++;
    }
    expect(compared).toBeGreaterThan(host.trace.size - 5);
    // Both go on to the select screen again (one after its victory screen: the other waits for it there).
    net.run(60000, () => host.gs.thisId === SceneId.MELEE && guest.gs.thisId === SceneId.MELEE && host.session.phase === guest.session.phase);
    expect(host.session.phase).toBe(4);
    expect(guest.session.phase).toBe(4);
    // Robot select again and on: no desync.
    net.run(20000);
    expect(host.end ?? guest.end).toBeNull();
  }, 120000);

  it('keeps in step over a slow network (the game waits for the inputs)', () => {
    const net = netGame(70, [masher(5), masher(6)]);
    const [host, guest] = net.sides;
    net.run(200000, () => host.gs.sc.isArena() && guest.gs.sc.isArena());
    expect(host.gs.sc.isArena()).toBe(true);
    net.run(30000);
    expect(host.end ?? guest.end).toBeNull();
    let compared = 0;
    for (const [k, v] of guest.trace) {
      if (!host.trace.has(k)) continue;
      expect(host.trace.get(k), k).toBe(v);
      compared++;
    }
    expect(compared).toBeGreaterThan(300);
  }, 120000);

  it('ESC on the select screen: from the robots to the pilots in both games, then out of the game for both', () => {
    // Both players confirm their pilot at once, then stand still.
    const net = netGame(8, [(n) => (n === 3 ? ACT_PUNCH : 0), (n) => (n === 5 ? ACT_PUNCH : 0)]);
    const [host, guest] = net.sides;
    const page = (s: Side) => (s.gs.sc as MeleeScene).page;
    net.run(20000, () => host.gs.thisId === SceneId.MELEE && guest.gs.thisId === SceneId.MELEE && page(host) === 1 && page(guest) === 1);
    expect([page(host), page(guest)]).toEqual([1, 1]);
    // The guest's ESC (from the menu keys) comes with its inputs: both go back to the pilots.
    guest.session.inject(ACT_ESC);
    net.run(3000, () => page(host) === 0 && page(guest) === 0);
    expect([page(host), page(guest)]).toEqual([0, 0]);
    expect(host.end ?? guest.end).toBeNull();
    // The host's ESC on the pilots: the game ends for both, back to MULTIPLAYER.
    host.session.inject(ACT_ESC);
    net.run(5000, () => host.gs.thisId === SceneId.MENU && guest.gs.thisId === SceneId.MENU);
    expect(host.end?.kind).toBe('left');
    expect(guest.end?.kind).toBe('peerLeft');
    expect(guest.end?.message).toMatch(/HOST left/);
    expect([host.gs.thisId, guest.gs.thisId]).toEqual([SceneId.MENU, SceneId.MENU]);
    expect(host.gs.net).toBeNull();
    expect(guest.gs.net).toBeNull();
    // The main menu put the players' own controls back.
    for (const s of net.sides) expect(s.gs.getPlayer(0).ctrl.type).not.toBe(CtrlType.NETWORK);
  });

  it('a lost connection in a fight ends the game in both', () => {
    const net = netGame(5, [masher(9), masher(10)]);
    const [host, guest] = net.sides;
    net.run(200000, () => host.gs.sc.isArena() && guest.gs.sc.isArena());
    net.run(3000);
    net.pair.b.ended('reset');
    net.pair.a.ended('reset');
    net.run(5000, () => host.gs.thisId === SceneId.MENU && guest.gs.thisId === SceneId.MENU);
    expect(host.end?.kind).toBe('lost');
    expect(guest.end?.kind).toBe('lost');
    expect([host.gs.thisId, guest.gs.thisId]).toEqual([SceneId.MENU, SceneId.MENU]);
  }, 60000);

  it('the other game going silent ends the game', () => {
    const net = netGame(5, [masher(3), masher(4)]);
    const [host] = net.sides;
    net.run(2000);
    // (the guest's computer stops: nothing more comes from it)
    net.sides[1].frame = 1e9;
    net.sides[1].next = 1e12;
    net.pair.latency = 1e12;
    net.run(30000, () => host.end !== null);
    expect(host.end?.kind).toBe('timeout');
  }, 60000);

  it('a fight that gets out of sync is stopped in both games', () => {
    const net = netGame(5, [masher(11), masher(12)]);
    const [host, guest] = net.sides;
    net.run(200000, () => host.gs.sc.isArena() && guest.gs.sc.isArena());
    net.run(2000);
    expect(host.end ?? guest.end).toBeNull();
    // (something only one game saw)
    const o = guest.gs.findObject(guest.gs.getPlayer(1).harObjId)!;
    harData(o).health -= 7;
    net.run(10000, () => host.end !== null && guest.end !== null);
    expect(host.end?.kind).toBe('desync');
    expect(guest.end?.kind).toBe('desync');
    net.run(3000, () => host.gs.thisId === SceneId.MENU && guest.gs.thisId === SceneId.MENU);
    expect([host.gs.thisId, guest.gs.thisId]).toEqual([SceneId.MENU, SceneId.MENU]);
  }, 60000);

  it('the status bar says whose move it is on the select screen and the VS screen; the fight waits for both PUNCHes', () => {
    const [h, g] = [taps(), taps()];
    const net = netGame(10, [h.next, g.next]);
    const [host, guest] = net.sides;
    const status = (s: Side) => netStatusOf(s.gs);
    const melee = (s: Side) => s.gs.sc as MeleeScene;
    net.run(5000, () => host.gs.thisId === SceneId.MELEE && guest.gs.thisId === SceneId.MELEE && !!status(host) && !!status(guest));
    expect(status(host)).toEqual({ side: 0, text: 'PICK YOUR PILOT (RED CURSOR)' });
    expect(status(guest)).toEqual({ side: 1, text: 'PICK YOUR PILOT (BLUE CURSOR)' });
    // The host picks a pilot: it waits for the guest, who hears the host is ready.
    h.queue.push(ACT_PUNCH);
    net.run(3000, () => melee(host).cursor[0].done && melee(guest).cursor[0].done);
    expect(status(host)).toEqual({ side: 0, text: 'WAITING FOR GUEST TO PICK A PILOT', waiting: true });
    expect(status(guest)).toEqual({ side: 1, text: 'HOST IS READY: PICK YOUR PILOT' });
    g.queue.push(ACT_PUNCH);
    net.run(3000, () => melee(host).page === 1 && melee(guest).page === 1);
    expect(status(guest)?.text).toBe('PICK YOUR ROBOT (BLUE CURSOR)');
    h.queue.push(ACT_PUNCH);
    g.queue.push(ACT_PUNCH);
    net.run(5000, () => host.gs.thisId === SceneId.VS && guest.gs.thisId === SceneId.VS && !!status(host) && !!status(guest));
    expect(status(host)?.text).toBe('PICK THE ARENA (LEFT/RIGHT), THEN PUNCH');
    expect(status(guest)?.text).toBe('HOST PICKS THE ARENA: PUNCH WHEN READY');
    // The host picks the next arena and presses PUNCH: the fight waits for the guest's.
    h.queue.push(ACT_RIGHT, 0, ACT_PUNCH);
    net.run(3000, () => (host.gs.sc as VsScene).netReady[0] && (guest.gs.sc as VsScene).netReady[0]);
    net.run(1500);
    expect([host.gs.thisId, guest.gs.thisId]).toEqual([SceneId.VS, SceneId.VS]);
    expect([host.gs.arena, guest.gs.arena]).toEqual([1, 1]);
    // (above the arena's box at the bottom of the VS screen)
    expect(status(host)).toEqual({ side: 0, text: 'WAITING FOR GUEST TO PRESS PUNCH', waiting: true, above: 150 });
    expect(status(guest)?.text).toBe('HOST IS READY: PRESS PUNCH TO FIGHT');
    // (the guest's directions do not change the arena)
    g.queue.push(ACT_RIGHT, 0, ACT_PUNCH);
    net.run(5000, () => host.gs.sc.isArena() && guest.gs.sc.isArena());
    expect([host.gs.thisId, guest.gs.thisId]).toEqual([SceneId.ARENA1, SceneId.ARENA1]);
    // In the fight the bar is gone (unless a game waits for the other).
    net.run(500);
    expect(status(host)).toBeNull();
    expect(host.end ?? guest.end).toBeNull();
  });

  it('the status bar says whom the game waits for, and whether they have got to this screen yet', () => {
    const net = netGame(10, [() => 0, () => 0]);
    const [host, guest] = net.sides;
    // (the guest's computer is slow to start: the host gets to the select screen first and waits there)
    guest.next = Infinity;
    net.run(4000);
    expect(host.gs.thisId).toBe(SceneId.MELEE);
    expect(netStatusOf(host.gs)).toEqual({ side: 0, text: 'WAITING FOR GUEST TO GET HERE...', waiting: true });
    guest.next = net.now();
    net.run(3000, () => netStatusOf(host.gs)?.text === 'PICK YOUR PILOT (RED CURSOR)');
    expect(netStatusOf(host.gs)?.text).toBe('PICK YOUR PILOT (RED CURSOR)');
    // A hiccup on the select screen: the guest is here, just late.
    guest.next = Infinity;
    net.run(1500);
    expect(netStatusOf(host.gs)).toEqual({ side: 0, text: 'WAITING FOR GUEST...', waiting: true });
  });

  it('what a game can play: the robots, arenas and pilots, and their files', () => {
    createGame(SceneId.MENU);
    const c = netContent();
    expect(c.robots.slice(0, 11)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(c.arenas.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(c.files).toMatch(/^[0-9a-f]{8}$/);
    expect(netContent()).toEqual(c);
  });

  /** Both games on the select screen, taking their players' input. */
  const onSelectScreen = (sides: Side[]) => sides.every((s) => s.gs.thisId === SceneId.MELEE && s.gs.sc.takesInput());

  it('the key that closes the help over a network game stays the help\'s until it is let go: ESC on the pilots does not leave', () => {
    const net = netGame(8, [() => 0, () => 0]);
    const [host, guest] = net.sides;
    net.run(5000, () => onSelectScreen(net.sides));
    // (F1 over the select screen; the game goes on under it, the local player standing still)
    const help = new HelpOverlay(() => {});
    try {
      help.open();
      expect(host.session.suppressLocal()).toBe(true);
      // ESC closes it, and is still down for a moment: the select screen must not take it (it would leave the game)
      setKeyState('Escape', true);
      help.key('Escape');
      expect(help.isOpen()).toBe(false);
      net.run(1000);
      expect(host.session.suppressLocal()).toBe(true);
      setKeyState('Escape', false);
      expect(helpOverlayHeld()).toBe(false);
      expect(host.session.suppressLocal()).toBe(false);
      net.run(1000);
      expect(host.end ?? guest.end).toBeNull();
      expect([host.gs.thisId, guest.gs.thisId]).toEqual([SceneId.MELEE, SceneId.MELEE]);
    } finally {
      setKeyState('Escape', false);
      help.close(null);
    }
  });

  it('a game waiting for the other one can still be left: ESC is read while the input steps stand still', () => {
    const net = netGame(8, [() => 0, () => 0]);
    const [host, guest] = net.sides;
    net.run(5000, () => onSelectScreen(net.sides));
    // (the guest's computer stops: the host waits for its inputs)
    guest.next = Infinity;
    net.run(1500);
    expect(host.session.late()).toBe(true);
    setKeyState('Escape', true);
    try {
      net.run(500, () => host.end !== null);
    } finally {
      setKeyState('Escape', false);
    }
    expect(host.end?.kind).toBe('left');
    net.run(1000);
    expect(host.gs.thisId).toBe(SceneId.MENU);
  });

  it('a screen that cannot open ends the network game, and the other game hears it (it would wait there for good)', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const net = netGame(8, [() => 0, () => 0]);
    const [host, guest] = net.sides;
    registerScene(SceneId.MELEE, (gs) => {
      if (gs === host.gs) throw new Error('(the test: this screen cannot open)');
      return new MeleeScene(gs);
    });
    try {
      net.run(5000, () => host.end !== null && guest.end !== null);
    } finally {
      registerScene(SceneId.MELEE, (gs) => new MeleeScene(gs));
      quiet.mockRestore();
    }
    expect(host.end?.kind).toBe('left');
    expect(guest.end?.kind).toBe('peerLeft');
    expect([host.gs.thisId, host.gs.net]).toEqual([SceneId.MENU, null]);
    net.run(1000);
    expect(guest.gs.thisId).toBe(SceneId.MENU);
  });

  it('a game called off before the select screen opens leaves nothing of the network game behind', () => {
    const pair = new LoopbackPair(0);
    const gs = createGame(SceneId.MENU);
    const rules = hostRules(gs);
    rules.speed = settings().gameplay.speed === 10 ? 0 : 10;
    const session = new NetSession({ link: pair.a, localPlayer: 0, names: ['HOST', 'GUEST'], rules, seed: 1, timers: false });
    const seen: { end: NetEnd | null } = { end: null };
    startNetGame(gs, session, { onEnd: (e) => (seen.end = e) });
    expect([gs.nextId, gs.getPlayer(1).ctrl.type, gs.speed]).toEqual([SceneId.MELEE, CtrlType.NETWORK, rules.speed + 5]);
    // (the other game leaves while this one fades out of the main menu)
    pair.b.send('{"t":"bye","reason":"left"}');
    pair.run();
    expect(seen.end?.kind).toBe('peerLeft');
    expect(gs.net).toBeNull();
    expect([gs.thisId, gs.nextId, gs.nextWaitTicks]).toEqual([SceneId.MENU, SceneId.MENU, 0]);
    expect(gs.speed).toBe(settings().gameplay.speed + 5);
    expect([gs.modeLabel, gs.menuReturn]).toEqual([null, null]);
    for (const i of [0, 1]) expect(gs.getPlayer(i).ctrl.type).not.toBe(CtrlType.NETWORK);
    const engine = new Engine(gs, { render() {} });
    for (let t = 0; t < 1000; t += 20) engine.advance(20);
    expect(gs.thisId).toBe(SceneId.MENU);
  });

  it('the help gives a screen that opened under it that screen\'s colors back (a network game goes on under the help)', () => {
    const gs = createGame(SceneId.MENU);
    const help = new HelpOverlay(() => {});
    const opened: { colors: Uint8Array | null } = { colors: null };
    gs.onSceneChange = () => {
      opened.colors = vga.base.colors.slice();
      help.sceneChanged();
    };
    try {
      help.open('controls');
      const own = vga.base.colors.slice();
      gs.swapScene(SceneId.MELEE);
      // (the help keeps its own colors while it is open)
      expect(vga.base.colors).toEqual(own);
      help.close(null);
      expect(opened.colors).not.toBeNull();
      expect(vga.base.colors).toEqual(opened.colors);
    } finally {
      help.close(null);
      gs.onSceneChange = null;
    }
  });

  it('a hidden window\'s game catches up when its timers come late, and waits for no artwork', () => {
    const gs = createGame(SceneId.MENU);
    const engine = new Engine(gs, { render() {} });
    engine.idle(1000);
    engine.waiting = true;
    const before = gs.sc.staticTicksSinceStart;
    // (a second later: a hidden window's timer, slowed down)
    engine.idle(2000);
    expect(engine.waiting).toBe(false);
    expect(gs.sc.staticTicksSinceStart - before).toBeGreaterThanOrEqual(95);
  });
});

/** A LAN of two pages in this process: the host's game is found by the guest's search and joined over a loopback. */
function fakeLan(pair: LoopbackPair): [LanBackend, LanBackend] {
  let guestArrives: ((link: NetLink) => void) | null = null;
  let hostName = '';
  const info = async () => ({ name: 'tester', addresses: ['10.0.0.1'] });
  const host: LanBackend = {
    kind: 'network', info, scan: async () => [], join: async () => Promise.reject(new Error('no')),
    async host(name, _version, onGuest) {
      hostName = name;
      guestArrives = onGuest;
      return { port: 2097, stop: () => (guestArrives = null) };
    },
  };
  const guest: LanBackend = {
    kind: 'network', info, host: async () => Promise.reject(new Error('no')),
    scan: async () => (guestArrives ? [{ name: hostName, address: '10.0.0.1', version: APP_VERSION, busy: false }] : []),
    async join() {
      if (!guestArrives) throw new Error('refused');
      guestArrives(pair.a);
      return pair.b;
    },
  };
  return [host, guest];
}

describe.skipIf(!hasGameData)('the LAN page', () => {
  afterEach(() => {
    setLanBackend(undefined);
    vi.restoreAllMocks();
  });

  /**
   * Two LAN pages (each over its own game) joined by a fake network; `wait` lets the messages and promises go, the pages
   * updated and drawn (`draw` false: not drawn, as in a hidden window).
   */
  function twoPages() {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    settings().lan.name = 'TESTER';
    const pair = new LoopbackPair(0);
    const [hb, gb] = fakeLan(pair);
    const games = [createGame(SceneId.MENU), createGame(SceneId.MENU)];
    setLanBackend(hb);
    const host = new LanPage(games[0]);
    setLanBackend(gb);
    const guest = new LanPage(games[1]);
    for (const p of [host, guest]) {
      p.onOpen();
      p.setColors();
    }
    const wait = async (ms = 0, draw = true) => {
      now += ms;
      for (let i = 0; i < 20; i++) {
        pair.run(pair.now + 1);
        for (const p of [host, guest]) {
          p.update();
          if (!draw) continue;
          drawList.begin();
          p.render();
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    };
    const state = (p: LanPage) => (p as unknown as { state: string }).state;
    return { host, guest, games, wait, state, pair };
  }

  it('hosting, the game found and joined, MATCH FOUND on both, then the robot select screen in both', async () => {
    const { host, guest, games, wait, state } = twoPages();
    // The host: ENTER on HOST A GAME.
    host.action(ACT_PUNCH, CtrlType.KEYBOARD);
    await wait();
    expect(state(host)).toBe('hosting');
    // The guest's search finds it; DOWN twice to it, ENTER joins.
    await wait(3000);
    guest.action(ACT_DOWN, CtrlType.KEYBOARD);
    guest.action(ACT_DOWN, CtrlType.KEYBOARD);
    guest.action(ACT_PUNCH, CtrlType.KEYBOARD);
    await wait();
    // Both agreed: both show the match for a moment (the guest got a name of its own).
    expect([state(host), state(guest)]).toEqual(['starting', 'starting']);
    expect(games[0].net).toBeNull();
    await wait(1000);
    expect([state(host), state(guest)]).toEqual(['starting', 'starting']);
    // (nothing drawn: a hidden window's page starts the match all the same)
    await wait(2000, false);
    expect([host.finished, guest.finished]).toEqual([true, true]);
    for (const gs of games) {
      expect(gs.net?.names).toEqual(['TESTER', 'TESTER 2']);
      expect(gs.nextId).toBe(SceneId.MELEE);
    }
    expect([games[0].net?.localPlayer, games[1].net?.localPlayer]).toEqual([0, 1]);
    for (const gs of games) gs.net?.leave();
  });

  it('ESC on MATCH FOUND calls the game off: the other player hears it', async () => {
    const { host, guest, games, wait, state } = twoPages();
    host.action(ACT_PUNCH, CtrlType.KEYBOARD);
    await wait(3000);
    guest.action(ACT_DOWN, CtrlType.KEYBOARD);
    guest.action(ACT_DOWN, CtrlType.KEYBOARD);
    guest.action(ACT_PUNCH, CtrlType.KEYBOARD);
    await wait();
    expect(state(guest)).toBe('starting');
    expect(guest.back()).toBe(true);
    expect(state(guest)).toBe('menu');
    await wait(3000);
    // (the host's match does not start: the guest's goodbye was waiting for it, and its page says so; its game is
    // as it was)
    expect(games[1].net).toBeNull();
    expect(games[0].net).toBeNull();
    expect(host.finished).toBe(false);
    expect(state(host)).toBe('menu');
    expect((host as unknown as { status: string }).status).toBe('TESTER 2 LEFT THE GAME.');
    expect([games[0].thisId, games[0].nextId]).toEqual([SceneId.MENU, SceneId.MENU]);
    expect(games[0].getPlayer(0).ctrl.type).not.toBe(CtrlType.NETWORK);
  });

  it('the name is the computer\'s user name until the player types one, and an emptied one plays as PLAYER', async () => {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const [hb, gb] = fakeLan(new LoopbackPair(0));
    settings().lan.name = '';
    setLanBackend(hb);
    const page = new LanPage(createGame(SceneId.MENU));
    page.onOpen();
    await tick();
    expect(settings().lan.name).toBe('TESTER');
    // (BACKSPACE empties it on the name's row; the game is hosted as PLAYER all the same)
    page.action(ACT_UP, CtrlType.KEYBOARD);
    for (let i = 0; i < 8; i++) page.key('Backspace');
    expect(settings().lan.name).toBe('');
    page.action(ACT_DOWN, CtrlType.KEYBOARD);
    page.action(ACT_PUNCH, CtrlType.KEYBOARD);
    await tick();
    expect((await gb.scan())[0]?.name).toBe('PLAYER');
    page.onClose();
    // (a computer that does not say: PLAYER)
    settings().lan.name = '';
    setLanBackend({ ...hb, info: () => Promise.reject(new Error('no')) });
    new LanPage(createGame(SceneId.MENU)).onOpen();
    await tick();
    expect(settings().lan.name).toBe('PLAYER');
  });

  it('the games found keep their order, and the highlighted one stays highlighted as others come and go', async () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const game = (name: string, address: string): LanGame => ({ name, address, version: APP_VERSION, busy: false });
    const answers = [[game('ZED', '10.0.0.9'), game('AMY', '10.0.0.5')], [game('BOB', '10.0.0.7'), game('ZED', '10.0.0.9'), game('AMY', '10.0.0.5')]];
    setLanBackend({
      kind: 'network', info: async () => ({ name: 'me', addresses: [] }), host: async () => Promise.reject(new Error('no')),
      join: async () => Promise.reject(new Error('no')), scan: async () => answers.shift() ?? [],
    });
    const page = new LanPage(createGame(SceneId.MENU));
    page.onOpen();
    page.setColors();
    const look = async () => {
      drawList.begin();
      page.render();
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    };
    const inner = page as unknown as { games: LanGame[]; row: number };
    const picked = () => inner.games[inner.row - 3]?.name;
    await look();
    expect(inner.games.map((g) => g.name)).toEqual(['AMY', 'ZED']);
    // DOWN to ZED's game (past JOIN BY ADDRESS and AMY's)
    for (let i = 0; i < 3; i++) page.action(ACT_DOWN, CtrlType.KEYBOARD);
    expect(picked()).toBe('ZED');
    // The next search finds BOB's game too: ZED's stays highlighted, a row further down (ENTER joins the game it shows).
    now += 3000;
    await look();
    expect(inner.games.map((g) => g.name)).toEqual(['AMY', 'BOB', 'ZED']);
    expect(picked()).toBe('ZED');
  });

  it('a search that cannot go out says so, with what the computer\'s system may ask', async () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    let refused = true;
    setLanBackend({
      kind: 'network', info: async () => ({ name: 'me', addresses: ['192.168.1.20'], os: 'macos' }),
      host: async () => Promise.reject(new Error('no')), join: async () => Promise.reject(new Error('no')),
      scan: async () => {
        if (refused) throw new Error('No route to host (os error 65)');
        return [];
      },
    });
    const page = new LanPage(createGame(SceneId.MENU));
    page.onOpen();
    page.setColors();
    const look = async () => {
      drawList.begin();
      page.render();
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    };
    const inner = page as unknown as { scanFailed: boolean; os: string };
    await look();
    expect([inner.os, inner.scanFailed]).toEqual(['macos', true]);
    // (allowed now: the next search goes out)
    refused = false;
    now += 3000;
    await look();
    expect(inner.scanFailed).toBe(false);
    // What each system may ask (Windows the private networks, a Mac the local network, Linux its firewall's port).
    expect(networkHint('windows')).toBe('If Windows asks, let the game use private networks.');
    expect(networkHint('macos')).toMatch(/Mac asks, allow the game to use the local network/);
    expect(networkHint('linux')).toMatch(/port 2097 \(TCP and UDP\)/);
    expect(networkHint('')).toBe('');
  });
});

describe.skipIf(!hasGameData || !hasExtras)('the fingerprint of what a game can play, with mods', () => {
  afterEach(() => resetMods());

  it('counts a mod arena\'s description, which the fights read (whose behavior it has, its animations)', async () => {
    createGame(SceneId.MENU);
    await loadExtras();
    const arena = modArenas()[0];
    const before = netContent().files;
    const base = arena.info.base;
    arena.info.base = base === 2 ? 3 : 2;
    try {
      expect(netContent().files).not.toBe(before);
    } finally {
      arena.info.base = base;
    }
    expect(netContent().files).toBe(before);
  });
});
