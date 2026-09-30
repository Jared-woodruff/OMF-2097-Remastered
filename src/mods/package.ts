// Reading and writing mod packages (.omfmod, see types.ts). Reading checks everything the game relies on (the
// manifest, every file's format, the animations a robot must have), so a package that loads plays.
import { parseAF, type AfFile } from '../formats/af';
import { parseBK, type BkFile } from '../formats/bk';
import { decodePng, PngError } from '../util/png';
import { unzip, zip, ZipError } from '../util/zip';
import {
  compareVersions, ModError, readArenaInfo, readManifest, readPilotInfo, readRobotInfo, REQUIRED_MOVES, type ModArenaInfo,
  type ModManifest, type ModPilotInfo, type ModRobotInfo,
} from './types';

export interface ModRobotData {
  id: string;
  info: ModRobotInfo;
  /** The fighter file. */
  af: Uint8Array;
}

export interface ModArenaData {
  id: string;
  info: ModArenaInfo;
  /** The scene file. */
  bk: Uint8Array;
  /** Its widescreen background (576 x 200), if it has one. */
  wid: Uint8Array | null;
}

export interface ModPilotData {
  id: string;
  info: ModPilotInfo;
  /** The portrait (PNG), if it has one. */
  portrait: Uint8Array | null;
  /** The pilot select grid's face (PNG, 51 x 36), if it has one. */
  face: Uint8Array | null;
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
export async function readModPackage(bytes: Uint8Array, gameVersion = ''): Promise<ModPackage> {
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
  const manifest = readManifest(text(files, 'mod.json'));
  if (gameVersion && compareVersions(manifest.game, gameVersion) > 0) {
    throw new ModError(`${manifest.name} needs version ${manifest.game} of the game or newer. Update the game to play it.`);
  }
  const pkg: ModPackage = { manifest, robots: [], arenas: [], pilots: [] };
  for (const id of manifest.robots) {
    const dir = `robots/${id}/`;
    const info = readRobotInfo(text(files, `${dir}robot.json`), `${dir}robot.json`);
    const af = files.get(`${dir}fighter.af`);
    if (!af) throw new ModError(`The mod has no ${dir}fighter.af.`);
    checkFighter(af, `${dir}fighter.af`);
    pkg.robots.push({ id, info, af });
  }
  for (const id of manifest.arenas) {
    const dir = `arenas/${id}/`;
    const info = readArenaInfo(text(files, `${dir}arena.json`), `${dir}arena.json`);
    const bk = files.get(`${dir}arena.bk`);
    if (!bk) throw new ModError(`The mod has no ${dir}arena.bk.`);
    const wid = files.get(`${dir}arena.wid`) ?? null;
    checkArena(bk, wid, `${dir}arena.bk`);
    pkg.arenas.push({ id, info, bk, wid });
  }
  for (const id of manifest.pilots) {
    const dir = `pilots/${id}/`;
    const info = readPilotInfo(text(files, `${dir}pilot.json`), `${dir}pilot.json`);
    const portrait = files.get(`${dir}portrait.png`) ?? null;
    const face = files.get(`${dir}face.png`) ?? null;
    await checkImage(portrait, `${dir}portrait.png`, 160, 160);
    await checkImage(face, `${dir}face.png`, 51, 36);
    pkg.pilots.push({ id, info, portrait, face });
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
    files.push([`robots/${r.id}/robot.json`, json(r.info)], [`robots/${r.id}/fighter.af`, r.af]);
  }
  for (const a of pkg.arenas) {
    files.push([`arenas/${a.id}/arena.json`, json(a.info)], [`arenas/${a.id}/arena.bk`, a.bk]);
    if (a.wid) files.push([`arenas/${a.id}/arena.wid`, a.wid]);
  }
  for (const p of pkg.pilots) {
    files.push([`pilots/${p.id}/pilot.json`, json(p.info)]);
    if (p.portrait) files.push([`pilots/${p.id}/portrait.png`, p.portrait]);
    if (p.face) files.push([`pilots/${p.id}/face.png`, p.face]);
  }
  return zip(files);
}
