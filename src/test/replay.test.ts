// Replays: the REC format, and recorded fights played back tick for tick to the same result (a player on the
// keyboard against the computer, whose every input is recorded; and two keyboard players).
import { afterEach, describe, expect, it } from 'vitest';
import { setKeyState } from '../controller/input';
import { packAction, unpackAction } from '../controller/rec';
import { Pilot } from '../formats/pilot';
import { recCreate, recMove, recParse, recSerialize, REC_LOOKUP_ACTION, recSeedMove, recSeedOf } from '../formats/rec';
import { ACT_DOWN, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_STOP, ACT_UP, HarId, SceneId } from '../game/constants';
import type { GameState } from '../game/gameState';
import { harData } from '../game/objects/har';
import { ReplaySession } from '../game/replay/playback';
import { metaFromRec, pruneIds, setReplaySink, type ReplayMeta } from '../game/replay/store';
import type { ArenaScene } from '../game/scenes/arena';
import { globalRandom } from '../util/random';
import { createGame, hasGameData, HeadlessRunner } from './harness';

const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'ShiftRight'];

afterEach(() => {
  for (const k of KEYS) setKeyState(k, false);
});

describe('REC format', () => {
  it('packs and unpacks every input', () => {
    const dirs = [0, ACT_UP, ACT_UP | ACT_RIGHT, ACT_RIGHT, ACT_DOWN | ACT_RIGHT, ACT_DOWN, ACT_DOWN | ACT_LEFT, ACT_LEFT, ACT_UP | ACT_LEFT];
    for (const d of dirs) {
      for (const b of [0, ACT_PUNCH, ACT_KICK, ACT_PUNCH | ACT_KICK]) {
        const a = d | b;
        expect(unpackAction(packAction(a))).toBe(a === 0 ? ACT_STOP : a);
      }
    }
  });

  it('writes what it reads', () => {
    const rec = recCreate();
    const p = new Pilot();
    p.name = 'Crystal';
    p.harId = 13;
    p.power = 12;
    p.color1 = 5;
    p.quotes[3] = 'I will win.';
    rec.pilots[0].info = p;
    rec.arenaId = 7;
    rec.power = [3, 8];
    rec.roundType = 2;
    rec.moves.push(recSeedMove(0xdeadbeef));
    for (let t = 0; t < 50; t++) {
      const m = recMove(t * 3, REC_LOOKUP_ACTION, t % 2);
      m.extra[0] = packAction(t % 3 ? ACT_RIGHT | ACT_PUNCH : ACT_DOWN);
      rec.moves.push(m);
    }
    const bytes = recSerialize(rec);
    const back = recParse(bytes);
    expect(back.pilots[0].info.name).toBe('Crystal');
    expect(back.pilots[0].info.harId).toBe(13);
    expect(back.pilots[0].info.power).toBe(12);
    expect(back.pilots[0].info.quotes[3]).toBe('I will win.');
    expect(back.arenaId).toBe(7);
    expect(back.power).toEqual([3, 8]);
    expect(back.roundType).toBe(2);
    expect(recSeedOf(back.moves[0])).toBe(0xdeadbeef);
    expect(back.moves.length).toBe(51);
    expect(Array.from(recSerialize(back))).toEqual(Array.from(bytes));
    expect(metaFromRec(back).players[0].name).toBe('Crystal');
  });

  it('keeps the newest fights and every kept one', () => {
    const meta = (created: number, kept = false): ReplayMeta => ({
      created, mode: '', players: [{ name: '', harId: 0, pilotId: 0 }, { name: '', harId: 0, pilotId: 0 }], arena: 0, winner: 0,
      rounds: [0, 0], ticks: 0, kept,
    });
    const list = [1, 5, 3, 9, 7, 2].map((c, i) => ({ id: i + 1, meta: meta(c, c === 1) }));
    // Two automatic ones stay: the newest (9, 7); 5, 3 and 2 go; the kept one (1) stays.
    expect(pruneIds(list, 2).sort()).toEqual([2, 3, 6]);
  });
});

/** Both robots' state, for comparing a fight with its replay. */
function snapshot(gs: GameState): string {
  return [0, 1].map((i) => {
    const o = gs.findObject(gs.getPlayer(i).harObjId);
    if (!o) return '-';
    const h = harData(o);
    return [o.posX.toFixed(3), o.posY.toFixed(3), o.velX.toFixed(3), o.velY.toFixed(3), h.health, h.endurance, h.state,
      o.curAnimation?.id ?? -1, o.curSpriteId].join(',');
  }).join(' | ');
}

/** Records the state after every game tick while the fight runs. */
function traceTicks(gs: GameState): Map<number, string> {
  const trace = new Map<number, string>();
  const tick = gs.dynamicTick.bind(gs);
  gs.dynamicTick = () => {
    tick();
    if (gs.sc.isArena()) trace.set(gs.tick, snapshot(gs));
  };
  return trace;
}

/** Plays a fight with pseudo-random key presses for player 1 until the arena ends; returns the saved recording. */
function recordFight(gs: GameState, seed: number): { meta: ReplayMeta; data: Uint8Array; trace: Map<number, string>; winner: number } {
  let saved: { meta: ReplayMeta; data: Uint8Array } | null = null;
  setReplaySink(async (meta, data) => {
    saved = { meta, data };
  });
  gs.swapScene(SceneId.ARENA0);
  const trace = traceTicks(gs);
  const run = new HeadlessRunner(gs);
  let r = seed >>> 0;
  let winner = -1;
  for (let t = 0; t < 400000 && gs.sc.isArena(); t += 30) {
    r = (Math.imul(r, 1103515245) + 12345) >>> 0;
    for (const k of KEYS) setKeyState(k, false);
    setKeyState(KEYS[(r >>> 8) % KEYS.length], true);
    if ((r >>> 16) % 3 === 0) setKeyState(KEYS[(r >>> 20) % KEYS.length], true);
    winner = (gs.sc as ArenaScene).winner;
    run.advance(30);
  }
  for (const k of KEYS) setKeyState(k, false);
  expect(saved).not.toBeNull();
  return { ...saved!, trace, winner };
}

/** Plays a recording back; returns the state trace and the winner. */
function playBack(meta: ReplayMeta, data: Uint8Array): { trace: Map<number, string>; winner: number; session: ReplaySession } {
  globalRandom.setSeed(987654);
  const gs = createGame(SceneId.MENU);
  const session = new ReplaySession(gs, { meta, data }, () => {});
  session.start();
  const run = new HeadlessRunner(gs);
  for (let t = 0; t < 5000 && !gs.sc.isArena(); t += 20) run.advance(20);
  expect(gs.sc.isArena()).toBe(true);
  const trace = traceTicks(gs);
  for (let t = 0; t < 400000 && !session.ended; t += 100) run.advance(100);
  expect(session.ended).toBe(true);
  return { trace, winner: (gs.sc as ArenaScene).winner, session };
}

function expectSameFight(recorded: Map<number, string>, played: Map<number, string>): void {
  expect(recorded.size).toBeGreaterThan(500);
  let compared = 0;
  for (const [tick, state] of recorded) {
    if (!played.has(tick)) continue;
    expect(played.get(tick), `tick ${tick}`).toBe(state);
    compared++;
  }
  // Every tick up to the fight's end was played back.
  expect(compared).toBeGreaterThan(recorded.size - 5);
}

describe.skipIf(!hasGameData)('replays', () => {
  it('a fight against the computer plays back the same, tick for tick', () => {
    globalRandom.setSeed(42);
    const gs = createGame(SceneId.MENU, [0, 1], [HarId.JAGUAR, HarId.KATANA]);
    gs.setupKeyboard(0, 0);
    gs.setupAi(1, 4);
    gs.rand.setSeed(1234);
    const fight = recordFight(gs, 7);
    expect(fight.meta.mode).toBe('ONE PLAYER');
    expect(fight.meta.winner).toBe(fight.winner);
    const replay = playBack(fight.meta, fight.data);
    expectSameFight(fight.trace, replay.trace);
    expect(replay.winner).toBe(fight.winner);
  });

  it('two keyboard players play back the same (inputs recorded when they change)', () => {
    globalRandom.setSeed(5);
    const gs = createGame(SceneId.MENU, [2, 3], [HarId.SHADOW, HarId.PYROS]);
    gs.setupKeyboard(0, 0);
    gs.setupKeyboard(1, 1);
    gs.matchSettings.rounds = 0;
    gs.rand.setSeed(99);
    const fight = recordFight(gs, 3);
    expect(fight.meta.mode).toBe('TWO PLAYER');
    const replay = playBack(fight.meta, fight.data);
    expectSameFight(fight.trace, replay.trace);
  });

  it('jumps to a moment and steps one tick', () => {
    globalRandom.setSeed(11);
    const gs = createGame(SceneId.MENU, [4, 5], [HarId.THORN, HarId.FLAIL]);
    gs.setupKeyboard(0, 0);
    gs.setupAi(1, 3);
    const fight = recordFight(gs, 21);
    const replay = playBack(fight.meta, fight.data);
    const s = replay.session;
    const target = 900;
    s.seek(target);
    expect(s.gs.tick).toBe(target);
    expect(snapshot(s.gs)).toBe(fight.trace.get(target));
    s.setPaused(true);
    s.step();
    expect(s.gs.tick).toBe(target + 1);
    expect(snapshot(s.gs)).toBe(fight.trace.get(target + 1));
    s.seek(target - 1);
    expect(snapshot(s.gs)).toBe(fight.trace.get(target - 1));
  });
});
