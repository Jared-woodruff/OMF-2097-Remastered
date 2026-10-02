// Reading and writing mod packages (.omfmod, see types.ts). Reading checks everything the game relies on (the
// manifest, every file's format, the animations a robot must have), so a package that loads plays.
import { parseAF, type AfFile } from '../formats/af';
import { parseBK, type BkFile } from '../formats/bk';
import type { Sprite } from '../formats/sprite';
import { imageSize } from '../util/imageSize';
import { decodePng, PngError } from '../util/png';
import { unzip, zip, ZipError } from '../util/zip';
import { pixelHash } from '../video/hd/pixelHash';
import {
  compareVersions, HD_MAX, hdShapeProblem, ModError, readArenaInfo, readHdInfo, readManifest, readPilotInfo, readRobotInfo, REQUIRED_MOVES,
  type ModArenaInfo, type ModHdInfo, type ModManifest, type ModPilotInfo, type ModRobotInfo,
} from './types';

/** A robot's, arena's or pilot's HD pictures: hd.json, and the pictures it names. */
export interface ModHd {
  info: ModHdInfo;
  /** The pictures, by their name in hd.json ("hd/..."). */
  files: Map<string, Uint8Array>;
}

export interface ModRobotData {
  id: string;
  info: ModRobotInfo;
  /** The fighter file. */
  af: Uint8Array;
  hd: ModHd | null;
}

export interface ModArenaData {
  id: string;
  info: ModArenaInfo;
  /** The scene file. */
  bk: Uint8Array;
  /** Its widescreen background (576 x 200), if it has one. */
  wid: Uint8Array | null;
  hd: ModHd | null;
}

export interface ModPilotData {
  id: string;
  info: ModPilotInfo;
  /** The portrait (PNG), if it has one. */
  portrait: Uint8Array | null;
  /** The pilot select grid's face (PNG, 51 x 36), if it has one. */
  face: Uint8Array | null;
  hd: ModHd | null;
}

export interface ModPackage {
  manifest: ModManifest;
  robots: ModRobotData[];
  arenas: ModArenaData[];
  pilots: ModPilotData[];
}

/** File name extension of mod packages. */
export const MOD_EXTENSION = '.omfmod';

/** Names of the animations every robot needs (for messages). */
const MOVE_NAMES: Record<number, string> = {
  1: 'jump', 2: 'stand up', 3: 'stunned', 4: 'crouch', 5: 'standing block', 6: 'crouching block', 9: 'damage', 10: 'walk',
  11: 'idle', 48: 'victory', 49: 'defeat',
};

/** Checks a robot's fighter file; returns it parsed. */
export function checkFighter(af: Uint8Array, where: string): AfFile {
  let f: AfFile;
  try {
    f = parseAF(af);
  } catch {
    throw new ModError(`${where} is damaged.`);
  }
  const missing = REQUIRED_MOVES.filter((id) => !f.moves[id]);
  if (missing.length) throw new ModError(`${where} has no ${missing.map((id) => MOVE_NAMES[id]).join(', ')} animation${missing.length > 1 ? 's' : ''}.`);
  if (!f.health || !f.endurance) throw new ModError(`${where}: the robot has no health or endurance.`);
  return f;
}

/** Checks an arena's scene file (and widescreen background); returns it parsed. */
export function checkArena(bk: Uint8Array, wid: Uint8Array | null, where: string): BkFile {
  let f: BkFile;
  try {
    f = parseBK(bk);
  } catch {
    throw new ModError(`${where} is damaged.`);
  }
  if (f.width !== 320 || f.height !== 200 || f.background.length < 320 * 200) throw new ModError(`${where}: the background must be 320 x 200.`);
  if (!f.palettes.length || f.palettes.length !== f.remaps.length) throw new ModError(`${where} has no palette.`);
  if (wid) {
    const w = wid.length >= 4 ? wid[0] | (wid[1] << 8) : 0, h = wid.length >= 4 ? wid[2] | (wid[3] << 8) : 0;
    if (w !== 576 || h !== 200) throw new ModError(`${where}: the widescreen background must be 576 x 200.`);
  }
  return f;
}

/** A sprite's pixel fingerprint: the remastered renderer finds the sprite's HD picture by it. */
export function spriteHash(s: Sprite): string {
  return pixelHash(s.width, s.height, s.pixels());
}

const letter = (i: number) => String.fromCharCode(65 + i);

/** hd.json of a content folder, if it has one (its pictures are added as they are checked, see hdPicture). */
function readHd(files: Map<string, Uint8Array>, dir: string): ModHd | null {
  if (!files.has(`${dir}hd.json`)) return null;
  return { info: readHdInfo(text(files, `${dir}hd.json`), `${dir}hd.json`), files: new Map() };
}

/** Adds one of hd.json's pictures to the set, after checking its file and its shape (nw x nh native pixels). */
function hdPicture(hd: ModHd, files: Map<string, Uint8Array>, dir: string, file: string, nw: number, nh: number, what: string): void {
  const data = files.get(dir + file);
  if (!data) throw new ModError(`The mod has no ${dir}${file}.`);
  const size = imageSize(data);
  if (!size) throw new ModError(`${dir}${file} is not a PNG or WebP picture.`);
  const problem = hdShapeProblem(size.w, size.h, nw, nh);
  if (problem) throw new ModError(`${dir}${file}, the HD picture of ${what}: ${problem}.`);
  hd.files.set(file, data);
}

/** A picture of a frame the game draws itself (hd.json's mech): a picture, of a size that can be HD. */
function hdFrame(hd: ModHd, files: Map<string, Uint8Array>, dir: string, file: string): void {
  const data = files.get(dir + file);
  if (!data) throw new ModError(`The mod has no ${dir}${file}.`);
  const size = imageSize(data);
  if (!size) throw new ModError(`${dir}${file} is not a PNG or WebP picture.`);
  if (size.w > HD_MAX || size.h > HD_MAX) throw new ModError(`${dir}${file} is bigger than ${HD_MAX} x ${HD_MAX}.`);
  hd.files.set(file, data);
}

/**
 * The sprite pictures of hd.json (a robot's moves or an arena's animations): each must be of a sprite there is, in
 * its shape; pictures made for sprites that changed since are left out.
 */
function hdSprites(hd: ModHd, files: Map<string, Uint8Array>, dir: string, anims: ({ animation: { sprites: Sprite[] } } | null)[], noun: string): void {
  const pad = hd.info.pad;
  hd.info.sprites = hd.info.sprites.filter((e) => {
    const sp = anims[e.anim]?.animation.sprites[e.sprite];
    const what = `${noun} ${e.anim}, sprite ${letter(e.sprite)}`;
    if (!sp || sp.isEmpty()) throw new ModError(`${dir}hd.json names ${what}, which has no picture.`);
    if (e.hash && e.hash !== spriteHash(sp)) return false;
    hdPicture(hd, files, dir, e.file, sp.width + 2 * pad, sp.height + 2 * pad, what);
    return true;
  });
}

function text(files: Map<string, Uint8Array>, path: string): unknown {
  const data = files.get(path);
  if (!data) throw new ModError(`The mod has no ${path}.`);
  try {
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new ModError(`${path} is not valid JSON.`);
  }
}

/**
 * Reads a package. `gameVersion`: packages made for newer games are refused. Throws ModError (worded for the player)
 * when something is wrong.
 */
/** Reads and checks a package; `lenient`: OMF Studio opening a project (see readManifest). */
export async function readModPackage(bytes: Uint8Array, gameVersion = '', lenient = false): Promise<ModPackage> {
  let files: Map<string, Uint8Array>;
  try {
    files = await unzip(bytes);
  } catch (err) {
    throw new ModError(err instanceof ZipError ? `This is not a mod package: ${err.message}` : 'This is not a mod package.');
  }
  // (a package zipped with its folder around it)
  if (!files.has('mod.json')) {
    const inner = [...files.keys()].find((k) => /^[^/]+\/mod\.json$/.test(k));
    if (inner) {
      const prefix = inner.slice(0, -'mod.json'.length);
      files = new Map([...files].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));
    }
  }
  const manifest = readManifest(text(files, 'mod.json'), lenient);
  if (gameVersion && compareVersions(manifest.game, gameVersion) > 0) {
    throw new ModError(`${manifest.name} needs version ${manifest.game} of the game or newer. Update the game to play it.`);
  }
  const pkg: ModPackage = { manifest, robots: [], arenas: [], pilots: [] };
  for (const id of manifest.robots) {
    const dir = `robots/${id}/`;
    const info = readRobotInfo(text(files, `${dir}robot.json`), `${dir}robot.json`);
    const af = files.get(`${dir}fighter.af`);
    if (!af) throw new ModError(`The mod has no ${dir}fighter.af.`);
    const f = checkFighter(af, `${dir}fighter.af`);
    const hd = readHd(files, dir);
    if (hd) {
      hdSprites(hd, files, dir, f.moves, 'move');
      for (const e of hd.info.mech) hdFrame(hd, files, dir, e.file);
      Object.assign(hd.info, { background: null, geometry: null, portrait: null, face: null });
    }
    pkg.robots.push({ id, info, af, hd });
  }
  for (const id of manifest.arenas) {
    const dir = `arenas/${id}/`;
    const info = readArenaInfo(text(files, `${dir}arena.json`), `${dir}arena.json`);
    const bk = files.get(`${dir}arena.bk`);
    if (!bk) throw new ModError(`The mod has no ${dir}arena.bk.`);
    const wid = files.get(`${dir}arena.wid`) ?? null;
    const f = checkArena(bk, wid, `${dir}arena.bk`);
    const hd = readHd(files, dir);
    if (hd) {
      hdSprites(hd, files, dir, f.anims, 'animation');
      // (the whole background: with its widescreen sides when it has them)
      if (hd.info.background) hdPicture(hd, files, dir, hd.info.background, wid ? 576 : 320, 200, 'the background');
      if (hd.info.geometry) {
        if (!hd.info.background) throw new ModError(`${dir}hd.json has a geometry map but no background.`);
        hdPicture(hd, files, dir, hd.info.geometry.file, wid ? 576 : 320, 200, "the background's geometry");
      }
      Object.assign(hd.info, { portrait: null, face: null, mech: [] });
    }
    pkg.arenas.push({ id, info, bk, wid, hd });
  }
  for (const id of manifest.pilots) {
    const dir = `pilots/${id}/`;
    const info = readPilotInfo(text(files, `${dir}pilot.json`), `${dir}pilot.json`);
    const portrait = files.get(`${dir}portrait.png`) ?? null;
    const face = files.get(`${dir}face.png`) ?? null;
    await checkImage(portrait, `${dir}portrait.png`, 160, 160);
    await checkImage(face, `${dir}face.png`, 51, 36);
    const hd = readHd(files, dir);
    if (hd) {
      const p = portrait && imageSize(portrait), fc = face && imageSize(face);
      if (hd.info.portrait) {
        if (!p) throw new ModError(`${dir}hd.json has an HD portrait, but the pilot has no portrait.png.`);
        hdPicture(hd, files, dir, hd.info.portrait, p.w, p.h, 'the portrait');
      }
      if (hd.info.face) {
        if (!fc || fc.w !== 51 || fc.h !== 36) throw new ModError(`${dir}hd.json has an HD face: it needs a face.png of 51 x 36.`);
        hdPicture(hd, files, dir, hd.info.face, 51, 36, 'the face');
      }
      Object.assign(hd.info, { sprites: [], background: null, geometry: null, mech: [] });
    }
    pkg.pilots.push({ id, info, portrait, face, hd });
  }
  return pkg;
}

/** Checks a picture (PNG, at most w x h). */
async function checkImage(data: Uint8Array | null, where: string, w: number, h: number): Promise<void> {
  if (!data) return;
  let img;
  try {
    img = await decodePng(data);
  } catch (err) {
    throw new ModError(`${where}: ${err instanceof PngError ? err.message : 'the image is damaged.'}`);
  }
  if (img.w > w || img.h > h) throw new ModError(`${where} is bigger than ${w} x ${h}.`);
}

const json = (v: unknown): Uint8Array => new TextEncoder().encode(`${JSON.stringify(v, null, 2)}\n`);

/** A content folder's HD pictures, and hd.json. */
function hdFiles(dir: string, hd: ModHd | null): [string, Uint8Array][] {
  if (!hd) return [];
  return [[`${dir}hd.json`, json(hd.info)], ...[...hd.files].map(([f, data]) => [`${dir}${f}`, data] as [string, Uint8Array])];
}

/** A package's file. */
export async function writeModPackage(pkg: ModPackage): Promise<Uint8Array> {
  const m = pkg.manifest;
  const manifest: ModManifest = {
    ...m,
    robots: pkg.robots.map((r) => r.id),
    arenas: pkg.arenas.map((a) => a.id),
    pilots: pkg.pilots.map((p) => p.id),
  };
  const files: [string, Uint8Array][] = [['mod.json', json(manifest)]];
  for (const r of pkg.robots) {
    files.push([`robots/${r.id}/robot.json`, json(r.info)], [`robots/${r.id}/fighter.af`, r.af], ...hdFiles(`robots/${r.id}/`, r.hd));
  }
  for (const a of pkg.arenas) {
    files.push([`arenas/${a.id}/arena.json`, json(a.info)], [`arenas/${a.id}/arena.bk`, a.bk]);
    if (a.wid) files.push([`arenas/${a.id}/arena.wid`, a.wid]);
    files.push(...hdFiles(`arenas/${a.id}/`, a.hd));
  }
  for (const p of pkg.pilots) {
    files.push([`pilots/${p.id}/pilot.json`, json(p.info)]);
    if (p.portrait) files.push([`pilots/${p.id}/portrait.png`, p.portrait]);
    if (p.face) files.push([`pilots/${p.id}/face.png`, p.face]);
    files.push(...hdFiles(`pilots/${p.id}/`, p.hd));
  }
  return zip(files);
}
