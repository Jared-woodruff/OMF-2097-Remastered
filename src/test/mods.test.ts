// Mod support (src/mods): packages (zip archives with the original formats inside) are read, checked and written; a
// mod's robot, arena and pilot get their numbers and join the game like the remaster's own content, and they play.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setKeyState } from '../controller/input';
import { saveAF, parseAF } from '../formats/af';
import { HAR_NAMES, HarId, SceneId } from '../game/constants';
import { harMoveList } from '../game/gui/moveList';
import {
  allowedArena, allowedHar, arenaDescription, arenaList, arenaLook, arenaName, arenaNewsName, extraHarIds, modPilotIds, nextArena,
  pilotBio, pilotInfo, pilotNameOf, pilotStyle, pilotWinBit, randomHarPool,
} from '../game/roster';
import type { MeleeScene } from '../game/scenes/melee';
import type { VsScene } from '../game/scenes/vs';
import { winQuote } from '../game/scenes/victory';
import { PILOT_SEX_FEMALE, PilotId } from '../game/constants';
import { MOD_ID_RANGES, resetModIds } from '../mods/ids';
import { readModPackage, writeModPackage, type ModPackage } from '../mods/package';
import { modArenas, modPilots, modRobot, modRobots, registerModPackage, resetMods } from '../mods/registry';
import { buildSampleMod, SAMPLE_ARC, SAMPLE_LIGHT, SAMPLE_MOD_ID } from '../mods/sample';
import { parseBK, saveBK } from '../formats/bk';
import { harData } from '../game/objects/har';
import { getFile } from '../resources/files';
import { copyAnims } from '../studio/arena/animEditor';
import { ModError, readManifest } from '../mods/types';
import { harName, harPicture, hasFighter, loadAf, loadBk } from '../resources/resources';
import { decodePng, encodeIndexedPng, encodePng } from '../util/png';
import { unzip, zip } from '../util/zip';
import { createGame, hasGameData, HeadlessRunner, installBrowserShims, loadGameData } from './harness';

describe('zip archives', () => {
  it('keep their files (stored and deflated) and names', async () => {
    const big = new Uint8Array(5000).map((_, i) => i % 7);
    const files: [string, Uint8Array][] = [['mod.json', new TextEncoder().encode('{"a":1}')], ['robots/ä/fighter.af', big], ['empty', new Uint8Array()]];
    const back = await unzip(await zip(files));
    expect([...back.keys()]).toEqual(files.map(([n]) => n));
    for (const [n, d] of files) expect(Array.from(back.get(n)!)).toEqual(Array.from(d));
  });

  it('are the same every time for the same files', async () => {
    const files: [string, Uint8Array][] = [['a.txt', new TextEncoder().encode('x'.repeat(300))]];
    expect(Array.from(await zip(files))).toEqual(Array.from(await zip(files)));
  });
});

describe('PNG images', () => {
  it('RGBA images come back as they were', async () => {
    const rgba = new Uint8Array(7 * 5 * 4).map((_, i) => (i * 37) & 0xff);
    const img = await decodePng(await encodePng(7, 5, rgba));
    expect([img.w, img.h]).toEqual([7, 5]);
    expect(Array.from(img.rgba)).toEqual(Array.from(rgba));
    expect(img.indexed).toBeNull();
  });

  it('indexed images keep their indices and palette', async () => {
    const data = new Uint8Array(9 * 4).map((_, i) => (i * 11) & 0xff);
    const pal = new Uint8Array(768).map((_, i) => (i * 3) & 0xff);
    const img = await decodePng(await encodeIndexedPng(9, 4, data, pal, 0));
    expect(Array.from(img.indexed!.data)).toEqual(Array.from(data));
    expect(Array.from(img.indexed!.palette)).toEqual(Array.from(pal));
    // index 0 see-through
    expect(img.rgba[3]).toBe(0);
    expect(img.rgba[7]).toBe(255);
  });
});

describe('mod manifests', () => {
  const base = { format: 1, id: 'jane.pack', name: 'Pack', robots: ['a'] };

  it('need an id of lower case letters, digits, dots, dashes and underscores', () => {
    expect(readManifest(base).id).toBe('jane.pack');
    expect(() => readManifest({ ...base, id: 'Jane Pack' })).toThrow(ModError);
    expect(() => readManifest({ ...base, robots: ['../x'] })).toThrow(ModError);
  });

  it('refuse formats newer than the game reads, and packages without content', () => {
    expect(() => readManifest({ ...base, format: 2 })).toThrow(/newer version/);
    expect(() => readManifest({ ...base, robots: [] })).toThrow(/no robots/);
  });
});

describe.skipIf(!hasGameData)('mod packages', () => {
  let sample: ModPackage;
  let bytes: Uint8Array;

  beforeAll(async () => {
    installBrowserShims();
    loadGameData();
    sample = await buildSampleMod();
    bytes = await writeModPackage(sample);
  });

  it('come back as they were written', async () => {
    const pkg = await readModPackage(bytes);
    expect(pkg.manifest.id).toBe(SAMPLE_MOD_ID);
    expect(pkg.robots.map((r) => r.id)).toEqual(['sentinel']);
    expect(Array.from(pkg.robots[0].af)).toEqual(Array.from(sample.robots[0].af));
    expect(pkg.robots[0].info).toEqual(sample.robots[0].info);
    expect(Array.from(pkg.arenas[0].bk)).toEqual(Array.from(sample.arenas[0].bk));
    expect(pkg.arenas[0].wid?.length).toBe(sample.arenas[0].wid?.length);
    expect(pkg.pilots[0].info).toEqual(sample.pilots[0].info);
  });

  it('refuse games older than they need', async () => {
    const newer = await writeModPackage({ ...sample, manifest: { ...sample.manifest, game: '0.10.0' } });
    await expect(readModPackage(newer, '0.9.9')).rejects.toThrow(/needs version 0\.10\.0/);
    await expect(readModPackage(newer, '0.10.0')).resolves.toBeTruthy();
    await expect(readModPackage(newer, '1.0.0')).resolves.toBeTruthy();
  });

  it('refuse a robot without the animations the game plays', async () => {
    const af = parseAF(sample.robots[0].af);
    af.moves[3] = null;
    const broken = await writeModPackage({ ...sample, robots: [{ ...sample.robots[0], af: saveAF(af) }] });
    await expect(readModPackage(broken)).rejects.toThrow(/no stunned animation/);
  });

  it('refuse what is not a mod', async () => {
    await expect(readModPackage(new TextEncoder().encode('hello'))).rejects.toThrow(ModError);
    await expect(readModPackage(await zip([['readme.txt', new Uint8Array(3)]]))).rejects.toThrow(/no mod\.json/);
  });
});

describe.skipIf(!hasGameData)('mods in the game', () => {
  let harId = -1;
  let arena = -1;

  beforeAll(async () => {
    installBrowserShims();
    loadGameData();
    resetMods();
    resetModIds();
    await registerModPackage(await readModPackage(await writeModPackage(await buildSampleMod())));
    harId = modRobots()[0].harId;
    arena = modArenas()[0].index;
  });

  it('give their content numbers after the game\'s own, the same ones next time', async () => {
    expect(harId).toBe(MOD_ID_RANGES.robot.first);
    expect(arena).toBe(MOD_ID_RANGES.arena.first);
    resetMods();
    await registerModPackage(await buildSampleMod());
    expect(modRobots()[0].harId).toBe(harId);
  });

  it('add the robot: its file under its number, its name, the select screen, the computer\'s picks', () => {
    expect(hasFighter(harId)).toBe(true);
    const af = loadAf(harId);
    expect(af.id).toBe(harId);
    // The shared effect moves come from the original game's files.
    for (const id of [7, 8, 12, 13, 14, 55, 56, 57]) expect(af.moves[id], `move ${id}`).toBeTruthy();
    expect(HAR_NAMES[harId]).toBe('SENTINEL');
    expect(harName(harId)).toBe('Sentinel');
    expect(extraHarIds()).toContain(harId);
    expect(randomHarPool()).toContain(harId);
    expect(allowedHar(harId)).toBe(harId);
    expect(harPicture(harId, 60)?.surface.w).toBe(51);
    // The move list names the specials from robot.json.
    expect(harMoveList(af).map((e) => e.label)).toEqual(expect.arrayContaining(['DRILL RUSH', 'CORKSCREW', 'DRILL BIT']));
    // The language file's arena names stay (robot names past its free entries are kept apart).
    expect(arenaName(0)).toBe('Stadium');
  });

  it('add the arena to the rotation with its texts, sounds and look', () => {
    expect(arenaList()).toContain(arena);
    expect(allowedArena(arena)).toBe(arena);
    expect(nextArena(arena, 1)).toBe(0);
    expect(arenaName(arena)).toBe('DUSK ROOFTOP');
    expect(arenaNewsName(arena)).toBe('Dusk Rooftop');
    expect(arenaDescription(arena)).toMatch(/sun goes down/);
    expect(arenaLook(arena)).toBe(7);
    const bk = loadBk(`ARENA${arena}.BK`);
    // Its own file id (no original arena's behavior), the shared announcements and sounds added.
    expect(bk.fileId).toBe(0x10000 + arena);
    for (const id of [6, 7, 8, 9, 10, 11]) expect(bk.infos.has(id)).toBe(true);
    expect(bk.soundTranslationTable.some((v) => v)).toBe(true);
  });

  it('a mod robot fights an original robot in the mod arena to a finish', () => {
    const gs = createGame(SceneId.MENU, [2, 3], [harId, HarId.PYROS]);
    gs.setupAi(0, 4);
    gs.setupAi(1, 4);
    gs.matchSettings.rounds = 0;
    const scene = SceneId.ARENA0 + arena;
    gs.swapScene(scene);
    expect(gs.sc.isArena()).toBe(true);
    const run = new HeadlessRunner(gs);
    for (let t = 0; t < 240000 && gs.nextId === scene; t += 500) run.advance(500);
    expect(gs.nextId).not.toBe(scene);
  });

  it('the computer uses a mod robot\'s specials', () => {
    expect(modRobot(harId)!.info.ai.projectile.length).toBe(1);
  });
});

const held = new Set<string>();
function press(run: HeadlessRunner, code: string): void {
  setKeyState(code, true);
  held.add(code);
  run.advance(60);
  setKeyState(code, false);
  held.delete(code);
  run.advance(60);
}
afterEach(() => {
  for (const k of held) setKeyState(k, false);
  held.clear();
});

describe.skipIf(!hasGameData)('mod pilots in the game', () => {
  let pilotId = -1;
  let harId = -1;

  beforeAll(async () => {
    installBrowserShims();
    loadGameData();
    resetMods();
    await registerModPackage(await buildSampleMod());
    pilotId = modPilots()[0].pilotId;
    harId = modRobots()[0].harId;
  });

  it('have their stats, colors, texts and style', () => {
    expect(pilotId).toBe(MOD_ID_RANGES.pilot.first);
    expect(modPilotIds()).toEqual([pilotId]);
    const info = pilotInfo(pilotId);
    expect([info.power, info.agility, info.endurance, info.sex]).toEqual([11, 13, 9, PILOT_SEX_FEMALE]);
    expect([info.color1, info.color2, info.color3]).toEqual([5, 11, 8]);
    expect(pilotNameOf(pilotId)).toBe('Vega');
    expect(pilotBio(pilotId)).toMatch(/orbital yards/);
    expect(pilotStyle(pilotId)).toBe(PilotId.CRYSTAL);
    // No place of their own in the one-player game's list of beaten pilots.
    expect(pilotWinBit(pilotId)).toBe(0);
    expect(pilotWinBit(PilotId.MILANO)).toBe(2 << PilotId.MILANO);
    expect(['I have flown worse machines than yours. Not many.', 'Another one for the test report.']).toContain(winQuote(pilotId));
  });

  it('are picked on the pilot select screen, below the original ten, and fly into a fight', () => {
    const gs = createGame(SceneId.MELEE);
    gs.getPlayer(0).pilot.name = '';
    gs.getPlayer(1).pilot.name = '';
    gs.swapScene(SceneId.MELEE);
    const run = new HeadlessRunner(gs);
    run.advance(400);
    const sc = gs.sc as MeleeScene;
    press(run, 'ArrowDown');
    press(run, 'ArrowDown');
    expect(sc.cursor[0].row).toBe(2);
    expect(sc.viewTop).toBe(1);
    expect(sc.pilotIdA).toBe(pilotId);
    expect(gs.getPlayer(0).pilot.power).toBe(11);
    expect(sc.playerName[0].str).toBe('Vega');
    // Its portrait on the screen (the face in the grid and the big one), in the screen's colors.
    press(run, 'Enter');
    press(run, 'ControlLeft');
    expect(sc.page).toBe(1);
    expect(sc.pilotIdA).toBe(pilotId);
    // The robot page's cursor starts where the pilot's was, on the nearest robot: its row 2 starts at column 1 (the
    // mod robot).
    expect([sc.cursor[0].row, sc.cursor[0].column]).toEqual([2, 1]);
    expect(sc.harIndex(0)).toBe(harId);
    press(run, 'Enter');
    press(run, 'ControlLeft');
    for (let t = 0; t < 3000 && gs.thisId !== SceneId.VS; t += 50) run.advance(50);
    expect(gs.thisId).toBe(SceneId.VS);
    expect(gs.getPlayer(0).pilot.pilotId).toBe(pilotId);
    expect(gs.getPlayer(0).pilot.name).toBe('Vega');
    expect(gs.getPlayer(0).pilot.harId).toBe(harId);
    const vs = gs.sc as VsScene;
    expect(vs.bk.infos.get(4)!.ani.sprites[pilotId]?.surface).toBeTruthy();
  });

  it('say their own lines on the VS screen of the one player game', () => {
    const gs = createGame(SceneId.MENU, [0, 3], [0, 5]);
    gs.getPlayer(0).pilot.pilotId = pilotId;
    gs.setupAi(1);
    gs.swapScene(SceneId.VS);
    const vs = gs.sc as VsScene;
    expect(vs.insults[0]?.str).toBe('I have flown worse machines than yours. Not many.');
    // Christian answers as he would answer Crystal (the pilot VEGA plays like).
    expect(vs.insults[1]?.str).toBeTruthy();
  });

  it('meet Major Kreissack once every original pilot is beaten', () => {
    const gs = createGame(SceneId.MELEE, [0, 1], [0, 5]);
    gs.setupAi(1);
    gs.getPlayer(0).pilot.name = '';
    gs.getPlayer(1).pilot.name = '';
    gs.getPlayer(0).spWins = 2046;
    gs.swapScene(SceneId.MELEE);
    const run = new HeadlessRunner(gs);
    run.advance(400);
    const sc = gs.sc as MeleeScene;
    press(run, 'ArrowDown');
    press(run, 'ArrowDown');
    expect(sc.pilotIdA).toBe(pilotId);
    press(run, 'Enter');
    press(run, 'Enter');
    expect(gs.getPlayer(1).pilot.pilotId).toBe(PilotId.KREISSACK);
  });
});

describe.skipIf(!hasGameData)('animations of mod arenas', () => {
  beforeAll(() => {
    installBrowserShims();
    loadGameData();
  });

  it('loop from the start when the arena lists them, with its own sounds over the original ones', async () => {
    resetMods();
    await registerModPackage(await buildSampleMod());
    const arena = modArenas()[0].index;
    const gs = createGame(SceneId.MENU, [0, 1], [0, 5]);
    gs.swapScene(SceneId.ARENA0 + arena);
    const ids = gs.objects.map((r) => r.obj.curAnimation?.id);
    expect(ids).toContain(SAMPLE_LIGHT);
    // The arc appears only at random.
    expect(ids).not.toContain(SAMPLE_ARC);
    const arc = gs.sc.bk.infos.get(SAMPLE_ARC)!;
    expect([arc.probability, arc.hazardDamage, arc.ani.collisionCoords.length > 0]).toEqual([900, 8, true]);
    const table = gs.sc.bk.soundTranslationTable;
    expect(table[20]).toBe(33);
    // (entries it leaves empty: the original's; 1 and 2 are the round's announcements)
    expect(table[1]).toBe(20);
  });

  it('a hazard of a mod arena hurts the robot it touches', async () => {
    resetMods();
    const pkg = await buildSampleMod();
    // The arc almost every tick, where the first robot stands.
    const bk = parseBK(pkg.arenas[0].bk);
    bk.anims[SAMPLE_ARC]!.probability = 2;
    bk.anims[SAMPLE_ARC]!.animation.startX = 110;
    pkg.arenas[0].bk = saveBK(bk);
    await registerModPackage(pkg);
    const arena = modArenas()[0].index;
    const gs = createGame(SceneId.MENU, [0, 1], [0, 5]);
    gs.matchSettings.rounds = 0;
    gs.matchSettings.hazards = true;
    gs.rand.setSeed(1001);
    const scene = SceneId.ARENA0 + arena;
    gs.swapScene(scene);
    const run = new HeadlessRunner(gs);
    const p1 = () => harData(gs.findObject(gs.getPlayer(0).harObjId)!);
    const start = p1().health;
    for (let t = 0; t < 12000 && p1().health === start; t += 250) run.advance(250);
    expect(p1().health).toBeLessThan(start);
  });

  it('a hazard OMF Studio copies from an original arena plays in a mod arena', async () => {
    resetMods();
    const pkg = await buildSampleMod();
    const bk = parseBK(pkg.arenas[0].bk);
    // The Fire Pit's orbs: the animation that starts them (made more frequent), the orb, its burst and its fade.
    const map = copyAnims(bk, parseBK(getFile('ARENA3.BK')), 0, 0, true)!;
    expect([...map.keys()].sort((a, b) => a - b)).toEqual([0, 15, 16, 17, 18]);
    bk.anims[0]!.probability = 10;
    pkg.arenas[0].bk = saveBK(bk);
    await registerModPackage(pkg);
    // (whatever the random numbers: with the game's draw, 1001 never started it, two hazards drawing on even numbers)
    for (const seed of [1000, 1001]) {
      const gs = createGame(SceneId.MENU, [0, 1], [0, 5]);
      gs.matchSettings.hazards = true;
      gs.rand.setSeed(seed);
      gs.swapScene(SceneId.ARENA0 + modArenas()[0].index);
      const run = new HeadlessRunner(gs);
      let orbs = 0;
      for (let t = 0; t < 10000 && !orbs; t += 250) {
        run.advance(250);
        orbs = gs.objects.filter((r) => r.obj.curAnimation?.id === map.get(15)).length;
      }
      expect(orbs).toBeGreaterThan(0);
    }
  });
});
