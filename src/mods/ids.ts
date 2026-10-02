// The numbers mod content plays under. The engine knows robots, arenas and pilots by small numbers, and saves them
// (replays, records, the training setup), so each mod robot, arena and pilot keeps the number it got the first time it
// was loaded: kept in the browser's storage, by "<mod id>/<content id>". The remaster's new robots and arenas (a mod that
// comes with the game, extras.ts) keep the numbers they had when they were part of the game.
import { EXTRAS_MOD_ID, EXTRAS_NUMBERS, reservedNumber } from './extras';

export type ModKind = 'robot' | 'arena' | 'pilot';

/**
 * The numbers each kind gets. Robots: after the originals (0-10), the remaster's (11-14, its mod's) and the workshop's
 * (15-22), up to 63 (the scoreboard's files keep 6 bits). Arenas: after the originals (0-4) and the remaster's (5-8), up
 * to 31 (a replay keeps 5 bits). Pilots: after the originals (0-10), up to 63.
 */
export const MOD_ID_RANGES: Record<ModKind, { first: number; last: number }> = {
  robot: { first: 24, last: 63 },
  arena: { first: 9, last: 31 },
  pilot: { first: 16, last: 63 },
};

const STORAGE_KEY = 'omf2097r.modIds';

type IdMap = Record<ModKind, Record<string, number>>;

let map: IdMap | null = null;

function load(): IdMap {
  if (!map) {
    map = { robot: {}, arena: {}, pilot: {} };
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      const saved = raw ? (JSON.parse(raw) as Partial<IdMap>) : {};
      for (const kind of ['robot', 'arena', 'pilot'] as ModKind[]) {
        const r = MOD_ID_RANGES[kind];
        for (const [key, id] of Object.entries(saved[kind] ?? {})) {
          if (Number.isInteger(id) && id >= r.first && id <= r.last) map[kind][key] = id;
        }
      }
    } catch {
      // unreadable: numbers are given again
    }
  }
  return map;
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(load()));
  } catch {
    // storage unavailable: the numbers last for this session
  }
}

/** The installed mods (their content's numbers stay theirs while they are off). */
let installedMods = new Set<string>();

export function setInstalledMods(ids: Iterable<string>): void {
  installedMods = new Set(ids);
}

/**
 * The number of a piece of content (`key`: "<mod id>/<content id>"): the one it had, else a free one. `taken`: the
 * numbers of content loaded now (a number of content that is not installed any more is given again only when no
 * other is free; an installed mod's, on or off, never). Null when every number is taken.
 */
export function modContentId(kind: ModKind, key: string, taken: Set<number>): number | null {
  const fixed = reservedNumber(kind, key);
  if (fixed !== undefined) return fixed;
  const m = load()[kind];
  const had = m[key];
  if (had !== undefined && !taken.has(had)) return had;
  const r = MOD_ID_RANGES[kind];
  const assigned = new Set(Object.values(m));
  let id = -1;
  for (let i = r.first; i <= r.last && id < 0; i++) if (!assigned.has(i) && !taken.has(i)) id = i;
  // All given out once: reuse the number of content no installed mod has any more (the longest unused first would
  // need dates; the lowest is good enough).
  for (let i = r.first; i <= r.last && id < 0; i++) {
    if (taken.has(i)) continue;
    const owners = Object.entries(m).filter(([, v]) => v === i).map(([k]) => k);
    if (owners.some((k) => installedMods.has(k.slice(0, k.indexOf('/'))))) continue;
    for (const k of owners) delete m[k];
    id = i;
  }
  if (id < 0) return null;
  m[key] = id;
  save();
  return id;
}

/** The content a number was last given to (to explain a replay whose robot is missing), or null. */
export function modContentKey(kind: ModKind, id: number): string | null {
  if (kind !== 'pilot') {
    for (const [folder, n] of Object.entries(EXTRAS_NUMBERS[kind])) if (n === id) return `${EXTRAS_MOD_ID}/${folder}`;
  }
  for (const [k, v] of Object.entries(load()[kind])) if (v === id) return k;
  return null;
}

/** Forgets the numbers (tests). */
export function resetModIds(): void {
  map = null;
}
