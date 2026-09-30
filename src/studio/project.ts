// An OMF Studio project: a mod package open for editing. Its robots' fighter files and its arenas' scene files are
// held parsed (studio edits them in place) and written back in the original formats when the project is saved,
// built or tested; a project is stored as the package it builds (a .omfmod file is a project, and the other way round).
import { parseAF, saveAF, type AfFile } from '../formats/af';
import { parseBK, saveBK, type BkFile } from '../formats/bk';
import { readModPackage, writeModPackage, type ModPackage } from '../mods/package';
import { CONTENT_ID_PATTERN, MOD_FORMAT, type ModArenaInfo, type ModManifest, type ModPilotInfo, type ModRobotInfo } from '../mods/types';
import { APP_VERSION } from '../platform/versionLabel';

export interface RobotDoc {
  id: string;
  info: ModRobotInfo;
  af: AfFile;
}

export interface ArenaDoc {
  id: string;
  info: ModArenaInfo;
  bk: BkFile;
  /** The widescreen background file (576 x 200), if any. */
  wid: Uint8Array | null;
}

export interface PilotDoc {
  id: string;
  info: ModPilotInfo;
  portrait: Uint8Array | null;
  face: Uint8Array | null;
}

export interface Project {
  /** Where it is stored (studio/storage.ts). */
  key: string;
  manifest: ModManifest;
  robots: RobotDoc[];
  arenas: ArenaDoc[];
  pilots: PilotDoc[];
}

/** A new project's storage key. */
export function newKey(): string {
  return `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function emptyManifest(): ModManifest {
  return {
    format: MOD_FORMAT,
    id: 'me.my-mod',
    name: 'My mod',
    version: '1.0',
    author: '',
    description: '',
    game: APP_VERSION || '0.0.0',
    robots: [],
    arenas: [],
    pilots: [],
  };
}

export function newProject(): Project {
  return { key: newKey(), manifest: emptyManifest(), robots: [], arenas: [], pilots: [] };
}

/** A project from a package (checked by readModPackage first). */
export function projectFromPackage(pkg: ModPackage, key = newKey()): Project {
  return {
    key,
    manifest: { ...pkg.manifest },
    robots: pkg.robots.map((r) => ({ id: r.id, info: structuredClone(r.info), af: parseAF(r.af) })),
    arenas: pkg.arenas.map((a) => ({ id: a.id, info: structuredClone(a.info), bk: parseBK(a.bk), wid: a.wid })),
    pilots: pkg.pilots.map((p) => ({ id: p.id, info: structuredClone(p.info), portrait: p.portrait, face: p.face })),
  };
}

/** The package a project builds. */
export function packageFromProject(p: Project): ModPackage {
  return {
    manifest: { ...p.manifest, format: MOD_FORMAT, game: APP_VERSION || p.manifest.game },
    robots: p.robots.map((r) => ({ id: r.id, info: r.info, af: saveAF(r.af) })),
    arenas: p.arenas.map((a) => ({ id: a.id, info: a.info, bk: saveBK(a.bk), wid: a.wid })),
    pilots: p.pilots.map((pl) => ({ id: pl.id, info: pl.info, portrait: pl.portrait, face: pl.face })),
  };
}

/** A project's package file. */
export function buildProject(p: Project): Promise<Uint8Array> {
  return writeModPackage(packageFromProject(p));
}

/** Opens a package file as a project (throws ModError when it is not one). */
export async function openPackage(bytes: Uint8Array, key?: string): Promise<Project> {
  return projectFromPackage(await readModPackage(bytes), key);
}

/** A free content id from a name ("Iron Fist" -> "iron-fist", "iron-fist-2"...). */
export function freeContentId(name: string, taken: string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'item';
  let id = CONTENT_ID_PATTERN.test(base) ? base : `x${base}`.slice(0, 24);
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}
