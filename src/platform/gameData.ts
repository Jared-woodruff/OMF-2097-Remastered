// Game data for the web version: the original files can be imported in the browser (from the freeware OMF21.EXE, a
// zip, or an installed game folder) and are kept in IndexedDB, so a web deployment does not need to host them.
import { provideFile } from '../resources/files';
import { readZipEntries, readZipEntry, ZipError } from '../util/zip';
import { done, openDb } from './db';

/** Files the engine needs at runtime (same set as tools/extract-gamedata.mjs). */
const WANTED = /\.(AF|BK|PSM|PIC|TRN)$|^(ALTPALS|CHARSMAL|GRAPHCHR|ENGLISH|GERMAN|SOUNDS)\.DAT$/i;
/** Proof that a file set is One Must Fall 2097's. */
const REQUIRED = ['FIGHTR0.AF', 'MAIN.BK', 'SOUNDS.DAT', 'ENGLISH.DAT'];

const STORE = 'gamedata';

export class GameDataError extends Error {}

function baseName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop()!.toUpperCase();
}

/** The wanted files of a zip archive; archives that contain the game's installer (OMF21.EXE) are searched too. */
async function extractArchive(buf: Uint8Array, depth = 0): Promise<Map<string, Uint8Array>> {
  try {
    return await extractArchiveFiles(buf, depth);
  } catch (err) {
    throw err instanceof ZipError ? new GameDataError(err.message) : err;
  }
}

async function extractArchiveFiles(buf: Uint8Array, depth: number): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  const entries = readZipEntries(buf);
  if (!entries) return out;
  for (const e of entries) {
    const name = baseName(e.name);
    if (WANTED.test(name)) out.set(name, await readZipEntry(buf, e));
  }
  if (!out.has('FIGHTR0.AF') && depth < 2) {
    for (const e of entries) {
      if (!/\.(exe|zip)$/i.test(e.name) || e.size < 1_000_000) continue;
      const inner = await extractArchiveFiles(await readZipEntry(buf, e), depth + 1);
      if (inner.has('FIGHTR0.AF')) return inner;
    }
  }
  return out;
}

/**
 * Extracts the game files from what the player dropped or picked: OMF21.EXE (the PKZIP self-extracting installer of
 * the freeware release), a zip containing the game or its installer, or the files of an installed game.
 */
export async function extractGameFiles(files: File[], onProgress?: (text: string) => void): Promise<Map<string, Uint8Array>> {
  const found = new Map<string, Uint8Array>();
  for (const f of files) {
    const name = baseName(f.name);
    if (WANTED.test(name)) {
      found.set(name, new Uint8Array(await f.arrayBuffer()));
    } else if (/\.(EXE|ZIP)$/.test(name) && f.size > 100_000) {
      onProgress?.(`Unpacking ${f.name}…`);
      for (const [k, v] of await extractArchive(new Uint8Array(await f.arrayBuffer()))) found.set(k, v);
    }
  }
  const missing = REQUIRED.filter((r) => !found.has(r));
  if (missing.length === REQUIRED.length) {
    throw new GameDataError('No One Must Fall 2097 files were found there. Use OMF21.EXE, a zip of the game, or its installed folder.');
  }
  if (missing.length > 0) throw new GameDataError(`Some game files are missing: ${missing.join(', ')}.`);
  return found;
}

// ---- Persistent storage (IndexedDB) ------------------------------------------------------------------------------------

/** Keeps the imported files for later visits. */
export async function storeGameFiles(files: Map<string, Uint8Array>): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.clear();
    for (const [name, data] of files) store.put(data, name);
    await done(tx);
  } finally {
    db.close();
  }
}

/** Loads previously imported files into the file cache; false when there are none. */
export async function loadStoredGameFiles(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return false;
  }
  try {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const [keys, values] = await Promise.all([
      new Promise<IDBValidKey[]>((res, rej) => {
        const r = store.getAllKeys();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      }),
      new Promise<unknown[]>((res, rej) => {
        const r = store.getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      }),
    ]);
    const names = keys.map(String);
    if (!REQUIRED.every((r) => names.includes(r))) return false;
    names.forEach((n, i) => provideFile(n, values[i] as Uint8Array));
    return true;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

/** Forgets the imported files (the next start asks for them again). */
export async function clearStoredGameFiles(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await done(tx);
  } finally {
    db.close();
  }
}

/** Registers extracted files with the file cache. */
export function provideGameFiles(files: Map<string, Uint8Array>): void {
  for (const [name, data] of files) provideFile(name, data);
}
