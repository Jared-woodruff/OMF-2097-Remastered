// Headless test harness: runs the game logic in Node (vitest) with the original data files, no browser needed.
import fs from 'node:fs';
import path from 'node:path';
import { provideFile } from '../resources/files';
import { provideGenerated } from '../resources/generated';
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
export const GENERATED_DIR = path.resolve(__dirname, '../../public/gen');
export const hasGameData = fs.existsSync(path.join(GAMEDATA_DIR, 'FIGHTR0.AF'));

let loaded = false;

/** Loads every original data file into the in-memory file cache, and the remaster's generated files. */
export function loadGameData(): void {
  if (loaded) return;
  for (const f of fs.readdirSync(GAMEDATA_DIR)) {
    if (f === 'manifest.json') continue;
    provideFile(f, new Uint8Array(fs.readFileSync(path.join(GAMEDATA_DIR, f))));
  }
  if (fs.existsSync(GENERATED_DIR)) {
    for (const f of fs.readdirSync(GENERATED_DIR)) provideGenerated(f, new Uint8Array(fs.readFileSync(path.join(GENERATED_DIR, f))));
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
