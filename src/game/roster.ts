// Which robots, arenas and pilots can be picked: the original eleven robots, five arenas and eleven pilots, and the
// robots, arenas and pilots of the mods that are on (src/mods): the mod of the remaster's new robots and arenas (HARs
// 11-14, arenas 5-8, see mods/extras.ts) first, then the installed ones.
import { genRobot } from '../gen/roster';
import { modArena, modArenas, modPilot, modPilots, modRobot, modRobots } from '../mods/registry';
import { MOD_AMBIENCE } from '../mods/types';
import { hasGenerated } from '../resources/generated';
import { hasFighter, langGet } from '../resources/resources';
import { globalRandom } from '../util/random';
import { HarId, ORIGINAL_ARENAS, ORIGINAL_HAR_TYPES, PILOT_INFO, PILOT_SEX_FEMALE, PILOT_SEX_MALE, type PilotInfo } from './constants';
import { workshopReady } from './workshop/registry';

/** The remaster's new robots (their mod's): Plug trades them, custom tournaments put opponents on them. */
export const EXTRA_HAR_IDS = [HarId.GLACIER, HarId.TEMPEST, HarId.HELIX, HarId.SPECTRE];

/** Whether the remaster's new robots are in the game (their mod is on). */
export function extraRobotsEnabled(): boolean {
  return EXTRA_HAR_IDS.every(hasFighter);
}

/**
 * A robot's special moves' names, by move id: its robot.json's (a mod's), else those of the robot its moves come from
 * (built from the generator's parts: the workshop's).
 */
export function specialNames(harId: number): Record<number, string> {
  const own = modRobot(harId)?.info.moves;
  if (own && Object.keys(own).length) return own;
  return genRobot(harId)?.specialNames ?? own ?? {};
}

/** The mods' robots that can be picked. */
export function modHarIds(): number[] {
  return modRobots().map((r) => r.harId).filter(hasFighter);
}

/** The robots after the original ten on the robot select screen: the mods' (the remaster's new robots first). */
export function extraHarIds(): number[] {
  return modHarIds();
}

/** The robots a random pick chooses from: the ten originals (NOVA only when asked) and the mods'. */
export function randomHarPool(includeNova = false): number[] {
  const ids = Array.from({ length: includeNova ? ORIGINAL_HAR_TYPES : ORIGINAL_HAR_TYPES - 1 }, (_, i) => i);
  ids.push(...extraHarIds());
  return ids;
}

/** A HAR id limited to what can be picked (JAGUAR for one that is not there: a mod's that is off; the workshop's robots are there once built). */
export function allowedHar(harId: number): number {
  if (harId < 0) return 0;
  if (harId < ORIGINAL_HAR_TYPES) return harId;
  if (workshopReady(harId)) return harId;
  return modRobot(harId) && hasFighter(harId) ? harId : 0;
}

/** The arenas to choose from, in order: the originals, then the mods' (the remaster's new arenas first). */
export function arenaList(): number[] {
  const list = Array.from({ length: ORIGINAL_ARENAS }, (_, i) => i);
  for (const a of modArenas()) if (hasGenerated(`ARENA${a.index}.BK`)) list.push(a.index);
  return list;
}

/** Whether an arena's files are there (a mod arena's while its mod is on; replays may name one that is not). */
export function arenaAvailable(arena: number): boolean {
  return arena >= 0 && (arena < ORIGINAL_ARENAS || hasGenerated(`ARENA${arena}.BK`));
}

/** A random arena of the rotation (rand_arena()). */
export function randomArena(): number {
  const list = arenaList();
  return list[globalRandom.int(list.length)];
}

/** The arena `step` places after `arena` in the rotation (wrapping around). */
export function nextArena(arena: number, step = 1): number {
  const list = arenaList();
  const i = list.indexOf(arena);
  return list[(((i < 0 ? 0 : i) + step) % list.length + list.length) % list.length];
}

/** An arena number limited to what can be picked. */
export function allowedArena(arena: number): number {
  return arenaList().includes(arena) ? arena : 0;
}

/** Name of an arena (the original game's text for its own five). */
export function arenaName(arena: number): string {
  if (arena < ORIGINAL_ARENAS) return langGet(56 + arena).replace(/\n$/, '');
  return modArena(arena)?.info.name ?? '';
}

/**
 * An arena's name in the news report's sentences ("traded blows in the ~5"): the original game's names without their
 * article ("The Desert"), the new arenas' names in the same style.
 */
export function arenaNewsName(arena: number): string {
  if (arena < ORIGINAL_ARENAS) return arenaName(arena).replace(/^the /i, '');
  return modArena(arena)?.info.newsName ?? arenaNewsName(0);
}

/** Description of an arena for the VS screen. */
export function arenaDescription(arena: number): string {
  if (arena < ORIGINAL_ARENAS) return langGet(66 + arena).replace(/\n$/, '');
  return modArena(arena)?.info.description ?? '';
}

/**
 * The original arena whose built-in behavior an arena has (the Power Plant's walls, the Fire Pit's hazards...): the
 * original arenas their own, a mod arena the one it names (-1: none).
 */
export function arenaBase(arena: number): number {
  if (arena < ORIGINAL_ARENAS) return arena;
  return modArena(arena)?.info.base ?? -1;
}

/**
 * Whose remastered ambience and acoustics an arena has (fx/arenas.ts, the audio's rooms): the original arenas their
 * own, a mod arena the one it names (-1: none; 5-8: the remaster's new arenas', see MOD_AMBIENCE).
 */
export function arenaLook(arena: number): number {
  if (arena < ORIGINAL_ARENAS) return arena;
  const a = modArena(arena);
  return a ? MOD_AMBIENCE.indexOf(a.info.ambience) - 1 : -1;
}

/** The song of a mod arena (null: the game's own arenas' come from their scene files). */
export function arenaMusic(arena: number): string | null {
  return modArena(arena)?.info.music ?? null;
}

// ---- pilots ------------------------------------------------------------------------------------------------------

/** The mods' pilots (the pilot select screen lists them after the original ten). */
export function modPilotIds(): number[] {
  return modPilots().map((p) => p.pilotId);
}

/** Whether a pilot id is one that can be played: an original pilot's, or a mod pilot's while its mod is on. */
export function pilotExists(pilotId: number): boolean {
  return (pilotId >= 0 && pilotId < PILOT_INFO.length) || !!modPilot(pilotId);
}

/** A pilot's stats, colors and sex: the story pilots' table, a mod pilot's pilot.json. */
export function pilotInfo(pilotId: number): PilotInfo {
  const m = modPilot(pilotId)?.info;
  if (m) {
    return {
      power: m.power, agility: m.agility, endurance: m.endurance, color1: m.colors[0], color2: m.colors[1], color3: m.colors[2],
      sex: m.sex === 'female' ? PILOT_SEX_FEMALE : PILOT_SEX_MALE,
    };
  }
  return PILOT_INFO[pilotId] ?? PILOT_INFO[0];
}

/** A pilot's name as the game's texts write it ("Crystal"). */
export function pilotNameOf(pilotId: number): string {
  return modPilot(pilotId)?.info.name ?? langGet(20 + pilotId);
}

/** The pilot select screen's text about a pilot. */
export function pilotBio(pilotId: number): string {
  return modPilot(pilotId)?.info.bio ?? langGet(135 + pilotId);
}

/**
 * The original pilot a pilot plays like: its own id for the originals, the fighting style a mod pilot names (the
 * computer fights like them; the originals taunt a mod pilot like them).
 */
export function pilotStyle(pilotId: number): number {
  return modPilot(pilotId)?.info.personality ?? pilotId;
}

/** A pilot's bit in the one-player game's record of beaten pilots (spWins): the original pilots' own; mod pilots have none. */
export function pilotWinBit(pilotId: number): number {
  return pilotId >= 0 && pilotId < PILOT_INFO.length ? 2 << pilotId : 0;
}
