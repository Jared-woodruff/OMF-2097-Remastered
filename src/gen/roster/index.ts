// The generated robots (GLACIER, TEMPEST, HELIX and SPECTRE: the new robots' mod plays them as HARs 11-14, see
// mods/extras.ts) and how each becomes a fighter file; and the robots built from their parts that are in the game now
// (the robot workshop's, and mod robots made of them), for what the game draws from their 3D models.
import { measure } from '../fighter/body';
import type { GenFighter } from '../fighter/build';
import { soundTable } from '../fighter/build';
import { basicAttacks, coreMoves, finisherMoves, MOVE, portraitMoves } from '../fighter/moveset';
import { GLACIER } from './glacier';
import { HELIX } from './helix';
import { SPECTRE } from './spectre';
import { TEMPEST } from './tempest';
import type { GenRobot } from './types';

export type { GenRobot } from './types';

export const GEN_ROBOTS: GenRobot[] = [GLACIER, TEMPEST, HELIX, SPECTRE];

/**
 * Which of each robot's specials the computer uses to shoot from afar, charge in and push back (its tactics, like the
 * originals', see controller/ai.ts): what their mod's robot.json names (and copies of them take along).
 */
export const GEN_TACTICS: Record<string, { projectile: number[]; charge: number[]; push: number[] }> = {
  GLACIER: { projectile: [MOVE.SPECIAL1], charge: [MOVE.SPECIAL2], push: [MOVE.SPECIAL3] },
  TEMPEST: { projectile: [MOVE.SPECIAL1], charge: [MOVE.SPECIAL2], push: [MOVE.SPECIAL2] },
  HELIX: { projectile: [MOVE.SPECIAL3], charge: [MOVE.SPECIAL1], push: [MOVE.SPECIAL2] },
  SPECTRE: { projectile: [MOVE.SPECIAL1], charge: [MOVE.SPECIAL3], push: [] },
};

/** How each robot plays (the README's words), for its robot.json. */
export const GEN_DESCRIPTIONS: Record<string, string> = {
  GLACIER: 'A heavy ice juggernaut: slow, strong and tough. Ice Lance, Glacial Ram and Frost Spikes.',
  TEMPEST: 'A light and fast wind robot with high, floaty jumps. Gale Blast, Cyclone Kick and Sky Dive.',
  HELIX: 'An industrial driller with a spiral drill and a claw. Drill Rush, Corkscrew and Drill Bit.',
  SPECTRE: 'A phantom with forearm lasers and a cloak of blades. Photon Beam, Phase Shift and Shadow Strike.',
};

/** Robots built from the generated robots' parts that are in the game now (gen/workshop.ts: the workshop's, the mods'), by HAR id. */
const workshop = new Map<number, GenRobot>();

export function registerGenRobot(r: GenRobot): void {
  workshop.set(r.id, r);
}

export function unregisterGenRobot(harId: number): void {
  workshop.delete(harId);
}

/** The 3D robot a HAR is drawn from, if it is one of those (the new robots while their mod is on, the workshop's...). */
export function genRobot(harId: number): GenRobot | undefined {
  return workshop.get(harId);
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
