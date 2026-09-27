// Headless tests for the CPU opponent (src/controller/ai.ts): unit checks of the ported helpers plus full AI fights.
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACT_DOWN, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_STOP, AI_DIFFICULTY_NAMES, CAT_CLOSE, CAT_JUMPING, CtrlType,
  HAR_NAMES, HarEventType, HarId, OBJECT_FACE_LEFT, OBJECT_FACE_RIGHT, SceneId, STATIC_TICKS,
} from '../game/constants';
import { AiController, charToAct, createAiController, isSpecialMove, resetPilotPersonality, type Ai } from '../controller/ai';
import type { CtrlEvent } from '../controller/controller';
import { Pilot } from '../formats/pilot';
import type { GameState } from '../game/gameState';
import { ARENA_STATE_FIGHTING, harData, harInstallHook } from '../game/objects/har';
import type { ArenaScene } from '../game/scenes/arena';
import { Scene } from '../game/scene';
import { afGetMove } from '../resources/resources';
import { globalRandom } from '../util/random';
import { drawList } from '../video/draw';
import { createGame, hasGameData } from './harness';

/** Simulated time of the current fight (read by event hooks). */
const clock = { ms: 0 };

/** Ticks the game with the engine's static/dynamic scheduling until `done()` (checked after every tick) or `maxMs`. */
function runUntil(gs: GameState, done: () => boolean, maxMs: number): number {
  let ms = 0;
  let staticWait = 0;
  let dynamicWait = 0;
  while (ms < maxMs) {
    ms += STATIC_TICKS;
    clock.ms = ms;
    staticWait += STATIC_TICKS;
    dynamicWait += STATIC_TICKS;
    while (staticWait >= STATIC_TICKS) {
      gs.staticTick();
      staticWait -= STATIC_TICKS;
      if (done()) return ms;
    }
    let dyn = gs.msPerDyntick();
    while (dynamicWait >= dyn) {
      gs.dynamicTick();
      dynamicWait -= dyn;
      if (done()) return ms;
      dyn = gs.msPerDyntick();
    }
    if (ms % 200 === 0) {
      // exercise the render path now and then
      drawList.begin();
      gs.render();
    }
  }
  return -1;
}

interface FightSpec {
  arena: number;
  hars: [number, number];
  pilots: [number, number];
  /** AI difficulty per player, or 'idle' for a keyboard controller with nothing pressed. */
  players: [number | 'idle', number | 'idle'];
  seed: number;
  /** matchSettings.rounds (0 = one round, 1 = best of 3) */
  rounds?: number;
}

interface FightResult {
  ms: number;
  winner: number;
  finish: number;
  /** HarEvent counts per player, keyed by event name */
  events: [Map<string, number>, Map<string, number>];
  /** Attack counts per player keyed by kind (basic/special/jump/throw) */
  attacks: [Map<string, number>, Map<string, number>];
  scene: SceneId;
  /** simulated ms of the last knockout (DEFEAT event), -1 if none */
  koMs: number;
}

function startFight(spec: FightSpec): { gs: GameState; result: FightResult } {
  globalRandom.setSeed(spec.seed);
  const gs = createGame(SceneId.MENU, spec.pilots, spec.hars);
  gs.rand.setSeed(spec.seed * 7 + 3);
  for (let i = 0; i < 2; i++) {
    const p = spec.players[i];
    if (p !== 'idle') gs.setupAi(i, p);
  }
  gs.matchSettings.rounds = spec.rounds ?? 0;
  const id = SceneId.ARENA0 + spec.arena;
  gs.swapScene(id);
  const result: FightResult = {
    ms: -1, winner: -1, finish: 0, events: [new Map(), new Map()], attacks: [new Map(), new Map()], scene: id, koMs: -1,
  };
  const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (let i = 0; i < 2; i++) {
    const obj = gs.findObject(gs.getPlayer(i).harObjId)!;
    harInstallHook(harData(obj), (e) => {
      inc(result.events[i], HarEventType[e.type]);
      if (e.type === HarEventType.DEFEAT) result.koMs = clock.ms;
      if (e.type === HarEventType.ATTACK && e.move) {
        const kind = e.move.category === CAT_CLOSE ? 'throw' : e.move.category === CAT_JUMPING ? 'jump'
          : isSpecialMove(e.move) ? 'special' : 'basic';
        inc(result.attacks[i], kind);
      }
    });
  }
  return { gs, result };
}

/** Runs a whole match; stops as soon as the arena hands over to the next scene. */
function fight(spec: FightSpec, maxMs = 300000): FightResult {
  const { gs, result } = startFight(spec);
  result.ms = runUntil(gs, () => gs.nextId !== result.scene, maxMs * Math.max(1, 2 * (spec.rounds ?? 0) + 1));
  result.winner = result.ms >= 0 ? gs.fightStats.winner : -1;
  result.finish = gs.fightStats.finish;
  result.scene = gs.nextId;
  return result;
}

const sum = (m: Map<string, number>, k: string) => m.get(k) ?? 0;
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

afterEach(() => {
  AiController.finishers = true;
});

describe('AI controller helpers', () => {
  it('types move strings into controller actions like the reference char_to_act', () => {
    const a = { moveStrPos: 0 } as Ai;
    // "K36": 6 (towards), then 3 (down-towards) merged with the kick button
    a.moveStrPos = 2;
    expect(charToAct(a, 'K36', OBJECT_FACE_RIGHT)).toBe(ACT_RIGHT);
    expect(a.moveStrPos).toBe(2);
    a.moveStrPos = 1;
    expect(charToAct(a, 'K36', OBJECT_FACE_RIGHT)).toBe(ACT_DOWN | ACT_RIGHT | ACT_KICK);
    expect(a.moveStrPos).toBe(0);
    // mirrored when facing left
    a.moveStrPos = 2;
    expect(charToAct(a, 'K36', OBJECT_FACE_LEFT)).toBe(ACT_LEFT);
    a.moveStrPos = 1;
    expect(charToAct(a, 'K36', OBJECT_FACE_LEFT)).toBe(ACT_DOWN | ACT_LEFT | ACT_KICK);
    // back-down (1) facing left is down-right
    a.moveStrPos = 1;
    expect(charToAct(a, 'P1', OBJECT_FACE_LEFT)).toBe(ACT_DOWN | ACT_RIGHT | ACT_PUNCH);
    // '5' is neutral and never merges buttons; a lone button is just the button
    a.moveStrPos = 1;
    expect(charToAct(a, 'P5', OBJECT_FACE_RIGHT)).toBe(ACT_STOP);
    expect(a.moveStrPos).toBe(1);
    a.moveStrPos = 0;
    expect(charToAct(a, 'P', OBJECT_FACE_RIGHT)).toBe(ACT_PUNCH);
    // two chained buttons are both merged
    a.moveStrPos = 2;
    expect(charToAct(a, 'PK2', OBJECT_FACE_RIGHT)).toBe(ACT_DOWN | ACT_KICK | ACT_PUNCH);
    expect(a.moveStrPos).toBe(0);
  });

  it('classifies basic vs special move strings', () => {
    const m = (s: string) => ({ moveString: s }) as Parameters<typeof isSpecialMove>[0];
    for (const s of ['K', 'K1', 'K2', 'K3', 'K4', 'K6', 'P', 'P1', 'P2', 'P3', 'P4', 'P6']) expect(isSpecialMove(m(s))).toBe(false);
    for (const s of ['P63', 'K6321', 'P52', 'K9', 'P85252']) expect(isSpecialMove(m(s))).toBe(true);
  });

  it('applies the hard-coded story pilot personalities and keeps tournament pilot preferences', () => {
    const story = new Pilot();
    story.attDef = 77;
    story.pilotId = 0;
    resetPilotPersonality(story);
    expect([story.attNormal, story.attHyper, story.attJump, story.attSniper, story.apThrow, story.prefFwd]).toEqual([30, 10, 10, 20, 100, 30]);
    expect(story.attDef).toBe(77); // Crystal's case does not touch att_def (reference behavior)
    expect(story.learning).toBeCloseTo(1.5);
    expect(story.forget).toBeCloseTo(0.25);

    // Tournament opponents (pilot ids outside the story roster) keep their TRN/CHR preferences.
    const trn = new Pilot();
    Object.assign(trn, { attNormal: 11, attHyper: 22, attJump: 33, attDef: 44, attSniper: 55, apSpecial: -20, prefJump: 5, learning: 7, forget: 1 });
    const gsStub = {} as GameState;
    const ctrl = createAiController(gsStub, 3, trn, 42) as AiController;
    expect(ctrl.type).toBe(CtrlType.AI);
    expect(trn.pilotId).toBe(42);
    expect([trn.attNormal, trn.attHyper, trn.attJump, trn.attDef, trn.attSniper, trn.apSpecial, trn.prefJump, trn.learning, trn.forget])
      .toEqual([11, 22, 33, 44, 55, -20, 5, 7, 1]);
    expect(ctrl.data.difficulty).toBe(4); // reference stores AI_DIFFICULTY_* + 1
    expect(ctrl.data.pilot).toBe(trn);
    expect(ctrl.printState()).toBe('? ? ? 0');

    // A story pilot id passed at creation overrides the pilot's preferences (reference ai_controller_create).
    const p = new Pilot();
    createAiController(gsStub, 0, p, 9);
    expect([p.attNormal, p.attHyper, p.apHigh, p.prefJump, p.prefBack]).toEqual([30, 40, 100, 12, -7]);

    // Tournament opponents (every TRN pilot has pilot id 0) keep their own record's preferences...
    const tournamentGs = { isTournament: () => true } as unknown as GameState;
    const trnPilot = () => {
      const tp = new Pilot();
      Object.assign(tp, { attNormal: 65, attHyper: 85, attDef: 50, prefFwd: 130, learning: 5.5, forget: 1 });
      return tp;
    };
    const t1 = trnPilot();
    const tc = createAiController(tournamentGs, 5, t1, 0) as AiController;
    expect([t1.attNormal, t1.attHyper, t1.attDef, t1.prefFwd, t1.learning]).toEqual([65, 85, 50, 130, 5.5]);
    expect(tc.data.basePersonality?.attNormal).toBe(65);
    // ...unless strict reference behavior is requested: then pilot id 0 means Crystal's personality.
    AiController.tournamentPersonalities = false;
    try {
      const t2 = trnPilot();
      createAiController(tournamentGs, 5, t2, 0);
      expect([t2.attNormal, t2.attHyper, t2.attDef, t2.prefFwd, t2.learning]).toEqual([30, 10, 50, 30, 1.5]);
    } finally {
      AiController.tournamentPersonalities = true;
    }
  });
});

describe.skipIf(!hasGameData)('AI controller (headless fights)', () => {
  it('presses PUNCH to advance the VS/NEWSROOM screens, idles while paused and outside the fight', () => {
    const gs = createGame(SceneId.MENU);
    gs.setupAi(0, 4);
    const ctrl = gs.getPlayer(0).ctrl as AiController;
    const vs = new Scene(gs, SceneId.VS);
    const prev = gs.sc;
    gs.sc = vs;
    try {
      const ev: CtrlEvent[] = [];
      vs.staticTicksSinceStart = 254;
      expect(ctrl.poll(ev)).toBe(1); // no HAR
      expect(ev.length).toBe(0);
      vs.staticTicksSinceStart = 255;
      ctrl.poll(ev);
      expect(ev.map((e) => e.action)).toEqual([ACT_PUNCH]);
      ev.length = 0;
      gs.warpSpeed = true;
      vs.staticTicksSinceStart = 3;
      ctrl.poll(ev);
      expect(ev.map((e) => e.action)).toEqual([ACT_PUNCH]);
      gs.warpSpeed = false;
    } finally {
      gs.sc = prev;
    }

    // In the arena: nothing while the round is starting or the game is paused.
    const { gs: g2 } = startFight({ arena: 0, hars: [0, 5], pilots: [0, 1], players: ['idle', 6], seed: 5 });
    const ai = g2.getPlayer(1).ctrl as AiController;
    const ev: CtrlEvent[] = [];
    expect((g2.sc as ArenaScene).arenaGetState()).not.toBe(ARENA_STATE_FIGHTING);
    ai.poll(ev);
    expect(ev.length).toBe(0);
    runUntil(g2, () => (g2.sc as ArenaScene).arenaGetState() === ARENA_STATE_FIGHTING, 10000);
    g2.paused = true;
    for (let i = 0; i < 50; i++) ai.poll(ev);
    expect(ev.length).toBe(0);
    g2.paused = false;
    let polls = 0;
    while (ev.length === 0 && polls++ < 200) ai.poll(ev);
    expect(ev.length).toBeGreaterThan(0);
  });

  it('types a selected special move so the HAR executes it', () => {
    const { gs } = startFight({ arena: 0, hars: [5, 0], pilots: [0, 1], players: ['idle', 6], seed: 11 });
    runUntil(gs, () => (gs.sc as ArenaScene).arenaGetState() === ARENA_STATE_FIGHTING, 10000);
    const ai = gs.getPlayer(1).ctrl as AiController;
    const obj = gs.findObject(ai.harObjId)!;
    const move = afGetMove(harData(obj).afData, 16)!; // Jaguar P6321 (high special)
    expect(move.moveString).toBe('P6321');
    const executed: number[] = [];
    harInstallHook(harData(obj), (e) => {
      if (e.type === HarEventType.ATTACK && e.move) executed.push(e.move.id);
    });
    // select it exactly like set_selected_move does and let the poll loop type it out
    ai.data.selectedMove = move;
    ai.data.moveStrPos = move.moveString.length - 1;
    const typed: number[] = [];
    const origPoll = ai.poll.bind(ai);
    ai.poll = (ev: CtrlEvent[]) => {
      const active = ai.data.selectedMove === move;
      const n = ev.length;
      const r = origPoll(ev);
      if (active) typed.push(...ev.slice(n).map((e) => e.action));
      return r;
    };
    runUntil(gs, () => executed.length > 0, 3000);
    // facing left (player 2 starts on the right): 1 = down-right, 2 = down, 3 = down-left, 6 + P = left + punch
    expect(typed).toContain(ACT_DOWN | ACT_RIGHT);
    expect(typed).toContain(ACT_DOWN | ACT_LEFT);
    expect(typed).toContain(ACT_LEFT | ACT_PUNCH);
    expect(executed[0]).toBe(16);
  });

  it('updates move statistics and throw/shot memory from HAR events', () => {
    const { gs } = startFight({ arena: 0, hars: [0, 0], pilots: [0, 1], players: ['idle', 3], seed: 21 });
    runUntil(gs, () => (gs.sc as ArenaScene).arenaGetState() === ARENA_STATE_FIGHTING, 10000);
    const ai = gs.getPlayer(1).ctrl as AiController;
    const af = harData(gs.findObject(ai.harObjId)!).afData;
    const punch = afGetMove(af, 42)!; // "P"
    const throwMove = afGetMove(af, 20)!; // "P6" (CAT_CLOSE)
    const ms = ai.data.moveStats[punch.id];
    ms.lastDist = 40;
    ai.harHook({ type: HarEventType.ENEMY_BLOCK, playerId: 1, move: punch });
    expect(ms.value).toBe(-1);
    expect(ai.data.blocked).toBe(1);
    expect(ai.data.lastMoveId).toBe(punch.id);
    ai.harHook({ type: HarEventType.ENEMY_BLOCK, playerId: 1, move: punch }); // only the first block counts
    expect(ms.value).toBe(-1);
    ai.harHook({ type: HarEventType.LAND_HIT, playerId: 1, move: punch });
    expect(ms.value).toBe(0);
    expect(ms.minHitDist).toBe(40);
    expect(ms.maxHitDist).toBe(40);
    expect(ai.data.selectedMove).toBeNull();
    const thrown = ai.data.thrown;
    ai.harHook({ type: HarEventType.TAKE_HIT, playerId: 1, move: throwMove });
    expect(ai.data.thrown).toBe(thrown + 1);
    ai.harHook({ type: HarEventType.BLOCK_PROJECTILE, playerId: 1, move: punch });
    ai.harHook({ type: HarEventType.TAKE_HIT_PROJECTILE, playerId: 1, move: punch });
    expect(ai.data.shot).toBeGreaterThanOrEqual(1);
  });

  it('forgets learned adjustments back to the tournament pilot record (story pilots: hard-coded personality)', () => {
    for (const tournament of [true, false]) {
      globalRandom.setSeed(tournament ? 61 : 62);
      const gs = createGame(SceneId.MENU, [0, 4], [0, 5]);
      if (tournament) gs.getPlayer(0).chr = {} as NonNullable<GameState['players'][0]['chr']>;
      const pilot = gs.getPlayer(1).pilot;
      Object.assign(pilot, { attNormal: 65, attHyper: 85, attSniper: 25, attDef: 50, prefFwd: 130, learning: 5.5, forget: 1 });
      gs.setupAi(1, 6);
      gs.matchSettings.rounds = 0;
      gs.swapScene(SceneId.ARENA0);
      runUntil(gs, () => (gs.sc as ArenaScene).arenaGetState() === ARENA_STATE_FIGHTING, 10000);
      const ai = gs.getPlayer(1).ctrl as AiController;
      // what the AI "learned" (e.g. after being thrown repeatedly)
      pilot.attSniper = 99;
      pilot.prefFwd = 5;
      ai.data.thrown = 7;
      const move = afGetMove(harData(gs.findObject(ai.harObjId)!).afData, 42)!;
      for (let i = 0; i < 200 && ai.data.thrown !== 0; i++) ai.harHook({ type: HarEventType.LAND_HIT, playerId: 1, move });
      expect(ai.data.thrown).toBe(0); // forgot
      if (tournament) {
        expect([pilot.attSniper, pilot.prefFwd, pilot.attNormal]).toEqual([25, 130, 65]);
      } else {
        // Shirro's hard-coded personality (story mode)
        expect([pilot.attSniper, pilot.prefFwd, pilot.attNormal]).toEqual([4, 10, 15]);
      }
    }
  });

  it('AI vs AI fights finish in every arena, for every HAR and difficulty', () => {
    const lines: string[] = [];
    const perHar = new Map<number, { attacks: number; specials: number; wins: number }>();
    const totals = { specials: 0, throws: 0, jumps: 0, blocks: 0, projectileHits: 0, projectileBlocks: 0, finishes: 0 };
    for (let d = 0; d <= 6; d++) {
      const times: number[] = [];
      for (let arena = 0; arena < 5; arena++) {
        for (let k = 0; k < 3; k++) {
          const h0 = (arena * 3 + k + d) % 11;
          const h1 = (arena * 3 + k + d + 5) % 11;
          const seed = 1000 + d * 100 + arena * 10 + k;
          const spec: FightSpec = { arena, hars: [h0, h1], pilots: [seed % 10, (seed * 7) % 11], players: [d, d], seed };
          const r = fight(spec);
          expect(r.ms, `fight timed out: ${JSON.stringify(spec)}`).toBeGreaterThan(0);
          expect([0, 1]).toContain(r.winner);
          expect(r.scene).toBe(SceneId.VS); // demo play continues with the VS screen
          times.push(r.ms / 1000);
          for (let i = 0; i < 2; i++) {
            const hid = [h0, h1][i];
            const s = perHar.get(hid) ?? { attacks: 0, specials: 0, wins: 0 };
            s.attacks += sum(r.events[i], 'ATTACK');
            s.specials += sum(r.attacks[i], 'special');
            if (r.winner === i) s.wins++;
            perHar.set(hid, s);
            totals.specials += sum(r.attacks[i], 'special');
            totals.throws += sum(r.attacks[i], 'throw');
            totals.jumps += sum(r.attacks[i], 'jump');
            totals.blocks += sum(r.events[i], 'BLOCK') + sum(r.events[i], 'BLOCK_PROJECTILE');
            totals.projectileHits += sum(r.events[i], 'LAND_HIT_PROJECTILE');
            totals.projectileBlocks += sum(r.events[i], 'ENEMY_BLOCK_PROJECTILE');
          }
          if (r.finish) totals.finishes++;
        }
      }
      lines.push(`${AI_DIFFICULTY_NAMES[d].padEnd(12)} 15 fights, mean ${mean(times).toFixed(1)}s, max ${Math.max(...times).toFixed(1)}s`);
    }
    for (const [hid, s] of [...perHar.entries()].sort((a, b) => a[0] - b[0])) {
      lines.push(`  ${HAR_NAMES[hid].padEnd(9)} attacks=${s.attacks} specials=${s.specials} wins=${s.wins}`);
      expect(s.attacks, `${HAR_NAMES[hid]} never attacked`).toBeGreaterThan(0);
    }
    lines.push(`  totals ${JSON.stringify(totals)}`);
    console.log(`AI vs AI matrix (one round each):\n${lines.join('\n')}`);
    expect(totals.specials).toBeGreaterThan(0);
    expect(totals.throws).toBeGreaterThan(0);
    expect(totals.jumps).toBeGreaterThan(0);
    expect(totals.blocks).toBeGreaterThan(0);
    expect(totals.projectileHits + totals.projectileBlocks).toBeGreaterThan(0);
  }, 120000);

  it('plays best-of-3 matches across round resets', () => {
    for (let k = 0; k < 4; k++) {
      const r = fight({ arena: k, hars: [k, 10 - k], pilots: [k, k + 4], players: [2 + k, 6 - k], seed: 77 + k, rounds: 1 });
      expect(r.ms).toBeGreaterThan(0);
      expect([0, 1]).toContain(r.winner);
      const defeats = sum(r.events[0], 'DEFEAT') + sum(r.events[1], 'DEFEAT');
      expect(defeats).toBeGreaterThanOrEqual(2);
    }
  }, 120000);

  it('beats an idle keyboard player at every difficulty', () => {
    const lines: string[] = [];
    for (let d = 0; d <= 6; d++) {
      const times: number[] = [];
      for (let k = 0; k < 3; k++) {
        const r = fight({ arena: (d + k) % 5, hars: [(d * 3 + k) % 11, (d * 5 + k * 4) % 11], pilots: [k, (d + k) % 10], players: ['idle', d], seed: 300 + d * 10 + k });
        expect(r.ms, `difficulty ${d} fight ${k} did not finish`).toBeGreaterThan(0);
        expect(r.winner, `difficulty ${d} fight ${k}: idle player won`).toBe(1);
        expect(r.scene).toBe(SceneId.NEWSROOM); // single player continues to the newsroom
        expect(sum(r.events[1], 'LAND_HIT') + sum(r.events[1], 'LAND_HIT_PROJECTILE')).toBeGreaterThan(0);
        expect(r.koMs).toBeGreaterThan(0);
        times.push(r.koMs / 1000);
      }
      lines.push(`${AI_DIFFICULTY_NAMES[d].padEnd(12)} time to knock out an idle player: ${times.map((t) => t.toFixed(1)).join(', ')}s`);
    }
    console.log(lines.join('\n'));
  }, 120000);

  it('scrap/destruction: never in strict reference mode, attempted by the victorious AI with the extension', () => {
    const specs: FightSpec[] = [];
    for (let k = 0; k < 8; k++) specs.push({ arena: k % 5, hars: [k % 11, (k + 3) % 11], pilots: [k, (k + 2) % 10], players: ['idle', 6], seed: 900 + k });
    AiController.finishers = false;
    for (const s of specs) {
      const r = fight(s);
      expect(r.winner).toBe(1);
      expect(r.finish).toBe(0);
      expect(sum(r.events[1], 'SCRAP')).toBe(0);
    }
    AiController.finishers = true;
    let finished = 0;
    let destroyed = 0;
    for (const s of specs) {
      const r = fight(s);
      expect(r.winner).toBe(1);
      if (r.finish) finished++;
      if (r.finish === 2) destroyed++;
    }
    console.log(`ULTIMATE finishers: ${finished}/8 scrapped, ${destroyed}/8 destroyed`);
    expect(finished).toBeGreaterThan(0);
  }, 120000);

  it('enters special moves with every HAR', () => {
    // Every HAR should enter special moves (typed move strings or hard-coded charge/push sequences) at high difficulty.
    const specialsByHar = new Map<number, number>();
    for (let h = 0; h < 11; h++) {
      for (let k = 0; k < 2; k++) {
        const r = fight({ arena: (h + k) % 5, hars: [(h + 4 + k) % 11, h], pilots: [k, h % 10], players: [3, 6], seed: 4000 + h * 10 + k });
        expect(r.ms).toBeGreaterThan(0);
        specialsByHar.set(h, (specialsByHar.get(h) ?? 0) + sum(r.attacks[1], 'special'));
      }
    }
    const summary = [...specialsByHar.entries()].map(([h, n]) => `${HAR_NAMES[h]}=${n}`).join(' ');
    console.log(`special moves executed by an ULTIMATE AI per HAR (2 fights each): ${summary}`);
    // Gargoyle is excluded: the reference's hard-coded Gargoyle charge sequences end with a bare PUNCH, which the HAR
    // input buffer records as a neutral '5', so they never match (reference quirk, preserved).
    for (const [h, n] of specialsByHar) if (h !== HarId.GARGOYLE) expect(n, HAR_NAMES[h]).toBeGreaterThan(0);
  }, 120000);
});
