// Mod packages (.omfmod): what they hold and the rules their contents follow. A package is a zip archive:
//
//   mod.json                       the manifest (ModManifest)
//   robots/<id>/robot.json         a robot: its name, texts and how the computer fights with it (ModRobotInfo)
//   robots/<id>/fighter.af         its fighter file, in the original format (every animation, move and hit point)
//   arenas/<id>/arena.json         an arena: name, texts, music, ambience (ModArenaInfo)
//   arenas/<id>/arena.bk           its scene file, in the original format (background, palette, hazards, sounds)
//   arenas/<id>/arena.wid          optional: its widescreen background (576 x 200, see resources.ts)
//   pilots/<id>/pilot.json         a pilot: name, stats, colors, fighting style, bio and lines (ModPilotInfo)
//   pilots/<id>/portrait.png       its portrait (true color, up to 88 x 69 shown as it is; the game fits it into each
//                                  screen's palette)
//   pilots/<id>/face.png           optional: its face in the pilot select grid (51 x 36; see-through where the cursor's
//                                  color shows, like the originals'); made from the portrait when there is none
//
// Robots and arenas may leave out what every one of them shares (the effect moves 7, 8, 12-14 and 55-57 of a fighter
// file; the round banners, shared colors and sounds of an arena): the game adds the original game's, like it does for
// its own new robots and arenas. OMF Studio (src/studio) makes these packages; mods/package.ts reads and writes them.

/** The package format this game reads (mod.json `format`). */
export const MOD_FORMAT = 1;

export interface ModManifest {
  format: number;
  /** Unique id: lower case letters, digits, '.', '-' and '_' ("jane.steel-pack"). */
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  /** The oldest game version it works with ("0.2.0"). */
  game: string;
  /** Content ids (folder names under robots/, arenas/ and pilots/). */
  robots: string[];
  arenas: string[];
  pilots: string[];
}

export interface ModRobotInfo {
  /** The robot's name (upper case, like the originals'). */
  name: string;
  /** A line about it (the mech lab and the move list show it). */
  description: string;
  /** Names of its special moves, by move id (the move list shows them with their inputs). */
  moves: Record<number, string>;
  /** Its special moves the computer uses for its tactics (move ids): projectiles, charges, pushes. */
  ai: { projectile: number[]; charge: number[]; push: number[] };
}

/** The original songs an arena can play. */
export const MOD_MUSIC = ['ARENA0.PSM', 'ARENA1.PSM', 'ARENA2.PSM', 'ARENA3.PSM', 'ARENA4.PSM', 'MENU.PSM', 'END.PSM'] as const;

/** Arena ambiences (the remastered effects of the game's arenas: dust, embers, rain...): by the arena's name. */
export const MOD_AMBIENCE = ['none', 'stadium', 'danger room', 'power plant', 'fire pit', 'desert', 'orbital', 'ice cave', 'rooftop', 'abyss'] as const;

export interface ModArenaInfo {
  /** Its name (upper case, like the originals'). */
  name: string;
  /** The VS screen's text about it. */
  description: string;
  /** How the news report names it ("... traded blows in the ~"). */
  newsName: string;
  music: (typeof MOD_MUSIC)[number];
  ambience: (typeof MOD_AMBIENCE)[number];
  /**
   * An original arena (0-4) whose built-in behavior it has: the Stadium's light (0), the Power Plant's walls (2), the
   * Fire Pit's animations at the start (3), the Desert's palette for each round (4). -1: none.
   */
  base: number;
}

export const MOD_SEXES = ['male', 'female'] as const;

export interface ModPilotInfo {
  /** As the game's texts write the originals' ("Crystal", "Major Kreissack"). */
  name: string;
  sex: (typeof MOD_SEXES)[number];
  /** 1-20 each, like the originals' (the pilot select screen's bars). */
  power: number;
  agility: number;
  endurance: number;
  /** The robot's colors (0-15, the original color ramps): primary, secondary, tertiary. */
  colors: [number, number, number];
  /** The pilot select screen's text. */
  bio: string;
  /** How the computer fights as this pilot: an original pilot's style (0 CRYSTAL .. 10 KREISSACK). */
  personality: number;
  /** Lines said on the VS screen and after winning. */
  quotes: string[];
  /**
   * The one-player game's ending after beating Major Kreissack: the pilot's story (shown with the end titles) and a
   * closing line (empty: the game's own words).
   */
  ending: [string, string];
}

/** Every robot must have these animations (the engine plays them): jump, stand up, stunned, crouch, both blocks, the damage sheet, walk, idle, victory and defeat. */
export const REQUIRED_MOVES = [1, 2, 3, 4, 5, 6, 9, 10, 11, 48, 49];
/** The pictures a robot brings in its fighter file: the robot select screen's cell (51 x 36) and the VS screen's image. */
export const PICTURE_MOVES = { cell: 60, vs: 61 } as const;

export const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const CONTENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** A problem with a package, worded for the player. */
export class ModError extends Error {}

type Json = Record<string, unknown>;

function obj(v: unknown, what: string): Json {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ModError(`${what} is not valid.`);
  return v as Json;
}

function str(o: Json, key: string, what: string, max: number, fallback?: string): string {
  const v = o[key];
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v !== 'string') throw new ModError(`${what}: "${key}" is missing.`);
  if (v.length > max) throw new ModError(`${what}: "${key}" is longer than ${max} characters.`);
  return v;
}

function int(o: Json, key: string, what: string, min: number, max: number, fallback?: number): number {
  const v = o[key];
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new ModError(`${what}: "${key}" must be a whole number from ${min} to ${max}.`);
  return v;
}

function ids(o: Json, key: string, what: string): string[] {
  const v = o[key] ?? [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !CONTENT_ID_PATTERN.test(x))) {
    throw new ModError(`${what}: "${key}" must list folder names (lower case letters, digits, '-' and '_').`);
  }
  if (new Set(v).size !== v.length) throw new ModError(`${what}: "${key}" names a folder twice.`);
  return v as string[];
}

function oneOf<T extends string>(o: Json, key: string, what: string, list: readonly T[], fallback: T): T {
  const v = o[key] ?? fallback;
  if (!list.includes(v as T)) throw new ModError(`${what}: "${key}" must be one of ${list.join(', ')}.`);
  return v as T;
}

/** Compares dotted version numbers ("0.2.0" < "0.10.1"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0), pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

export function readManifest(v: unknown): ModManifest {
  const o = obj(v, 'mod.json');
  const format = int(o, 'format', 'mod.json', 1, 999);
  if (format > MOD_FORMAT) throw new ModError('This mod was made for a newer version of the game. Update the game to play it.');
  const id = str(o, 'id', 'mod.json', 64);
  if (!ID_PATTERN.test(id)) throw new ModError(`mod.json: the id "${id}" may only have lower case letters, digits, '.', '-' and '_'.`);
  const m: ModManifest = {
    format,
    id,
    name: str(o, 'name', 'mod.json', 40).trim() || id,
    version: str(o, 'version', 'mod.json', 16, '1.0'),
    author: str(o, 'author', 'mod.json', 40, ''),
    description: str(o, 'description', 'mod.json', 400, ''),
    game: str(o, 'game', 'mod.json', 16, '0.0.0'),
    robots: ids(o, 'robots', 'mod.json'),
    arenas: ids(o, 'arenas', 'mod.json'),
    pilots: ids(o, 'pilots', 'mod.json'),
  };
  if (!m.robots.length && !m.arenas.length && !m.pilots.length) throw new ModError('This mod has no robots, arenas or pilots.');
  return m;
}

function moveIds(v: unknown, what: string): number[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'number' || !Number.isInteger(x) || x < 15 || x > 69)) {
    throw new ModError(`${what} must list move ids from 15 to 69.`);
  }
  return v as number[];
}

export function readRobotInfo(v: unknown, where: string): ModRobotInfo {
  const o = obj(v, where);
  const moves: Record<number, string> = {};
  const mv = o.moves === undefined ? {} : obj(o.moves, `${where}: "moves"`);
  for (const [k, name] of Object.entries(mv)) {
    const id = Number(k);
    if (!Number.isInteger(id) || id < 15 || id > 69 || typeof name !== 'string' || name.length > 24) {
      throw new ModError(`${where}: "moves" must name special moves by their ids (15-69), 24 characters at most.`);
    }
    moves[id] = name;
  }
  const ai = o.ai === undefined ? {} : obj(o.ai, `${where}: "ai"`);
  return {
    name: str(o, 'name', where, 12).trim().toUpperCase() || 'ROBOT',
    description: str(o, 'description', where, 200, ''),
    moves,
    ai: {
      projectile: moveIds(ai.projectile, `${where}: "ai.projectile"`),
      charge: moveIds(ai.charge, `${where}: "ai.charge"`),
      push: moveIds(ai.push, `${where}: "ai.push"`),
    },
  };
}

export function readArenaInfo(v: unknown, where: string): ModArenaInfo {
  const o = obj(v, where);
  const name = str(o, 'name', where, 16).trim().toUpperCase() || 'ARENA';
  return {
    name,
    description: str(o, 'description', where, 160, ''),
    newsName: str(o, 'newsName', where, 24, '').trim() || name.charAt(0) + name.slice(1).toLowerCase(),
    music: oneOf(o, 'music', where, MOD_MUSIC, 'ARENA0.PSM'),
    ambience: oneOf(o, 'ambience', where, MOD_AMBIENCE, 'none'),
    base: int(o, 'base', where, -1, 4, -1),
  };
}

function ending(v: unknown, where: string): [string, string] {
  if (v === undefined) return ['', ''];
  if (!Array.isArray(v) || v.length > 2 || v.some((t) => typeof t !== 'string' || t.length > 1500)) {
    throw new ModError(`${where}: "ending" must be up to two texts of 1500 characters at most.`);
  }
  return [v[0] ?? '', v[1] ?? ''];
}

export function readPilotInfo(v: unknown, where: string): ModPilotInfo {
  const o = obj(v, where);
  const colors = o.colors ?? [0, 0, 0];
  if (!Array.isArray(colors) || colors.length !== 3 || colors.some((c) => typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c > 15)) {
    throw new ModError(`${where}: "colors" must be three colors from 0 to 15.`);
  }
  const quotes = o.quotes ?? [];
  if (!Array.isArray(quotes) || quotes.length > 10 || quotes.some((q) => typeof q !== 'string' || q.length > 160)) {
    throw new ModError(`${where}: "quotes" must be up to 10 lines of 160 characters at most.`);
  }
  return {
    name: str(o, 'name', where, 16).trim() || 'Pilot',
    sex: oneOf(o, 'sex', where, MOD_SEXES, 'male'),
    power: int(o, 'power', where, 1, 20, 10),
    agility: int(o, 'agility', where, 1, 20, 10),
    endurance: int(o, 'endurance', where, 1, 20, 10),
    colors: colors as [number, number, number],
    bio: str(o, 'bio', where, 300, ''),
    personality: int(o, 'personality', where, 0, 10, 0),
    quotes: quotes as string[],
    ending: ending(o.ending, where),
  };
}
