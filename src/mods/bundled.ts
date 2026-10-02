// The mods that come with the game (mods/index.json next to it: the remaster's new robots and arenas, extras.ts). The
// MODS page lists them with the installed ones; like any mod they are off until the player turns them on (the choice
// is kept in the browser's storage), and their packages are fetched from next to the game when they are loaded. An
// installed mod with the same id (the player's own version of it) takes its place.
import { looksLikeHtml } from '../resources/generated';
import { EXTRAS_MOD_ID } from './extras';

export interface BundledMod {
  /** The package's file name, next to the list. */
  file: string;
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  /** Its robots', arenas' and pilots' names (for the MODS page before the package is fetched). */
  robots: string[];
  arenas: string[];
  pilots: string[];
  /** The package's size. */
  bytes: number;
  /** Its content's fingerprint (a new package has a new one: the address it is fetched at changes with it). */
  sig?: string;
}

const STORAGE_KEY = 'omf2097r.bundledMods';
/** Where the game's settings are kept (settings.ts): read once for the NEW CONTENT choices of older versions. */
const SETTINGS_KEY = 'omf2097r.settings';

let base = 'mods/';
let list: Promise<BundledMod[]> | null = null;

/** Where the list and the packages are (tests: a folder on disk through a fetch shim). */
export function setBundledBase(url: string): void {
  base = url.endsWith('/') ? url : `${url}/`;
  list = null;
}

/** The mods that come with the game (none when the list is not there: a build without them, offline). */
export function bundledMods(): Promise<BundledMod[]> {
  list ??= (async () => {
    try {
      const res = await fetch(`${base}index.json`);
      if (!res.ok) return [];
      const data = new Uint8Array(await res.arrayBuffer());
      // (hosts with a single-page-app fallback answer a missing file with the page)
      if (looksLikeHtml(data)) return [];
      const json = JSON.parse(new TextDecoder().decode(data)) as { mods?: BundledMod[] };
      return (json.mods ?? []).filter((m) => m && typeof m.id === 'string' && typeof m.file === 'string');
    } catch {
      return [];
    }
  })();
  return list;
}

/** A bundled mod's package. Throws when it cannot be fetched. */
export async function fetchBundled(m: BundledMod): Promise<Uint8Array> {
  const res = await fetch(`${base}${m.file}${m.sig ? `?${m.sig}` : ''}`);
  if (!res.ok) throw new Error(`${m.file} is not there (${res.status})`);
  const data = new Uint8Array(await res.arrayBuffer());
  if (looksLikeHtml(data)) throw new Error(`${m.file} is not there`);
  return data;
}

type Choices = Record<string, boolean>;

function choices(): Choices {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Choices) : {};
  } catch {
    return {};
  }
}

/** Whether the player turned a bundled mod on. */
export function bundledEnabled(id: string): boolean {
  return choices()[id] === true;
}

export function setBundledEnabled(id: string, on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...choices(), [id]: on }));
  } catch {
    // storage unavailable: the choice lasts until the page closes
  }
}

/**
 * Before the new robots and arenas were a mod, OPTIONS > NEW CONTENT turned them on (settings gameplay.extraRobots /
 * extraArenas, from settings revision 2: older settings had them off). A player who had either on finds their mod on.
 * Done once: the choice is kept from then on.
 */
export function migrateNewContent(): void {
  try {
    if (typeof localStorage === 'undefined' || EXTRAS_MOD_ID in choices()) return;
    const raw = localStorage.getItem(SETTINGS_KEY);
    const s = raw ? (JSON.parse(raw) as { revision?: number; gameplay?: { extraRobots?: unknown; extraArenas?: unknown } }) : null;
    const on = !!s && (s.revision ?? 0) >= 2 && (s.gameplay?.extraRobots === true || s.gameplay?.extraArenas === true);
    setBundledEnabled(EXTRAS_MOD_ID, on);
  } catch {
    // unreadable settings: the mod stays off
  }
}

/** Forgets the fetched list (tests). */
export function resetBundled(): void {
  list = null;
}
