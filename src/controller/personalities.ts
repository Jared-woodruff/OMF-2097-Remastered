// The original pilots' fighting personalities: how the computer fights as each of them (the reference's
// reset_pilot_personality, hard-coded per story pilot). A pilot record's fields a pilot's entry leaves out keep their
// value, as in the reference. Mod pilots may bring a complete personality of their own (pilot.json "ai").
import type { Pilot } from '../formats/pilot';
import type { ModPilotAi } from '../mods/types';

/** The personality fields of a pilot record (attitudes 0-100, preferences -100 to 100, learning and forgetting). */
export type PersonalityField = 'attNormal' | 'attHyper' | 'attJump' | 'attDef' | 'attSniper' | 'apThrow' | 'apSpecial' | 'apJump' |
  'apHigh' | 'apLow' | 'apMiddle' | 'prefJump' | 'prefFwd' | 'prefBack' | 'learning' | 'forget';

export type Personality = Record<PersonalityField, number>;

/** Every personality field, in the order of the pilot record. */
export const PERSONALITY_FIELDS: PersonalityField[] = ['attNormal', 'attHyper', 'attJump', 'attDef', 'attSniper', 'apThrow', 'apSpecial',
  'apJump', 'apHigh', 'apLow', 'apMiddle', 'prefJump', 'prefFwd', 'prefBack', 'learning', 'forget'];

/** By story pilot id (0 Crystal .. 10 Kreissack). */
export const STORY_PERSONALITIES: Partial<Personality>[] = [
  // crystal
  { attNormal: 30, attHyper: 10, attJump: 10, attSniper: 20, apThrow: 100, apSpecial: 75, apJump: -30, apHigh: -50,
    apLow: -50, apMiddle: -50, prefJump: -10, prefFwd: 30, prefBack: 10, learning: 1.5, forget: 0.25 },
  // steffan
  { attNormal: 40, attHyper: 60, attJump: 30, apThrow: 25, apSpecial: 20, apHigh: -75, apLow: 75, apMiddle: 50,
    prefJump: 6, prefFwd: 20, prefBack: -9, learning: 1.0, forget: 0.4 },
  // milano
  { attNormal: 20, attHyper: 30, attJump: 40, attSniper: 20, apThrow: -50, apSpecial: -50, apJump: -50, apHigh: 50,
    apLow: 50, apMiddle: 50, prefJump: 8, prefFwd: 30, prefBack: -3, learning: 0.9, forget: 0.1 },
  // christian
  { attNormal: 20, attHyper: 15, attDef: 30, attSniper: 10, apThrow: 30, apSpecial: 25, apJump: 30, apLow: -25,
    apMiddle: 20, prefJump: 2, prefFwd: 10, prefBack: -10, learning: 2.5, forget: 0.35 },
  // shirro
  { attNormal: 15, attHyper: 5, attJump: 5, attDef: 20, attSniper: 4, apThrow: 75, apSpecial: 50, apJump: -50,
    apHigh: -50, apLow: -50, apMiddle: -50, prefJump: -20, prefFwd: 10, prefBack: 10, learning: 2.0, forget: 0.2 },
  // jean-paul
  { attNormal: 20, attHyper: 10, attJump: 20, attDef: 30, attSniper: 45, apThrow: -50, apSpecial: 75, apJump: 100,
    apHigh: -50, apLow: 100, apMiddle: -50, prefFwd: 20, learning: 1.2, forget: 0.07 },
  // ibrahim
  { attNormal: 40, attHyper: 5, attJump: 5, attDef: 50, attSniper: 7, apSpecial: 50, apJump: -50, apHigh: 50,
    apLow: 50, apMiddle: 50, prefJump: 2, prefFwd: 10, prefBack: -10, learning: 2.5, forget: 0.05 },
  // angel
  { attNormal: 40, attHyper: 60, attJump: 30, apThrow: 25, apSpecial: 20, apJump: 100, apHigh: -75, apLow: 75,
    apMiddle: 50, prefJump: 40, prefFwd: 40, prefBack: -9, learning: 3.0, forget: 0.15 },
  // cossette
  { attNormal: 50, attHyper: 5, attJump: 5, attDef: 5, attSniper: 5, apThrow: 25, apSpecial: -50, apJump: -50,
    apHigh: -25, apLow: 10, apMiddle: -50, prefJump: -10, prefBack: 10, learning: 0.7, forget: 0.2 },
  // raven
  { attNormal: 30, attHyper: 40, apThrow: 100, apSpecial: 100, apJump: 100, apHigh: 100, apLow: 100, apMiddle: 100,
    prefJump: 12, prefFwd: 30, prefBack: -7, learning: 3.0, forget: 0.5 },
  // kreissack
  { attNormal: 30, attHyper: 75, attSniper: 25, apThrow: 100, apSpecial: 100, learning: 3.0, forget: 0.25 },
];

/** Sets a pilot record's personality fields (learning and forgetting are 32-bit floats, like the record's). */
export function applyPersonality(pilot: Pilot, p: Partial<Personality>): void {
  for (const f of PERSONALITY_FIELDS) {
    const v = p[f];
    if (v !== undefined) pilot[f] = f === 'learning' || f === 'forget' ? Math.fround(v) : v;
  }
}

/** A story pilot's personality in full, as a new pilot record gets it (the fields its entry leaves out at 0). */
export function storyPersonality(id: number): Personality {
  const out = Object.fromEntries(PERSONALITY_FIELDS.map((f) => [f, 0])) as Personality;
  return { ...out, ...STORY_PERSONALITIES[id] };
}

/** pilot.json's "ai" names of the personality fields. */
const MOD_AI_KEYS: Record<PersonalityField, keyof ModPilotAi> = {
  attNormal: 'normal', attHyper: 'hyper', attJump: 'jump', attDef: 'defensive', attSniper: 'sniper', apThrow: 'throws',
  apSpecial: 'specials', apJump: 'jumpAttacks', apHigh: 'high', apLow: 'low', apMiddle: 'middle', prefJump: 'moveJump',
  prefFwd: 'moveForward', prefBack: 'moveBack', learning: 'learning', forget: 'forget',
};

/** A mod pilot's personality (pilot.json "ai") as the record's fields. */
export function modPersonality(ai: ModPilotAi): Personality {
  return Object.fromEntries(PERSONALITY_FIELDS.map((f) => [f, ai[MOD_AI_KEYS[f]]])) as Personality;
}

/** A personality as pilot.json writes it. */
export function modAi(p: Personality): ModPilotAi {
  return Object.fromEntries(PERSONALITY_FIELDS.map((f) => [MOD_AI_KEYS[f], p[f]])) as unknown as ModPilotAi;
}
