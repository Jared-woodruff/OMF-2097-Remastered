// The game's IndexedDB database (web and desktop): imported game data ('gamedata', see gameData.ts), the player's
// own music ('music', see audio/customMusic.ts), saved fights ('replays', see game/replay/store.ts), installed mods
// ('mods', see mods/store.ts; OMF Studio installs into it too) and OMF Studio's projects ('studio', see
// studio/storage.ts).

const DB_NAME = 'omf2097r';
const DB_VERSION = 5;

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('gamedata')) db.createObjectStore('gamedata');
      if (!db.objectStoreNames.contains('music')) db.createObjectStore('music', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('replays')) db.createObjectStore('replays', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('mods')) db.createObjectStore('mods', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('studio')) db.createObjectStore('studio', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Resolves when a transaction completes. */
export function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** The result of a request. */
export function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
