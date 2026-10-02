// OMF Studio's projects, kept in the game's database ('studio' store) as the packages they build, so they are there
// the next time Studio opens (in the desktop app, the game and Studio share it).
import { done, openDb, result } from '../platform/db';
import { buildProject, openPackage, type Project } from './project';

export interface StoredProject {
  key: string;
  name: string;
  /** Last saved (ms since 1970). */
  updated: number;
  bytes: Uint8Array;
}

const STORE = 'studio';

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => Promise<T> | T): Promise<T> {
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

/** The stored projects, the most recent first. */
export async function listProjects(): Promise<StoredProject[]> {
  try {
    const all = await withStore('readonly', (s) => result(s.getAll() as IDBRequest<StoredProject[]>));
    return all.sort((a, b) => b.updated - a.updated);
  } catch {
    return [];
  }
}

export async function saveProject(p: Project): Promise<void> {
  const bytes = await buildProject(p);
  const rec: StoredProject = { key: p.key, name: p.manifest.name, updated: Date.now(), bytes };
  await withStore('readwrite', (s) => {
    s.put(rec);
  });
}

export async function loadProject(key: string): Promise<Project | null> {
  const rec = await withStore('readonly', (s) => result(s.get(key) as IDBRequest<StoredProject | undefined>));
  return rec ? openPackage(rec.bytes, rec.key) : null;
}

export async function deleteProject(key: string): Promise<void> {
  await withStore('readwrite', (s) => {
    s.delete(key);
  });
}
