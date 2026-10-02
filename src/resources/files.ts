// Loads original game data files (served from `gamedata/` next to the app).

const cache = new Map<string, Uint8Array>();
const pending = new Map<string, Promise<Uint8Array>>();
let baseUrl = 'gamedata/';

export function setDataBaseUrl(url: string): void {
  baseUrl = url.endsWith('/') ? url : url + '/';
}

/** Registers file contents directly (e.g. when the user supplies the game archive in the browser). */
export function provideFile(name: string, data: Uint8Array): void {
  cache.set(name.toUpperCase(), data);
}

export function hasFile(name: string): boolean {
  return cache.has(name.toUpperCase());
}

/** Names (upper case) of every loaded game file, sorted; optionally only those with the given extension (".TRN"). */
export function listFiles(ext?: string): string[] {
  const suffix = ext?.toUpperCase();
  return [...cache.keys()].filter((k) => !suffix || k.endsWith(suffix)).sort();
}

export function getFile(name: string): Uint8Array {
  const d = cache.get(name.toUpperCase());
  if (!d) throw new Error(`Game file not loaded: ${name}`);
  return d;
}

export function loadFile(name: string): Promise<Uint8Array> {
  const key = name.toUpperCase();
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(key);
  if (!p) {
    p = fetch(baseUrl + key).then(async (res) => {
      if (!res.ok) throw new Error(`Failed to load ${key}: HTTP ${res.status}`);
      const data = new Uint8Array(await res.arrayBuffer());
      cache.set(key, data);
      pending.delete(key);
      return data;
    });
    pending.set(key, p);
  }
  return p;
}

/**
 * Preloads the whole data set listed in manifest.json, reporting progress in bytes. Returns false when the server has
 * no game data (the web version then asks the player for it, see platform/gameData.ts).
 */
export async function preloadAll(onProgress?: (loaded: number, total: number) => void): Promise<boolean> {
  let manifest: { files: { name: string; size: number }[] };
  try {
    const res = await fetch(baseUrl + 'manifest.json');
    if (!res.ok) return false;
    // Hosts with a single-page-app fallback answer missing files with index.html.
    manifest = (await res.json()) as typeof manifest;
    if (!Array.isArray(manifest?.files)) return false;
  } catch {
    return false;
  }
  const total = manifest.files.reduce((a, f) => a + f.size, 0);
  let loaded = 0;
  await Promise.all(
    manifest.files.map(async (f) => {
      await loadFile(f.name);
      loaded += f.size;
      onProgress?.(loaded, total);
    }),
  );
  return true;
}
