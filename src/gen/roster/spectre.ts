// SPECTRE (HAR 14): the phantom laser robot. Specials: PHOTON BEAM (a fast laser bolt from the forearm emitter),
// PHASE SHIFT (fades out and reappears behind the enemy) and SHADOW STRIKE (a dashing kick trailing afterimages).
import type { Vec3 } from '../geometry';
import { prop, type PlacedShape } from '../robot';
import type { Body } from '../fighter/body';
import type { GenMove } from '../fighter/build';
import { CAT, MOVE, REACT, LEAD_KICK, LEAD_PUNCH, sp } from '../fighter/moveset';
import * as P from '../fighter/poses';
import { ball, capsule, FX, fxMat, wedge } from '../robots/parts';
import { SPECTRE as MODEL } from '../robots/spectre';
import type { GenRobot } from './types';

const BEAM = fxMat(FX.purple, true, 0.1);
const CORE = fxMat(FX.steel, true, 0.6);
const FLASH = fxMat(FX.purple, true, 0.5);

/** The photon bolt (+x, tip at the origin); `k` varies its length a little. */
function bolt(k: number): PlacedShape[] {
  const len = 16 + 2 * k;
  return [
    prop(capsule(len, 2.4), [-len - 2, 0, 0], BEAM, [0, 0, 90]),
    prop(capsule(len - 1, 1.1), [-len - 2, 0, 1.5], CORE, [0, 0, 90]),
    prop(ball(3.2, 3, 3), [-2, 0, 0], CORE),
  ];
}

/** The flash of a bolt hitting: t 0..1. */
function flash(t: number): PlacedShape[] {
  const out: PlacedShape[] = [prop(ball(6 * (1 - t) + 1), [0, 0, 0], t < 0.5 ? CORE : FLASH)];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const r = 5 + 14 * t;
    const at: Vec3 = [Math.cos(a) * r, Math.sin(a) * r, 0];
    out.push(prop(wedge(0.8, 3.5 * (1 - 0.6 * t), 0.4, 0), at, FLASH, [0, 0, (a * 180) / Math.PI - 90]));
  }
  return out;
}

function specials(b: Body): GenMove[] {
  const charge = (s: number) => ({ joint: 'elbowB', part: { shape: ball(2.4 * s), at: [2.6, -15.5, 0] as Vec3, mat: CORE } });
  // PHOTON BEAM: the lead forearm aimed straight at the enemy.
  const cast = [
    sp(P.fight(b)),
    sp(P.fight(b, { twist: -10, handB: [b.A * 0.4, b.S - 2], attach: [charge(1)] })),
    sp(P.fight(b, { lean: 6, twist: -16, root: [2, 0], handB: [b.A * 1.02, b.S - 4], attach: [charge(1.4)] }), LEAD_PUNCH),
    sp(P.fight(b, { lean: 4, twist: -12, root: [2, 0], handB: [b.A * 0.95, b.S - 3] })),
  ];
  // PHASE SHIFT: cloaked crouch while fading.
  const cloak = P.crouch(b, { drop: 0.05, lean: 16, nod: 14, handF: [b.A * 0.3, b.S - b.L * 0.3], handB: [b.A * 0.35, b.S - b.L * 0.28] });
  // SHADOW STRIKE: low flying side kick.
  const strike = (t: number) => P.free(b, {
    root: [4 * t, -2],
    tilt: -18 * t,
    lean: -6,
    footF: [-b.L * 0.35, b.ankle + 4],
    footB: [b.L * (0.3 + 0.75 * t), b.H * (0.55 + 0.2 * t)],
    footAngleB: -60 * t,
    handF: [-b.A * 0.2, b.S - 6],
    handB: [b.A * 0.2, b.S + 4],
  });
  return [
    {
      id: MOVE.SPECIAL1, category: CAT.HIGH, moveString: 'P63', damage: 8, blockStun: 9, points: 8, extraStringSelector: 5,
      anim: 'nA2-nB5-s20l50sp10nC2-mx+58my-66m36nC6-mm15mu26jhnD4-jhnA3',
      footer: REACT.highLight,
      sprites: cast,
    },
    {
      id: MOVE.SPECIAL2, category: CAT.MEDIUM, moveString: 'K41', points: 4, extraStringSelector: 5,
      anim: 'A1-bf230s21l50sp15zzA2-bf190zzA2-bf140zzA2-bf100zzA2-bf60zzA2-bf30zzA2-atZ2-bf30s21l50sp15zzA2-bf80A2-bf140A2-bf190jhA2-bf230jhA2-jhB3',
      sprites: [sp(cloak), sp(P.fight(b))],
    },
    {
      id: MOVE.SPECIAL3, category: CAT.MEDIUM, moveString: 'K63', damage: 26, blockStun: 12, points: 10, extraStringSelector: 5,
      anim: 'A2-ubs22l50sp10B2-ubx+11C2-ubx+11cpD2-ubx+6cpD4-nE3-nA3',
      footer: REACT.knockdown,
      sprites: [sp(P.fight(b)), sp(strike(0)), sp(strike(0.6), LEAD_KICK), sp(strike(1), LEAD_KICK), sp(P.fight(b, { drop: 0.05 }))],
    },
    {
      id: MOVE.FX1, category: CAT.PROJECTILE, moveString: '!', damage: 18, blockStun: 10, successorId: MOVE.FX2, points: 8, extraStringSelector: 5,
      anim: 'unbwq1A1-vx+12unA2-unB2-unA2-unB2-unA2-unB2-unA2-unB2-unA2-unB2-unA2-unB2-unA2-unB2-unA2-unB2-unA2-unB2-unA2-unB2-unA2-unB2-unA2-unB2',
      footer: REACT.projectile,
      sprites: [0, 1].map((k) => ({ pose: null, props: bolt(k), hit: ['props'] })),
    },
    {
      id: MOVE.FX2, category: CAT.PROJECTILE, moveString: '!', anim: 'A2-B2-C2-D2',
      sprites: [0, 0.35, 0.7, 1].map((t) => ({ pose: null, props: flash(t) })),
    },
  ];
}

export const SPECTRE: GenRobot = {
  id: 14,
  name: 'SPECTRE',
  model: MODEL,
  style: { stance: 0.4, drop: 0.14, lean: 3, guardX: 0.82, guardY: -0.06, rearX: -0.22, rearY: -0.3, bob: 0.8 },
  stats: { health: 200, endurance: 13440, forward: 4.7, reverse: 4.1, jump: -13.8, fall: 0.95 },
  colors: [[60, 60, 80], [255, 60, 200], [150, 150, 200]],
  sounds: { 20: 49, 21: 42, 22: 43 },
  links: { chain: MOVE.SPECIAL1, reversal: MOVE.SPECIAL3 },
  specials,
  finisher: (b) => ({
    scrap: 'P85852',
    destruction: 'K25258',
    power: (k) => [
      P.fight(b, { lean: -4, handF: [b.A * 0.3, b.S + 4], handB: [b.A * 0.35, b.S + 6] }),
      P.fight(b, { lean: -10, nod: -10, handF: [-b.A * 0.4, b.S + b.A * 0.5], handB: [b.A * 0.2, b.S + b.A * 0.6] }),
      P.fight(b, { lean: 8, twist: -14, root: [3, 0], handB: [b.A * 1.02, b.H * 0.75], handF: [b.A * 0.95, b.H * 0.8] }),
      P.fight(b, { lean: 6, twist: -10, root: [3, 0], handB: [b.A * 0.98, b.H * 0.72], handF: [b.A * 0.9, b.H * 0.78] }),
    ][k],
  }),
  specialNames: { [MOVE.SPECIAL1]: 'PHOTON BEAM', [MOVE.SPECIAL2]: 'PHASE SHIFT', [MOVE.SPECIAL3]: 'SHADOW STRIKE' },
};
