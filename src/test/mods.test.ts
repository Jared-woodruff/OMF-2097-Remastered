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
import { hdFromPackage, packageFromProject, projectFromPackage } from '../studio/project';
import { HD_PAD, HD_SCALE, ModError, readManifest, readPilotInfo } from '../mods/types';
import { spriteHash } from '../mods/package';
import { hdRegion, portraitBasePalette, robotBasePalette } from '../mods/hdArt';
import { imageSize } from '../util/imageSize';
import { Palette } from '../formats/palette';
import { robotPalette } from '../studio/colors';
import { modPersonality, STORY_PERSONALITIES } from '../controller/personalities';
import { resetPilotPersonality } from '../controller/ai';
import { Pilot } from '../formats/pilot';
import { settings } from '../game/settings';
import { endingEntries, ENDING_PORTRAIT } from '../mods/portraits';
import { modPilot } from '../mods/registry';
import { bkGetInfo, langGet } from '../resources/resources';
import { harName, harPicture, hasFighter, loadAf, loadBk } from '../resources/resources';
import { decodePng, encodeIndexedPng, encodePng } from '../util/png';
import { unzip, zip } from '../util/zip';
import { createGame, extrasPackage, hasGameData, HeadlessRunner, installBrowserShims, loadGameData } from './harness';

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

describe('picture headers', () => {
  it('give PNG and WebP pictures\' sizes without decoding them', async () => {
    expect(imageSize(await encodePng(7, 5, new Uint8Array(7 * 5 * 4)))).toEqual({ type: 'png', w: 7, h: 5 });
    const webp = (chunk: string, body: number[]) => {
      const b = new Uint8Array(40);
      b.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
      b.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8);
      b.set([...chunk].map((c) => c.charCodeAt(0)), 12);
      b.set(body, 20);
      return b;
    };
    // Extended (canvas 300 x 200), lossy key frame (640 x 480), lossless (1024 x 768).
    expect(imageSize(webp('VP8X', [0, 0, 0, 0, 43, 1, 0, 199, 0, 0]))).toEqual({ type: 'webp', w: 300, h: 200 });
    expect(imageSize(webp('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 0x80, 0x02, 0xe0, 0x01]))).toEqual({ type: 'webp', w: 640, h: 480 });
    const bits = (1024 - 1) | ((768 - 1) << 14);
    expect(imageSize(webp('VP8L', [0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255]))).toEqual({ type: 'webp', w: 1024, h: 768 });
    expect(imageSize(new TextEncoder().encode('not a picture at all, not at all'))).toBeNull();
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

  it('give pilots a personality and VS screen words of their own, and read older pilots as they were', () => {
    // (before them: no personality of its own, its first line after winning on the VS screen)
    const old = readPilotInfo({ name: 'X', quotes: ['a', 'b'] }, 'p');
    expect(old.ai).toBeNull();
    expect(old.vs).toEqual({ line: 'a', to: {}, from: {} });
    const p = readPilotInfo({ name: 'X', ai: { normal: 30, learning: 1.5 }, vs: { line: 'l', to: { 3: 'hi' }, from: { 10: 'yo' } } }, 'p');
    expect(p.ai).toMatchObject({ normal: 30, learning: 1.5, hyper: 0, throws: 0 });
    expect(p.vs).toEqual({ line: 'l', to: { 3: 'hi' }, from: { 10: 'yo' } });
    expect(() => readPilotInfo({ name: 'X', ai: { normal: 101 } }, 'p')).toThrow(/ai\.normal/);
    expect(() => readPilotInfo({ name: 'X', ai: { throws: 1.5 } }, 'p')).toThrow(/whole/);
    expect(() => readPilotInfo({ name: 'X', vs: { to: { 11: 'x' } } }, 'p')).toThrow(ModError);
  });
});

describe.skipIf(!hasGameData)('mod packages', () => {
  let sample: ModPackage;
  let bytes: Uint8Array;

  beforeAll(async () => {
    installBrowserShims();
    loadGameData();
    sample = await buildSampleMod(await extrasPackage());
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
    await registerModPackage(await readModPackage(await writeModPackage(await buildSampleMod(await extrasPackage()))));
    harId = modRobots()[0].harId;
    arena = modArenas()[0].index;
  });

  it('give their content numbers after the game\'s own, the same ones next time', async () => {
    expect(harId).toBe(MOD_ID_RANGES.robot.first);
    expect(arena).toBe(MOD_ID_RANGES.arena.first);
    resetMods();
    await registerModPackage(await buildSampleMod(await extrasPackage()));
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
    await registerModPackage(await buildSampleMod(await extrasPackage()));
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
    // Its line for anyone; Christian answers as he answers Crystal (the pilot VEGA plays like).
    expect(vs.insults[0]?.str).toBe('I have flown worse machines than yours. Not many.');
    expect(vs.insults[1]?.str).toBe(langGet(870 + 11 * PilotId.CHRISTIAN + PilotId.CRYSTAL));
    // Its own line to Major Kreissack, and his own answer to it (on a difficulty where he answers at all).
    const difficulty = settings().gameplay.difficulty;
    settings().gameplay.difficulty = 3;
    const gs2 = createGame(SceneId.MENU, [0, PilotId.KREISSACK], [0, 5]);
    gs2.getPlayer(0).pilot.pilotId = pilotId;
    gs2.setupAi(1);
    gs2.swapScene(SceneId.VS);
    const vs2 = gs2.sc as VsScene;
    settings().gameplay.difficulty = difficulty;
    expect(vs2.insults[0]?.str).toBe('Your NOVA is the last machine on my test list, Major.');
    expect(vs2.insults[1]?.str).toBe('A test pilot. Then let this be your final test.');
  });

  it('fight with a personality of their own, or like the pilot they play like', () => {
    const p = new Pilot();
    p.pilotId = pilotId;
    resetPilotPersonality(p);
    const own = modPersonality(modPilot(pilotId)!.info.ai!);
    expect([p.attNormal, p.attSniper, p.apSpecial, p.prefBack, p.learning]).toEqual([own.attNormal, own.attSniper, own.apSpecial, own.prefBack, Math.fround(own.learning)]);
    const info = modPilot(pilotId)!.info;
    const ai = info.ai;
    info.ai = null;
    try {
      const q = new Pilot();
      q.pilotId = pilotId;
      resetPilotPersonality(q);
      expect([q.attNormal, q.apThrow, q.prefFwd]).toEqual([STORY_PERSONALITIES[0].attNormal, STORY_PERSONALITIES[0].apThrow, STORY_PERSONALITIES[0].prefFwd]);
    } finally {
      info.ai = ai;
    }
  });

  it('have their portrait in the one-player game\'s ending, in its colors', () => {
    const gs = createGame(SceneId.MENU, [0, 1], [harId, 5]);
    gs.getPlayer(0).pilot.pilotId = pilotId;
    gs.swapScene(SceneId.END1);
    const ani = bkGetInfo(gs.sc.bk, 3)!.ani;
    const pic = ani.sprites[pilotId]?.surface;
    expect(pic).toBeTruthy();
    expect(pic!.w).toBeLessThanOrEqual(ENDING_PORTRAIT.w);
    expect(pic!.h).toBeLessThanOrEqual(ENDING_PORTRAIT.h);
    // (only the colors the originals' portraits use there)
    const entries = new Set(endingEntries(ani.sprites.slice(0, 10).map((s) => s.surface?.data)));
    expect([...pic!.data].every((v) => v === 0 || entries.has(v))).toBe(true);
    expect(gs.objects.some((r) => r.obj.curAnimation === ani && r.obj.curSpriteId === pilotId)).toBe(true);
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
    await registerModPackage(await buildSampleMod(await extrasPackage()));
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
    const pkg = await buildSampleMod(await extrasPackage());
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
    const pkg = await buildSampleMod(await extrasPackage());
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

describe.skipIf(!hasGameData)('HD pictures of mods', () => {
  beforeAll(() => {
    installBrowserShims();
    loadGameData();
  });

  /** A PNG of w x h. */
  const picture = (w: number, h: number) => encodePng(w, h, new Uint8Array(w * h * 4).fill(200));
  const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

  /** The sample package as files, with a robot's hd.json and pictures. */
  async function withRobotHd(hd: unknown, pictures: [string, Uint8Array][]): Promise<Uint8Array> {
    const files = await unzip(await writeModPackage(await buildSampleMod(await extrasPackage())));
    files.set('robots/sentinel/hd.json', json(hd));
    for (const [f, data] of pictures) files.set(`robots/sentinel/${f}`, data);
    return zip(files);
  }

  it('go with the sprites they were made for, in their shape', async () => {
    const sample = await buildSampleMod(await extrasPackage());
    const idle = parseAF(sample.robots[0].af).moves[11]!.animation.sprites[0];
    const nw = idle.width + 2 * HD_PAD, nh = idle.height + 2 * HD_PAD;
    const good = await picture(nw * HD_SCALE.x, nh * HD_SCALE.y);
    const pkg = await readModPackage(await withRobotHd({
      sprites: [
        { anim: 11, sprite: 0, file: 'hd/idle-a.png', hash: spriteHash(idle) },
        // (made for pixels the sprite no longer has: left out)
        { anim: 11, sprite: 1, file: 'hd/idle-b.png', hash: '0123456789abcdef' },
      ],
    }, [['hd/idle-a.png', good], ['hd/idle-b.png', good]]));
    const hd = pkg.robots[0].hd!;
    expect(hd.info.colors).toEqual([0, 1, 4]);
    expect(hd.info.sprites.map((e) => e.file)).toEqual(['hd/idle-a.png']);
    expect([...hd.files.keys()]).toEqual(['hd/idle-a.png']);
    // Written and read again, as it was.
    const back = await readModPackage(await writeModPackage(pkg));
    expect(back.robots[0].hd!.info).toEqual(hd.info);
    expect(Array.from(back.robots[0].hd!.files.get('hd/idle-a.png')!)).toEqual(Array.from(good));
    // Any size of that shape, but not another shape, a missing picture or a sprite the robot does not have.
    await expect(readModPackage(await withRobotHd({ sprites: [{ anim: 11, sprite: 0, file: 'hd/a.png' }] },
      [['hd/a.png', await picture(nw * HD_SCALE.x * 2, nh * HD_SCALE.y * 2)]]))).resolves.toBeTruthy();
    await expect(readModPackage(await withRobotHd({ sprites: [{ anim: 11, sprite: 0, file: 'hd/a.png' }] },
      [['hd/a.png', await picture(nw * HD_SCALE.x, nh * HD_SCALE.x)]]))).rejects.toThrow(/shape of/);
    await expect(readModPackage(await withRobotHd({ sprites: [{ anim: 11, sprite: 0, file: 'hd/a.png' }] }, []))).rejects.toThrow(/has no robots\/sentinel\/hd\/a.png/);
    await expect(readModPackage(await withRobotHd({ sprites: [{ anim: 40, sprite: 0, file: 'hd/a.png' }] },
      [['hd/a.png', good]]))).rejects.toThrow(/move 40, sprite A/);
  });

  it('of the mechlab\'s turning robot go with its frames\' fingerprints, and stay through OMF Studio', async () => {
    const pic = await picture(300, 520);
    const pkg = await readModPackage(await withRobotHd({ mech: [{ file: 'hd/mech-0.png', hash: '0123456789abcdef' }] }, [['hd/mech-0.png', pic]]));
    expect(pkg.robots[0].hd!.info.mech).toEqual([{ file: 'hd/mech-0.png', hash: '0123456789abcdef' }]);
    expect(pkg.robots[0].hd!.files.has('hd/mech-0.png')).toBe(true);
    const back = await readModPackage(await writeModPackage(pkg));
    expect(back.robots[0].hd!.info.mech).toEqual(pkg.robots[0].hd!.info.mech);
    // (OMF Studio keeps them as they are)
    const doc = hdFromPackage(pkg.robots[0].hd, parseAF(pkg.robots[0].af).moves)!;
    expect(doc.mech.map((e) => e.hash)).toEqual(['0123456789abcdef']);
    // A missing picture or a fingerprint that is not one: refused.
    await expect(readModPackage(await withRobotHd({ mech: [{ file: 'hd/mech-0.png', hash: '0123456789abcdef' }] }, []))).rejects.toThrow(/has no robots\/sentinel\/hd\/mech-0.png/);
    await expect(readModPackage(await withRobotHd({ mech: [{ file: 'hd/mech-0.png', hash: 'nope' }] }, [['hd/mech-0.png', pic]]))).rejects.toThrow(/16 hexadecimal/);
  });

  it('of an arena\'s background have its whole shape, with its widescreen sides', async () => {
    const files = await unzip(await writeModPackage(await buildSampleMod(await extrasPackage())));
    files.set('arenas/dusk-rooftop/hd.json', json({ background: 'hd/background.webp' }));
    // (the sample's arena has widescreen sides: 576 x 200 at 5 x 6, here at half the remaster's resolution)
    const bg = await picture(1440, 600);
    files.set('arenas/dusk-rooftop/hd/background.webp', new TextEncoder().encode('not a picture, not at all, no'));
    await expect(readModPackage(await zip(files))).rejects.toThrow(/not a PNG or WebP/);
    files.set('arenas/dusk-rooftop/hd.json', json({ background: 'hd/background.png' }));
    files.set('arenas/dusk-rooftop/hd/background.png', bg);
    const pkg = await readModPackage(await zip(files));
    expect(pkg.arenas[0].hd!.info.background).toBe('hd/background.png');
    files.set('arenas/dusk-rooftop/hd/background.png', await picture(1600, 1200));
    await expect(readModPackage(await zip(files))).rejects.toThrow(/2880 x 1200/);
  });

  it('of an arena\'s background come with its geometry map, which OMF Studio keeps while the background stays', async () => {
    const files = await unzip(await writeModPackage(await buildSampleMod(await extrasPackage())));
    const bg = await picture(1440, 600);
    files.set('arenas/dusk-rooftop/hd/background.png', bg);
    files.set('arenas/dusk-rooftop/hd/geometry.png', await picture(1440, 600));
    const hd = (geometry: unknown) => files.set('arenas/dusk-rooftop/hd.json', json({ background: 'hd/background.png', geometry }));
    hd({ file: 'hd/geometry.png', floor: 0.5, far: 0.1 });
    const pkg = await readModPackage(await zip(files));
    // (no parallax given: all of it)
    expect(pkg.arenas[0].hd!.info.geometry).toEqual({ file: 'hd/geometry.png', floor: 0.5, far: 0.1, parallax: 1 });
    expect(pkg.arenas[0].hd!.files.has('hd/geometry.png')).toBe(true);
    const back = await readModPackage(await writeModPackage(pkg));
    expect(back.arenas[0].hd!.info.geometry).toEqual(pkg.arenas[0].hd!.info.geometry);
    // OMF Studio saves it with the background it was made for, and leaves it out with another one.
    const project = projectFromPackage(pkg);
    expect(packageFromProject(project).arenas[0].hd!.info.geometry).toMatchObject({ floor: 0.5, far: 0.1, parallax: 1 });
    project.arenas[0].hd!.background = await picture(2880, 1200);
    expect(packageFromProject(project).arenas[0].hd!.info.geometry).toBeNull();
    // Its numbers in range, its picture of the background's shape.
    hd({ file: 'hd/geometry.png', floor: 1.5 });
    await expect(readModPackage(await zip(files))).rejects.toThrow(/"floor" must be a number from 0 to 1/);
    hd({ file: 'hd/geometry.png', floor: 0.5 });
    files.set('arenas/dusk-rooftop/hd/geometry.png', await picture(800, 600));
    await expect(readModPackage(await zip(files))).rejects.toThrow(/geometry: it must have the shape of 2880 x 1200/);
  });

  it('are drawn against the colors they were painted in', () => {
    // A robot's: the chosen ramps and the colors every fight shares, like Studio's templates.
    const rgb = robotBasePalette([0, 1, 4]);
    const studio = robotPalette([0, 1, 4]);
    for (const i of [1, 15, 16, 31, 32, 47, 0x60, 0xa0, 0xf9]) expect([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]]).toEqual([studio.r(i), studio.g(i), studio.b(i)]);
    // A portrait's: the screen's, the dimmed copies holding the bright colors.
    const pal = new Palette();
    for (let i = 0; i < 256; i++) pal.set(i, i, 255 - i, i >> 1);
    const base = portraitBasePalette(pal);
    expect([base[5 * 3], base[5 * 3 + 1], base[5 * 3 + 2]]).toEqual([0xa5, 255 - 0xa5, 0xa5 >> 1]);
    expect([base[0xb0 * 3], base[0xb0 * 3 + 1]]).toEqual([0xb0, 255 - 0xb0]);
    // The part of an HD portrait a cut of the portrait stands for.
    expect(hdRegion({ x: 10, y: 0, w: 51, h: 36 }, 88, 69, 440, 414)).toEqual([50, 0, 255, 216]);
    expect(hdRegion(null, 88, 69, 440, 414)).toEqual([0, 0, 440, 414]);
  });
});
