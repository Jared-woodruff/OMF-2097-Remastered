// Which robots and arenas can be picked: the original eleven robots and five arenas, plus the remaster's four robots
// (HARs 11-14) and four arenas (5-8) when they are turned on in the settings and their files are there.
import { GEN_ARENAS } from '../gen/scene/arenas';
import { hasGenerated } from '../resources/generated';
import { hasFighter, langGet } from '../resources/resources';
import { ARENA_COUNT, HarId, ORIGINAL_ARENAS, ORIGINAL_HAR_TYPES } from './constants';
import { settings } from './settings';

export const EXTRA_HAR_IDS = [HarId.GLACIER, HarId.TEMPEST, HarId.HELIX, HarId.SPECTRE];

/** True for the remaster's robots. */
export function isExtraHar(harId: number): boolean {
  return harId >= ORIGINAL_HAR_TYPES;
}

/** Whether the new robots can be picked (setting on and fighter files present). */
export function extraRobotsEnabled(): boolean {
  return settings().gameplay.extraRobots && EXTRA_HAR_IDS.every(hasFighter);
}

/** The robots a random pick chooses from: the ten originals (NOVA only when asked) and the new ones if on. */
export function randomHarPool(includeNova = false): number[] {
  const ids = Array.from({ length: includeNova ? ORIGINAL_HAR_TYPES : ORIGINAL_HAR_TYPES - 1 }, (_, i) => i);
  if (extraRobotsEnabled()) ids.push(...EXTRA_HAR_IDS);
  return ids;
}

/** A HAR id limited to what can be picked (the new robots fall back to JAGUAR when turned off). */
export function allowedHar(harId: number): number {
  if (harId < 0) return 0;
  if (harId < ORIGINAL_HAR_TYPES) return harId;
  return extraRobotsEnabled() && EXTRA_HAR_IDS.includes(harId) ? harId : 0;
}

/** Whether the new arenas are in the rotation (setting on and scene files present). */
export function extraArenasEnabled(): boolean {
  return settings().gameplay.extraArenas && GEN_ARENAS.every((a) => hasGenerated(a.file));
}

/** Number of arenas to choose from (0 .. n-1). */
export function arenaCount(): number {
  return extraArenasEnabled() ? ARENA_COUNT : ORIGINAL_ARENAS;
}

/** An arena number limited to what can be picked. */
export function allowedArena(arena: number): number {
  return arena >= 0 && arena < arenaCount() ? arena : 0;
}

/** Name of an arena (the original game's text for its own five). */
export function arenaName(arena: number): string {
  if (arena < ORIGINAL_ARENAS) return langGet(56 + arena).replace(/\n$/, '');
  return GEN_ARENAS.find((a) => a.index === arena)?.name ?? '';
}

/**
 * An arena's name in the news report's sentences ("traded blows in the ~5"): the original game's names without their
 * article ("The Desert"), the new arenas' names in the same style.
 */
export function arenaNewsName(arena: number): string {
  if (arena < ORIGINAL_ARENAS) return arenaName(arena).replace(/^the /i, '');
  return GEN_ARENAS.find((a) => a.index === arena)?.newsName ?? arenaNewsName(0);
}

/** Description of an arena for the VS screen. */
export function arenaDescription(arena: number): string {
  if (arena < ORIGINAL_ARENAS) return langGet(66 + arena).replace(/\n$/, '');
  return GEN_ARENAS.find((a) => a.index === arena)?.description ?? '';
}
