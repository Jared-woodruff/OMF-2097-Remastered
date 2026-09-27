// Difficulty-scaling statistics for the CPU opponent (src/controller/ai.ts). Deterministic (fixed seeds); prints a
// per-difficulty table. The AI under test is player 2; its opponents are an idle keyboard player, a scripted
// "button masher" that walks in and attacks (a stand-in for an aggressive human) and a VETERAN-level AI.
import { describe, expect, it } from 'vitest';
import {
  ACT_DOWN, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_STOP, AI_DIFFICULTY_NAMES, CtrlType, HarEventType,
  OBJECT_FACE_RIGHT, SceneId, STATIC_TICKS,
} from '../game/constants';
import { Controller, type CtrlEvent } from '../controller/controller';
import type { GameState } from '../game/gameState';
import { ARENA_STATE_FIGHTING, harData, harInstallHook, type ArenaLike } from '../game/objects/har';
import { globalRandom, Random } from '../util/random';
import { createGame, hasGameData } from './harness';

/** Scripted aggressive opponent: walks in, then mixes punches, kicks, sweeps and advancing attacks. */
class MasherController extends Controller {
  private rng: Random;
  constructor(gs: GameState, seed: number) {
    super(gs);
    this.type = CtrlType.KEYBOARD;
    this.rng = new Random(seed);
  }

  override poll(ev: CtrlEvent[]): number {
    const o = this.gs.findObject(this.harObjId);
    const e = this.gs.findObject(this.gs.getPlayer(1).harObjId);
    if (!o || !e) return 0;
    const fwd = o.direction === OBJECT_FACE_RIGHT ? ACT_RIGHT : ACT_LEFT;
    let act = ACT_STOP;
    if ((this.gs.sc as unknown as ArenaLike).arenaGetState() !== ARENA_STATE_FIGHTING) {
      // hands off once the fight is decided (random mashing could otherwise keep re-entering a scrap forever)
      act = ACT_STOP;
    } else if (Math.abs(o.posX - e.posX) > 45) {
      act = fwd;
    } else {
      const r = this.rng.int(8);
      act = r === 0 ? ACT_PUNCH : r === 1 ? ACT_KICK : r === 2 ? ACT_DOWN | ACT_KICK : r === 3 ? fwd | ACT_PUNCH : fwd;
    }
    this.cmd(act, ev);
    this.last = this.current;
    this.current = 0;
    return 0;
  }
}

/** Simulated time of the current fight (read by event hooks). */
const clock = { ms: 0 };

function runUntil(gs: GameState, done: () => boolean, maxMs: number): number {
  let staticWait = 0;
  let dynamicWait = 0;
  clock.ms = 0;
  while (clock.ms < maxMs) {
    clock.ms += STATIC_TICKS;
    staticWait += STATIC_TICKS;
    dynamicWait += STATIC_TICKS;
    while (staticWait >= STATIC_TICKS) {
      gs.staticTick();
      staticWait -= STATIC_TICKS;
      if (done()) return clock.ms;
    }
    let dyn = gs.msPerDyntick();
    while (dynamicWait >= dyn) {
      gs.dynamicTick();
      dynamicWait -= dyn;
      if (done()) return clock.ms;
      dyn = gs.msPerDyntick();
    }
  }
  return -1;
}

type Opponent = 'idle' | 'masher' | number;

interface Outcome {
  finished: boolean;
  aiWon: boolean;
  /** simulated seconds until the knockout (DEFEAT event) */
  koSec: number;
  aiHealthLeft: number;
  aiBlocks: number;
  /** 0 none, 1 scrap, 2 destruction */
  finish: number;
}

/**
 * One-round fight of the AI under test against `opponent`. The AI is player 2 unless `aiSide` is 0 (only for AI
 * opponents; the keyboard-type opponents always play player 1).
 */
function fight(difficulty: number, opponent: Opponent, k: number, seed: number, aiSide: 0 | 1 = 1): Outcome {
  globalRandom.setSeed(seed);
  const hars: [number, number] = [(k * 7 + 3) % 11, (k * 5) % 11];
  const gs = createGame(SceneId.MENU, [(k + 2) % 10, k % 10], hars);
  gs.rand.setSeed(seed ^ 0x5a5a);
  const other = aiSide === 1 ? 0 : 1;
  if (opponent === 'masher') gs.getPlayer(0).setCtrl(new MasherController(gs, seed));
  else if (typeof opponent === 'number') gs.setupAi(other, opponent);
  gs.setupAi(aiSide, difficulty);
  gs.matchSettings.rounds = 0;
  const id = SceneId.ARENA0 + (k % 5);
  gs.swapScene(id);
  const aiObj = gs.findObject(gs.getPlayer(aiSide).harObjId)!;
  let blocks = 0;
  let koMs = -1;
  harInstallHook(harData(aiObj), (e) => {
    if (e.type === HarEventType.BLOCK || e.type === HarEventType.BLOCK_PROJECTILE) blocks++;
  });
  for (let i = 0; i < 2; i++) {
    harInstallHook(harData(gs.findObject(gs.getPlayer(i).harObjId)!), (e) => {
      if (e.type === HarEventType.DEFEAT && koMs < 0) koMs = clock.ms;
    });
  }
  const ms = runUntil(gs, () => gs.nextId !== id, 300000);
  const h = harData(aiObj);
  return {
    finished: ms >= 0,
    aiWon: ms >= 0 && gs.fightStats.winner === aiSide,
    koSec: koMs / 1000,
    aiHealthLeft: Math.max(0, h.health) / h.healthMax,
    aiBlocks: blocks,
    finish: gs.fightStats.finish,
  };
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const f1 = (n: number) => n.toFixed(1).padStart(5);

describe.skipIf(!hasGameData)('AI difficulty scaling (statistics)', () => {
  it('prints per-difficulty win rates and win times', () => {
    const N = 20;
    const IDLE_N = 6;
    const rows: string[] = [];
    const masherWins: number[] = [];
    for (let d = 0; d <= 6; d++) {
      const idleKo: number[] = [];
      let scraps = 0;
      let destructions = 0;
      for (let k = 0; k < IDLE_N; k++) {
        const r = fight(d, 'idle', k, 10000 + d * 100 + k);
        expect(r.finished).toBe(true);
        expect(r.aiWon).toBe(true);
        idleKo.push(r.koSec);
        if (r.finish >= 1) scraps++;
        if (r.finish === 2) destructions++;
      }
      let mw = 0;
      const mKo: number[] = [];
      const mHealth: number[] = [];
      const mBlocks: number[] = [];
      for (let k = 0; k < N; k++) {
        const r = fight(d, 'masher', k, 20000 + d * 100 + k);
        expect(r.finished).toBe(true);
        if (r.aiWon) {
          mw++;
          mKo.push(r.koSec);
          mHealth.push(r.aiHealthLeft * 100);
        }
        mBlocks.push(r.aiBlocks);
      }
      // AI vs AI: play every setup from both sides (the engine resolves simultaneous hits in player 1's favor)
      let vw = 0;
      const vKo: number[] = [];
      for (let k = 0; k < N; k++) {
        for (const side of [0, 1] as const) {
          const r = fight(d, 2, k, 30000 + d * 100 + k, side);
          expect(r.finished).toBe(true);
          if (r.aiWon) {
            vw++;
            vKo.push(r.koSec);
          }
        }
      }
      masherWins.push(mw);
      rows.push(
        `${AI_DIFFICULTY_NAMES[d].padEnd(12)} | idle: KO ${f1(mean(idleKo))}s, scrap ${scraps}/${IDLE_N}, destr ${destructions}/${IDLE_N}` +
        ` | masher: ${String(mw).padStart(2)}/${N} wins, KO ${f1(mean(mKo))}s, hp left ${mean(mHealth).toFixed(0).padStart(3)}%, blocks ${mean(mBlocks).toFixed(1).padStart(4)}/fight` +
        ` | vs VETERAN AI (both sides): ${String(vw).padStart(2)}/${2 * N} wins, KO ${f1(mean(vKo))}s`,
      );
    }
    console.log(`AI difficulty scaling (one-round fights, times are simulated seconds to the knockout):\n${rows.join('\n')}`);
    // Smart AIs block the masher's attacks and win far more often than dumb ones.
    const low = masherWins[0] + masherWins[1];
    const high = masherWins[5] + masherWins[6];
    expect(high).toBeGreaterThan(low + N / 2);
  }, 300000);
});
