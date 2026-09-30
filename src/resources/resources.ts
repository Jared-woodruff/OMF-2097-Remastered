// Runtime resources: fighters (AF), scenes (BK), language strings, fonts, sounds, pilots.
import { parseAF, type AfFile } from '../formats/af';
import { AnimationData } from '../formats/animation';
import { parseBK, type BkFile } from '../formats/bk';
import { parseAltPals, parseFont, parseLanguage, parsePic, parseSounds, type BitmapFont, type PicPhoto, type SoundEntry } from '../formats/misc';
import type { Palette, RemapTables } from '../formats/palette';
import { parseTournament, type TournamentFile } from '../formats/tournament';
import { ANIM_JUMPING, JUMP_COORD_ADJUSTMENT } from '../game/constants';
import { Surface } from '../video/surface';
import { Animation, createAnimation } from './animation';
import { getFile } from './files';
import { getGenerated } from './generated';
import { decodeSprite } from '../formats/sprite';
import { setExtendedBackground } from '../video/hd/extend';

// ---------------------------------------------------------------------------
// Fighters

export interface AfMove {
  id: number;
  ani: Animation;
  /** Low 8 bits of the position constraint word (the reference engine truncates it). */
  posConstraints: number;
  posConstraintsFull: number;
  aiFlags: number;
  nextMove: number;
  successorId: number;
  category: number;
  points: number;
  blockDamage: number;
  blockStun: number;
  throwDuration: number;
  extraStringSelector: number;
  damage: number;
  stun: number;
  moveString: string;
  footerString: string;
}

export interface Af {
  id: number;
  endurance: number;
  health: number;
  forwardSpeed: number;
  reverseSpeed: number;
  jumpSpeed: number;
  fallSpeed: number;
  aiProjectileYThreshold: number;
  moves: (AfMove | null)[];
  soundTranslationTable: Uint8Array;
  file: string;
}

const afCache = new Map<string, AfFile>();

/** Effect moves every robot shares (sparks, scrap metal, bolt, screw, blasts), identical in all original files. */
const SHARED_MOVES = [7, 8, 12, 13, 14, 55, 56, 57];

function afFile(name: string): AfFile {
  let f = afCache.get(name);
  if (!f) {
    const generated = getGenerated(name);
    f = generated ? withSharedMoves(parseAF(generated)) : parseAF(getFile(name));
    afCache.set(name, f);
  }
  return f;
}

/**
 * A generated robot's file gets the shared effect moves from the original robots' (the player's game data; they are
 * not part of the generated files). Their sprites lose their sharing index so they cannot stand in for the robot's own.
 */
function withSharedMoves(af: AfFile): AfFile {
  const src = afFile('FIGHTR0.AF');
  for (const id of SHARED_MOVES) {
    const m = src.moves[id];
    if (!m || af.moves[id]) continue;
    const animation = new AnimationData();
    animation.startX = m.animation.startX;
    animation.startY = m.animation.startY;
    animation.animString = m.animation.animString;
    animation.coords = m.animation.coords.map((c) => ({ ...c }));
    animation.extraStrings = m.animation.extraStrings.slice();
    animation.sprites = m.animation.sprites.map((sp) => {
      const c = sp.clone();
      c.index = 0;
      c.missing = 0;
      return c;
    });
    af.moves[id] = { ...m, animation, unknown: m.unknown.slice() };
  }
  return af;
}

/**
 * A picture stored in a robot's fighter file as a one-sprite move (the generated robots keep their robot select cell
 * and VS screen image there); a fresh surface each call.
 */
export function harPicture(harId: number, moveId: number): { surface: Surface; x: number; y: number } | null {
  if (!hasFighter(harId)) return null;
  const name = harFileName(harId);
  const af = afFile(name);
  const sp = af.moves[moveId]?.animation.sprites[0];
  if (!sp || sp.isEmpty()) return moveId === PICTURE_CELL || moveId === PICTURE_VS ? pictureFromIdle(af, name, moveId) : null;
  const surface = new Surface(sp.width, sp.height, sp.pixels().slice(), 0);
  surface.source = { kind: 'sprite', key: `${name}/${moveId}/0` };
  return { surface, x: sp.posX, y: sp.posY };
}

/** The robot select screen's cell and the VS screen's image (moves of the generated robots' and mods' fighter files). */
const PICTURE_CELL = 60, PICTURE_VS = 61;
/** The cell's size and background color (gen/fighter/moveset.ts). */
const CELL_W = 51, CELL_H = 36, CELL_BACKGROUND = 0xd0;
/** About the height of the original robots' VS images. */
const VS_HEIGHT = 130;

/**
 * A picture for a fighter file that has none (a mod made without them), from the first frame of its idle animation:
 * the cell shows its head and shoulders, the VS screen the whole robot scaled to the originals' size.
 */
function pictureFromIdle(af: AfFile, name: string, moveId: number): { surface: Surface; x: number; y: number } | null {
  const idle = af.moves[11]?.animation.sprites.find((s) => !s.isEmpty() && s.width < 1000);
  if (!idle) return null;
  const px = idle.pixels(), w = idle.width, h = idle.height;
  let top = 0;
  while (top < h - 1 && !px.subarray(top * w, (top + 1) * w).some((v) => v)) top++;
  if (moveId === PICTURE_CELL) {
    // Centred on the pixels of the frame's top part (the head), a little room above it.
    let sum = 0, n = 0;
    for (let y = top; y < Math.min(h, top + CELL_H); y++) {
      for (let x = 0; x < w; x++) {
        if (px[y * w + x]) {
          sum += x;
          n++;
        }
      }
    }
    const cx = n ? Math.round(sum / n) : w >> 1;
    const data = new Uint8Array(CELL_W * CELL_H).fill(CELL_BACKGROUND);
    for (let y = 0; y < CELL_H; y++) {
      for (let x = 0; x < CELL_W; x++) {
        const sx = cx - (CELL_W >> 1) + x, sy = top - 3 + y;
        const v = sx >= 0 && sx < w && sy >= 0 && sy < h ? px[sy * w + sx] : 0;
        if (v) data[y * CELL_W + x] = v;
      }
    }
    const surface = new Surface(CELL_W, CELL_H, data, 0);
    surface.source = { kind: 'generated', key: `${name}/${moveId}/idle` };
    return { surface, x: 0, y: 0 };
  }
  const scale = Math.max(1, Math.min(3, VS_HEIGHT / Math.max(1, h - top)));
  const sw = Math.round(w * scale), sh = Math.round((h - top) * scale);
  const data = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const sy = top + Math.min(h - top - 1, Math.floor(y / scale));
    for (let x = 0; x < sw; x++) data[y * sw + x] = px[sy * w + Math.min(w - 1, Math.floor(x / scale))];
  }
  const surface = new Surface(sw, sh, data, 0);
  surface.source = { kind: 'generated', key: `${name}/${moveId}/idle` };
  return { surface, x: 0, y: 0 };
}

/** The parsed fighter file of a robot (shared: do not modify). */
export function fighterFile(harId: number): AfFile {
  return afFile(harFileName(harId));
}

/** Forgets a parsed fighter file (a workshop robot that was built again). */
export function forgetFighter(harId: number): void {
  afCache.delete(harFileName(harId));
}

/** Whether a robot's fighter file is available (the generated robots ship separately from the game data). */
export function hasFighter(harId: number): boolean {
  const name = harFileName(harId);
  if (afCache.has(name) || getGenerated(name)) return true;
  try {
    getFile(name);
    return true;
  } catch {
    return false;
  }
}

export function harFileName(harId: number): string {
  return `FIGHTR${harId}.AF`;
}

/** Creates a fresh (mutable) runtime copy of a fighter. */
export function loadAf(harId: number): Af {
  const name = harFileName(harId);
  const src = afFile(name);
  const shared = new Map<number, Surface | null>();
  const moves: (AfMove | null)[] = src.moves.map((m, id) => {
    if (!m) return null;
    const ani = createAnimation(m.animation, id, shared, name);
    if (id === ANIM_JUMPING) ani.fixupCoordinates(0, -JUMP_COORD_ADJUSTMENT);
    return {
      id,
      ani,
      posConstraints: m.posConstraint & 0xff,
      posConstraintsFull: m.posConstraint,
      aiFlags: m.aiFlags,
      nextMove: m.playIfHit,
      successorId: m.successorId,
      category: m.category,
      points: m.points * 400,
      blockDamage: m.blockDamage,
      blockStun: m.blockStun,
      throwDuration: m.throwDuration,
      extraStringSelector: m.extraStringSelector,
      damage: m.damageAmount,
      stun: 0,
      moveString: m.moveString,
      footerString: m.footerString,
    };
  });
  const stl = src.soundTable.slice();
  stl[25] = 0;
  stl[26] = 0;
  stl[27] = 0;
  return {
    id: src.fighterId,
    endurance: src.endurance,
    health: src.health,
    forwardSpeed: src.forwardSpeed,
    reverseSpeed: src.reverseSpeed,
    jumpSpeed: src.jumpSpeed,
    fallSpeed: src.fallSpeed,
    aiProjectileYThreshold: src.aiProjectileYThreshold,
    moves,
    soundTranslationTable: stl,
    file: name,
  };
}

export function afGetMove(af: Af, id: number): AfMove | null {
  return id >= 0 && id < af.moves.length ? af.moves[id] : null;
}

// ---------------------------------------------------------------------------
// Scenes

export interface BkInfo {
  chainHit: number;
  chainNoHit: number;
  repeat: number;
  probability: number;
  hazardDamage: number;
  footerString: string;
  ani: Animation;
}

export interface Bk {
  fileId: number;
  file: string;
  background: Surface;
  /** Scene animations, ordered by id. */
  infos: Map<number, BkInfo>;
  palettes: Palette[];
  remaps: RemapTables[];
  soundTranslationTable: Uint8Array;
}

const bkCache = new Map<string, BkFile>();

function bkFile(name: string): BkFile {
  let f = bkCache.get(name);
  if (!f) {
    const generated = getGenerated(name);
    f = generated ? withSharedArenaParts(parseBK(generated)) : parseBK(getFile(name));
    bkCache.set(name, f);
  }
  return f;
}

/** Scene animations every arena shares: ROUND, the round number, YOU LOSE, YOU WIN, FIGHT!, READY, dust, round token. */
const SHARED_ARENA_ANIMS = [6, 7, 8, 9, 10, 11, 24, 25, 26, 27];

/**
 * A generated arena's file holds only its own content: the rest comes from the first original arena (the player's game
 * data): the palette entries every arena shares, the remap rows of the robots' colors, the shared scene animations
 * and the sound table.
 */
function withSharedArenaParts(bk: BkFile): BkFile {
  const ref = bkFile('ARENA0.BK');
  bk.palettes = bk.palettes.map((own) => {
    const p = ref.palettes[0].clone();
    p.copyRange(own, 0x60, 0x40);
    return p;
  });
  bk.remaps.forEach((r) => r.tables.forEach((t, k) => t.set(ref.remaps[0].tables[k].subarray(0, 0x60), 0)));
  for (const id of SHARED_ARENA_ANIMS) {
    const a = ref.anims[id];
    if (!a || bk.anims[id]) continue;
    const animation = new AnimationData();
    animation.startX = a.animation.startX;
    animation.startY = a.animation.startY;
    animation.animString = a.animation.animString;
    animation.coords = a.animation.coords.map((c) => ({ ...c }));
    animation.extraStrings = a.animation.extraStrings.slice();
    animation.sprites = a.animation.sprites.map((sp) => {
      const c = sp.clone();
      c.index = 0;
      c.missing = 0;
      return c;
    });
    bk.anims[id] = { ...a, animation };
  }
  // (a mod arena may bring its own sounds; the generated arenas leave theirs empty)
  if (bk.soundTable.every((v) => v === 0)) bk.soundTable = ref.soundTable.slice();
  return bk;
}

/** The native widescreen background of a generated arena (576 x 200), or null. */
function wideBackground(name: string): Surface | null {
  const data = getGenerated(name.replace(/\.BK$/i, '.WID'));
  if (!data) return null;
  const w = data[0] | (data[1] << 8), h = data[2] | (data[3] << 8);
  const surf = new Surface(w, h, decodeSprite(data.subarray(4), w, h), -1);
  return surf;
}

export function loadBk(name: string): Bk {
  const src = bkFile(name);
  const shared = new Map<number, Surface | null>();
  const infos = new Map<number, BkInfo>();
  src.anims.forEach((a, id) => {
    if (!a) return;
    infos.set(id, {
      chainHit: a.chainHit,
      chainNoHit: a.chainNoHit,
      repeat: a.repeat,
      probability: a.probability,
      hazardDamage: a.hazardDamage,
      footerString: a.footerString,
      ani: createAnimation(a.animation, id, shared, name),
    });
  });
  // Every load gets its own copies of the mutable parts (scenes edit palettes / pixels in place).
  const background = new Surface(src.width, src.height, src.background.slice(), -1);
  background.source = { kind: 'background', key: `${name}/bg` };
  // Generated arenas bring a real widescreen background (instead of the mirrored sides of the others).
  const wide = wideBackground(name);
  if (wide) {
    wide.source = { kind: 'background', key: `${name}/bg#ext` };
    setExtendedBackground(background, wide);
  }
  return {
    fileId: src.fileId,
    file: name,
    background,
    infos,
    palettes: src.palettes.map((p) => p.clone()),
    remaps: src.remaps.map((r) => r.clone()),
    soundTranslationTable: src.soundTable.slice(),
  };
}

export function bkGetInfo(bk: Bk, id: number): BkInfo | null {
  return bk.infos.get(id) ?? null;
}

// ---------------------------------------------------------------------------
// Language, fonts, sounds, palettes, portraits

let language: string[] = [];

/** Ids of the 23 strings OMF 2.1 added (netplay); 990-string language files lack them. */
const LANG_21_NEW_IDS = [149, 150, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 267, 269, 270, 271, 284, 295, 305];

export function loadLanguage(file = 'ENGLISH.DAT'): void {
  // The trailing line break of every entry is not part of the text.
  language = parseLanguage(getFile(file)).map((s) => (s.text.endsWith('\n') ? s.text.slice(0, -1) : s.text));
  if (language.length === 990) {
    // Older files (e.g. GERMAN.DAT): insert placeholders so ids line up with the 1013-entry layout.
    for (const id of LANG_21_NEW_IDS) language.splice(id, 0, '');
  }
  // The remaster's robots take the unused entries after the robot names (31 + HAR id); so do the workshop's.
  GENERATED_HAR_NAMES.forEach((name, i) => {
    if (!language[42 + i]) language[42 + i] = name;
  });
  for (const [id, name] of customHarNames) if (31 + id <= LAST_FREE_HAR_NAME) language[31 + id] = name;
}

/** The last of the language file's free entries after the robot names (56 is the first arena's name). */
const LAST_FREE_HAR_NAME = 55;

/** Names of the workshop's and mods' robots (HAR 15..), kept over language changes. */
const customHarNames = new Map<number, string>();

/** Names a workshop or mod robot (in the language file's free entries after the robot names while there are some). */
export function setHarName(harId: number, name: string): void {
  const title = name.charAt(0) + name.slice(1).toLowerCase();
  customHarNames.set(harId, title);
  if (language.length && 31 + harId <= LAST_FREE_HAR_NAME) language[31 + harId] = title;
}

/** A robot's name as the game's texts write it ("Jaguar"; the workshop's and mods' robots too). */
export function harName(harId: number): string {
  return customHarNames.get(harId) ?? langGet(31 + harId);
}

/** Names of HARs 11.. (the generated robots), in the case of the originals' ("Jaguar"; the news report prints it). */
const GENERATED_HAR_NAMES = ['Glacier', 'Tempest', 'Helix', 'Spectre'];

export function langGet(id: number): string {
  return language[id] ?? '';
}

export function langCount(): number {
  return language.length;
}

let fontSmall: BitmapFont | null = null;
let fontBig: BitmapFont | null = null;

export function fonts(): { small: BitmapFont; big: BitmapFont } {
  if (!fontSmall) fontSmall = parseFont(getFile('CHARSMAL.DAT'), 6);
  if (!fontBig) fontBig = parseFont(getFile('GRAPHCHR.DAT'), 8);
  return { small: fontSmall, big: fontBig! };
}

let sounds: SoundEntry[] | null = null;

export function soundBank(): SoundEntry[] {
  if (!sounds) sounds = parseSounds(getFile('SOUNDS.DAT'));
  return sounds;
}

let altpals: Palette[] | null = null;

export function altPalettes(): Palette[] {
  if (!altpals) altpals = parseAltPals(getFile('ALTPALS.DAT'));
  return altpals;
}

const picCache = new Map<string, PicPhoto[]>();

export function loadPic(name: string): PicPhoto[] {
  let p = picCache.get(name);
  if (!p) {
    p = parsePic(getFile(name));
    picCache.set(name, p);
  }
  return p;
}

const trnCache = new Map<string, TournamentFile>();
/** Tournaments made in the game (custom tournaments), by upper-case file name. */
const customTrns = new Map<string, TournamentFile>();

/** Adds (or replaces) a tournament made in the game; null removes it. */
export function registerTournament(name: string, trn: TournamentFile | null): void {
  const key = name.toUpperCase();
  if (trn) {
    customTrns.set(key, trn);
    trnCache.set(key, trn);
  } else {
    customTrns.delete(key);
    trnCache.delete(key);
  }
}

/** The file names of the tournaments made in the game. */
export function customTournamentNames(): string[] {
  return [...customTrns.keys()].sort();
}

export function loadTournament(name: string): TournamentFile {
  const key = name.toUpperCase();
  let t = trnCache.get(key);
  if (!t) {
    t = parseTournament(getFile(key), key);
    trnCache.set(key, t);
  }
  return t;
}
