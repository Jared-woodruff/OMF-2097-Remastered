// High score table: 4 pages (one per round type) of 20 entries, persisted in the original SCORES.DAT layout
// (port of the reference scores resource + sd_score format). The browser build keeps the file in localStorage.
import { BinaryReader, BinaryWriter, cstr } from '../util/reader';

export const SCORE_PAGES = 4;
export const SCORE_ENTRIES = 20;
/** Bytes per entry in SCORES.DAT: u32 score, char name[16], u32 (har_id:6, pilot_id:6, padding:20). */
export const SCORE_ENTRY_SIZE = 24;
export const SCORES_FILE_SIZE = SCORE_PAGES * SCORE_ENTRIES * SCORE_ENTRY_SIZE;

const STORAGE_KEY = 'omf2097r.scores';

export interface ScoreEntry {
  score: number;
  pilotId: number;
  harId: number;
  /** Up to 15 characters (char[16] with terminator). */
  name: string;
}

export interface Scoreboard {
  /** entries[page][slot], sorted by descending score. */
  entries: ScoreEntry[][];
}

export function emptyScoreEntry(): ScoreEntry {
  return { score: 0, pilotId: 0, harId: 0, name: '' };
}

export function createScoreboard(): Scoreboard {
  const sb: Scoreboard = { entries: [] };
  for (let i = 0; i < SCORE_PAGES; i++) {
    const page: ScoreEntry[] = [];
    for (let m = 0; m < SCORE_ENTRIES; m++) page.push(emptyScoreEntry());
    sb.entries.push(page);
  }
  return sb;
}

export function scoresClear(sb: Scoreboard): void {
  for (let i = 0; i < SCORE_PAGES; i++) {
    for (let m = 0; m < SCORE_ENTRIES; m++) {
      sb.entries[i][m] = emptyScoreEntry();
    }
  }
}

// ---------------------------------------------------------------------------
// SCORES.DAT (sd_score)

/** Parses SCORES.DAT. Throws on truncated data (the reference's SD_FILE_PARSE_ERROR). */
export function sdScoreLoad(data: Uint8Array): Scoreboard {
  const r = new BinaryReader(data);
  const sb = createScoreboard();
  for (let i = 0; i < SCORE_PAGES; i++) {
    for (let j = 0; j < SCORE_ENTRIES; j++) {
      const e = sb.entries[i][j];
      e.score = r.u32();
      e.name = cstr(r.bytes(16));
      const id = r.u32();
      e.harId = id & 0x3f;
      e.pilotId = (id >>> 6) & 0x3f;
    }
  }
  return sb;
}

export function sdScoreSave(sb: Scoreboard): Uint8Array {
  const w = new BinaryWriter(SCORES_FILE_SIZE);
  for (let i = 0; i < SCORE_PAGES; i++) {
    for (let j = 0; j < SCORE_ENTRIES; j++) {
      const e = sb.entries[i][j];
      w.u32(e.score);
      w.fixedStr(e.name, 16);
      w.u32((e.harId & 0x3f) | ((e.pilotId & 0x3f) << 6));
    }
  }
  return w.toBytes();
}

// ---------------------------------------------------------------------------
// Persistence

function toBase64(data: Uint8Array): string {
  let s = '';
  for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Loads the stored SCORES.DAT bytes, or null if there are none. */
export function scoresLoadFile(): Uint8Array | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? fromBase64(raw) : null;
  } catch {
    return null;
  }
}

export function scoresSaveFile(data: Uint8Array): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, toBase64(data));
    return true;
  } catch {
    return false; // storage unavailable (private mode): scores stay in memory for this session
  }
}

/** Returns 0 on success, 1 when there is no (valid) score file — like the reference scores_read. */
export function scoresRead(sb: Scoreboard): number {
  const data = scoresLoadFile();
  if (!data) return 1;
  let loaded: Scoreboard;
  try {
    loaded = sdScoreLoad(data);
  } catch {
    return 1;
  }
  for (let i = 0; i < SCORE_PAGES; i++) {
    for (let m = 0; m < SCORE_ENTRIES; m++) {
      sb.entries[i][m] = { ...loaded.entries[i][m] };
    }
  }
  return 0;
}

export function scoresWrite(sb: Scoreboard): number {
  scoresSaveFile(sdScoreSave(sb));
  return 0;
}

/** Removes the stored scores (debug/tests). */
export function scoresDeleteFile(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
