// Runtime resources: fighters (AF), scenes (BK), language strings, fonts, sounds, pilots.
import { parseAF, type AfFile } from '../formats/af';
import { parseBK, type BkFile } from '../formats/bk';
import { parseAltPals, parseFont, parseLanguage, parsePic, parseSounds, type BitmapFont, type PicPhoto, type SoundEntry } from '../formats/misc';
import type { Palette, RemapTables } from '../formats/palette';
import { parseTournament, type TournamentFile } from '../formats/tournament';
import { ANIM_JUMPING, JUMP_COORD_ADJUSTMENT } from '../game/constants';
import { Surface } from '../video/surface';
import { Animation, createAnimation } from './animation';
import { getFile } from './files';

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

function afFile(name: string): AfFile {
  let f = afCache.get(name);
  if (!f) {
    f = parseAF(getFile(name));
    afCache.set(name, f);
  }
  return f;
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
    f = parseBK(getFile(name));
    bkCache.set(name, f);
  }
  return f;
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
}

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

export function loadTournament(name: string): TournamentFile {
  const key = name.toUpperCase();
  let t = trnCache.get(key);
  if (!t) {
    t = parseTournament(getFile(key), key);
    trnCache.set(key, t);
  }
  return t;
}
