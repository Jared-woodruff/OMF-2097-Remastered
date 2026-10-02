// HELIX (HAR 13): the drilling robot. Specials: DRILL RUSH (a charge with the drill out, hitting several times),
// CORKSCREW (a rising drill uppercut) and DRILL BIT (the drill head fired like a missile).
import type { Vec3 } from '../geometry';
import { prop, type PlacedShape } from '../robot';
import type { Body } from '../fighter/body';
import type { GenMove } from '../fighter/build';
import { CAT, MOVE, REACT, REAR_PUNCH, sp } from '../fighter/moveset';
import * as P from '../fighter/poses';
import { cone, cylinder, FX, fxMat, wedge } from '../robots/parts';
import { HELIX as MODEL } from '../robots/helix';
import type { GenRobot } from './types';

const STEEL = fxMat(FX.steel, false, 0, 1);
const GOLD = fxMat(FX.gold, false, 0.1, 1);
const SPARK = fxMat(FX.fire, true, 0.3);

/** The flying drill head (+x, tip at the origin), spinning. */
function bit(spin: number): PlacedShape[] {
  return [
    prop(cone(9, 5, 0.3), [-9, 0, 0], STEEL, [spin, 0, -90]),
    prop(cylinder(0.5, 4.2, 0.4), [-12, 0, 0], GOLD, [spin + 14, 0, -90 + 14]),
    prop(cylinder(0.45, 2.8, 0.4), [-7, 0, 0], GOLD, [spin + 14, 0, -90 + 14]),
    prop(cylinder(2.2, 5.4, 1), [-20, 0, 0], GOLD, [spin, 0, 90]),
  ];
}

/** Sparks spraying from an impact: t 0..1. */
function sparks(t: number): PlacedShape[] {
  const out: PlacedShape[] = [];
  for (let i = 0; i < 8; i++) {
    const a = ((i / 8) * 1.6 - 0.8) * Math.PI + Math.PI;
    const r = 3 + 20 * t;
    const at: Vec3 = [Math.cos(a) * r, Math.sin(a) * r - 6 * t * t * 3, 0];
    out.push(prop(wedge(0.8, 3 * (1 - 0.5 * t), 0.5, 0), at, i % 3 ? SPARK : GOLD, [0, 0, (a * 180) / Math.PI - 90]));
  }
  return out;
}

function specials(b: Body): GenMove[] {
  const drill = (spin: number) => ({ handF: [0, spin, 0] as Vec3 });
  // DRILL RUSH: drill thrust forward while charging.
  const rush = (spin: number, k: number) => P.fight(b, {
    lean: 18,
    twist: 26,
    root: [6 + k, 0],
    drop: 0.06,
    handF: [b.A * 1.02, b.S - 10],
    handB: [b.A * 0.2, b.S - 6],
    footAngleF: -16,
    joints: drill(spin),
  });
  // CORKSCREW: rising drill uppercut, the body spinning.
  const screw = (turn: number, spin: number, lift: number) => P.free(b, {
    root: [2, lift],
    lean: -6,
    nod: -12,
    footF: [-6, b.ankle + lift * 0.3 + 6],
    footB: [8, b.ankle + lift * 0.3 + 2],
    footAngleF: 40,
    footAngleB: 30,
    handF: [b.A * 0.35, b.S + b.A * 0.95],
    handB: [b.A * 0.3, b.S - 4],
    joints: { pelvis: [0, turn, 0], ...drill(spin) },
  });
  // DRILL BIT: the drill arm pulled back, then punched forward.
  const fire = [
    sp(P.fight(b)),
    sp(P.cross(b, -1)),
    sp(P.fight(b, { lean: 12, twist: 30, root: [5, 0], handF: [b.A * 1.0, b.S - 6], joints: drill(40) }), REAR_PUNCH),
    sp(P.fight(b, { lean: 8, twist: 22, root: [4, 0], handF: [b.A * 0.85, b.S - 7] })),
  ];
  return [
    {
      id: MOVE.SPECIAL1, category: CAT.MEDIUM, moveString: 'P63', damage: 9, blockStun: 8, points: 10, extraStringSelector: 5,
      anim: 'A3-B3-s20l55sp10x+8C2-x+9q1cpD2-x+9q2cpE2-x+9q3cpC2-x+8q4cpD2-x+6q5cpE2-x+3nF4-nA4',
      footer: 'sp13s2l30sf4D1-E2-D1',
      sprites: [
        sp(P.fight(b)), sp(P.cross(b, -1)),
        sp(rush(0, 0), REAR_PUNCH), sp(rush(40, 1), REAR_PUNCH), sp(rush(80, 2), REAR_PUNCH),
        sp(P.cross(b, 0.6)),
      ],
    },
    {
      id: MOVE.SPECIAL2, category: CAT.HIGH, moveString: 'P326', damage: 26, blockStun: 12, points: 12, extraStringSelector: 5,
      anim: 'zzA3-zzs21l50sp11B2-vx+1y-12zzaiq1k30C2-aiq2k30D2-aiq3k30E2-aiq4k30C2-d-5cgD3-d-5cgE3-d-5cgF40-gG3-gA2',
      footer: 'l40s02x-1D1-x-1E1-F5-E4-D3',
      sprites: [
        sp(P.uppercut(b, 0)), sp(P.uppercut(b, 0.6)),
        sp(screw(0, 0, 10), REAR_PUNCH), sp(screw(120, 50, 14), REAR_PUNCH), sp(screw(240, 100, 14), REAR_PUNCH),
        sp(P.free(b, { root: [0, 8], lean: 6, footF: [-6, b.ankle + 8], footB: [6, b.ankle + 6], handF: [b.A * 0.5, b.S], handB: [b.A * 0.4, b.S - 4] })),
        sp(P.crouch(b, { drop: 0.1 })),
      ],
    },
    {
      id: MOVE.SPECIAL3, category: CAT.HIGH, moveString: 'P41', damage: 10, blockStun: 9, points: 8, extraStringSelector: 5,
      anim: 'nA3-nB5-s22l60sp10nC2-mx+58my-62m36nC8-mm17mu36jhnD4-jhnA3',
      footer: REACT.highLight,
      sprites: fire,
    },
    {
      id: MOVE.FX1, category: CAT.PROJECTILE, moveString: '!', damage: 24, blockStun: 12, successorId: MOVE.FX2, points: 8, extraStringSelector: 5,
      anim: 'unbwq1A1-vx+9unA2-unB2-unC2-unA2-unB2-unC2-unA2-unB2-unC2-unA2-unB2-unC2-unA2-unB2-unC2-unA2-unB2-unC2-unA2-unB2-unC2-unA2-unB2-unC2-unA2-unB2-unC2-unA2-unB2-unC2',
      footer: REACT.projectile,
      sprites: [0, 40, 80].map((s) => ({ pose: null, props: bit(s), hit: ['props'] })),
    },
    {
      id: MOVE.FX2, category: CAT.PROJECTILE, moveString: '!', anim: 'A2-B2-C2-D3',
      sprites: [0.1, 0.4, 0.7, 1].map((t) => ({ pose: null, props: sparks(t) })),
    },
  ];
}

export const HELIX: GenRobot = {
  id: 13,
  name: 'HELIX',
  model: MODEL,
  style: { stance: 0.44, drop: 0.19, lean: 11, guardX: 0.78, guardY: -0.24, rearX: -0.02, rearY: -0.5, bob: 1.2 },
  stats: { health: 210, endurance: 14080, forward: 4.2, reverse: 3.5, jump: -13.0, fall: 1.0 },
  colors: [[90, 90, 100], [235, 235, 235], [240, 170, 30]],
  sounds: { 20: 58, 21: 53, 22: 62 },
  links: { chain: MOVE.SPECIAL3, reversal: MOVE.SPECIAL2 },
  specials,
  finisher: (b) => ({
    scrap: 'P65454',
    destruction: 'K45656',
    power: (k) => [
      P.cross(b, -1),
      P.fight(b, { lean: 20, twist: 30, root: [8, 0], drop: 0.1, handF: [b.A * 1.0, b.H * 0.9], handB: [b.A * 0.3, b.S - 8], joints: { handF: [0, 0, 0] } }),
      P.fight(b, { lean: 24, twist: 30, root: [9, 0], drop: 0.14, handF: [b.A * 1.02, b.H * 0.8], handB: [b.A * 0.3, b.S - 10], joints: { handF: [0, 60, 0] } }),
      P.fight(b, { lean: 24, twist: 30, root: [9, 0], drop: 0.14, handF: [b.A * 1.02, b.H * 0.8], handB: [b.A * 0.3, b.S - 10], joints: { handF: [0, 120, 0] } }),
    ][k],
  }),
  specialNames: { [MOVE.SPECIAL1]: 'DRILL RUSH', [MOVE.SPECIAL2]: 'CORKSCREW', [MOVE.SPECIAL3]: 'DRILL BIT' },
};
