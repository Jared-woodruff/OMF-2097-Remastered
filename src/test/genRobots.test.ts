// The remaster's generated robots (src/gen; their mod plays them as HARs 11-14): their fighter files are complete and
// the mod's are up to date, and they fight: full AI matches against each other and against the original robots.
import { describe, expect, it } from 'vitest';
import { saveAF } from '../formats/af';
import { HarEventType, HarId, SceneId, STATIC_TICKS } from '../game/constants';
import type { GameState } from '../game/gameState';
import { harData, harInstallHook } from '../game/objects/har';
import { buildFighter } from '../gen/fighter/build';
import { fighterOf, GEN_ROBOTS } from '../gen/roster';
import { afGetMove, langGet, loadAf } from '../resources/resources';
import { globalRandom } from '../util/random';
import { drawList } from '../video/draw';
import { EXTRAS_NUMBERS } from '../mods/extras';
import { createGame, extrasPackage, hasExtras, hasGameData, loadExtras } from './harness';

function runUntil(gs: GameState, done: () => boolean, maxMs: number): number {
  let ms = 0, staticWait = 0, dynamicWait = 0;
  while (ms < maxMs) {
    ms += STATIC_TICKS;
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
      drawList.begin();
      gs.render();
    }
  }
  return -1;
}

interface Result {
  ms: number;
  winner: number;
  events: [Map<string, number>, Map<string, number>];
  moves: [Set<number>, Set<number>];
}

function aiFight(hars: [number, number], seed: number, arena = 0): Result {
  globalRandom.setSeed(seed);
  const gs = createGame(SceneId.MENU, [0, 1], hars);
  gs.rand.setSeed(seed * 7 + 3);
  gs.setupAi(0, 4);
  gs.setupAi(1, 4);
  gs.matchSettings.rounds = 0;
  const id = SceneId.ARENA0 + arena;
  gs.swapScene(id);
  const r: Result = { ms: -1, winner: -1, events: [new Map(), new Map()], moves: [new Set(), new Set()] };
  for (let i = 0; i < 2; i++) {
    const obj = gs.findObject(gs.getPlayer(i).harObjId)!;
    harInstallHook(harData(obj), (e) => {
      r.events[i].set(HarEventType[e.type], (r.events[i].get(HarEventType[e.type]) ?? 0) + 1);
      if (e.type === HarEventType.ATTACK && e.move) r.moves[i].add(e.move.id);
    });
  }
  r.ms = runUntil(gs, () => gs.nextId !== id, 240000);
  r.winner = r.ms >= 0 ? gs.fightStats.winner : -1;
  return r;
}

describe.skipIf(!hasGameData || !hasExtras)('generated robots', () => {
  it('have every move the engine needs', async () => {
    await loadExtras();
    for (const r of GEN_ROBOTS) {
      const af = loadAf(r.id);
      for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 48, 49, 55, 56, 57, 60, 61]) {
        expect(afGetMove(af, id), `${r.name} move ${id}`).not.toBeNull();
      }
      expect(afGetMove(af, 9)!.ani.spriteCount()).toBe(24);
      expect(afGetMove(af, 1)!.ani.spriteCount()).toBe(8);
      // Named like the originals in the language text ("Jaguar"): the news report prints it in sentences.
      expect(langGet(31 + r.id).toUpperCase()).toBe(r.name);
      expect(langGet(31 + r.id)).toMatch(/^[A-Z][a-z]+$/);
      // Every attack that deals damage can hit: it has hit points.
      for (const m of af.moves) {
        if (!m || m.damage === 0 || m.category === 2) continue;
        expect(m.ani.collisionCoords.length, `${r.name} move ${m.id} hit points`).toBeGreaterThan(0);
      }
    }
  });

  it('are up to date with their definitions in their mod (npm run gen)', async () => {
    const pkg = await extrasPackage();
    for (const r of GEN_ROBOTS) {
      const { af } = buildFighter(fighterOf(r));
      af.fighterId = r.id;
      af.upwardsJumpFrameLimit = 2;
      const built = saveAF(af);
      const folder = Object.entries(EXTRAS_NUMBERS.robot).find(([, n]) => n === r.id)![0];
      const file = pkg.robots.find((x) => x.id === folder)!.af;
      expect(Buffer.compare(Buffer.from(built), Buffer.from(file)), `${r.name}: run npm run gen`).toBe(0);
    }
  }, 60000);

  it('fight each other and the original robots to a finish', async () => {
    await loadExtras();
    const pairs: [number, number][] = [
      [HarId.GLACIER, HarId.TEMPEST],
      [HarId.HELIX, HarId.SPECTRE],
      [HarId.JAGUAR, HarId.GLACIER],
      [HarId.SPECTRE, HarId.KATANA],
    ];
    pairs.forEach((hars, k) => {
      const r = aiFight(hars, 100 + k, k % 5);
      if (process.env.GEN_FIGHT_LOG) console.log(hars, r.ms, r.winner, [...r.moves[0]].sort((a, b) => a - b).join(','), '|', [...r.moves[1]].sort((a, b) => a - b).join(','), JSON.stringify([...r.events[0]]), JSON.stringify([...r.events[1]]));
      expect(r.ms, `${hars} finished`).toBeGreaterThan(0);
      expect(r.winner).toBeGreaterThanOrEqual(0);
      for (let i = 0; i < 2; i++) expect(r.events[i].get('ATTACK') ?? 0, `${hars[i]} attacked`).toBeGreaterThan(3);
    });
  }, 120000);
});
