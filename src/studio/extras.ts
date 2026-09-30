// The remaster's new robots and arenas in OMF Studio: the mod that comes with the game (mods/extras.ts), fetched from
// next to Studio the first time it is wanted. Studio opens a copy of it as a project, starts new robots and arenas
// from its robots and arenas (with their HD pictures), and makes the sample mod's arena from its rooftop.
import { bundledMods, fetchBundled } from '../mods/bundled';
import { EXTRAS_MOD_ID, EXTRAS_NUMBERS } from '../mods/extras';
import { readModPackage, type ModPackage } from '../mods/package';
import { GEN_ARENAS } from '../gen/scene/arenas';
import { GEN_ROBOTS } from '../gen/roster';

let pkg: Promise<ModPackage> | null = null;

/** The new robots and arenas mod's package. Throws (worded for the author) when it cannot be had. */
export function extrasPackage(): Promise<ModPackage> {
  pkg ??= (async () => {
    const b = (await bundledMods()).find((m) => m.id === EXTRAS_MOD_ID);
    if (!b) throw new Error('the new robots and arenas are not next to Studio (mods/index.json)');
    return readModPackage(await fetchBundled(b));
  })();
  // (a failure is not kept: the next try fetches again)
  pkg.catch(() => (pkg = null));
  return pkg;
}

/** The new robots, as the game numbers them while their mod is on: [number, name, folder]. */
export const EXTRAS_ROBOTS: [number, string, string][] = GEN_ROBOTS.map((r) => [r.id, r.name,
  Object.entries(EXTRAS_NUMBERS.robot).find(([, n]) => n === r.id)![0]]);

/** The new arenas: [number, name, folder]. */
export const EXTRAS_ARENAS: [number, string, string][] = GEN_ARENAS.map((a) => [a.index, a.name,
  Object.entries(EXTRAS_NUMBERS.arena).find(([, n]) => n === a.index)![0]]);
