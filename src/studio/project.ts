// An OMF Studio project: a mod package open for editing. Its robots' fighter files and its arenas' scene files are
// held parsed (studio edits them in place) and written back in the original formats when the project is saved,
// built or tested; a project is stored as the package it builds (a .omfmod file is a project, and the other way round).
import { parseAF, saveAF, type AfFile } from '../formats/af';
import { parseBK, saveBK, type BkFile } from '../formats/bk';
import type { Sprite } from '../formats/sprite';
import { readModPackage, spriteHash, writeModPackage, type ModHd, type ModPackage } from '../mods/package';
import { hdShapeProblem } from '../mods/types';
import {
  CONTENT_ID_PATTERN, HD_PAD, HD_REFERENCE_COLORS, MOD_FORMAT, type ModArenaInfo, type ModHdSprite, type ModManifest, type ModPilotInfo,
  type ModRobotInfo,
} from '../mods/types';
import { APP_VERSION } from '../platform/versionLabel';
import { imageSize } from '../util/imageSize';

/**
 * A robot's, arena's or pilot's HD pictures (the package's hd.json, see mods/types.ts ModHdInfo). Sprite pictures are
 * held by the fingerprint of the sprite they are for: a picture goes with its pixels (the sprites sharing a picture
 * share it; a sprite whose pixels change leaves it, see sprites.ts).
 */
export interface HdDoc {
  /** Robots: the robot colors the pictures are painted in (primary, secondary, tertiary). */
  colors: [number, number, number];
  /** Native pixels of margin the sprite pictures cover around their sprites. */
  pad: number;
  sprites: Map<string, Uint8Array>;
  background: Uint8Array | null;
  portrait: Uint8Array | null;
  face: Uint8Array | null;
}

export function emptyHd(): HdDoc {
  return { colors: [...HD_REFERENCE_COLORS], pad: HD_PAD, sprites: new Map(), background: null, portrait: null, face: null };
}

export interface RobotDoc {
  id: string;
  info: ModRobotInfo;
  af: AfFile;
  hd: HdDoc | null;
}

export interface ArenaDoc {
  id: string;
  info: ModArenaInfo;
  bk: BkFile;
  /** The widescreen background file (576 x 200), if any. */
  wid: Uint8Array | null;
  hd: HdDoc | null;
}

export interface PilotDoc {
  id: string;
  info: ModPilotInfo;
  portrait: Uint8Array | null;
  face: Uint8Array | null;
  hd: HdDoc | null;
}

type Anims = ({ animation: { sprites: Sprite[] } } | null | undefined)[];

/** A package's HD pictures as a project holds them. */
/** A package's HD pictures as a project holds them (by their sprites' fingerprints). */
export function hdFromPackage(hd: ModHd | null, anims: Anims): HdDoc | null {
  if (!hd) return null;
  const doc: HdDoc = { ...emptyHd(), colors: [...hd.info.colors], pad: hd.info.pad };
  for (const e of hd.info.sprites) {
    const sp = anims[e.anim]?.animation.sprites[e.sprite];
    const data = hd.files.get(e.file);
    if (sp && data) doc.sprites.set(spriteHash(sp), data);
  }
  const file = (f: string | null) => (f ? hd.files.get(f) ?? null : null);
  doc.background = file(hd.info.background);
  doc.portrait = file(hd.info.portrait);
  doc.face = file(hd.info.face);
  return doc;
}

/** A picture's file name in hd/ (its extension from its format). */
function hdName(base: string, data: Uint8Array): string {
  return `hd/${base}.${imageSize(data)?.type ?? 'png'}`;
}

/**
 * The HD pictures a project's robot or arena (`prefix` "m": moves, "a": animations) or pilot puts in its package:
 * those of the sprites it has (a picture shared by several sprites is stored once), named after the first sprite.
 */
function hdToPackage(hd: HdDoc | null, anims: Anims, prefix: string): ModHd | null {
  if (!hd) return null;
  const files = new Map<string, Uint8Array>();
  const sprites: ModHdSprite[] = [];
  if (hd.sprites.size) {
    const named = new Map<string, string>();
    anims.forEach((a, anim) => a?.animation.sprites.forEach((sp, i) => {
      if (sp.isEmpty()) return;
      const hash = spriteHash(sp);
      const data = hd.sprites.get(hash);
      if (!data) return;
      let file = named.get(hash);
      if (!file) {
        named.set(hash, (file = hdName(`${prefix}${anim}-${String.fromCharCode(97 + i)}`, data)));
        files.set(file, data);
      }
      sprites.push({ anim, sprite: i, file, hash });
    }));
  }
  const one = (base: string, data: Uint8Array | null) => {
    if (!data) return null;
    const file = hdName(base, data);
    files.set(file, data);
    return file;
  };
  const background = one('background', hd.background), portrait = one('portrait', hd.portrait), face = one('face', hd.face);
  if (!files.size) return null;
  return { info: { colors: hd.colors, pad: hd.pad, sprites, background, portrait, face }, files };
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
    robots: pkg.robots.map((r) => {
      const af = parseAF(r.af);
      return { id: r.id, info: structuredClone(r.info), af, hd: hdFromPackage(r.hd, af.moves) };
    }),
    arenas: pkg.arenas.map((a) => {
      const bk = parseBK(a.bk);
      return { id: a.id, info: structuredClone(a.info), bk, wid: a.wid, hd: hdFromPackage(a.hd, bk.anims) };
    }),
    pilots: pkg.pilots.map((p) => ({ id: p.id, info: structuredClone(p.info), portrait: p.portrait, face: p.face, hd: hdFromPackage(p.hd, []) })),
  };
}

/** The package a project builds. */
export function packageFromProject(p: Project): ModPackage {
  return {
    manifest: { ...p.manifest, format: MOD_FORMAT, game: APP_VERSION || p.manifest.game },
    robots: p.robots.map((r) => ({ id: r.id, info: r.info, af: saveAF(r.af), hd: hdToPackage(r.hd, r.af.moves, 'm') })),
    // (HD pictures go only with pictures of their shape: the package would not load otherwise)
    arenas: p.arenas.map((a) => ({
      id: a.id, info: a.info, bk: saveBK(a.bk), wid: a.wid,
      hd: hdToPackage(a.hd && { ...a.hd, background: fits(a.hd.background, a.wid ? 576 : 320, 200) }, a.bk.anims, 'a'),
    })),
    pilots: p.pilots.map((pl) => {
      const portrait = pl.portrait && imageSize(pl.portrait), face = pl.face && imageSize(pl.face);
      const hd = pl.hd && {
        ...pl.hd, portrait: portrait ? fits(pl.hd.portrait, portrait.w, portrait.h) : null,
        face: face && face.w === 51 && face.h === 36 ? fits(pl.hd.face, 51, 36) : null,
      };
      return { id: pl.id, info: pl.info, portrait: pl.portrait, face: pl.face, hd: hdToPackage(hd, [], '') };
    }),
  };
}

/** An HD picture, if it has the shape of nw x nh native pixels (else null). */
function fits(bytes: Uint8Array | null, nw: number, nh: number): Uint8Array | null {
  const size = bytes && imageSize(bytes);
  return size && !hdShapeProblem(size.w, size.h, nw, nh) ? bytes : null;
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
