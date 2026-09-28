// GLACIER (HAR 11): the heavy ice juggernaut. Specials: ICE LANCE (a crystal spear thrown from both palms), GLACIAL
// RAM (a shoulder charge sliding on ice) and FROST SPIKES (a stomp that makes ice spikes burst from the floor ahead).
import type { Vec3 } from '../geometry';
import { prop, type PlacedShape } from '../robot';
import type { Body } from '../fighter/body';
import type { GenMove } from '../fighter/build';
import { CAT, MOVE, REACT, sp } from '../fighter/moveset';
import * as P from '../fighter/poses';
import { cone, FX, fxMat, wedge } from '../robots/parts';
import { GLACIER as MODEL } from '../robots/glacier';
import type { GenRobot } from './types';

const ICE = fxMat(FX.cyan, false, 0.05, 1);
const ICE_HI = fxMat(FX.steel, false, 0.15, 1);
const ICE_GLOW = fxMat(FX.cyan, true, 0.4);

/** The ice lance, flying toward +x with its tip at the origin; `spin` turns it around its axis. */
function lance(spin: number): PlacedShape[] {
  return [
    prop(cone(13, 3.6, 0.2), [-13, 0, 0], ICE, [spin, 0, -90]),
    prop(cone(4, 2.6, 0.2), [-29, 0, 0], ICE_HI, [spin, 0, 90]),
    prop(wedge(1.8, 5, 0.7, 0), [-22, 0, 0], ICE_HI, [spin, 0, 120]),
    prop(wedge(1.8, 5, 0.7, 0), [-22, 0, 0], ICE_HI, [spin + 120, 0, 120]),
    prop(wedge(1.8, 5, 0.7, 0), [-22, 0, 0], ICE_HI, [spin + 240, 0, 120]),
  ];
}

/** Ice shards flying apart: t 0..1. */
function shatter(t: number): PlacedShape[] {
  const out: PlacedShape[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.4;
    const r = 3 + 22 * t;
    const at: Vec3 = [Math.cos(a) * r - 4, Math.sin(a) * r * 0.8, 0];
    const size = 3.2 * (1 - 0.6 * t);
    out.push(prop(wedge(size * 0.6, size, 0.6, 0), at, i % 2 ? ICE : ICE_HI, [30 * i, 20 * i, (a * 180) / Math.PI - 90]));
  }
  if (t < 0.5) out.push(prop(cone(4 * (1 - t), 3, 0.2), [-4, 0, 0], ICE_GLOW, [0, 0, -90]));
  return out;
}

/** Ice spikes bursting from the floor ahead: height 0..1. */
function spikes(h: number): PlacedShape[] {
  const out: PlacedShape[] = [];
  const list: [number, number, number, number][] = [[-12, 0.7, 3.5, -12], [0, 1, 4.5, 4], [11, 0.8, 3.8, 14], [20, 0.5, 3, 24]];
  for (const [x, scale, r, lean] of list) {
    const len = 26 * scale * h;
    if (len < 1) continue;
    out.push(prop(cone(len / 2, r * (0.5 + 0.5 * h), 0.2), [x - Math.sin((lean * Math.PI) / 180) * len * 0.5, len / 2 - 1, 0], x % 2 ? ICE_HI : ICE, [0, 0, -lean]));
  }
  return out;
}

function specials(b: Body): GenMove[] {
  const g = P.guard(b);
  const crystal = (s: number) => ({ joint: 'handF', part: { shape: cone(3 * s, 2.4 * s, 0.2), at: [0, -8, 0] as Vec3, mat: ICE_GLOW, rot: [0, 0, 0] as Vec3 } });
  // ICE LANCE: both palms pushed forward.
  const cast = [
    sp(P.fight(b)),
    sp(P.fight(b, { lean: -6, twist: -18, handF: [g.handF[0] - 10, b.H + 6], handB: [g.handB[0] - 14, b.H + 10], attach: [crystal(0.8)] })),
    sp(P.fight(b, { lean: 12, twist: 16, root: [4, 0], handF: [b.A * 0.95, b.S - 8], handB: [b.A * 0.9, b.S - 2], attach: [crystal(1.2)] }), ['handF', 'handB']),
    sp(P.fight(b, { lean: 10, twist: 12, root: [3, 0], handF: [b.A * 0.85, b.S - 8], handB: [b.A * 0.8, b.S - 3] })),
  ];
  // GLACIAL RAM: lowered shoulder, sliding forward.
  const ramPose = (k: number) => P.fight(b, {
    drop: 0.1 + 0.04 * k,
    lean: 26 + 6 * k,
    twist: -22,
    nod: -12,
    root: [4 + 2 * k, 0],
    footF: [g.footF[0] - 6 - 4 * k, b.ankle],
    footB: [g.footB[0] + 4, b.ankle],
    footAngleF: -20,
    handF: [b.A * 0.35, b.S - b.A * 0.45],
    handB: [b.A * 0.5, b.S - b.A * 0.2],
  });
  const ramHit = ['chest', 'shoulderB', 'head', 'shoulderF'];
  // FROST SPIKES: stomp with the lead foot.
  const stompUp = P.fight(b, { lean: -8, footB: [g.footB[0] - 2, b.ankle + b.L * 0.5], footAngleB: -10, handF: [g.handF[0] - 4, b.S + 6], handB: [g.handB[0], b.S + 10] });
  const stompDown = P.fight(b, { drop: 0.14, lean: 18, nod: 8, footB: [g.footB[0] + 3, b.ankle], handF: [b.A * 0.4, b.H * 0.95], handB: [b.A * 0.6, b.H * 0.9] });
  return [
    {
      id: MOVE.SPECIAL1, category: CAT.HIGH, moveString: 'P63', damage: 10, blockStun: 9, points: 8, extraStringSelector: 5,
      anim: 'nA3-nB5-s20l60sp10nC2-mx+56my-64m36nC8-mm15mu36jhnD4-jhnA3',
      footer: REACT.highLight,
      sprites: cast,
    },
    {
      id: MOVE.SPECIAL2, category: CAT.MEDIUM, moveString: 'K41', damage: 28, blockStun: 12, points: 10, extraStringSelector: 5,
      anim: 'A3-B3-s21l60sp10x+7C2-x+9cpD2-x+10cpC2-x+10cpD2-x+8cpC2-x+4nB4-nA4',
      footer: REACT.knockdown,
      sprites: [sp(P.crouch(b)), sp(ramPose(0)), sp(ramPose(1), ramHit), sp(ramPose(2), ramHit)],
    },
    {
      id: MOVE.SPECIAL3, category: CAT.LOW, moveString: 'K63', damage: 6, blockStun: 6, points: 8, extraStringSelector: 5,
      anim: 'A5-B2-s22l60sp10bb5mx+62my+0m38B12-mm17mu40nC4-nA3',
      footer: REACT.lowLight,
      sprites: [sp(stompUp), sp(stompDown, ['footB', 'kneeB']), sp(P.fight(b, { drop: 0.06, lean: 8 }))],
    },
    {
      id: MOVE.FX1, category: CAT.PROJECTILE, moveString: '!', damage: 24, blockStun: 12, successorId: MOVE.FX2, points: 8, extraStringSelector: 5,
      anim: 'unbwq1A1-vx+8unA3-unB3-unC3-unA3-unB3-unC3-unA3-unB3-unC3-unA3-unB3-unC3-unA3-unB3-unC3-unA3-unB3-unC3-unA3-unB3-unC3-unA3-unB3-unC3',
      footer: REACT.projectile,
      sprites: [0, 40, 80].map((s) => ({ pose: null, props: lance(s), hit: ['props'] })),
    },
    {
      id: MOVE.FX2, category: CAT.PROJECTILE, moveString: '!', anim: 'A2-B2-C2-D3-E3',
      sprites: [0.05, 0.25, 0.5, 0.75, 1].map((t) => ({ pose: null, props: shatter(t) })),
    },
    {
      id: MOVE.FX3, category: CAT.PROJECTILE, moveString: '!', damage: 18, blockStun: 10, points: 6, extraStringSelector: 5,
      anim: 'unq1A2-B2-C3-D10-nC3-nB2-nA2',
      footer: 'vx-3y-10s01l50D1-E2-F2-L5-M300',
      sprites: [0.3, 0.65, 1, 1].map((h, i) => ({ pose: null, props: spikes(h * (i === 3 ? 0.96 : 1)), hit: ['props'] })),
    },
    {
      // The same spikes without a hit (the destruction's).
      id: MOVE.FX4, category: CAT.PROJECTILE, moveString: '!',
      anim: 'nA2-nB2-nC3-nD30-nC3-nB2-nA2',
      sprites: [0.3, 0.65, 1, 0.96].map((h) => ({ pose: null, props: spikes(h) })),
    },
  ];
}

export const GLACIER: GenRobot = {
  id: 11,
  name: 'GLACIER',
  model: MODEL,
  style: { stance: 0.46, drop: 0.2, lean: 6, guardX: 0.86, guardY: -0.2, rearX: -0.1, rearY: -0.56, bob: 1.2 },
  stats: { health: 230, endurance: 15360, forward: 3.8, reverse: 3.1, jump: -12.4, fall: 1.12 },
  colors: [[150, 160, 180], [150, 230, 255], [60, 110, 220]],
  sounds: { 20: 62, 21: 55, 22: 40 },
  links: { chain: MOVE.SPECIAL1, reversal: MOVE.SPECIAL2 },
  specials,
  finisher: (b) => ({
    scrap: 'P25852',
    destruction: 'K85258',
    power: (k) => [
      P.fight(b, { drop: 0.02, lean: -10, handF: [4, b.S + b.A * 0.7], handB: [10, b.S + b.A * 0.75] }),
      P.fight(b, { drop: -0.02, lean: -18, nod: -10, handF: [-4, b.S + b.A * 0.85], handB: [2, b.S + b.A * 0.9] }),
      P.fight(b, { drop: 0.24, lean: 34, nod: 10, root: [6, 0], handF: [b.A * 0.8, b.H * 0.55], handB: [b.A * 0.95, b.H * 0.6] }),
      P.fight(b, { drop: 0.26, lean: 30, nod: 6, root: [6, 0], handF: [b.A * 0.85, b.H * 0.45], handB: [b.A, b.H * 0.5] }),
    ][k],
    strikeTags: 'mx+56my+0m39',
  }),
  specialNames: { [MOVE.SPECIAL1]: 'ICE LANCE', [MOVE.SPECIAL2]: 'GLACIAL RAM', [MOVE.SPECIAL3]: 'FROST SPIKES' },
};
