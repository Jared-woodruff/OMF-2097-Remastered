// TEMPEST (HAR 12): the aerial wind robot. Specials: GALE BLAST (a whirlwind thrown from both hands), CYCLONE KICK (a
// rising spin kick that hits several times) and SKY DIVE (a diving kick from the air).
import type { Vec3 } from '../geometry';
import { prop, type PlacedShape } from '../robot';
import type { Body } from '../fighter/body';
import type { GenMove } from '../fighter/build';
import { CAT, MOVE, REACT, REAR_KICK, LEAD_KICK, sp } from '../fighter/moveset';
import * as P from '../fighter/poses';
import { cylinder, FX, fxMat, wedge } from '../robots/parts';
import { TEMPEST as MODEL } from '../robots/tempest';
import type { GenRobot } from './types';

const WIND = fxMat(FX.grey, false, 0.1, 0.6);
const WIND_HI = fxMat(FX.steel, false, 0.2, 0.9);

/** The whirlwind: rings spinning around the flight axis (+x), tip at the origin; `spin` in degrees. */
function vortex(spin: number): PlacedShape[] {
  const out: PlacedShape[] = [];
  const rings: [number, number][] = [[-4, 4.5], [-11, 7.5], [-19, 10.5]];
  rings.forEach(([x, r], i) => {
    out.push(prop(cylinder(0.6, r, 0.55), [x, 0, 0], i === 1 ? WIND_HI : WIND, [spin * (1 + i * 0.3), 0, 90]));
  });
  for (let i = 0; i < 4; i++) {
    const a = spin + i * 90;
    const rad = (a * Math.PI) / 180;
    out.push(prop(wedge(1.2, 6, 0.5, -2), [-12 - (i % 2) * 5, Math.cos(rad) * 9, Math.sin(rad) * 9], WIND_HI, [a, 0, 100]));
  }
  return out;
}

/** Gusts spreading after the whirlwind breaks up: t 0..1. */
function burst(t: number): PlacedShape[] {
  const out: PlacedShape[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r = 4 + 18 * t;
    const at: Vec3 = [Math.cos(a) * r - 6, Math.sin(a) * r * 0.9, 0];
    out.push(prop(wedge(1.2, 5 * (1 - 0.5 * t), 0.5, 2), at, i % 2 ? WIND : WIND_HI, [0, 0, (a * 180) / Math.PI - 90]));
  }
  return out;
}

function specials(b: Body): GenMove[] {
  // GALE BLAST: arms swept back, then thrust forward.
  const cast = [
    sp(P.fight(b)),
    sp(P.fight(b, { lean: -8, twist: -20, handF: [-b.A * 0.4, b.S - 4], handB: [-b.A * 0.2, b.S + 2] })),
    sp(P.fight(b, { lean: 12, twist: 18, root: [4, 0], handF: [b.A * 0.95, b.S - 6], handB: [b.A * 0.9, b.S] }), ['handF', 'handB']),
    sp(P.fight(b, { lean: 8, twist: 10, root: [3, 0], handF: [b.A * 0.8, b.S - 8], handB: [b.A * 0.78, b.S - 3] })),
  ];
  // CYCLONE KICK: the body spins around the vertical axis with the rear leg out.
  const spin = (turn: number, lift: number) => P.free(b, {
    root: [0, lift],
    lean: -10,
    nod: -6,
    joints: {
      pelvis: [0, turn, 0],
      hipF: [0, 0, 92], kneeF: [0, 0, -6], footF: [0, 0, -30],
      hipB: [0, 0, 20], kneeB: [0, 0, -70], footB: [0, 0, 40],
      shoulderF: [40, 0, 30], elbowF: [0, 0, 60], shoulderB: [-40, 0, 40], elbowB: [0, 0, 60],
    },
  });
  // SKY DIVE: the lead leg pointing down and forward.
  const dive = P.free(b, {
    root: [0, 8],
    tilt: 22,
    lean: -8,
    footF: [-10, b.ankle + 22],
    footB: [b.L * 0.85, b.ankle - b.L * 0.05],
    footAngleB: -20,
    handF: [b.A * 0.1, b.S + 6],
    handB: [-b.A * 0.2, b.S + 2],
  });
  return [
    {
      id: MOVE.SPECIAL1, category: CAT.HIGH, moveString: 'P41', damage: 10, blockStun: 9, points: 8, extraStringSelector: 5,
      anim: 'nA3-nB4-s20l55sp10nC2-mx+48my-60m36nC8-mm15mu30jhnD4-jhnA3',
      footer: REACT.highLight,
      sprites: cast,
    },
    {
      id: MOVE.SPECIAL2, category: CAT.HIGH, moveString: 'K63', damage: 26, blockStun: 12, points: 10, extraStringSelector: 5,
      anim: 'zzA2-zzs21l50sp12B2-vx+2y-11zzaiq1k20C2-aiq2k20D2-aiq3k20E2-aiq4k20F2-d-5cgC3-d-5cgD3-d-5cgE40-gG3-gA2',
      footer: 'l40s02x-1D1-x-1E1-F5-E4-D3',
      sprites: [
        sp(P.crouch(b)), sp(P.frontKick(b, 0.4)),
        sp(spin(0, 10), REAR_KICK), sp(spin(90, 14), REAR_KICK), sp(spin(180, 14), REAR_KICK), sp(spin(270, 12), REAR_KICK),
        sp(P.crouch(b, { drop: 0.1 })),
      ],
    },
    {
      id: MOVE.AIR1, category: CAT.JUMPING, moveString: 'K2', damage: 22, blockStun: 12, points: 8, posConstraint: 4, extraStringSelector: 5,
      anim: 'A2-s22l50sp10vx+7y+9ubcpB60',
      footer: REACT.highMedium,
      sprites: [sp(P.jumpKick(b, 0)), sp(dive, LEAD_KICK)],
    },
    {
      id: MOVE.FX1, category: CAT.PROJECTILE, moveString: '!', damage: 20, blockStun: 11, successorId: MOVE.FX2, points: 8, extraStringSelector: 5,
      anim: 'unbwq1A1-vx+7unA2-unB2-unC2-unA2-unB2-unC2-unA2-unB2-unC2-unA2-unB2-unC2-unA2-unB2-unC2-unA2-unB2-unC2-unA2-unB2-unC2-unA2-unB2-unC2-unA2-unB2-unC2-unA2-unB2-unC2-unA2-unB2-unC2-unA2-unB2-unC2',
      footer: REACT.projectile,
      sprites: [0, 30, 60].map((s) => ({ pose: null, props: vortex(s), hit: ['props'] })),
    },
    {
      id: MOVE.FX2, category: CAT.PROJECTILE, moveString: '!', anim: 'A2-B2-C2-D3',
      sprites: [0.1, 0.4, 0.7, 1].map((t) => ({ pose: null, props: burst(t) })),
    },
  ];
}

export const TEMPEST: GenRobot = {
  id: 12,
  name: 'TEMPEST',
  model: MODEL,
  style: { stance: 0.42, drop: 0.16, lean: 4, guardX: 0.8, guardY: -0.1, rearX: -0.2, rearY: -0.36, bob: 1.0 },
  stats: { health: 190, endurance: 12800, forward: 5.0, reverse: 4.3, jump: -14.8, fall: 0.84 },
  colors: [[140, 150, 160], [255, 235, 120], [40, 170, 120]],
  sounds: { 20: 46, 21: 47, 22: 53 },
  links: { chain: MOVE.SPECIAL1, reversal: MOVE.SPECIAL2 },
  specials,
  finisher: (b) => ({
    scrap: 'P25858',
    destruction: 'K85252',
    power: (k) => [
      P.crouch(b, { drop: 0.1 }),
      P.free(b, { root: [0, 16], lean: -12, joints: { pelvis: [0, 180, 0], hipF: [0, 0, 100], kneeF: [0, 0, -10], hipB: [0, 0, 30], kneeB: [0, 0, -80], shoulderF: [60, 0, 40], shoulderB: [-60, 0, 40] } }),
      P.free(b, { root: [0, 22], lean: -16, joints: { hipF: [0, 0, 150], kneeF: [0, 0, -5], footF: [0, 0, -40], hipB: [0, 0, 10], kneeB: [0, 0, -60], shoulderF: [0, 0, 120], shoulderB: [0, 0, 140] } }),
      P.crouch(b, { drop: 0.04 }),
    ][k],
  }),
  specialNames: { [MOVE.SPECIAL1]: 'GALE BLAST', [MOVE.SPECIAL2]: 'CYCLONE KICK', [MOVE.AIR1]: 'SKY DIVE' },
};
