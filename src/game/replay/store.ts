// Saved fights: every fight's recording (REC file) with a summary for the replay list, in the browser's database
// (IndexedDB, also in the desktop app). The newest fights are kept automatically; the player can keep any fight for
// good, delete it, or exchange recordings as .REC files.
import { recLastTick, recParse, type RecFile } from '../../formats/rec';
import { done, openDb, result } from '../../platform/db';

export interface ReplayPlayer {
  name: string;
  harId: number;
  pilotId: number;
}

export interface ReplayMeta {
  /** When the fight was played (ms since 1970). */
  created: number;
  /** Game mode shown in the list (ONE PLAYER, TWO PLAYER, TOURNAMENT, ...). */
  mode: string;
  players: [ReplayPlayer, ReplayPlayer];
  arena: number;
  /** The winner (0 or 1), or -1 for a fight that was not finished. */
  winner: number;
  /** Rounds won by each player. */
  rounds: [number, number];
  /** Length in game ticks. */
  ticks: number;
  /** Kept for good (not pruned). */
  kept: boolean;
  /** Player 1's health at the start in percent, when less than full (a survival fight after a damaging one). */
  startHealth?: number;
}

export interface ReplayRecord {
  id?: number;
  meta: ReplayMeta;
  data: Uint8Array;
}

/** Fights kept automatically besides the ones kept for good. */
export const AUTO_KEEP = 40;

/** Ids to delete so that at most `maxAuto` fights not kept for good remain (the oldest go first). */
export function pruneIds(list: { id?: number; meta: ReplayMeta }[], maxAuto = AUTO_KEEP): number[] {
  const auto = list.filter((r) => !r.meta.kept && r.id !== undefined).sort((a, b) => b.meta.created - a.meta.created);
  return auto.slice(maxAuto).map((r) => r.id!);
}

/** A summary for a recording from elsewhere (an imported .REC file). */
export function metaFromRec(rec: RecFile, created = Date.now()): ReplayMeta {
  const p = (i: number): ReplayPlayer => ({
    name: rec.pilots[i].info.name.trim() || `PLAYER ${i + 1}`,
    harId: rec.pilots[i].info.harId,
    pilotId: rec.pilots[i].info.pilotId,
  });
  return {
    created, mode: rec.gameMode === 1 ? 'TOURNAMENT' : 'IMPORTED', players: [p(0), p(1)], arena: rec.arenaId,
    winner: -1, rounds: [0, 0], ticks: recLastTick(rec), kept: true,
  };
}

/** A file name for an exported recording: date, pilots and robots. */
export function replayFileName(meta: ReplayMeta, harName: (id: number) => string): string {
  const d = new Date(meta.created);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const who = meta.players.map((p) => `${p.name}-${harName(p.harId)}`.replace(/[^A-Za-z0-9-]+/g, '')).join('-vs-');
  return `omf2097-${stamp}-${who}.rec`.toLowerCase();
}

/** Where finished fights go (the database; tests catch them instead). */
let sink: (meta: ReplayMeta, data: Uint8Array) => Promise<unknown> = (meta, data) => saveReplay(meta, data);

export function setReplaySink(fn: (meta: ReplayMeta, data: Uint8Array) => Promise<unknown>): void {
  sink = fn;
}

/** Keeps a finished fight (arena). */
export function storeFight(meta: ReplayMeta, data: Uint8Array): void {
  void sink(meta, data).catch((err) => console.warn('[replay] not saved:', err));
}

/** Stores a fight and prunes the oldest automatic ones; resolves to the new id. */
export async function saveReplay(meta: ReplayMeta, data: Uint8Array): Promise<number> {
  const db = await openDb();
  try {
    const tx = db.transaction('replays', 'readwrite');
    const store = tx.objectStore('replays');
    const id = (await result(store.add({ meta, data }))) as number;
    const all = (await result(store.getAll())) as ReplayRecord[];
    for (const old of pruneIds(all)) store.delete(old);
    await done(tx);
    return id;
  } finally {
    db.close();
  }
}

/** All stored fights, newest first. */
export async function listReplays(): Promise<ReplayRecord[]> {
  const db = await openDb();
  try {
    const all = (await result(db.transaction('replays').objectStore('replays').getAll())) as ReplayRecord[];
    return all.sort((a, b) => b.meta.created - a.meta.created);
  } finally {
    db.close();
  }
}

export async function deleteReplay(id: number): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction('replays', 'readwrite');
    tx.objectStore('replays').delete(id);
    await done(tx);
  } finally {
    db.close();
  }
}

/** Keeps a fight for good, or lets it go with the automatic ones. */
export async function setReplayKept(id: number, kept: boolean): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction('replays', 'readwrite');
    const store = tx.objectStore('replays');
    const rec = (await result(store.get(id))) as ReplayRecord | undefined;
    if (rec) {
      rec.meta.kept = kept;
      store.put(rec);
    }
    await done(tx);
  } finally {
    db.close();
  }
}

/** Imports .REC files (kept for good); resolves to the number imported. Unreadable files are skipped. */
export async function importReplays(files: File[]): Promise<number> {
  let n = 0;
  for (const f of files) {
    try {
      const data = new Uint8Array(await f.arrayBuffer());
      const meta = metaFromRec(recParse(data), f.lastModified || Date.now());
      await saveReplay(meta, data);
      n++;
    } catch (err) {
      console.warn(`[replay] could not import ${f.name}:`, err);
    }
  }
  return n;
}
