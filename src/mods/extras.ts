// The remaster's new robots and arenas, as a mod that comes with the game: GLACIER, TEMPEST, HELIX and SPECTRE, and
// the Orbital, Ice Cave, Rooftop and Abyss arenas. Like any mod it is off until the player turns it on (EXTRAS > MODS)
// and plays through the mod system (src/mods); `npm run extras` makes its package from the definitions in src/gen
// (src/gen/dev/extras.test.ts). Its robots and arenas keep the numbers they had when they were part of the game, so
// the saves, replays and records that name them still find them.

/** The mod's id (mod.json). */
export const EXTRAS_MOD_ID = 'omf2097r.extras';

/** Its package's file name (next to the game: mods/<file>, listed by mods/index.json). */
export const EXTRAS_FILE = `${EXTRAS_MOD_ID}.omfmod`;

/** The numbers its robots and arenas play under, by their folder names in the package. */
export const EXTRAS_NUMBERS: Record<'robot' | 'arena', Record<string, number>> = {
  robot: { glacier: 11, tempest: 12, helix: 13, spectre: 14 },
  arena: { orbital: 5, 'ice-cave': 6, rooftop: 7, abyss: 8 },
};

/** The number a mod's robot or arena keeps (`key`: "<mod id>/<folder name>"), or undefined. */
/** Whether OMF Studio's test address (see main.ts) names a robot (h1, h2) or the arena of the mod, by number. */
export function testNamesExtras(params: URLSearchParams): boolean {
  const named = (key: string, kind: 'robot' | 'arena') => {
    const v = params.get(key);
    return v !== null && /^\d+$/.test(v) && Object.values(EXTRAS_NUMBERS[kind]).includes(Number(v));
  };
  return named('h1', 'robot') || named('h2', 'robot') || named('arena', 'arena');
}

export function reservedNumber(kind: 'robot' | 'arena' | 'pilot', key: string): number | undefined {
  if (kind === 'pilot' || !key.startsWith(`${EXTRAS_MOD_ID}/`)) return undefined;
  return EXTRAS_NUMBERS[kind][key.slice(EXTRAS_MOD_ID.length + 1)];
}
