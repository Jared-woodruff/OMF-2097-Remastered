// Tournament save game manager (port of the reference resources/sgmanager.c).
//
// There is no file system in the web build: save games live in a `SaveStorage`, by default the browser's
// localStorage (base64 CHR bytes under "omf2097.save.<FILE NAME>"). A desktop build can install its own storage
// (e.g. a directory of .CHR files) with `setSaveStorage`.
import { chrLoad, chrSave, type ChrFile } from '../game/tournament/chr';
import { saveSettings, settings } from '../game/settings';
import { dossifyFilename, pathSetExt, pathStem } from '../util/path';

/** A flat directory of save files (the reference's save directory). Names are file names like "JOHN_DOE.CHR". */
export interface SaveStorage {
  /** All stored file names. */
  list(): string[];
  read(name: string): Uint8Array | null;
  /** Returns false when the data could not be stored. */
  write(name: string, data: Uint8Array): boolean;
  /** Returns false when there was nothing to remove. */
  remove(name: string): boolean;
}

export function bytesToBase64(data: Uint8Array): string {
  let s = '';
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Save files in localStorage: "<prefix><name>" = base64 data, plus an index of the names. */
export class LocalStorageSaveStorage implements SaveStorage {
  constructor(readonly prefix = 'omf2097.save.') {}

  private get store(): Storage | null {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  }

  private indexKey(): string {
    return `${this.prefix}index`;
  }

  private readIndex(): string[] {
    try {
      const raw = this.store?.getItem(this.indexKey());
      const v = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(v) ? v.filter((n): n is string => typeof n === 'string') : [];
    } catch {
      return [];
    }
  }

  private writeIndex(names: string[]): void {
    try {
      this.store?.setItem(this.indexKey(), JSON.stringify(names));
    } catch {
      /* storage full or unavailable */
    }
  }

  list(): string[] {
    const st = this.store;
    if (!st) return [];
    const names = new Set(this.readIndex());
    // Also pick up entries the index does not know about (when the storage can be enumerated).
    if (typeof st.key === 'function' && typeof st.length === 'number') {
      for (let i = 0; i < st.length; i++) {
        const k = st.key(i);
        if (k && k.startsWith(this.prefix) && k !== this.indexKey()) names.add(k.slice(this.prefix.length));
      }
    }
    return [...names].filter((n) => st.getItem(this.prefix + n) !== null).sort();
  }

  read(name: string): Uint8Array | null {
    try {
      const raw = this.store?.getItem(this.prefix + name);
      return raw == null ? null : base64ToBytes(raw);
    } catch {
      return null;
    }
  }

  write(name: string, data: Uint8Array): boolean {
    const st = this.store;
    if (!st) return false;
    try {
      st.setItem(this.prefix + name, bytesToBase64(data));
    } catch {
      return false;
    }
    const index = this.readIndex();
    if (!index.includes(name)) {
      index.push(name);
      this.writeIndex(index);
    }
    return true;
  }

  remove(name: string): boolean {
    const st = this.store;
    if (!st) return false;
    const existed = st.getItem(this.prefix + name) !== null;
    try {
      st.removeItem(this.prefix + name);
    } catch {
      return false;
    }
    const index = this.readIndex();
    if (index.includes(name)) this.writeIndex(index.filter((n) => n !== name));
    return existed;
  }
}

/** In-memory storage (tests, or when nothing should persist). */
export class MemorySaveStorage implements SaveStorage {
  files = new Map<string, Uint8Array>();
  list(): string[] {
    return [...this.files.keys()].sort();
  }
  read(name: string): Uint8Array | null {
    const d = this.files.get(name);
    return d ? d.slice() : null;
  }
  write(name: string, data: Uint8Array): boolean {
    this.files.set(name, data.slice());
    return true;
  }
  remove(name: string): boolean {
    return this.files.delete(name);
  }
}

let storage: SaveStorage = new LocalStorageSaveStorage();

export function setSaveStorage(s: SaveStorage): void {
  storage = s;
}

export function getSaveStorage(): SaveStorage {
  return storage;
}

/** Save file name of a pilot: path_append + path_set_ext(".CHR") + path_dossify_filename. */
export function sgFileName(pilotName: string): string {
  return dossifyFilename(pathSetExt(pilotName, '.CHR'));
}

/** scan_save_directory(&list, "*.CHR") */
function scanSaves(): string[] {
  return storage.list().filter((n) => n.endsWith('.CHR'));
}

/** sg_count(): number of saved games. */
export function sgCount(): number {
  return scanSaves().length;
}

/** sg_load(): loads one save file; null (and an error log) when it is missing or broken. */
export function sgLoad(fileName: string): ChrFile | null {
  const data = storage.read(fileName);
  if (!data) {
    console.error(`Loading savegame ${fileName} failed: file not found`);
    return null;
  }
  try {
    return chrLoad(data);
  } catch (e) {
    console.error(`Loading savegame ${fileName} failed:`, e);
    return null;
  }
}

/** sg_load_all(): every save game that loads. */
export function sgLoadAll(): ChrFile[] {
  const out: ChrFile[] = [];
  for (const name of scanSaves()) {
    const chr = sgLoad(name);
    if (chr) out.push(chr);
    else console.warn(`Failed to load save ${name}`);
  }
  return out;
}

/** sg_load_pilot(): the save game of a pilot (by name or file stem). */
export function sgLoadPilot(pilotName: string): ChrFile | null {
  return sgLoad(sgFileName(pilotName));
}

/** sg_save(): saves the character and remembers it as the last played one (settings tournament.last_name). */
export function sgSave(chr: ChrFile): boolean {
  const name = sgFileName(chr.pilot.name);
  let ok = false;
  try {
    ok = storage.write(name, chrSave(chr));
  } catch (e) {
    console.error(`Saving pilot ${chr.pilot.name} to ${name} failed:`, e);
    ok = false;
  }
  if (!ok) {
    console.error(`Saving pilot ${chr.pilot.name} to ${name} failed`);
    return false;
  }
  settings().tournament.lastName = pathStem(name);
  saveSettings();
  return true;
}

/** sg_delete(): removes a pilot's save game. */
export function sgDelete(pilotName: string): boolean {
  const name = sgFileName(pilotName);
  const ok = storage.remove(name);
  if (!ok) console.error(`Failed to delete ${name}`);
  return ok;
}
