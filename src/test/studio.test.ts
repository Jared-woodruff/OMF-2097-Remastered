// OMF Studio's model (src/studio): projects are mod packages open for editing; what Studio writes plays exactly like
// what it read, a shared picture edited everywhere or alone keeps the other sprites right, and every way to start a
// robot makes one the game accepts.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { parseAF, saveAF, type AfFile } from '../formats/af';
import { parseBK, saveBK } from '../formats/bk';
import { buildWorkshopFighter } from '../gen/workshop';
import { readModPackage, writeModPackage } from '../mods/package';
import { readPilotInfo } from '../mods/types';
import { buildSampleMod } from '../mods/sample';
import { checkFighter } from '../mods/package';
import { getFile } from '../resources/files';
import { copyAnims, relatedAnims, renumberString } from '../studio/arena/animEditor';
import { modAi, storyPersonality } from '../controller/personalities';
import { loadLanguage } from '../resources/resources';
import { decodePng, encodePng } from '../util/png';
import { spriteHash } from '../mods/package';
import { HD_PAD, HD_SCALE } from '../mods/types';
import { followEdit, hdTemplate, parseStem, spriteStem } from '../studio/hd';
import { modelJobs, unpremultiply } from '../studio/robot/hdModel';
import { GEN_ROBOTS } from '../gen/roster';
import { readRobotInfo } from '../mods/types';
import { robotPalette } from '../studio/colors';
import { originalPilot } from '../studio/pilot/originals';
import { BIO_BOX, ENDING_BOX, ENDING_LAST_BOX, endingPages, VICTORY_BOX, VS_BOX, wordsFit } from '../studio/pilot/words';
import { projectProblems } from '../studio/checks';
import { History } from '../studio/history';
import { emptyHd, newProject, openPackage, packageFromProject, projectFromPackage } from '../studio/project';
import { blankRobot } from '../studio/robot/newRobot';
import { copyMove, pictureFromIdle, setPicture as setRobotPicture } from '../studio/robot/model';
import { detach, setPicture, sharedGroup } from '../studio/sprites';
import { extrasPackage, GAMEDATA_DIR, hasGameData, installBrowserShims, loadGameData } from './harness';

/** Everything the game reads from a fighter file, for comparing two files. */
function afMeaning(af: AfFile): unknown {
  return {
    header: [af.execWindow, af.endurance, af.upwardsJumpFrameLimit, af.health, af.forwardSpeed, af.reverseSpeed, af.jumpSpeed, af.fallSpeed, af.aiProjectileYThreshold],
    sounds: Array.from(af.soundTable),
    moves: af.moves.map((m) => m && {
      fields: [m.aiFlags, m.posConstraint, m.playIfHit, m.category, m.blockDamage, m.blockStun, m.successorId, m.damageAmount, m.throwDuration,
        m.extraStringSelector, m.points, m.moveString, m.footerString],
      anim: [m.animation.startX, m.animation.startY, m.animation.animString, m.animation.extraStrings],
      coords: m.animation.coords.map((c) => [c.x, c.y, c.frameId]),
      sprites: m.animation.sprites.map((s) => (s.isEmpty() ? 'empty' : [s.posX, s.posY, s.width, s.height, Buffer.from(s.pixels()).toString('base64')])),
    }),
  };
}

describe.skipIf(!hasGameData)('OMF Studio projects', () => {
  beforeAll(() => {
    installBrowserShims();
    loadGameData();
  });

  it('write every original robot and arena back as the game reads it', () => {
    for (let i = 0; i <= 10; i++) {
      const bytes = new Uint8Array(fs.readFileSync(path.join(GAMEDATA_DIR, `FIGHTR${i}.AF`)));
      const af = parseAF(bytes);
      expect(afMeaning(parseAF(saveAF(af))), `robot ${i}`).toEqual(afMeaning(parseAF(bytes)));
    }
    for (let i = 0; i <= 4; i++) {
      const bytes = new Uint8Array(fs.readFileSync(path.join(GAMEDATA_DIR, `ARENA${i}.BK`)));
      const again = parseBK(saveBK(parseBK(bytes)));
      const orig = parseBK(bytes);
      expect(Buffer.from(again.background).equals(Buffer.from(orig.background))).toBe(true);
      expect(again.anims.map((a) => a?.animation.animString)).toEqual(orig.anims.map((a) => a?.animation.animString));
      expect(again.palettes.map((p) => Array.from(p.colors))).toEqual(orig.palettes.map((p) => Array.from(p.colors)));
    }
  });

  it('open a mod, and build it again as it was', async () => {
    const sample = await buildSampleMod(await extrasPackage());
    const bytes = await writeModPackage(sample);
    const p = await openPackage(bytes);
    expect(projectProblems(p).filter((x) => x.level === 'error')).toEqual([]);
    const again = await readModPackage(await writeModPackage(packageFromProject(p)));
    expect(again.manifest.id).toBe(sample.manifest.id);
    expect(afMeaning(parseAF(again.robots[0].af))).toEqual(afMeaning(parseAF(sample.robots[0].af)));
    expect(Buffer.from(again.arenas[0].bk).equals(Buffer.from(saveBK(parseBK(sample.arenas[0].bk))))).toBe(true);
    expect(again.pilots[0].info).toEqual(sample.pilots[0].info);
  });

  it('a shared picture edited everywhere changes every sprite that shows it', () => {
    const af = parseAF(new Uint8Array(fs.readFileSync(path.join(GAMEDATA_DIR, 'FIGHTR0.AF'))));
    const anims = af.moves.map((m) => m?.animation);
    const shared = anims.flatMap((a) => a?.sprites ?? []).find((s) => s.missing);
    expect(shared).toBeTruthy();
    const group = sharedGroup(anims, shared!);
    expect(group.length).toBeGreaterThan(1);
    const px = new Uint8Array(4 * 3).fill(33);
    setPicture(group, px, 4, 3);
    const reread = parseAF(saveAF(af));
    const all = reread.moves.flatMap((m) => m?.animation.sprites ?? []);
    const before = af.moves.flatMap((m) => m?.animation.sprites ?? []);
    group.forEach((s) => {
      const i = before.indexOf(s);
      expect([all[i].width, all[i].height, Array.from(all[i].pixels())]).toEqual([4, 3, Array.from(px)]);
    });
  });

  it('a shared picture edited alone leaves the other sprites as they were', () => {
    const af = parseAF(new Uint8Array(fs.readFileSync(path.join(GAMEDATA_DIR, 'FIGHTR0.AF'))));
    const anims = af.moves.map((m) => m?.animation);
    const sprites = anims.flatMap((a) => a?.sprites ?? []);
    // The source of a shared picture (a full sprite some later sprites copy).
    const source = sprites.find((s) => !s.missing && s.index && sharedGroup(anims, s).length > 1)!;
    const group = sharedGroup(anims, source);
    const old = Array.from(source.pixels());
    detach(anims, source);
    const px = new Uint8Array(2 * 2).fill(40);
    setPicture([source], px, 2, 2);
    const reread = parseAF(saveAF(af)).moves.flatMap((m) => m?.animation.sprites ?? []);
    expect(Array.from(reread[sprites.indexOf(source)].pixels())).toEqual(Array.from(px));
    for (const s of group.filter((x) => x !== source)) expect(Array.from(reread[sprites.indexOf(s)].pixels())).toEqual(old);
  });

  it('every way to start a robot makes one the game accepts', () => {
    const made: AfFile[] = [
      blankRobot(),
      parseAF(buildWorkshopFighter({ v: 1, name: 'TEST', body: 1, head: 2, moves: 3, size: 0, weight: 2, colors: [1, 2, 3] }, 0)),
      parseAF(new Uint8Array(fs.readFileSync(path.join(GAMEDATA_DIR, 'FIGHTR5.AF')))),
    ];
    for (const af of made) {
      expect(() => checkFighter(saveAF(af), 'robot')).not.toThrow();
      const p = newProject();
      p.robots.push({ id: 'x', af, hd: null, info: { name: 'X', description: '', moves: {}, ai: { projectile: [], charge: [], push: [] }, workshop: null } });
      expect(projectProblems(p).filter((x) => x.level === 'error')).toEqual([]);
      // Its pictures can be made from its idle animation.
      const cell = pictureFromIdle(af, 'cell')!;
      expect([cell.width, cell.height]).toEqual([51, 36]);
      setRobotPicture(af, 'cell', cell);
      setRobotPicture(af, 'vs', pictureFromIdle(af, 'vs')!);
      expect(parseAF(saveAF(af)).moves[61]?.animation.sprites[0].height).toBeGreaterThan(40);
    }
  });

  it('a copied move is a copy: editing it leaves the original alone', () => {
    const af = blankRobot();
    const copy = copyMove(af.moves[15]!);
    setPicture([copy.animation.sprites[0]], new Uint8Array(1).fill(5), 1, 1);
    expect(af.moves[15]!.animation.sprites[0].width).toBe(44);
  });

  it('checks find what keeps the game from playing a mod', () => {
    const p = newProject();
    expect(projectProblems(p).some((x) => /no robots, arenas or pilots/.test(x.text))).toBe(true);
    const af = blankRobot();
    af.moves[11] = null;
    p.robots.push({ id: 'x', af, hd: null, info: { name: 'X', description: '', moves: {}, ai: { projectile: [], charge: [], push: [] }, workshop: null } });
    expect(projectProblems(p).some((x) => x.level === 'error' && /idle animation/.test(x.text))).toBe(true);
    p.manifest.id = 'Bad Id';
    expect(projectProblems(p).some((x) => /id may only/.test(x.text))).toBe(true);
    // Words the screens would cut off: a warning that opens the pilot's words.
    p.pilots.push({ id: 'y', info: readPilotInfo({ name: 'Y', bio: 'A very long bio that goes on and on. '.repeat(6) }, 'y'), portrait: null, face: null, hd: null });
    const long = projectProblems(p).find((x) => /bio is too long/.test(x.text));
    expect(long?.level).toBe('warning');
    expect(long?.target).toEqual({ kind: 'pilot', index: 0, move: 2 });
  });

  it('an arena animation copied from another arena brings the ones it starts and turns into', () => {
    const fire = parseBK(getFile('ARENA3.BK'));
    // (the Fire Pit's spawner starts the orb, which bursts when hit and fades otherwise)
    expect(relatedAnims(fire.anims, 0)).toEqual([0, 15, 17, 18, 16]);
    // (the Desert's planes, some started by its variants, drop bombs that explode)
    expect([...relatedAnims(parseBK(getFile('ARENA4.BK')).anims, 0)].sort((a, b) => a - b)).toEqual([0, 12, 13, 14, 15, 16, 17, 18]);
    expect(renumberString(fire.anims[0]!.animation.animString, new Map([[15, 40]]))).toBe('Z3-mx+152my+160mp-1m40Z1-mx+160my+100m40mp10Z1-Z300');
    // Copied into a scene file whose slot 15 is taken: the orb moves, what names it follows; no chain stays none.
    const to = parseBK(getFile('ARENA0.BK'));
    to.anims[15] = to.anims[0];
    const map = copyAnims(to, fire, 0, 5, true)!;
    const orb = map.get(15)!;
    expect(orb).not.toBe(15);
    expect(to.anims[5]!.animation.animString).toBe(`Z3-mx+152my+160mp-1m${orb}Z1-mx+160my+100m${orb}mp10Z1-Z300`);
    expect([to.anims[orb]!.chainHit, to.anims[orb]!.chainNoHit]).toEqual([17, 16]);
    expect([to.anims[16]!.chainHit, to.anims[16]!.chainNoHit, to.anims[17]!.chainNoHit]).toEqual([0, 0, 18]);
  });

  it('a copy of an original pilot has everything the game has for them, and builds', async () => {
    loadLanguage();
    const melee = parseBK(fs.readFileSync(path.join(GAMEDATA_DIR, 'MELEE.BK')));
    for (const id of [0, 7, 10]) {
      const p = await originalPilot(id);
      expect(p.info.ai).toEqual(modAi(storyPersonality(id)));
      expect(Object.keys(p.info.vs.to)).toHaveLength(11);
      const portrait = await decodePng(p.portrait!);
      const s = melee.anims[4]!.animation.sprites[id];
      expect([portrait.w, portrait.h]).toEqual([s.width, s.height]);
      // (Kreissack has no face in the grid, nor an ending: the player never plays him)
      expect(!!p.face).toBe(id < 10);
      expect(!!p.info.ending[0]).toBe(id < 10);
      const project = newProject();
      project.manifest.name = 'Copy';
      project.pilots.push({ id: 'copy', ...p, hd: null });
      const back = await readModPackage(await writeModPackage(packageFromProject(project)));
      expect(back.pilots[0].info).toEqual(p.info);
    }
    expect((await originalPilot(0)).info.name).toBe('Crystal');
  });

  it('the original pilots\' words fit the boxes Studio shows them in, as the game does', async () => {
    loadLanguage();
    for (let id = 0; id < 10; id++) {
      const { info } = await originalPilot(id);
      expect(wordsFit(BIO_BOX, info.bio), `bio ${id}`).toBe(true);
      for (let b = 0; b < 11; b++) {
        expect(wordsFit(VS_BOX, info.vs.to[b]), `line ${id} to ${b}`).toBe(true);
        expect(wordsFit(VS_BOX, info.vs.from[b]), `answer ${b} to ${id}`).toBe(true);
      }
      for (const q of info.quotes) expect(wordsFit(VICTORY_BOX, q), q).toBe(true);
      for (const page of endingPages(info.ending[0])) expect(wordsFit(ENDING_BOX, page), `ending ${id}`).toBe(true);
      for (const page of endingPages(info.ending[1])) expect(wordsFit(ENDING_LAST_BOX, page), `last line ${id}`).toBe(true);
    }
    // A bio twice as long does not.
    expect(wordsFit(BIO_BOX, `${(await originalPilot(0)).info.bio} `.repeat(2))).toBe(false);
  });

  it('HD pictures go with their sprites\' pixels, into the package and back', async () => {
    const p = projectFromPackage(await buildSampleMod(await extrasPackage()));
    const robot = p.robots[0];
    const idle = robot.af.moves[11]!.animation.sprites;
    const [a, b] = [idle[0], idle[1]];
    const size = (s: typeof a) => [(s.width + 2 * HD_PAD) * HD_SCALE.x, (s.height + 2 * HD_PAD) * HD_SCALE.y];
    // A template is the sprite blown up to the HD size, with its margin.
    const t = await decodePng(await hdTemplate(a.pixels(), a.width, a.height, robotPalette([0, 1, 4]), HD_PAD));
    expect([t.w, t.h]).toEqual(size(a));
    const pic = (s: typeof a) => encodePng(size(s)[0], size(s)[1], new Uint8Array(size(s)[0] * size(s)[1] * 4).fill(90));
    robot.hd = emptyHd();
    robot.hd.sprites.set(spriteHash(a), await pic(a));
    robot.hd.sprites.set(spriteHash(b), await pic(b));
    // (a picture no sprite has any more is left out)
    robot.hd.sprites.set('0123456789abcdef', await pic(a));
    const pkg = packageFromProject(p);
    expect(pkg.robots[0].hd!.info.sprites.slice(0, 2).map((e) => [e.anim, e.sprite, e.file])).toEqual([[11, 0, 'hd/m11-a.png'], [11, 1, 'hd/m11-b.png']]);
    // (a picture several sprites share is stored once)
    expect(new Set(pkg.robots[0].hd!.info.sprites.map((e) => e.file)).size).toBe(pkg.robots[0].hd!.files.size);
    const back = projectFromPackage(await readModPackage(await writeModPackage(pkg)));
    expect([...back.robots[0].hd!.sprites.keys()].sort()).toEqual([spriteHash(a), spriteHash(b)].sort());
    // Drawn on, a sprite takes its picture along while it keeps its size; not once its size changed.
    const before = spriteHash(a);
    const px = a.pixels().slice();
    px[px.findIndex((v) => v !== 0)] = 40;
    setPicture([a], px, a.width, a.height);
    expect(followEdit(robot.hd, before, a)).toMatch(/goes with the changed sprite/);
    expect(robot.hd.sprites.has(spriteHash(a))).toBe(true);
    const before2 = spriteHash(a);
    setPicture([a], new Uint8Array(4).fill(40), 2, 2);
    expect(followEdit(robot.hd, before2, a)).toMatch(/size changed/);
    expect(robot.hd.sprites.has(spriteHash(a))).toBe(false);
    // Picture names: a robot's move and sprite, an arena's animation and sprite.
    expect([spriteStem('m', 11, 0), spriteStem('a', 30, 1)]).toEqual(['m11-a', 'a30-b']);
    expect([parseStem('m', 'M11-A'), parseStem('a', 'a30-b'), parseStem('m', 'a30-b'), parseStem('m', 'm11-a-hd')]).toEqual([[11, 0], [30, 1], null, null]);
  });

  it('HD pictures that no longer have the shape of their pictures stay out of the package', async () => {
    const p = projectFromPackage(await buildSampleMod(await extrasPackage()));
    const arena = p.arenas[0], pilot = p.pilots[0];
    // (the sample's arena has widescreen sides: 576 x 200)
    arena.hd = { ...emptyHd(), background: await encodePng(1440, 600, new Uint8Array(1440 * 600 * 4)) };
    pilot.hd = { ...emptyHd(), portrait: await encodePng(10, 10, new Uint8Array(400)) };
    const pkg = packageFromProject(p);
    expect(pkg.arenas[0].hd!.info.background).toBe('hd/background.png');
    expect(pkg.pilots[0].hd).toBeNull();
    // Without widescreen sides the background has another shape: its HD picture is left out.
    arena.wid = null;
    expect(packageFromProject(p).arenas[0].hd).toBeNull();
    await expect(readModPackage(await writeModPackage(packageFromProject(p)))).resolves.toBeTruthy();
  });

  it('a robot built from the workshop\'s parts has its 3D model\'s sprites to render in HD', async () => {
    const sample = await buildSampleMod(await extrasPackage());
    const p = projectFromPackage(sample);
    const robot = p.robots[0];
    // (robot.json names the parts: the game draws what it has no pictures of from their 3D model)
    expect(robot.info.workshop).toMatchObject({ body: 0, head: 3, moves: 2 });
    expect(readRobotInfo({ name: 'X' }, 'r').workshop).toBeNull();
    const all = new Set(robot.af.moves.flatMap((m) => m?.animation.sprites.filter((s) => !s.isEmpty()).map(spriteHash) ?? []));
    const first = modelJobs(robot.info.workshop!, robot.af);
    expect([first.jobs.length, first.other]).toEqual([all.size, 0]);
    // A sprite drawn on is not the model's any more; a move copied elsewhere still is.
    const idle = robot.af.moves[11]!.animation.sprites[0];
    const px = idle.pixels().slice();
    px[px.findIndex((v) => v !== 0)] = 40;
    setPicture(sharedGroup(robot.af.moves.map((m) => m?.animation), idle), px, idle.width, idle.height);
    robot.af.moves[45] = copyMove(robot.af.moves[15]!);
    const after = modelJobs(robot.info.workshop!, robot.af);
    expect([after.jobs.length, after.other]).toEqual([all.size - 1, 1]);
    expect(after.jobs.some((j) => j.hash === spriteHash(idle))).toBe(false);
    // The remaster's robots are workshop parts too: a copy of one renders from them.
    const extras = await extrasPackage();
    GEN_ROBOTS.forEach((g, k) => {
      const af = parseAF(extras.robots[k].af);
      const r = modelJobs({ v: 1, name: g.name, body: k, head: k, moves: k, size: 1, weight: 1, colors: [0, 1, 4] }, af);
      expect(r.other, g.name).toBe(0);
    });
    // What the GPU draws (premultiplied) becomes what pictures hold.
    const rgba = new Uint8Array([100, 50, 0, 128, 7, 7, 7, 255, 0, 0, 0, 0]);
    unpremultiply(rgba);
    expect(Array.from(rgba)).toEqual([199, 100, 0, 128, 7, 7, 7, 255, 0, 0, 0, 0]);
  });

  it('a project from a package keeps its content ids', async () => {
    const sample = await buildSampleMod(await extrasPackage());
    const p = projectFromPackage(sample);
    expect(p.robots.map((r) => r.id)).toEqual(['sentinel']);
    expect(p.arenas.map((a) => a.id)).toEqual(['dusk-rooftop']);
    expect(p.pilots.map((x) => x.id)).toEqual(['vega']);
  });

  it('undo goes back a round of changes at a time, and what is edited after never changes the steps kept', async () => {
    vi.useFakeTimers();
    try {
      const p = projectFromPackage(await buildSampleMod(await extrasPackage()));
      const bytes = async (q: typeof p) => writeModPackage(packageFromProject(q));
      const start = await bytes(p);
      const history = new History();
      history.reset(p);
      expect([history.canUndo, history.canRedo]).toEqual([false, false]);
      // One round: a frame taken out of a move, its hit point moved, the name typed a letter at a time, a sound.
      const r = p.robots[0];
      const move = r.af.moves[15]!.animation;
      const frames = move.animString;
      move.animString = frames.slice(0, frames.lastIndexOf('-'));
      move.coords[0].x += 5;
      for (const name of ['S', 'SE', 'SEN']) {
        r.info.name = name;
        history.changed(p);
      }
      r.af.soundTable[3] = 99;
      history.changed(p);
      vi.advanceTimersByTime(1000);
      const afterRobot = await bytes(p);
      // Another round, not yet a step: the arena's background and colors.
      p.arenas[0].bk.background[0] ^= 1;
      p.arenas[0].bk.palettes[0].set(0x60, 1, 2, 3);
      history.changed(p);
      expect(history.canUndo).toBe(true);
      // Back one step: the arena as it was, the robot changed; back again: the project as it was opened.
      const back1 = history.undo()!;
      expect(await bytes(back1)).toEqual(afterRobot);
      const back0 = history.undo()!;
      expect(await bytes(back0)).toEqual(start);
      expect(back0.robots[0].af.moves[15]!.animation.animString).toBe(frames);
      expect(history.undo()).toBeNull();
      // Edits of what undo gave never reach the steps kept.
      back0.robots[0].af.moves[15]!.animation.coords[0].x += 50;
      back0.robots[0].info.name = 'OTHER';
      back0.arenas[0].bk.background[1] ^= 1;
      const fwd = history.redo()!;
      expect(await bytes(fwd)).toEqual(afterRobot);
      expect(history.redo()!.arenas[0].bk.palettes[0].colors.slice(0x60 * 3, 0x60 * 3 + 3)).toEqual(new Uint8Array([1, 2, 3]));
      expect(history.canRedo).toBe(false);
      // A new change forgets what could be redone.
      history.undo();
      expect(history.canRedo).toBe(true);
      p.manifest.name = 'NEW';
      history.changed(p);
      expect(history.canRedo).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
