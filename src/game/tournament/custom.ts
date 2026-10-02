// Custom tournaments (MORE MODES > MY TOURNAMENTS): made from one of the installed tournaments, with a name, fewer opponents
// (spread over the ranks, the champion always among them), their robots as they were or some or all of them on the
// remaster's robots, and more or less prize money. They are joined like the others, from TOURNAMENT PLAY. Their
// descriptions are kept in the browser's storage and shared as .omftrn files.
import type { TournamentFile } from '../../formats/tournament';
import { customTournamentNames, hasFighter, loadTournament, registerTournament } from '../../resources/resources';
import { listFiles } from '../../resources/files';
import { EXTRA_HAR_IDS } from '../roster';

export interface CustomTournamentSpec {
  v: 1;
  /** The title (capitals, digits and spaces, up to 24). */
  name: string;
  /** The tournament it is made from (its file name). */
  base: string;
  /** 0: six opponents, 1: ten, 2: all of them. */
  size: number;
  /** 0: the robots they had, 1: every other one on a new robot, 2: all on the new robots. */
  robots: number;
  /** Prize money: 0 half, 1 as it was, 2 one and a half, 3 double. */
  prize: number;
}

const STORAGE_KEY = 'omf2097r.tournaments';
export const CUSTOM_SLOTS = 6;
export const SIZE_NAMES = ['6 OPPONENTS', '10 OPPONENTS', 'EVERYBODY'];
export const ROBOT_NAMES = ['AS THEY WERE', 'SOME NEW', 'ALL NEW'];
export const PRIZE_NAMES = ['HALF', 'NORMAL', 'ONE AND A HALF', 'DOUBLE'];
const SIZES = [6, 10, Infinity];
const PRIZES = [0.5, 1, 1.5, 2];

export const fileNameOf = (slot: number): string => `CUSTOM${slot + 1}.TRN`;

/** The installed tournaments a custom one can be made from. */
export function baseTournaments(): string[] {
  return listFiles('.TRN').filter((n) => !customTournamentNames().includes(n));
}

export function cleanTitle(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24) || 'CUSTOM TOURNAMENT';
}

export function defaultTournament(): CustomTournamentSpec {
  return { v: 1, name: 'MY TOURNAMENT', base: baseTournaments()[0] ?? 'NORTH_AM.TRN', size: 0, robots: 0, prize: 1 };
}

export function readTournamentSpec(x: unknown): CustomTournamentSpec | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Partial<CustomTournamentSpec>;
  const pick = (v: unknown, n: number, d: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < n ? (v as number) : d);
  const d = defaultTournament();
  return {
    v: 1,
    name: cleanTitle(typeof o.name === 'string' ? o.name : d.name),
    base: typeof o.base === 'string' && /^[A-Z0-9_]{1,8}\.TRN$/i.test(o.base) ? o.base.toUpperCase() : d.base,
    size: pick(o.size, SIZE_NAMES.length, d.size),
    robots: pick(o.robots, ROBOT_NAMES.length, d.robots),
    prize: pick(o.prize, PRIZE_NAMES.length, d.prize),
  };
}

/** The new robots can take part (their files are there). */
export function newRobotsAvailable(): boolean {
  return EXTRA_HAR_IDS.every(hasFighter);
}

/** The tournament a description makes (from its base tournament's data). */
export function buildCustomTournament(spec: CustomTournamentSpec, slot: number, base: TournamentFile): TournamentFile {
  // The ranked opponents: evenly spread from the champion (rank 1) down; unranked (secret) ones stay.
  const ranked = base.enemies.map((p, i) => ({ p, i })).filter((e) => !e.p.secret);
  const want = Math.min(ranked.length, SIZES[spec.size]);
  const keep = new Set<number>();
  for (let k = 0; k < want; k++) keep.add(ranked[Math.round((k * (ranked.length - 1)) / Math.max(1, want - 1))].i);
  const enemies = base.enemies.filter((p, i) => p.secret || keep.has(i)).map((p) => p.clone());
  // Robots: every other one, or all, on the remaster's robots (in turn).
  if (spec.robots > 0 && newRobotsAvailable()) {
    let n = 0;
    enemies.forEach((p, i) => {
      if (p.secret || (spec.robots === 1 && i % 2 === 1)) return;
      p.harId = EXTRA_HAR_IDS[n++ % EXTRA_HAR_IDS.length];
    });
  }
  const prize = PRIZES[spec.prize];
  const baseTitle = base.locales[0]?.title ?? base.filename;
  const robots = spec.robots === 2 ? ' ON THE NEW ROBOTS' : spec.robots === 1 ? ', SOME ON THE NEW ROBOTS' : '';
  const description = `${spec.name}: ${enemies.filter((p) => !p.secret).length} OPPONENTS FROM THE ${baseTitle.toUpperCase()}${robots}. ` +
    `PRIZE MONEY: ${PRIZE_NAMES[spec.prize]}.`;
  return {
    ...base,
    filename: fileNameOf(slot),
    enemyCount: enemies.length,
    winningsMultiplier: base.winningsMultiplier * prize,
    enemies,
    locales: base.locales.map((l) => ({
      ...l, title: spec.name, description, strippedDescription: description, descWidth: 300, descCenter: 160, descVmove: l.descVmove,
    })),
  };
}

let specs: (CustomTournamentSpec | null)[] | null = null;

function load(): (CustomTournamentSpec | null)[] {
  if (!specs) {
    specs = new Array<CustomTournamentSpec | null>(CUSTOM_SLOTS).fill(null);
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      const list = raw ? (JSON.parse(raw) as unknown[]) : [];
      list.slice(0, CUSTOM_SLOTS).forEach((x, i) => (specs![i] = x ? readTournamentSpec(x) : null));
    } catch {
      // unreadable: none
    }
  }
  return specs;
}

export function customTournaments(): readonly (CustomTournamentSpec | null)[] {
  return load();
}

/** Registers a slot's tournament with the game (or removes it); false when its base tournament is not installed. */
function register(slot: number): boolean {
  const spec = load()[slot];
  const name = fileNameOf(slot);
  if (!spec) {
    registerTournament(name, null);
    return true;
  }
  try {
    registerTournament(name, buildCustomTournament(spec, slot, loadTournament(spec.base)));
    return true;
  } catch {
    registerTournament(name, null);
    return false;
  }
}

export function setCustomTournament(slot: number, spec: CustomTournamentSpec | null): boolean {
  load()[slot] = spec;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(load()));
  } catch {
    // kept for this session
  }
  return register(slot);
}

/** Registers every stored custom tournament (at startup, once the game data is loaded). */
export function registerCustomTournaments(): void {
  for (let i = 0; i < CUSTOM_SLOTS; i++) register(i);
}

/** Forgets the stored tournaments (tests). */
export function resetCustomTournaments(): void {
  specs = null;
}
