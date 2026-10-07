// Network games (src/net): two games in this process, joined by a loopback link with latency and running at different
// frame rates, play a whole round of the select screen, the VS screen and a fight; both must see the same fight, tick
// for tick. Also the handshake's checks, leaving, losing the connection, and a fight that gets out of sync.
import { describe, expect, it } from 'vitest';
import { Controller, type CtrlEvent } from '../controller/controller';
import { Engine } from '../engine';
import { ACT_DOWN, ACT_ESC, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_STOP, ACT_UP, CtrlType, SceneId } from '../game/constants';
import type { GameState } from '../game/gameState';
import { harData } from '../game/objects/har';
import type { MeleeScene } from '../game/scenes/melee';
import { contentMismatch, guestHandshake, hostHandshake, readMatchSettings } from '../net/handshake';
import { LoopbackPair } from '../net/link';
import { hostRules, netContent, startNetGame } from '../net/netplay';
import { cleanName, NET_PROTOCOL, parseMessage, type NetContent } from '../net/protocol';
import { NetSession, type NetEnd } from '../net/session';
import { drawList } from '../video/draw';
import { createGame, hasGameData } from './harness';

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

  it('what a game can play: the robots, arenas and pilots, and their files', () => {
    createGame(SceneId.MENU);
    const c = netContent();
    expect(c.robots.slice(0, 11)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(c.arenas.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(c.files).toMatch(/^[0-9a-f]{8}$/);
    expect(netContent()).toEqual(c);
  });
});
