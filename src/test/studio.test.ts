// OMF Studio's model (src/studio): projects are mod packages open for editing; what Studio writes plays exactly like
// what it read, a shared picture edited everywhere or alone keeps the other sprites right, and every way to start a
// robot makes one the game accepts.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
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
import { decodePng } from '../util/png';
import { originalPilot } from '../studio/pilot/originals';
import { BIO_BOX, ENDING_BOX, ENDING_LAST_BOX, endingPages, VICTORY_BOX, VS_BOX, wordsFit } from '../studio/pilot/words';
import { projectProblems } from '../studio/checks';
import { newProject, openPackage, packageFromProject, projectFromPackage } from '../studio/project';
import { blankRobot } from '../studio/robot/newRobot';
import { copyMove, pictureFromIdle, setPicture as setRobotPicture } from '../studio/robot/model';
import { detach, setPicture, sharedGroup } from '../studio/sprites';
import { GAMEDATA_DIR, hasGameData, installBrowserShims, loadGameData } from './harness';

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
    const sample = await buildSampleMod();
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
      p.robots.push({ id: 'x', af, info: { name: 'X', description: '', moves: {}, ai: { projectile: [], charge: [], push: [] } } });
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
    p.robots.push({ id: 'x', af, info: { name: 'X', description: '', moves: {}, ai: { projectile: [], charge: [], push: [] } } });
    expect(projectProblems(p).some((x) => x.level === 'error' && /idle animation/.test(x.text))).toBe(true);
    p.manifest.id = 'Bad Id';
    expect(projectProblems(p).some((x) => /id may only/.test(x.text))).toBe(true);
    // Words the screens would cut off: a warning that opens the pilot's words.
    p.pilots.push({ id: 'y', info: readPilotInfo({ name: 'Y', bio: 'A very long bio that goes on and on. '.repeat(6) }, 'y'), portrait: null, face: null });
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
      project.pilots.push({ id: 'copy', ...p });
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

  it('a project from a package keeps its content ids', async () => {
    const sample = await buildSampleMod();
    const p = projectFromPackage(sample);
    expect(p.robots.map((r) => r.id)).toEqual(['sentinel']);
    expect(p.arenas.map((a) => a.id)).toEqual(['dusk-rooftop']);
    expect(p.pilots.map((x) => x.id)).toEqual(['vega']);
  });
});
