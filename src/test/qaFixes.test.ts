// Regressions of the QA pass of 2026-10-05: slow replays tick, a run given up ends with its score, the files Studio
// writes are refused where the game could not read them back, a mod's hostile sizes are turned away, and Studio's
// tags, picture names and blank robot are what the game reads.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app';
import { Engine } from '../engine';
import { parseAF, saveAF } from '../formats/af';
import { HarId, SceneId } from '../game/constants';
import type { GameState } from '../game/gameState';
import { ModeRun, type RunResult } from '../game/modes/run';
import { resetRecords } from '../game/records/records';
import { checkFighter, readModPackage, writeModPackage } from '../mods/package';
import { ModError } from '../mods/types';
import { addTag, newTag, parseAnim } from '../studio/anim';
import { projectProblems } from '../studio/checks';
import { parseStem, spriteStem } from '../studio/hd';
import { emptyManifest, newProject, openPackage, packageFromProject } from '../studio/project';
import { blankRobot } from '../studio/robot/newRobot';
import { readZipEntries, unzip, zip, ZipError } from '../util/zip';
import { createGame, GAMEDATA_DIR, hasGameData, installBrowserShims, loadGameData } from './harness';

describe('the engine', () => {
  it('ticks a game whose ticks last longer than its catch-up limit (a replay at a quarter of the speed)', () => {
    let ticks = 0;
    const gs = {
      msPerDyntick: () => 112,
      staticTick: () => undefined,
      dynamicTick: () => ticks++,
      paletteTransform: () => undefined,
    } as unknown as GameState;
    const engine = new Engine(gs, { render: () => undefined });
    // 5 seconds of 60 Hz frames: about 44 ticks of 112 ms
    for (let i = 0; i < 300; i++) engine.advance(1000 / 60);
    expect(ticks).toBeGreaterThan(40);
    expect(ticks).toBeLessThan(48);
  });
});

describe('zip archives', () => {
  it('refuse one that says its files unpack to more than the limit', async () => {
    const bytes = await zip([['a.txt', new TextEncoder().encode('hello')]]);
    const e = readZipEntries(bytes)![0];
    // The central directory's uncompressed size, made 2 GB.
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let p = bytes.length - 22;
    p = dv.getUint32(p + 16, true);
    expect(dv.getUint32(p + 24, true)).toBe(e.size);
    dv.setUint32(p + 24, 0x80000000, true);
    await expect(unzip(bytes)).rejects.toThrow(ZipError);
  });

  it('refuse an entry that unpacks to more than it says (a zip bomb)', async () => {
    const big = new Uint8Array(200_000).fill(65);
    const bytes = await zip([['big.bin', big]]);
    const e = readZipEntries(bytes)![0];
    if (e.method !== 8) return; // (no deflate in this runtime: stored entries cannot lie about their size)
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const cd = dv.getUint32(bytes.length - 22 + 16, true);
    dv.setUint32(cd + 24, 1000, true);
    await expect(unzip(bytes)).rejects.toThrow(ZipError);
  });
});

describe.skipIf(!hasGameData)('game rules', () => {
  beforeAll(() => {
    installBrowserShims();
    loadGameData();
  });
  beforeEach(() => resetRecords());

  it('a run given up from the pause menu ends, keeping the score it had, back to MORE MODES', () => {
    const gs = createGame(SceneId.MENU, [0, 1], [HarId.JAGUAR, HarId.KATANA]);
    const run = new ModeRun('arcade');
    gs.modeRun = run;
    let shown: RunResult | null = null;
    app.showRunResults = (r) => (shown = r);
    run.setupOpponent(gs);
    gs.getPlayer(0).score.score = 12_345;
    run.fightOver(gs, true, 20_000, 80);
    gs.nextWaitTicks = 0;
    // (quitting takes the fight's score away first)
    gs.getPlayer(0).score.score = 0;
    run.fightOver(gs, false, 5_000, 40, true);
    expect(shown).not.toBeNull();
    expect(shown!.cleared).toBe(false);
    expect(shown!.score).toBe(12_345);
    expect(gs.menuReturn).toBe('modes');
  });
});

describe.skipIf(!hasGameData)('files the game could not read back', () => {
  beforeAll(() => {
    installBrowserShims();
    loadGameData();
  });

  it('are refused when written, naming the move', () => {
    const af = blankRobot();
    af.moves[15]!.footerString = 'A1-'.repeat(200);
    expect(() => saveAF(af)).toThrow(/move 15: a reaction string of 600 characters/);
    af.moves[15]!.footerString = 'A1';
    af.moves[15]!.animation.animString = 'A1-'.repeat(400);
    expect(() => saveAF(af)).toThrow(/move 15: an animation string/);
    af.moves[15]!.animation.animString = 'A3-B4';
    af.moves[15]!.animation.coords = Array.from({ length: 300 }, () => ({ x: 0, y: 0, nullValue: 0, frameId: 0 }));
    expect(() => saveAF(af)).toThrow(/move 15: 300 hit points/);
  });

  it('keep a Studio project from being saved, with the robot named', () => {
    const p = newProject();
    const af = blankRobot();
    af.moves[15]!.footerString = 'x'.repeat(511);
    p.robots.push({ id: 'x', af, hd: null, info: { name: 'RONIN', description: '', moves: {}, ai: { projectile: [], charge: [], push: [] }, workshop: null } });
    expect(() => packageFromProject(p)).toThrow(/Robot RONIN: move 15/);
  });

  it('a mod sprite claiming a huge size is turned away, the originals\' empty ones are not', () => {
    const jaguar = new Uint8Array(fs.readFileSync(path.join(GAMEDATA_DIR, 'FIGHTR0.AF')));
    // (JAGUAR's damage sheet has an empty 25th sprite claiming 60537 x 60537)
    expect(() => checkFighter(jaguar, 'robot')).not.toThrow();
    const af = parseAF(jaguar);
    const s = af.moves[60]?.animation.sprites.find((x) => !x.isEmpty()) ?? af.moves[11]!.animation.sprites[0];
    s.width = 4000;
    expect(() => checkFighter(saveAF(af), 'robot')).toThrow(ModError);
  });
});

describe.skipIf(!hasGameData)('OMF Studio', () => {
  beforeAll(() => {
    installBrowserShims();
    loadGameData();
  });

  it('adds a tag where it reads back as itself ("u" then "br" would read as "ub" then "r")', () => {
    const f = parseAnim('uA4').frames[0];
    expect(addTag(f, newTag('br', null))).toBe(true);
    const back = parseAnim(`${f.tags.map((g) => g.raw).join('')}A4`).frames[0].tags.map((g) => g.name);
    expect(back.sort()).toEqual(['br', 'u']);
  });

  it('opens a project an earlier Studio saved past the format limits, says what to fix, and saves it once fixed', async () => {
    // (written as an earlier Studio did: move 15's reaction string 599 characters long, its animation 300 hit points)
    const bytes = saveAF(blankRobot());
    const find = (needle: number[], from = 0) => {
      for (let i = from; i <= bytes.length - needle.length; i++) if (needle.every((b, k) => bytes[i + k] === b)) return i;
      return -1;
    };
    const ascii = (t: string) => Array.from(t, (c) => c.charCodeAt(0));
    const footer = 'sp13s1l20sf0A1-B4-A3';
    const f = find([footer.length + 1, 0, ...ascii(footer), 0]);
    const anim = find([10, 0, ...ascii('A3-q1B4-A3'), 0]);
    expect(f).toBeGreaterThan(anim);
    expect(anim).toBeGreaterThan(0);
    const longFooter = `${'A1-'.repeat(199)}A1`;
    const coord = bytes.slice(anim - 4, anim);
    const out = [
      ...bytes.slice(0, anim - 7), 300 & 0xff, 300 >> 8, bytes[anim - 5],
      ...Array.from({ length: 300 }, () => [...coord]).flat(),
      ...bytes.slice(anim, f),
      (longFooter.length + 1) & 0xff, (longFooter.length + 1) >> 8, ...ascii(longFooter), 0,
      ...bytes.slice(f + footer.length + 3),
    ];
    const af = new Uint8Array(out);
    expect(() => parseAF(af)).toThrow();
    const info = { name: 'OLDBOT', description: '', moves: {}, ai: { projectile: [], charge: [], push: [] }, workshop: null };
    const pkg = await writeModPackage({ manifest: { ...emptyManifest(), id: 'me.old', robots: ['old'] }, robots: [{ id: 'old', info, af, hd: null }], arenas: [], pilots: [] });
    // The game refuses the file; Studio opens it.
    await expect(readModPackage(pkg)).rejects.toThrow(ModError);
    const p = await openPackage(pkg);
    const m = p.robots[0].af.moves[15]!;
    expect(m.footerString.length).toBe(599);
    expect(m.animation.coords.length).toBe(300);
    const errors = projectProblems(p).filter((x) => x.level === 'error').map((x) => x.text);
    expect(errors.some((t) => /reaction string is longer than 510/.test(t))).toBe(true);
    expect(errors.some((t) => /more than 256 hit points/.test(t))).toBe(true);
    // Not saved until fixed; fixed, it saves, and the game reads it.
    expect(() => packageFromProject(p)).toThrow(/Robot OLDBOT: move 15/);
    m.footerString = 'A1-B4-A3';
    m.animation.coords = m.animation.coords.slice(0, 1);
    const fixed = await writeModPackage(packageFromProject(p));
    await expect(readModPackage(fixed)).resolves.toBeTruthy();
  });

  it('names the HD pictures of sprites past z so that they read back', () => {
    expect(spriteStem('m', 15, 0)).toBe('m15-a');
    expect(spriteStem('m', 15, 27)).toBe('m15-s27');
    expect(parseStem('m', 'm15-s27')).toEqual([15, 27]);
    expect(parseStem('a', 'a3-z')).toEqual([3, 25]);
  });

  it('starts a blank robot with a whole damage sheet (A to X), which the checks are happy with', () => {
    const af = blankRobot();
    expect(af.moves[9]!.animation.sprites.length).toBe(24);
    const p = newProject();
    p.robots.push({ id: 'x', af, hd: null, info: { name: 'X', description: '', moves: {}, ai: { projectile: [], charge: [], push: [] }, workshop: null } });
    expect(projectProblems(p).some((x) => /damage sheet/.test(x.text))).toBe(false);
    af.moves[9]!.animation.sprites.length = 13;
    expect(projectProblems(p).some((x) => /damage sheet \(move 9\) has 13 sprites/.test(x.text))).toBe(true);
  });
});
