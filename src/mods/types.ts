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
//   <robots|arenas|pilots>/<id>/hd.json   optional: its HD pictures for the remastered look (ModHdInfo), in hd/
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
  /** Its animations that start with the scene and loop (ids 0-49: signs, machines, flames...). */
  loops: number[];
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
  /**
   * The original pilot it plays like (0 CRYSTAL .. 10 KREISSACK): the computer fights like them when it has no `ai` of
   * its own, and the originals speak to it like to them on the VS screen when it gives them no words of its own.
   */
  personality: number;
  /** How the computer fights as this pilot, or null: like the pilot it plays like. */
  ai: ModPilotAi | null;
  /** Its words on the one-player game's VS screen. */
  vs: ModPilotVs;
  /** Lines it says after winning (one at random). */
  quotes: string[];
  /**
   * The one-player game's ending after beating Major Kreissack: the pilot's story (shown with the end titles) and a
   * closing line (empty: the game's own words).
   */
  ending: [string, string];
}

/**
 * How the computer fights as a pilot: the personality fields of the original pilot records (controller/
 * personalities.ts). Attitudes are 0-100, how much it likes an attack or a way of moving -100 to 100.
 */
export interface ModPilotAi {
  /** Attitudes: fighting with basic moves, charging in, jumping in, defending (blocks, throws), sniping from afar. */
  normal: number;
  hyper: number;
  jump: number;
  defensive: number;
  sniper: number;
  /** How much it likes each kind of attack. */
  throws: number;
  specials: number;
  jumpAttacks: number;
  high: number;
  low: number;
  middle: number;
  /** How much it likes to jump, walk forward and walk back. */
  moveJump: number;
  moveForward: number;
  moveBack: number;
  /** How readily it learns the player's habits (0-15) and forgets them (0-3). */
  learning: number;
  forget: number;
}

/** The range of each field of pilot.json's "ai", and whether it is a whole number. */
export const MOD_AI_RANGES: Record<keyof ModPilotAi, [number, number, boolean]> = {
  normal: [0, 100, true], hyper: [0, 100, true], jump: [0, 100, true], defensive: [0, 100, true], sniper: [0, 100, true],
  throws: [-100, 100, true], specials: [-100, 100, true], jumpAttacks: [-100, 100, true], high: [-100, 100, true],
  low: [-100, 100, true], middle: [-100, 100, true], moveJump: [-100, 100, true], moveForward: [-100, 100, true],
  moveBack: [-100, 100, true], learning: [0, 15, false], forget: [0, 3, false],
};

/**
 * A pilot's words on the one-player game's VS screen, where the player's pilot says a line to the opponent and the
 * opponent answers. Keyed by original pilot (0 CRYSTAL .. 10 KREISSACK).
 */
export interface ModPilotVs {
  /** What it says to an opponent it has no line of its own for. */
  line: string;
  /** What it says to each original pilot. */
  to: Record<number, string>;
  /** What each original pilot says to it (otherwise what they say to the pilot it plays like). */
  from: Record<number, string>;
}

/** Every robot must have these animations (the engine plays them): jump, stand up, stunned, crouch, both blocks, the damage sheet, walk, idle, victory and defeat. */
export const REQUIRED_MOVES = [1, 2, 3, 4, 5, 6, 9, 10, 11, 48, 49];
/** The pictures a robot brings in its fighter file: the robot select screen's cell (51 x 36) and the VS screen's image. */
export const PICTURE_MOVES = { cell: 60, vs: 61 } as const;

/** HD pictures are 5 times as wide and 6 times as tall as the native pixels they stand for (the remaster's artwork). */
export const HD_SCALE = { x: 5, y: 6 } as const;
/** Native pixels of margin a sprite's HD picture covers around the sprite, unless hd.json says otherwise. */
export const HD_PAD = 4;
/** The largest HD picture, either side. */
export const HD_MAX = 4096;
/**
 * The robot colors (primary, secondary, tertiary) HD pictures are painted in unless hd.json says otherwise: the
 * remaster's reference, three clearly different hues (the game tells a robot's color ramps apart by hue).
 */
export const HD_REFERENCE_COLORS: [number, number, number] = [0, 1, 4];

/** A sprite's HD picture: the animation (a robot's move, an arena's animation), the sprite (0 = A) and its file. */
export interface ModHdSprite {
  anim: number;
  sprite: number;
  file: string;
  /** The fingerprint of the pixels of the sprite it was made for (the game leaves it out when they changed). */
  hash: string | null;
}

/** hd.json: a robot's, arena's or pilot's HD pictures (docs/MODDING.md). */
export interface ModHdInfo {
  /** Robots: the robot colors its pictures are painted in (primary, secondary, tertiary: 0-15). */
  colors: [number, number, number];
  /** Native pixels of margin its sprite pictures cover around their sprites. */
  pad: number;
  sprites: ModHdSprite[];
  /** Arenas: the background (with its widescreen sides when it has them). */
  background: string | null;
  /** Pilots: the portrait, and the pilot select grid's face. */
  portrait: string | null;
  face: string | null;
}

/** A file of hd.json: a picture in its hd folder. */
export const HD_FILE_PATTERN = /^hd\/[A-Za-z0-9._-]{1,64}\.(png|webp)$/;

function hdFile(o: Json, key: string, where: string): string | null {
  const v = o[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || !HD_FILE_PATTERN.test(v)) throw new ModError(`${where}: "${key}" must name a PNG or WebP picture in hd/.`);
  return v;
}

export function readHdInfo(v: unknown, where: string): ModHdInfo {
  const o = obj(v, where);
  const colors = o.colors ?? HD_REFERENCE_COLORS;
  if (!Array.isArray(colors) || colors.length !== 3 || colors.some((c) => typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c > 15)) {
    throw new ModError(`${where}: "colors" must be three colors from 0 to 15.`);
  }
  const list = o.sprites ?? [];
  if (!Array.isArray(list)) throw new ModError(`${where}: "sprites" must be a list.`);
  const seen = new Set<string>();
  const sprites = list.map((x, i): ModHdSprite => {
    const e = obj(x, `${where}: sprite ${i + 1}`);
    const at = `${where}: sprite ${i + 1}`;
    const s: ModHdSprite = {
      anim: int(e, 'anim', at, 0, 69), sprite: int(e, 'sprite', at, 0, 254), file: hdFile(e, 'file', at) ?? '', hash: null,
    };
    if (!s.file) throw new ModError(`${at}: "file" is missing.`);
    if (e.hash !== undefined && e.hash !== null) {
      if (typeof e.hash !== 'string' || !/^[0-9a-f]{16}$/.test(e.hash)) throw new ModError(`${at}: "hash" must be 16 hexadecimal digits.`);
      s.hash = e.hash;
    }
    const key = `${s.anim}/${s.sprite}`;
    if (seen.has(key)) throw new ModError(`${where} names animation ${s.anim}, sprite ${s.sprite} twice.`);
    seen.add(key);
    return s;
  });
  return {
    colors: [...colors] as [number, number, number],
    pad: int(o, 'pad', where, 0, 8, HD_PAD),
    sprites,
    background: hdFile(o, 'background', where),
    portrait: hdFile(o, 'portrait', where),
    face: hdFile(o, 'face', where),
  };
}

/**
 * Whether an HD picture of w x h has the shape of the native area it stands for (nw x nh native pixels, at 5 x 6), and
 * is big enough to be HD (at least twice the native pixels) and small enough to load. Returns what is wrong, or null.
 */
export function hdShapeProblem(w: number, h: number, nw: number, nh: number): string | null {
  const ew = nw * HD_SCALE.x, eh = nh * HD_SCALE.y;
  if (w > HD_MAX || h > HD_MAX) return `it is bigger than ${HD_MAX} x ${HD_MAX}`;
  if (Math.abs((w / h) / (ew / eh) - 1) > 0.02) return `it must have the shape of ${ew} x ${eh} (${nw} x ${nh} native pixels at 5 x 6)`;
  if (w < nw * 2) return `it must be at least ${nw * 2} pixels wide to be HD (${ew} x ${eh} is the remaster's size)`;
  return null;
}

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

function animIds(v: unknown, what: string): number[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'number' || !Number.isInteger(x) || x < 0 || x > 49) || new Set(v).size !== v.length) {
    throw new ModError(`${what} must list animation ids from 0 to 49 (each once).`);
  }
  return v as number[];
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
    loops: animIds(o.loops, `${where}: "loops"`),
  };
}

function ending(v: unknown, where: string): [string, string] {
  if (v === undefined) return ['', ''];
  if (!Array.isArray(v) || v.length > 2 || v.some((t) => typeof t !== 'string' || t.length > 1500)) {
    throw new ModError(`${where}: "ending" must be up to two texts of 1500 characters at most.`);
  }
  return [v[0] ?? '', v[1] ?? ''];
}

function pilotAi(v: unknown, where: string): ModPilotAi | null {
  if (v === undefined || v === null) return null;
  const o = obj(v, `${where}: "ai"`);
  const out = {} as ModPilotAi;
  for (const [key, [min, max, whole]] of Object.entries(MOD_AI_RANGES) as [keyof ModPilotAi, [number, number, boolean]][]) {
    const x = o[key] ?? 0;
    if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x > max || (whole && !Number.isInteger(x))) {
      throw new ModError(`${where}: "ai.${key}" must be a${whole ? ' whole' : ''} number from ${min} to ${max}.`);
    }
    out[key] = x;
  }
  return out;
}

/** The lines of a "vs" table by original pilot id (0-10). */
function vsLines(v: unknown, where: string): Record<number, string> {
  if (v === undefined) return {};
  const o = obj(v, where);
  const out: Record<number, string> = {};
  for (const [k, line] of Object.entries(o)) {
    const id = Number(k);
    if (!Number.isInteger(id) || id < 0 || id > 10 || typeof line !== 'string' || line.length > 160) {
      throw new ModError(`${where} must name original pilots (0-10) with lines of 160 characters at most.`);
    }
    if (line) out[id] = line;
  }
  return out;
}

function pilotVs(v: unknown, quotes: string[], where: string): ModPilotVs {
  // (without one, its first line after winning)
  if (v === undefined) return { line: quotes[0] ?? '', to: {}, from: {} };
  const o = obj(v, `${where}: "vs"`);
  return { line: str(o, 'line', `${where}: "vs"`, 160, ''), to: vsLines(o.to, `${where}: "vs.to"`), from: vsLines(o.from, `${where}: "vs.from"`) };
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
    ai: pilotAi(o.ai, where),
    vs: pilotVs(o.vs, quotes as string[], where),
    quotes: quotes as string[],
    ending: ending(o.ending, where),
  };
}
