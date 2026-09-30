// The remaster's new robots and arenas are a mod that comes with the game (mods/extras.ts): its package and the list of
// the game's mods in public/mods, off until the player turns it on (EXTRAS > MODS, the first start's setup, or their
// NEW CONTENT choice of older versions), then loaded like any mod under the numbers they had in the game (HARs 11-14,
// arenas 5-8): the robot select screen's third row, the arena rotation, their scene files' shared parts, their move
// lists, and fights.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setKeyState } from '../controller/input';
import { HarId, ORIGINAL_ARENAS, SceneId } from '../game/constants';
import type { GameState } from '../game/gameState';
import { harMoveList } from '../game/gui/moveList';
import { arenaList, arenaName, EXTRA_HAR_IDS, extraRobotsEnabled, randomHarPool, specialNames } from '../game/roster';
import type { MeleeScene } from '../game/scenes/melee';
import { effectsOf, frameOf, RobotFx } from '../fx/robotFx';
import { ParticleSystem } from '../fx/particles';
import { harSetAni } from '../game/objects/har';
import { MOVE } from '../gen/fighter/moveset';
import { genRobot, registerGenRobot, unregisterGenRobot } from '../gen/roster';
import { workshopRobot } from '../gen/workshop';
import { GEN_ARENAS } from '../gen/scene/arenas';
import { bundledEnabled, bundledMods, resetBundled, setBundledEnabled } from '../mods/bundled';
import { EXTRAS_MOD_ID, testNamesExtras } from '../mods/extras';
import { modContentId, resetModIds } from '../mods/ids';
import { loadMods, modArena, modPictured, modRobot, modRobots, modState, registerModPackage, resetMods } from '../mods/registry';
import { APP_VERSION } from '../platform/versionLabel';
import { readModPackage } from '../mods/package';
import { loadAf, loadBk } from '../resources/resources';
import { extendedBackground } from '../video/hd/extend';
import {
  createGame, extrasPackage, hasExtras, hasGameData, HeadlessRunner, installBrowserShims, loadExtras, loadGameData, serveBundledMods,
} from './harness';

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

describe.skipIf(!hasGameData || !hasExtras)('the new robots and arenas mod', () => {
  beforeEach(() => {
    installBrowserShims();
    serveBundledMods();
    loadGameData();
    localStorage.clear();
    resetBundled();
    resetMods();
    resetModIds();
  });

  it('comes with the game: four robots and four arenas with their HD pictures, playable by this version', async () => {
    const list = await bundledMods();
    expect(list.map((m) => m.id)).toEqual([EXTRAS_MOD_ID]);
    expect(list[0].robots).toEqual(['GLACIER', 'TEMPEST', 'HELIX', 'SPECTRE']);
    expect(list[0].arenas).toEqual(['ORBITAL', 'ICE CAVE', 'ROOFTOP', 'ABYSS']);
    const pkg = await readModPackage(new Uint8Array(await (await fetch(`mods/${list[0].file}`)).arrayBuffer()), APP_VERSION);
    expect(pkg.robots.map((r) => r.id)).toEqual(['glacier', 'tempest', 'helix', 'spectre']);
    expect(pkg.arenas.map((a) => a.id)).toEqual(['orbital', 'ice-cave', 'rooftop', 'abyss']);
    for (const [k, r] of pkg.robots.entries()) {
      // (every painted picture of the robot, each its sprite's; built from the robot workshop's parts of one robot)
      expect(new Set(r.hd!.info.sprites.map((e) => e.file)).size, r.id).toBeGreaterThan(130);
      expect(r.info.workshop).toMatchObject({ body: k, head: k, moves: k, size: 1, weight: 1 });
    }
    for (const [k, a] of pkg.arenas.entries()) {
      expect(a.hd!.info.background, a.id).toBe('hd/background.webp');
      expect(a.info).toMatchObject({ name: GEN_ARENAS[k].name, music: GEN_ARENAS[k].music, base: -1 });
    }
  });

  it('is off until the player turns it on', async () => {
    expect(await loadMods()).toBeNull();
    expect(bundledEnabled(EXTRAS_MOD_ID)).toBe(false);
    expect(modState(EXTRAS_MOD_ID)).toEqual({ id: EXTRAS_MOD_ID, loaded: false, error: null });
    expect(extraRobotsEnabled()).toBe(false);
    expect(randomHarPool()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(arenaList()).toEqual([0, 1, 2, 3, 4]);
    setBundledEnabled(EXTRAS_MOD_ID, true);
    await loadMods();
    expect(modState(EXTRAS_MOD_ID)?.loaded).toBe(true);
    expect(extraRobotsEnabled()).toBe(true);
    // (right after the game's own: the robot select screen's third row, the arenas after the originals)
    expect(randomHarPool()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14]);
    expect(arenaList()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('an OMF Studio test naming one of its robots or arenas has it, even with the mod off (which it stays)', async () => {
    const names = (q: string) => testNamesExtras(new URLSearchParams(q));
    expect([names('modtest&h1=mod:a&h2=0&arena=6'), names('modtest&h1=mod:a&h2=12&arena=0'), names('modtest&h1=mod:a&h2=5&arena=mod:b')])
      .toEqual([true, true, false]);
    expect(await loadMods(true, [EXTRAS_MOD_ID])).toBe('There is no mod to test.');
    expect(modState(EXTRAS_MOD_ID)?.loaded).toBe(true);
    expect(arenaList()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(bundledEnabled(EXTRAS_MOD_ID)).toBe(false);
    // (only for tests)
    resetMods();
    await loadMods(false, [EXTRAS_MOD_ID]);
    expect(modState(EXTRAS_MOD_ID)?.loaded).toBe(false);
  });

  it('keeps the numbers its robots and arenas had in the game (saves and replays name them)', async () => {
    await loadExtras();
    expect(EXTRA_HAR_IDS.map((id) => modRobot(id)?.info.name)).toEqual(['GLACIER', 'TEMPEST', 'HELIX', 'SPECTRE']);
    expect(GEN_ARENAS.map((a) => modArena(a.index)?.info.name)).toEqual(['ORBITAL', 'ICE CAVE', 'ROOFTOP', 'ABYSS']);
    expect(modContentId('robot', `${EXTRAS_MOD_ID}/helix`, new Set())).toBe(13);
    expect(modContentId('arena', `${EXTRAS_MOD_ID}/abyss`, new Set())).toBe(8);
    // Another mod's content never gets them.
    expect(modContentId('robot', 'someone.else/glacier', new Set())).toBe(24);
    expect(modContentId('arena', 'someone.else/rooftop', new Set())).toBe(9);
  });

  it('a player who had the new robots or arenas on (OPTIONS > NEW CONTENT) finds the mod on', async () => {
    localStorage.setItem('omf2097r.settings', JSON.stringify({ revision: 4, gameplay: { extraRobots: false, extraArenas: true } }));
    await loadMods();
    expect(bundledEnabled(EXTRAS_MOD_ID)).toBe(true);
    expect(modState(EXTRAS_MOD_ID)?.loaded).toBe(true);
    // Settings from before the choice existed had them off (revision 1): the mod stays off, and the choice is kept.
    localStorage.clear();
    resetMods();
    localStorage.setItem('omf2097r.settings', JSON.stringify({ gameplay: { extraRobots: true, extraArenas: true } }));
    await loadMods();
    expect(bundledEnabled(EXTRAS_MOD_ID)).toBe(false);
    expect(localStorage.getItem('omf2097r.bundledMods')).toBe(JSON.stringify({ [EXTRAS_MOD_ID]: false }));
  });

  it('its robots are drawn from their 3D models where it has no pictures, and their move lists name their specials', async () => {
    await loadExtras();
    for (const id of EXTRA_HAR_IDS) {
      expect(genRobot(id)?.name, `robot ${id}`).toBe(modRobot(id)!.info.name);
      expect(modPictured(id).size).toBeGreaterThan(130);
    }
    const labels = (id: number) => harMoveList(loadAf(id)).map((e) => e.label);
    expect(labels(HarId.GLACIER)).toEqual(expect.arrayContaining(['ICE LANCE', 'GLACIAL RAM', 'FROST SPIKES', 'SCRAP', 'DESTRUCT']));
    expect(labels(HarId.TEMPEST)).toEqual(expect.arrayContaining(['GALE BLAST', 'CYCLONE KICK', 'SKY DIVE']));
    expect(labels(HarId.HELIX)).toEqual(expect.arrayContaining(['DRILL RUSH', 'CORKSCREW', 'DRILL BIT']));
    expect(labels(HarId.SPECTRE)).toEqual(expect.arrayContaining(['PHOTON BEAM', 'PHASE SHIFT', 'SHADOW STRIKE']));
    expect(Object.values(specialNames(HarId.HELIX))).toEqual(['DRILL RUSH', 'CORKSCREW', 'DRILL BIT']);
    // Turned off, nothing of it is left.
    resetMods();
    expect(genRobot(HarId.GLACIER)).toBeUndefined();
  });

  it('a copy of one of its robots, under a number of its own, has that robot\'s special move effects', async () => {
    loadGameData();
    // (HELIX in a mod of its own, as OMF Studio copies it)
    const pkg = await extrasPackage();
    const helix = pkg.robots.filter((r) => r.id === 'helix');
    await registerModPackage({ ...pkg, manifest: { ...pkg.manifest, id: 'me.copy', robots: ['helix'], arenas: [] }, robots: helix, arenas: [] });
    const harId = modRobots().find((r) => r.key === 'me.copy/helix')!.harId;
    expect(harId).toBeGreaterThanOrEqual(24);
    expect([effectsOf(harId), frameOf(harId), effectsOf(HarId.JAGUAR)]).toEqual([HarId.HELIX, HarId.HELIX, -1]);
    // Its Drill Rush throws sparks.
    const gs = createGame(SceneId.MENU, [0, 1], [harId, HarId.JAGUAR]);
    gs.swapScene(SceneId.ARENA0);
    const o = gs.findObject(gs.getPlayer(0).harObjId)!;
    harSetAni(o, MOVE.SPECIAL1, false);
    const ps = new ParticleSystem();
    const fx = new RobotFx();
    for (let i = 0; i < 60 && ps.count === 0; i++) {
      gs.dynamicTick();
      fx.update(gs, ps, 1, () => {});
    }
    expect(ps.count).toBeGreaterThan(0);
    // A robot from the workshop's parts: the effects of the moves' robot, the ice of GLACIER's fists by the frame.
    registerGenRobot(workshopRobot({ v: 1, name: 'MIX', body: 0, head: 1, moves: 3, size: 1, weight: 1, colors: [0, 1, 2] }, 40));
    expect([effectsOf(40), frameOf(40)]).toEqual([HarId.SPECTRE, HarId.GLACIER]);
    unregisterGenRobot(40);
  });

  it('its arenas load with their own palette, the shared announcements and a real widescreen background', async () => {
    await loadExtras();
    const ref = loadBk('ARENA0.BK');
    for (const a of GEN_ARENAS) {
      const bk = loadBk(a.file);
      // (no original arena's rules: a mod arena's own file id)
      expect(bk.fileId).toBe(0x10000 + a.index);
      // Only the arena's own colors and the shared ones: never the robots' (0x00-0x5F) or the menu's.
      expect(bk.background.data.filter((v) => v < 0x60 || v > 0xf9).length).toBe(0);
      // The shared parts come from the first original arena.
      for (const id of [6, 7, 8, 9, 10, 11, 24, 25, 26, 27]) expect(bk.infos.has(id), `${a.name} anim ${id}`).toBe(true);
      for (let i = 0xa0; i < 0xfa; i++) expect(bk.palettes[0].r(i)).toBe(ref.palettes[0].r(i));
      expect(Array.from(bk.soundTranslationTable)).toEqual(Array.from(ref.soundTranslationTable));
      // Shadows of the arena's own colors stay in the usable range.
      for (let t = 0; t < 5; t++) {
        for (let i = 0x60; i < 0xa0; i++) {
          const m = bk.remaps[0].tables[t][i];
          expect(m >= 0x60 && m <= 0xf9, `${a.name} table ${t} entry ${i} -> ${m}`).toBe(true);
        }
      }
      // Widescreen: the scene continues at the sides (the middle is the classic background).
      const wide = extendedBackground(bk.background);
      expect(wide.w).toBe(576);
      for (let y = 0; y < 200; y += 37) {
        for (let x = 0; x < 320; x += 23) expect(wide.data[y * 576 + x + 128]).toBe(bk.background.data[y * 320 + x]);
      }
      expect(arenaName(a.index)).toBe(a.name);
    }
    expect(ORIGINAL_ARENAS).toBe(5);
  });

  it('host AI fights to a finish', async () => {
    await loadExtras();
    const gs = createGame(SceneId.MENU, [2, 3], [HarId.TEMPEST, HarId.PYROS]);
    gs.setupAi(0, 4);
    gs.setupAi(1, 4);
    gs.matchSettings.rounds = 0;
    gs.swapScene(SceneId.ARENA7);
    const run = new HeadlessRunner(gs);
    for (let t = 0; t < 240000 && gs.nextId === SceneId.ARENA7; t += 500) run.advance(500);
    expect(gs.nextId).not.toBe(SceneId.ARENA7);
  });

  describe('in the robot select screen', () => {
    function toHarPage(): { gs: GameState; run: HeadlessRunner; sc: MeleeScene } {
      const gs = createGame(SceneId.MELEE);
      gs.getPlayer(0).pilot.name = '';
      gs.getPlayer(1).pilot.name = '';
      gs.setupAi(1);
      gs.swapScene(SceneId.MELEE);
      const run = new HeadlessRunner(gs);
      run.advance(400);
      const sc = gs.sc as MeleeScene;
      press(run, 'Enter'); // pilot
      return { gs, run, sc };
    }

    it('the robot select screen scrolls to a third row with the new robots', async () => {
      await loadExtras();
      const { gs, run, sc } = toHarPage();
      expect(sc.page).toBe(1);
      press(run, 'ArrowRight'); // SHADOW
      press(run, 'ArrowDown'); // SHREDDER
      press(run, 'ArrowDown'); // the new row: GLACIER sits below SHREDDER
      expect(sc.viewTop).toBe(1);
      expect(sc.harIndex(0)).toBe(HarId.GLACIER);
      press(run, 'ArrowRight');
      expect(sc.harIndex(0)).toBe(HarId.TEMPEST);
      press(run, 'ArrowLeft');
      press(run, 'ArrowLeft'); // wraps to the row's last robot
      expect(sc.harIndex(0)).toBe(HarId.SPECTRE);
      press(run, 'ArrowUp');
      expect(sc.viewTop).toBe(1);
      expect(sc.harIndex(0)).toBe(HarId.CHRONOS);
      press(run, 'ArrowDown');
      press(run, 'Enter');
      expect(gs.getPlayer(0).pilot.harId).toBe(HarId.SPECTRE);
      expect(gs.nextId).toBe(SceneId.VS);
    });

    it('DOWN on KATANA stays there (the NOVA cheat still works)', async () => {
      await loadExtras();
      const { run, sc } = toHarPage();
      press(run, 'ArrowDown');
      expect(sc.harIndex(0)).toBe(HarId.KATANA);
      press(run, 'ArrowDown');
      expect(sc.harIndex(0)).toBe(HarId.KATANA);
      expect(sc.viewTop).toBe(0);
    });

    it('with the mod off, they are not offered', () => {
      const { run, sc } = toHarPage();
      press(run, 'ArrowRight');
      press(run, 'ArrowDown');
      press(run, 'ArrowDown');
      expect(sc.harIndex(0)).toBe(HarId.SHREDDER);
      expect(sc.viewTop).toBe(0);
    });
  });
});

it('the package is the mod\'s (not the game\'s files)', async () => {
  if (!hasExtras) return;
  const pkg = await extrasPackage();
  expect(pkg.manifest.id).toBe(EXTRAS_MOD_ID);
});
