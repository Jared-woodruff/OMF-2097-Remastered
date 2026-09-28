// The generated robots (HARs 11-14) and how each becomes a fighter file.
import { measure } from '../fighter/body';
import type { GenFighter } from '../fighter/build';
import { soundTable } from '../fighter/build';
import { basicAttacks, coreMoves, finisherMoves, portraitMoves } from '../fighter/moveset';
import { GLACIER } from './glacier';
import { HELIX } from './helix';
import { SPECTRE } from './spectre';
import { TEMPEST } from './tempest';
import type { GenRobot } from './types';

export type { GenRobot } from './types';

export const GEN_ROBOTS: GenRobot[] = [GLACIER, TEMPEST, HELIX, SPECTRE];

/** First HAR id of the generated robots. */
export const FIRST_GEN_HAR = 11;

export function genRobot(harId: number): GenRobot | undefined {
  return GEN_ROBOTS.find((r) => r.id === harId);
}

/** Every move of a generated robot, ready for buildFighter(). */
export function fighterOf(r: GenRobot): GenFighter {
  const b = measure(r.model, r.style);
  return {
    model: r.model,
    stats: r.stats,
    sounds: soundTable(r.sounds),
    moves: [...coreMoves(b, r.links), ...basicAttacks(b, r.links), ...r.specials(b), ...finisherMoves(b, r.finisher(b)), ...portraitMoves(b)],
  };
}
