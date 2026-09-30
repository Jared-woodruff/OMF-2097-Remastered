// Headless test harness: runs the game logic in Node (vitest) with the original data files, no browser needed.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { provideFile } from '../resources/files';
import { EXTRAS_FILE, EXTRAS_NUMBERS } from '../mods/extras';
import { readModPackage, type ModPackage } from '../mods/package';
import { registerModPackage } from '../mods/registry';
import { loadLanguage } from '../resources/resources';
import { PILOT_INFO, SceneId } from '../game/constants';
import { GameState } from '../game/gameState';
import { setPilotColors } from '../game/pilotColors';
import { drawList } from '../video/draw';
import { vga } from '../video/vga';
import { STATIC_TICKS } from '../game/constants';
import { langGet } from '../resources/resources';
import '../game/scenes/index';
import { registerPlaceholders } from '../game/scenes/placeholder';
import { afterAll, expect } from 'vitest';
import { Text } from '../game/gui/text';
import { NATIVE_H, NATIVE_W } from '../video/draw';

// Text audit (TEXT_AUDIT=<file>): records texts that are cut off (lines that do not fit their box are dropped) or
// drawn outside the screen while the scene tests run, and appends them to the file.
if (process.env.TEXT_AUDIT) {
  const found = new Map<string, string>();
  const draw = Text.prototype.draw;
  Text.prototype.draw = function (this: Text, x: number, y: number, opacity = 255) {
    draw.call(this, x, y, opacity);
    if (!this.str.trim() || found.has(this.str)) return;
    const full = new Text(this.font, this.w, 0xffff, this.str).setHAlign(this.halign).setVAlign(this.valign)
      .setMargin(this.margin).setLineSpacing(this.lineSpacing).setLetterSpacing(this.letterSpacing).setWordWrap(this.wordWrap)
      .setDirection(this.direction);
    full.layout();
    const count = (t: Text) => (t as unknown as { items: unknown[] }).items.length;
    const problems: string[] = [];
    if (count(this) < count(full)) problems.push(`cut off (box ${this.w}x${this.h}, needs ${full.height()} px)`);
    const w = this.width(), h = this.height();
    if (x < -1 || y < -1 || x + w > NATIVE_W + 1 || y + h > NATIVE_H + 1) problems.push(`outside the screen at ${x},${y} size ${w}x${h}`);
    if (problems.length) found.set(this.str, problems.join('; '));
  };
  afterAll(() => {
    if (found.size === 0) return;
    const lines = [...found].map(([str, p]) => JSON.stringify({ file: expect.getState?.().testPath ?? '', text: str, problem: p }));
    fs.appendFileSync(process.env.TEXT_AUDIT!, lines.join('\n') + '\n');
  });
}

export const GAMEDATA_DIR = path.resolve(__dirname, '../../public/gamedata');
/** The mods that come with the game (public/mods: the remaster's new robots and arenas). */
export const MODS_DIR = path.resolve(__dirname, '../../public/mods');
export const hasGameData = fs.existsSync(path.join(GAMEDATA_DIR, 'FIGHTR0.AF'));
export const hasExtras = fs.existsSync(path.join(MODS_DIR, EXTRAS_FILE));

let extras: Promise<ModPackage> | null = null;

/** The new robots and arenas' mod package (public/mods). */
export function extrasPackage(): Promise<ModPackage> {
  extras ??= readModPackage(new Uint8Array(fs.readFileSync(path.join(MODS_DIR, EXTRAS_FILE))));
  return extras;
}

let extrasFiles: Map<string, Buffer> | null = null;

/**
 * A file of the new robots and arenas' mod by the name the engine loads it by (FIGHTR11.AF, ARENA5.BK, ARENA5.WID), read
 * from its package at once (the development tools that are not asynchronous), or null.
 */
export function extrasFileSync(name: string): Uint8Array | null {
  if (!extrasFiles) {
    // (a zip's central directory: every file's place, stored or deflated)
    const buf = fs.readFileSync(path.join(MODS_DIR, EXTRAS_FILE));
    let end = buf.length - 22;
    while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
    extrasFiles = new Map();
    let p = buf.readUInt32LE(end + 16);
    for (let i = buf.readUInt16LE(end + 10); i > 0; i--) {
      const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28);
      const local = buf.readUInt32LE(p + 42);
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      extrasFiles.set(buf.toString('utf8', p + 46, p + 46 + nameLen), method === 0 ? data : zlib.inflateRawSync(data));
      p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    }
  }
  const up = name.toUpperCase();
  const robot = /^FIGHTR(\d+)\.AF$/.exec(up), arena = /^ARENA(\d+)\.(BK|WID)$/.exec(up);
  const folder = (kind: 'robot' | 'arena', n: number) => Object.entries(EXTRAS_NUMBERS[kind]).find(([, v]) => v === n)?.[0];
  const file = robot ? `robots/${folder('robot', Number(robot[1]))}/fighter.af`
    : arena ? `arenas/${folder('arena', Number(arena[1]))}/arena.${arena[2].toLowerCase()}` : null;
  const data = file && extrasFiles.get(file);
  return data ? new Uint8Array(data) : null;
}

let served = false;

/** Answers fetch('mods/...') from public/mods, like the web server does (the mods that come with the game). */
export function serveBundledMods(): void {
  if (served) return;
  served = true;
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('mods/')) return real(input, init);
    // (a package is asked for by its fingerprint: file?sig)
    const file = path.join(MODS_DIR, url.slice('mods/'.length).replace(/\?.*$/, ''));
    return fs.existsSync(file) ? new Response(new Uint8Array(fs.readFileSync(file))) : new Response(null, { status: 404 });
  }) as typeof fetch;
}

/** Plays the new robots and arenas: their mod registered as the game loads it when it is on (HARs 11-14, arenas 5-8). */
export async function loadExtras(): Promise<void> {
  loadGameData();
  await registerModPackage(await extrasPackage());
}

let loaded = false;

/** Loads every original data file into the in-memory file cache. */
export function loadGameData(): void {
  if (loaded) return;
  for (const f of fs.readdirSync(GAMEDATA_DIR)) {
    if (f === 'manifest.json') continue;
    provideFile(f, new Uint8Array(fs.readFileSync(path.join(GAMEDATA_DIR, f))));
  }
  loadLanguage();
  loaded = true;
}

/** Minimal localStorage shim for settings persistence in Node. */
export function installBrowserShims(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g.localStorage) {
    const store = new Map<string, string>();
    g.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    };
  }
  if (!g.navigator) g.navigator = {} as Navigator;
}

/**
 * Advances a game state by `ms` milliseconds of wall time using the same static/dynamic tick
 * scheduling as the real engine (see src/engine.ts), and exercises rendering into the draw list.
 */
export class HeadlessRunner {
  private staticWait = 0;
  private dynamicWait = 0;
  constructor(public gs: GameState) {}

  advance(ms: number): void {
    const gs = this.gs;
    let remaining = ms;
    while (remaining > 0) {
      const slice = Math.min(remaining, 50);
      remaining -= slice;
      this.staticWait += slice;
      this.dynamicWait += slice;
      let hasStatic: boolean, hasDynamic: boolean;
      let limit = 10;
      do {
        const dynMs = gs.msPerDyntick();
        hasStatic = this.staticWait > STATIC_TICKS;
        if (hasStatic) {
          gs.staticTick();
          this.staticWait -= STATIC_TICKS;
        }
        hasDynamic = this.dynamicWait > dynMs;
        if (hasDynamic) {
          gs.dynamicTick();
          this.dynamicWait -= dynMs;
        }
        if (hasStatic || hasDynamic) {
          gs.paletteTransform();
          vga.render();
        }
      } while (limit-- && (hasStatic || hasDynamic));
      drawList.begin();
      gs.render();
    }
  }
}

/** Creates a game state and configures both players as story-mode pilots. */
export function createGame(start: SceneId, pilots: [number, number] = [0, 1], hars: [number, number] = [0, 5]): GameState {
  installBrowserShims();
  loadGameData();
  registerPlaceholders();
  const gs = new GameState(start);
  for (let i = 0; i < 2; i++) {
    const p = gs.getPlayer(i);
    const info = PILOT_INFO[pilots[i]];
    p.pilot.pilotId = pilots[i];
    p.pilot.harId = hars[i];
    p.pilot.power = info.power;
    p.pilot.agility = info.agility;
    p.pilot.endurance = info.endurance;
    p.pilot.name = langGet(20 + pilots[i]);
    setPilotColors(p.pilot, info.color1, info.color2, info.color3);
  }
  return gs;
}
