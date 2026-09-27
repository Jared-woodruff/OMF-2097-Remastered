// The ADVANCED options the reference engine never implemented (DEF. THROWS, KNOCK DOWN, BLOCK DAMAGE), and the
// remastered effects: they must never change the simulation.
import { afterEach, describe, expect, it } from 'vitest';
import { setKeyState } from '../controller/input';
import { FxDirector } from '../fx/director';
import { CAT_CLOSE, CAT_JUMPING, HarEventType, KnockDownMode, SceneId, STATIC_TICKS } from '../game/constants';
import { FxType, onFx } from '../game/fx';
import type { GameState } from '../game/gameState';
import { harData, harInstallHook, knocksDown } from '../game/objects/har';
import { settings } from '../game/settings';
import type { AfMove } from '../resources/resources';
import { globalRandom } from '../util/random';
import { createGame, hasGameData, HeadlessRunner } from './harness';

const KEYS = ['ArrowRight', 'ArrowLeft', 'Enter', 'KeyD', 'KeyA'];
afterEach(() => {
  for (const k of KEYS) setKeyState(k, false);
});

/** A fight in the stadium between Jaguar (player 1) and Shadow (player 2), both keyboard controlled, past the round start. */
function keyboardFight(setup?: (gs: GameState) => void): { gs: GameState; run: HeadlessRunner } {
  const gs = createGame(SceneId.MENU, [0, 1], [0, 5]);
  setup?.(gs);
  gs.swapScene(SceneId.ARENA0);
  const run = new HeadlessRunner(gs);
  run.advance(3500);
  return { gs, run };
}

/** Walks player 1 into player 2 (player 2 holding back towards the right wall when `p2Blocks`). */
function closeIn(run: HeadlessRunner, p2Blocks: boolean): void {
  if (p2Blocks) setKeyState('KeyD', true);
  setKeyState('ArrowRight', true);
  run.advance(2500);
  setKeyState('ArrowRight', false);
  run.advance(100);
}

describe('KNOCK DOWN', () => {
  it('applies to the selected jumping attacks only', () => {
    const gs = { matchSettings: { knockDown: KnockDownMode.NONE } } as unknown as GameState;
    const move = (moveString: string, category: number) => ({ moveString, category }) as AfMove;
    const jumpKick = move('K', CAT_JUMPING), jumpPunch = move('P', CAT_JUMPING), kick = move('K', 5);
    const table: [KnockDownMode, boolean, boolean][] = [
      [KnockDownMode.NONE, false, false],
      [KnockDownMode.KICKS, true, false],
      [KnockDownMode.PUNCHES, false, true],
      [KnockDownMode.BOTH, true, true],
    ];
    for (const [mode, kicks, punches] of table) {
      gs.matchSettings.knockDown = mode;
      expect(knocksDown(gs, jumpKick)).toBe(kicks);
      expect(knocksDown(gs, jumpPunch)).toBe(punches);
      expect(knocksDown(gs, kick)).toBe(false);
    }
  });
});

describe.skipIf(!hasGameData)('BLOCK DAMAGE and DEF. THROWS (headless fights)', () => {
  const blockedFight = (pct: number) => {
    const { gs, run } = keyboardFight((g) => (g.matchSettings.blockDamage = pct));
    const p2 = harData(gs.findObject(gs.getPlayer(1).harObjId)!);
    let blocks = 0;
    harInstallHook(p2, (e) => {
      if (e.type === HarEventType.BLOCK) blocks++;
    });
    closeIn(run, true);
    const hp0 = p2.health;
    for (let i = 0; i < 4; i++) {
      setKeyState('Enter', true);
      run.advance(60);
      setKeyState('Enter', false);
      run.advance(700);
    }
    return { blocks, lost: hp0 - p2.health, health: p2.health };
  };

  it('blocked hits cost nothing by default', () => {
    const r = blockedFight(0);
    expect(r.blocks).toBeGreaterThan(0);
    expect(r.lost).toBe(0);
  });

  it('blocked hits inflict the selected share of their damage', () => {
    const r = blockedFight(35);
    expect(r.blocks).toBeGreaterThan(0);
    expect(r.lost).toBeGreaterThan(0);
    expect(r.health).toBeGreaterThan(0);
  });

  const backThrow = (defensive: boolean) => {
    const { gs, run } = keyboardFight((g) => (g.matchSettings.defensiveThrows = defensive));
    const p2 = harData(gs.findObject(gs.getPlayer(1).harObjId)!);
    let thrown = false;
    const p1 = harData(gs.findObject(gs.getPlayer(0).harObjId)!);
    harInstallHook(p1, (e) => {
      if (e.type === HarEventType.ATTACK && e.move?.category === CAT_CLOSE) thrown = true;
    });
    closeIn(run, false);
    // Back + punch, next to the enemy.
    setKeyState('ArrowLeft', true);
    setKeyState('Enter', true);
    run.advance(80);
    setKeyState('Enter', false);
    setKeyState('ArrowLeft', false);
    run.advance(400);
    return { thrown: thrown || p2.throwDuration > 0 || p2.isGrabbed > 0 };
  };

  it('throws need forward + punch by default', () => {
    expect(backThrow(false).thrown).toBe(false);
  });

  it('DEF. THROWS also throws from the defensive (back) position', () => {
    expect(backThrow(true).thrown).toBe(true);
  });
});

describe.skipIf(!hasGameData)('remastered effects', () => {
  /** An AI fight with fixed seeds; returns a fingerprint of the simulation, with or without the effects running. */
  function aiFight(withEffects: boolean): { state: string; events: number; particles: number; lights: number } {
    globalRandom.setSeed(1234);
    const gs = createGame(SceneId.MENU, [2, 5], [3, 7]);
    gs.rand.setSeed(99);
    gs.setupAi(0, 4);
    gs.setupAi(1, 4);
    gs.swapScene(SceneId.ARENA3);
    const director = withEffects ? new FxDirector() : null;
    let events = 0;
    const off = onFx((e) => {
      if (e.type !== FxType.LANDING) events++;
    });
    let particles = 0, lights = 0;
    let ticks = 0, staticWait = 0, dynamicWait = 0;
    for (let ms = 0; ms < 40000; ms += STATIC_TICKS) {
      staticWait += STATIC_TICKS;
      dynamicWait += STATIC_TICKS;
      while (staticWait >= STATIC_TICKS) {
        gs.staticTick();
        staticWait -= STATIC_TICKS;
      }
      while (dynamicWait >= gs.msPerDyntick()) {
        dynamicWait -= gs.msPerDyntick();
        gs.dynamicTick();
        ticks++;
      }
      if (director && ms % 30 === 0) {
        director.update(gs, ticks, true);
        particles = Math.max(particles, director.frame.particleCount);
        lights = Math.max(lights, director.frame.lights.length);
      }
    }
    off();
    director?.destroy();
    const h = [0, 1].map((i) => harData(gs.findObject(gs.getPlayer(i).harObjId)!));
    const o = [0, 1].map((i) => gs.findObject(gs.getPlayer(i).harObjId)!);
    const state = JSON.stringify([h.map((x) => [x.health, x.endurance]), o.map((x) => [x.posX, x.posY]), gs.rand.seed, globalRandom.seed]);
    return { state, events, particles, lights };
  }

  it('never change the fight', () => {
    const a = aiFight(false);
    const b = aiFight(true);
    expect(b.state).toBe(a.state);
    expect(b.events).toBe(a.events);
    expect(a.events).toBeGreaterThan(5);
    expect(b.particles).toBeGreaterThan(20);
    expect(b.lights).toBeGreaterThan(0);
  });

  it('switch off with the settings', () => {
    const v = settings().video;
    const saved = { ...v };
    try {
      v.fxParticles = v.fxLighting = v.fxImpact = v.fxAtmosphere = false;
      const gs = createGame(SceneId.MENU);
      gs.swapScene(SceneId.ARENA3);
      const director = new FxDirector();
      director.update(gs, 0, true);
      director.update(gs, 10, true);
      expect(director.frame.active).toBe(false);
      director.destroy();
    } finally {
      Object.assign(v, saved);
    }
  });
});

describe.skipIf(!hasGameData)('training mode', () => {
  it('never knocks anybody out and refills health after combos', async () => {
    const { startTraining } = await import('../game/scenes/mainmenu/menuTraining');
    const gs = createGame(SceneId.MENU, [0, 1], [0, 5]);
    const t = settings().training;
    Object.assign(t, { har: 0, pilot: 0, opponent: 5, arena: 0, dummy: 0 });
    startTraining(gs);
    const run = new HeadlessRunner(gs);
    run.advance(4500);
    expect(gs.thisId).toBe(SceneId.ARENA0);
    expect(gs.training).toBe(true);
    const dummy = harData(gs.findObject(gs.getPlayer(1).harObjId)!);
    let lowest = dummy.health;
    // Pound the dummy for a long time: far more damage than its health.
    setKeyState('ArrowRight', true);
    for (let i = 0; i < 120; i++) {
      setKeyState('Enter', i % 2 === 0);
      run.advance(150);
      lowest = Math.min(lowest, dummy.health);
      expect(dummy.health).toBeGreaterThan(0);
    }
    setKeyState('ArrowRight', false);
    setKeyState('Enter', false);
    expect(lowest).toBeLessThan(dummy.healthMax);
    expect(gs.nextId).toBe(SceneId.ARENA0);
    run.advance(4000);
    expect(dummy.health).toBe(dummy.healthMax);
  });
});
