// The installed mods: their packages, kept in the game's database (platform/db.ts), each on or off. The game loads the
// ones that are on when it starts (mods/registry.ts); OMF Studio installs the mods it builds here too (it shares the
// game's storage).
import { done, openDb, result } from '../platform/db';
import { APP_VERSION } from '../platform/versionLabel';
import { readModPackage, type ModPackage } from './package';

export interface InstalledMod {
  /** The mod's id (mod.json). */
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  /** Loaded when the game starts. */
  enabled: boolean;
  /** The package. */
  bytes: Uint8Array;
  /** When it was installed (ms since 1970). */
  installed: number;
}

const STORE = 'mods';

/**
 * The record OMF Studio puts the project it is testing in: a game page opened with ?modtest plays it (over an
 * installed mod with the same id); it is not an installed mod (the list leaves it out).
 */
export const TEST_MOD_ID = '~studio-test';

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, mode);
    const out = await fn(tx.objectStore(STORE));
    await done(tx);
    return out;
  } finally {
    db.close();
  }
}

/** Every installed mod, by name. */
export async function listMods(): Promise<InstalledMod[]> {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const all = await withStore('readonly', (s) => result(s.getAll() as IDBRequest<InstalledMod[]>));
    return all.filter((m) => m.id !== TEST_MOD_ID).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

/**
 * Installs a package (checked first: throws ModError when it cannot be played). A mod with the same id is replaced
 * (an update), keeping whether it was on; a new one is on.
 */
export async function installMod(bytes: Uint8Array): Promise<ModPackage> {
  const pkg = await readModPackage(bytes, APP_VERSION);
  const m = pkg.manifest;
  await withStore('readwrite', async (s) => {
    const old = (await result(s.get(m.id) as IDBRequest<InstalledMod | undefined>)) ?? null;
    const rec: InstalledMod = {
      id: m.id,
      name: m.name,
      version: m.version,
      author: m.author,
      description: m.description,
      enabled: old ? old.enabled : true,
      bytes,
      installed: Date.now(),
    };
    s.put(rec);
  });
  return pkg;
}

export async function setModEnabled(id: string, enabled: boolean): Promise<void> {
  await withStore('readwrite', async (s) => {
    const rec = await result(s.get(id) as IDBRequest<InstalledMod | undefined>);
    if (rec) s.put({ ...rec, enabled });
  });
}

export async function removeMod(id: string): Promise<void> {
  await withStore('readwrite', (s) => {
    s.delete(id);
  });
}

/** Puts a package to test in the game (OMF Studio's test fights); null clears it. Not checked here: the game reads it. */
export async function setTestMod(bytes: Uint8Array | null): Promise<void> {
  await withStore('readwrite', (s) => {
    if (bytes) {
      const rec: InstalledMod = { id: TEST_MOD_ID, name: 'Test', version: '', author: '', description: '', enabled: true, bytes, installed: Date.now() };
      s.put(rec);
    } else {
      s.delete(TEST_MOD_ID);
    }
  });
}

/** The package being tested, or null. */
export async function testMod(): Promise<Uint8Array | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const rec = await withStore('readonly', (s) => result(s.get(TEST_MOD_ID) as IDBRequest<InstalledMod | undefined>));
    return rec?.bytes ?? null;
  } catch {
    return null;
  }
}
