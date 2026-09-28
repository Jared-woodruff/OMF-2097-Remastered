// The remaster's new content in the game: the generated arenas' files and backgrounds, the robot select screen's
// third row, the NEW CONTENT toggles (off by default: the player opts in), and the new robots' named moves.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setKeyState } from '../controller/input';
import { ARENA_COUNT, HarId, ORIGINAL_ARENAS, SceneId } from '../game/constants';
import type { GameState } from '../game/gameState';
import { harMoveList } from '../game/gui/moveList';
import { arenaCount, arenaName, EXTRA_HAR_IDS, extraArenasEnabled, extraRobotsEnabled, randomHarPool } from '../game/roster';
import type { MeleeScene } from '../game/scenes/melee';
import { defaultSettings, loadSettings, saveSettings, settings } from '../game/settings';
import { GEN_ARENAS } from '../gen/scene/arenas';
import { loadAf, loadBk } from '../resources/resources';
import { extendedBackground } from '../video/hd/extend';
import { createGame, hasGameData, HeadlessRunner, installBrowserShims, loadGameData } from './harness';

const held = new Set<string>();
function press(run: HeadlessRunner, code: string): void {
  setKeyState(code, true);
  held.add(code);
  run.advance(60);
  setKeyState(code, false);
  held.delete(code);
  run.advance(60);
}

/** The tests below play with the new content turned on, as a player who opted in. */
beforeEach(() => {
  settings().gameplay.extraRobots = true;
  settings().gameplay.extraArenas = true;
});

afterEach(() => {
  for (const k of held) setKeyState(k, false);
  held.clear();
  settings().gameplay.extraRobots = false;
  settings().gameplay.extraArenas = false;
});

describe('opting in', () => {
  it('the new robots and arenas are off by default', () => {
    expect(defaultSettings().gameplay.extraRobots).toBe(false);
    expect(defaultSettings().gameplay.extraArenas).toBe(false);
  });

  it('settings saved before they became opt-in load with them off; later choices are kept', () => {
    installBrowserShims();
    const old = defaultSettings() as unknown as Record<string, unknown>;
    delete old.revision;
    (old.gameplay as Record<string, unknown>).extraRobots = true;
    (old.gameplay as Record<string, unknown>).extraArenas = true;
    localStorage.setItem('omf2097r.settings', JSON.stringify(old));
    expect(loadSettings().gameplay.extraRobots).toBe(false);
    expect(settings().gameplay.extraArenas).toBe(false);
    settings().gameplay.extraRobots = true;
    saveSettings();
    expect(loadSettings().gameplay.extraRobots).toBe(true);
    expect(settings().revision).toBeGreaterThanOrEqual(2);
  });
});

describe.skipIf(!hasGameData)('generated arenas', () => {
  it('load with their own palette, the shared announcements and a real widescreen background', () => {
    loadGameData();
    const ref = loadBk('ARENA0.BK');
    for (const a of GEN_ARENAS) {
      const bk = loadBk(a.file);
      expect(bk.fileId).toBe(a.fileId);
      // Only the arena's own colors and the shared ones: never the robots' (0x00-0x5F) or the menu's.
      for (const v of bk.background.data) {
        expect(v).toBeGreaterThanOrEqual(0x60);
        expect(v).toBeLessThanOrEqual(0xf9);
      }
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
  });

  it('host AI fights to a finish', () => {
    const gs = createGame(SceneId.MENU, [2, 3], [HarId.TEMPEST, HarId.PYROS]);
    gs.setupAi(0, 4);
    gs.setupAi(1, 4);
    gs.matchSettings.rounds = 0;
    gs.swapScene(SceneId.ARENA7);
    const run = new HeadlessRunner(gs);
    for (let t = 0; t < 240000 && gs.nextId === SceneId.ARENA7; t += 500) run.advance(500);
    expect(gs.nextId).not.toBe(SceneId.ARENA7);
  });

  it('can be turned off', () => {
    loadGameData();
    expect(extraArenasEnabled()).toBe(true);
    expect(arenaCount()).toBe(ARENA_COUNT);
    settings().gameplay.extraArenas = false;
    expect(arenaCount()).toBe(ORIGINAL_ARENAS);
  });
});

describe.skipIf(!hasGameData)('generated robots in the menus', () => {
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

  it('the robot select screen scrolls to a third row with the new robots', () => {
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

  it('DOWN on KATANA stays there (the NOVA cheat still works)', () => {
    const { run, sc } = toHarPage();
    press(run, 'ArrowDown');
    expect(sc.harIndex(0)).toBe(HarId.KATANA);
    press(run, 'ArrowDown');
    expect(sc.harIndex(0)).toBe(HarId.KATANA);
    expect(sc.viewTop).toBe(0);
  });

  it('turned off, they are not offered', () => {
    loadGameData();
    expect(extraRobotsEnabled()).toBe(true);
    expect(randomHarPool()).toEqual(expect.arrayContaining(EXTRA_HAR_IDS));
    settings().gameplay.extraRobots = false;
    expect(randomHarPool()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const { run, sc } = toHarPage();
    press(run, 'ArrowRight');
    press(run, 'ArrowDown');
    press(run, 'ArrowDown');
    expect(sc.harIndex(0)).toBe(HarId.SHREDDER);
    expect(sc.viewTop).toBe(0);
  });

  it('their move lists name their special moves', () => {
    loadGameData();
    const labels = (id: number) => harMoveList(loadAf(id)).map((e) => e.label);
    expect(labels(HarId.GLACIER)).toEqual(expect.arrayContaining(['ICE LANCE', 'GLACIAL RAM', 'FROST SPIKES', 'SCRAP', 'DESTRUCT']));
    expect(labels(HarId.TEMPEST)).toEqual(expect.arrayContaining(['GALE BLAST', 'CYCLONE KICK', 'SKY DIVE']));
    expect(labels(HarId.HELIX)).toEqual(expect.arrayContaining(['DRILL RUSH', 'CORKSCREW', 'DRILL BIT']));
    expect(labels(HarId.SPECTRE)).toEqual(expect.arrayContaining(['PHOTON BEAM', 'PHASE SHIFT', 'SHADOW STRIKE']));
  });
});
