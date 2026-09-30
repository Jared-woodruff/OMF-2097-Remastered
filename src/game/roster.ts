// Which robots, arenas and pilots can be picked: the original eleven robots, five arenas and eleven pilots, the
// remaster's four robots (HARs 11-14) and four arenas (5-8) when they are turned on in the settings and their files are
// there, and the robots, arenas and pilots of the mods that are on (src/mods).
import { GEN_ARENAS } from '../gen/scene/arenas';
import { modArena, modArenas, modPilot, modPilots, modRobot, modRobots } from '../mods/registry';
import { MOD_AMBIENCE } from '../mods/types';
import { hasGenerated } from '../resources/generated';
import { hasFighter, langGet } from '../resources/resources';
import { globalRandom } from '../util/random';
import { ARENA_COUNT, HarId, ORIGINAL_ARENAS, ORIGINAL_HAR_TYPES, PILOT_INFO, PILOT_SEX_FEMALE, PILOT_SEX_MALE, type PilotInfo } from './constants';
import { settings } from './settings';
import { workshopReady } from './workshop/registry';

export const EXTRA_HAR_IDS = [HarId.GLACIER, HarId.TEMPEST, HarId.HELIX, HarId.SPECTRE];

/** True for the remaster's robots (and the workshop's and mods'). */
export function isExtraHar(harId: number): boolean {
  return harId >= ORIGINAL_HAR_TYPES;
}

/** Whether the new robots can be picked (setting on and fighter files present). */
export function extraRobotsEnabled(): boolean {
  return settings().gameplay.extraRobots && EXTRA_HAR_IDS.every(hasFighter);
}

/** The mods' robots that can be picked. */
export function modHarIds(): number[] {
  return modRobots().map((r) => r.harId).filter(hasFighter);
}

/** The robots after the original ten on the robot select screen: the remaster's (when on), then the mods'. */
export function extraHarIds(): number[] {
  return [...(extraRobotsEnabled() ? EXTRA_HAR_IDS : []), ...modHarIds()];
}

/** The robots a random pick chooses from: the ten originals (NOVA only when asked), the new ones if on, the mods'. */
export function randomHarPool(includeNova = false): number[] {
  const ids = Array.from({ length: includeNova ? ORIGINAL_HAR_TYPES : ORIGINAL_HAR_TYPES - 1 }, (_, i) => i);
  ids.push(...extraHarIds());
  return ids;
}

/** A HAR id limited to what can be picked (the new robots fall back to JAGUAR when turned off; the workshop's robots are there once built; a mod's while it is on). */
export function allowedHar(harId: number): number {
  if (harId < 0) return 0;
  if (harId < ORIGINAL_HAR_TYPES) return harId;
  if (workshopReady(harId)) return harId;
  if (modRobot(harId) && hasFighter(harId)) return harId;
  return extraRobotsEnabled() && EXTRA_HAR_IDS.includes(harId) ? harId : 0;
}

/** Whether the new arenas are in the rotation (setting on and scene files present). */
export function extraArenasEnabled(): boolean {
  return settings().gameplay.extraArenas && GEN_ARENAS.every((a) => hasGenerated(a.file));
}

/** The arenas to choose from, in order: the originals, the remaster's (when on), the mods'. */
export function arenaList(): number[] {
  const list = Array.from({ length: extraArenasEnabled() ? ARENA_COUNT : ORIGINAL_ARENAS }, (_, i) => i);
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
  return GEN_ARENAS.find((a) => a.index === arena)?.name ?? modArena(arena)?.info.name ?? '';
}

/**
 * An arena's name in the news report's sentences ("traded blows in the ~5"): the original game's names without their
 * article ("The Desert"), the new arenas' names in the same style.
 */
export function arenaNewsName(arena: number): string {
  if (arena < ORIGINAL_ARENAS) return arenaName(arena).replace(/^the /i, '');
  return GEN_ARENAS.find((a) => a.index === arena)?.newsName ?? modArena(arena)?.info.newsName ?? arenaNewsName(0);
}

/** Description of an arena for the VS screen. */
export function arenaDescription(arena: number): string {
  if (arena < ORIGINAL_ARENAS) return langGet(66 + arena).replace(/\n$/, '');
  return GEN_ARENAS.find((a) => a.index === arena)?.description ?? modArena(arena)?.info.description ?? '';
}

/**
 * The original arena whose built-in behavior an arena has (the Power Plant's walls, the Fire Pit's hazards...): the
 * game's own arenas their own, a mod arena the one it names (-1: none).
 */
export function arenaBase(arena: number): number {
  if (arena < ARENA_COUNT) return arena;
  return modArena(arena)?.info.base ?? -1;
}

/**
 * Whose remastered ambience and acoustics an arena has (fx/arenas.ts, the audio's rooms): the game's own arenas their
 * own, a mod arena the one it names (-1: none).
 */
export function arenaLook(arena: number): number {
  if (arena < ARENA_COUNT) return arena;
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
