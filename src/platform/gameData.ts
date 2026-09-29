// Game data for the web version: the original files can be imported in the browser (from the freeware OMF21.EXE, a
// zip, or an installed game folder) and are kept in IndexedDB, so a web deployment does not need to host them.
import { provideFile } from '../resources/files';
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

// ---- ZIP (and PKZIP self-extractor) reading ---------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  method: number;
  compSize: number;
  size: number;
  localOffset: number;
}

function readZipEntries(buf: Uint8Array): ZipEntry[] | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // End of central directory record, searched backwards (it may be followed by a comment).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  // Self-extractors store offsets relative to the start of the zip payload, not the file.
  const delta = eocd - cdSize - cdOffset;
  const entries: ZipEntry[] = [];
  let p = cdOffset + delta;
  const decoder = new TextDecoder('latin1');
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) throw new GameDataError('The archive is damaged.');
    const nameLen = dv.getUint16(p + 28, true);
    entries.push({
      name: decoder.decode(buf.subarray(p + 46, p + 46 + nameLen)),
      method: dv.getUint16(p + 10, true),
      compSize: dv.getUint32(p + 20, true),
      size: dv.getUint32(p + 24, true),
      localOffset: dv.getUint32(p + 42, true) + delta,
    });
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntry(buf: Uint8Array, e: ZipEntry): Promise<Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const lh = e.localOffset;
  if (dv.getUint32(lh, true) !== 0x04034b50) throw new GameDataError('The archive is damaged.');
  const start = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
  const raw = buf.subarray(start, start + e.compSize);
  if (e.method === 0) return raw.slice();
  if (e.method === 8) return inflateRaw(raw);
  throw new GameDataError(`Unsupported compression in the archive (method ${e.method}).`);
}

/** The wanted files of a zip archive; archives that contain the game's installer (OMF21.EXE) are searched too. */
async function extractArchive(buf: Uint8Array, depth = 0): Promise<Map<string, Uint8Array>> {
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
      const inner = await extractArchive(await readZipEntry(buf, e), depth + 1);
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
