// Tournament save game (CHR) file layout (port of the byte-level parts of the reference formats/chr.c).
//
// Layout: the 428-byte pilot block (XOR key 0xAC) followed by 20 unknown bytes (read as part of a 448-byte XOR
// block, written as zeros), `enemies_inc_unranked` 68-byte enemy records (XOR key enemies*68), the 48-color HAR
// palette, an unknown dword and the pilot photo sprite (stored with width/height one less than the real size).
//
// The resource-dependent part of loading (tournament data, PIC photos, random HAR purchases of the enemies) is in
// src/game/tournament/chr.ts (`chrLoad`).
import { BinaryReader, BinaryWriter, xorDecode } from '../util/reader';
import { Palette } from './palette';
import { Pilot, PILOT_BLOCK_LENGTH } from './pilot';
import { Sprite } from './sprite';

export const MAX_CHR_ENEMIES = 256;
/** Number of cutscene dialog text pages (SD_CHR_CUTSCENE_TEXT_COUNT). */
export const CHR_CUTSCENE_TEXT_COUNT = 10;

const CHR_PILOT_READ_LENGTH = 448;
const CHR_PILOT_XOR_KEY = 0xac;
const CHR_PILOT_PADDING = CHR_PILOT_READ_LENGTH - PILOT_BLOCK_LENGTH;
const CHR_ENEMY_RECORD_LENGTH = 68;
const CHR_ENEMY_UNKNOWN_A = 9;
const CHR_ENEMY_UNKNOWN_B = 15;

/** State of an enemy in the player's current tournament (sd_chr_enemy). */
export interface ChrEnemy {
  /** Enemy pilot. Only the 43-byte "player" part is saved; the rest comes from the tournament file on load. */
  pilot: Pilot;
  /** 9 unknown bytes. */
  unknownA: Uint8Array;
  /** Seemingly the index into the TRN enemy list. */
  trnIndex: number;
  /** 15 unknown bytes. */
  unknownB: Uint8Array;
}

/** A saved tournament character (sd_chr_file). */
export interface ChrFile {
  pilot: Pilot;
  /** HAR palette (colors 0..47 are saved). */
  pal: Palette;
  /** Unknown dword (the reference guesses "has photo"). */
  unknownB: number;
  /** Pilot photo (also `pilot.photo` after loading). */
  photo: Sprite | null;
  /** Tournament winnings multiplier (from the TRN, not saved). */
  winningsMultiplier: number;
  /** Enemy states; `pilot.enemiesIncUnranked` entries. */
  enemies: ChrEnemy[];
  /** Cutscene BK of the tournament ending (from the TRN, not saved). */
  bkName: string;
  /** Tournament number (4 = World championship cutscene quirks; from the TRN, not saved). */
  tournamentId: number;
  /** Ending cutscene text pages for the pilot's HAR (from the TRN, not saved). */
  cutsceneText: string[];
}

/** sd_chr_create() */
export function chrCreate(): ChrFile {
  return {
    pilot: new Pilot(),
    pal: new Palette(),
    unknownB: 0,
    photo: null,
    winningsMultiplier: 0,
    enemies: [],
    bkName: '',
    tournamentId: 0,
    cutsceneText: new Array<string>(CHR_CUTSCENE_TEXT_COUNT).fill(''),
  };
}

/** A zeroed enemy record around a pilot. */
export function chrEnemyCreate(pilot: Pilot): ChrEnemy {
  return { pilot, unknownA: new Uint8Array(CHR_ENEMY_UNKNOWN_A), trnIndex: 0, unknownB: new Uint8Array(CHR_ENEMY_UNKNOWN_B) };
}

function fixedBytes(src: Uint8Array, len: number): Uint8Array {
  const out = new Uint8Array(len);
  out.set(src.subarray(0, len));
  return out;
}

/**
 * Parses the bytes of a CHR file (the file reading part of sd_chr_load, without resource lookups: enemy HAR colors
 * are not applied to their palettes and the tournament fields keep their defaults). Throws on truncated data.
 */
export function chrParse(data: Uint8Array): ChrFile {
  const chr = chrCreate();
  const r = new BinaryReader(data);

  // Pilot block and the unknown data
  const block = xorDecode(r.bytes(CHR_PILOT_READ_LENGTH), CHR_PILOT_XOR_KEY);
  chr.pilot.loadFull(new BinaryReader(block));

  // Enemies block
  const count = chr.pilot.enemiesIncUnranked;
  const eblock = xorDecode(r.bytes(CHR_ENEMY_RECORD_LENGTH * count), (count * CHR_ENEMY_RECORD_LENGTH) & 0xff);
  const er = new BinaryReader(eblock);
  for (let i = 0; i < count; i++) {
    const pilot = new Pilot();
    pilot.loadPlayer(er);
    const unknownA = er.bytes(CHR_ENEMY_UNKNOWN_A).slice();
    const trnIndex = er.u8();
    const unknownB = er.bytes(CHR_ENEMY_UNKNOWN_B).slice();
    chr.enemies.push({ pilot, unknownA, trnIndex, unknownB });
  }

  // HAR palette, unknown dword
  chr.pal = new Palette();
  chr.pal.loadRange(r, 0, 48);
  chr.unknownB = r.u32();

  // Photo (fix the stored size)
  const photo = Sprite.load(r);
  photo.width++;
  photo.height++;
  chr.photo = photo;
  chr.pilot.photo = photo;
  return chr;
}

/** sd_chr_save(): the bytes of a CHR file. */
export function chrSerialize(chr: ChrFile): Uint8Array {
  const w = new BinaryWriter(4096);

  // Pilot block, XORed. The reference then seeks 20 bytes forward ("TODO why did I have to add this"): zeros.
  const pw = new BinaryWriter(PILOT_BLOCK_LENGTH);
  chr.pilot.saveFull(pw);
  w.bytes(xorDecode(pw.toBytes(), CHR_PILOT_XOR_KEY));
  w.fill(0, CHR_PILOT_PADDING);

  // Enemies
  const count = chr.pilot.enemiesIncUnranked;
  const ew = new BinaryWriter(Math.max(16, count * CHR_ENEMY_RECORD_LENGTH));
  for (let i = 0; i < count; i++) {
    const e = chr.enemies[i];
    e.pilot.savePlayer(ew);
    ew.bytes(fixedBytes(e.unknownA, CHR_ENEMY_UNKNOWN_A));
    ew.u8(e.trnIndex);
    ew.bytes(fixedBytes(e.unknownB, CHR_ENEMY_UNKNOWN_B));
  }
  w.bytes(xorDecode(ew.toBytes(), (count * CHR_ENEMY_RECORD_LENGTH) & 0xff));

  // Palette, unknown dword
  chr.pal.saveRange(w, 0, 48);
  w.u32(chr.unknownB);

  // Photo, saved with the stored ("hacky") size. (The reference always has a photo here.)
  const photo = chr.photo ?? new Sprite();
  const saved = photo.clone();
  if (chr.photo) {
    saved.width = (photo.width - 1) & 0xffff;
    saved.height = (photo.height - 1) & 0xffff;
  }
  saved.save(w);
  return w.toBytes();
}

/** sd_chr_append_sanitized_filename(): alphanumerics upper-cased, anything else '_', plus ".CHR". */
export function chrSanitizedFilename(pilotName: string): string {
  let out = '';
  for (const ch of pilotName) out += /^[A-Za-z0-9]$/.test(ch) ? ch.toUpperCase() : '_';
  return `${out}.CHR`;
}

/** sd_chr_append_unsanitized_filename() */
export function chrUnsanitizedFilename(pilotName: string): string {
  return `${pilotName}.CHR`;
}

/** sd_chr_get_enemy() */
export function chrGetEnemy(chr: ChrFile | null, enemyNum: number): ChrEnemy | null {
  if (chr === null || enemyNum < 0 || enemyNum >= chr.pilot.enemiesIncUnranked) return null;
  return chr.enemies[enemyNum] ?? null;
}
