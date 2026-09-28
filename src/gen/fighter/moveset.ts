// The moves every generated robot shares: the engine's basic animations (jumping, blocking, getting hit, walking,
// idle, victory, defeat) and the basic attacks, with the originals' timing and reaction idioms. Robot specials and
// finishers are added per robot (gen/robots/*).
import { jointTransforms, type Pose } from '../robot';
import type { Body } from './body';
import type { GenMove, GenSprite } from './build';
import * as P from './poses';

/** Move categories (the engine's). */
export const CAT = {
  BASIC: 0,
  CLOSE: 2,
  LOW: 4,
  MEDIUM: 5,
  HIGH: 6,
  JUMPING: 7,
  PROJECTILE: 8,
  ANIM: 9,
  VICTORY: 11,
  SCRAP: 12,
  DESTRUCTION: 13,
} as const;

/** Move ids of the generated robots (the scan order of the input matcher runs 15 -> 69: specific inputs first). */
export const MOVE = {
  SPECIAL1: 15,
  SPECIAL2: 16,
  SPECIAL3: 17,
  SPECIAL4: 18,
  SPECIAL5: 19,
  THROW: 20,
  P3: 22,
  K3: 23,
  K4: 24,
  SCRAP: 25,
  DESTRUCTION: 26,
  P4: 27,
  P2: 30,
  K2: 31,
  P1: 32,
  K1: 33,
  AIR1: 34,
  AIR2: 35,
  FX1: 36,
  FX2: 37,
  FX3: 38,
  FX4: 39,
  FX5: 40,
  K: 41,
  P: 42,
  JUMP_K: 43,
  JUMP_P: 44,
  /** Menu pictures (not fight moves): the robot select screen's cell and the VS screen's big image. */
  PORTRAIT_CELL: 60,
  PORTRAIT_VS: 61,
} as const;

/** Size of a robot select cell (the original grid's). */
export const CELL_W = 51;
export const CELL_H = 36;
/** Background of a robot select cell (black in the select screen's palette, keyed out when drawn in color). */
export const CELL_BACKGROUND = 0xd0;

/** Victim reactions (footers) by weight: what the robot being hit plays on its damage sprites. */
export const REACT = {
  highLight: 'sp13s1l20sf0A1-B4-A3',
  highMedium: 'sp13s1l33sf-6A1-B1-C4-B3-A2',
  highHeavy: 'sp13s1l52bl5sf-16A1-B1-C5-B4-A2',
  midLight: 'sp13s2l20sf0D1-E4-D3',
  midMedium: 'sp13s2l33sf-6D1-E1-F4-E3-D2',
  lowLight: 'sp13s3l20sf0D1-E4-D3',
  lowMedium: 'sp13s3l33sf-6D1-E1-F4-E3-D2',
  launch: 'vx-6y-9s01l60bl6A1-B2-C3-L5-M400',
  sweep: 'vx-5y-9s3l55sp13D1-E2-F2-L5-M500',
  air: 'sp13s1l37sf-8A1-B1-C4-B3-A2',
  projectile: 's01l50A1-sw20B1-C5-B4-A2',
  knockdown: 'vx-8y-8s01l60bl5A1-B2-C3-L5-M300',
} as const;

export const LEAD_PUNCH = ['handB', 'elbowB'];
export const REAR_PUNCH = ['handF', 'elbowF'];
export const REAR_KICK = ['footF', 'kneeF'];
export const LEAD_KICK = ['footB', 'kneeB'];

export const sp = (pose: Pose | null, hit?: string[]): GenSprite => ({ pose, hit });

export interface Links {
  /** Special the basic punches chain into (like the originals' jn tags). */
  chain: number;
  /** Special that may follow right out of getting up. */
  reversal: number;
}

/** The engine's animations (ids 1-6, 9-11) and the endings (48, 49). */
export function coreMoves(b: Body, links: Links): GenMove[] {
  const basic = (id: number, anim: string, sprites: GenSprite[], category: number = CAT.ANIM): GenMove => ({
    id, category, moveString: '0', anim, sprites,
  });
  const idle = [0, 0.25, 0.5, 0.75, 1].map((t) => sp(P.idle(b, t)));
  return [
    basic(1, 'A120-B20-C10-D10-E10-F10-G10-rfE10-rfF10-rfG10-rfH10-D10-C10-B20-A120', [0, 1, 2, 3, 4, 5, 6, 7].map((k) => sp(P.jump(b, k)))),
    basic(2, `A5-B4-jn${links.reversal}C4-jgjn${links.reversal}D4`, [0, 1, 2, 3].map((k) => sp(P.standup(b, k)))),
    basic(3, 'A6-B6-C6-B6', [-1, 0, 1].map((t) => sp(P.stunned(b, t)))),
    basic(4, 'A5', [sp(P.crouch(b))]),
    basic(5, 'A2', [sp(P.block(b))]),
    basic(6, 'A2', [sp(P.crouchBlock(b))]),
    basic(9, 'A1-B1-C1-D1', [...P.DAMAGE_LETTERS].map((l) => sp(P.damage(b, l))), CAT.BASIC),
    basic(10, 'A3-B2-C2-D1-E2-D1-C2-B2', [0, 0.25, 0.5, 0.75, 1].map((t) => sp(P.walk(b, t)))),
    basic(11, 'A3-B2-C2-D2-E3-D2-C2-B2', idle),
    {
      id: 48,
      category: CAT.VICTORY,
      moveString: 'n',
      anim: 'beA3-beB3-beC3-s27l63sp12beD3-jfbeE3-jfF3-jfG1500',
      sprites: [0, 1, 2, 3, 4, 5, 6].map((k) => sp(P.victory(b, k))),
    },
    { id: 49, category: CAT.VICTORY, moveString: 'n', anim: 'A5-B30-A1400', sprites: [0, 1].map((k) => sp(P.defeat(b, k))) },
  ];
}

/** The basic attacks. */
export function basicAttacks(b: Body, links: Links): GenMove[] {
  const c = links.chain;
  return [
    {
      id: MOVE.P, category: CAT.HIGH, moveString: 'P', damage: 8, blockStun: 9, points: 2,
      anim: `A1-sp7sf10l20s5B1-C1-cpD2-nC1-njhjn${c}B2-njhjn${c}A1`,
      footer: REACT.highLight,
      sprites: [sp(P.jab(b, 0)), sp(P.jab(b, -0.2)), sp(P.jab(b, 0.55), LEAD_PUNCH), sp(P.jab(b, 1), LEAD_PUNCH)],
    },
    {
      id: MOVE.K, category: CAT.MEDIUM, moveString: 'K', damage: 22, blockStun: 12, points: 4,
      anim: 'A1-sp7sf-3l33s5B2-C2-cpD3-nC3-jmnB3-jmnA2',
      footer: REACT.midMedium,
      sprites: [sp(P.frontKick(b, 0.15)), sp(P.frontKick(b, 0.4)), sp(P.frontKick(b, 0.72), REAR_KICK), sp(P.frontKick(b, 1), REAR_KICK)],
    },
    {
      id: MOVE.P4, category: CAT.HIGH, moveString: 'P4', damage: 22, blockStun: 12, points: 6,
      anim: `A1-sp7sf-3l33s5B2-C2-cpD3-jhnC3-jhjn${c}nB2-jhjn${c}nA2`,
      footer: REACT.highMedium,
      sprites: [sp(P.cross(b, 0)), sp(P.cross(b, -1)), sp(P.cross(b, 0.5), REAR_PUNCH), sp(P.cross(b, 1), REAR_PUNCH)],
    },
    {
      id: MOVE.K4, category: CAT.HIGH, moveString: 'K4', damage: 35, blockStun: 14, points: 7,
      anim: 'sp7sf-22l52s5A1-B2-cpC2-cpD2-cpE3-nF3-nG3-nH3',
      footer: REACT.highHeavy,
      sprites: [
        sp(P.roundhouse(b, 0.15)), sp(P.roundhouse(b, 0.35), REAR_KICK), sp(P.roundhouse(b, 0.68), REAR_KICK),
        sp(P.roundhouse(b, 1), REAR_KICK), sp(P.roundhouse(b, 0.6)), sp(P.roundhouse(b, 0.3)), sp(P.roundhouse(b, 0.1)),
        sp(P.fight(b)),
      ],
    },
    {
      id: MOVE.P1, category: CAT.HIGH, moveString: 'P1', damage: 35, blockStun: 13, points: 7,
      anim: 'A2-sp7sf-22l52s5B2-C3-cpD3-cpE2-nE4-nD4-jmnC3-jmnB2-jmnA2',
      footer: REACT.launch,
      sprites: [0, 0.25, 0.5, 0.75, 1].map((t) => sp(P.uppercut(b, t), t >= 0.5 ? REAR_PUNCH : undefined)),
    },
    {
      id: MOVE.P2, category: CAT.MEDIUM, moveString: 'P2', damage: 22, blockStun: 12, points: 4,
      anim: `A1-sp7sf-3l33s5B2-C2-cpD3-jlnC3-njn${c}jlB2-njn${c}jlA2`,
      footer: REACT.midMedium,
      sprites: [sp(P.crouchPunch(b, 0, true)), sp(P.crouchPunch(b, -0.15, true)), sp(P.crouchPunch(b, 0.55, true), REAR_PUNCH), sp(P.crouchPunch(b, 1, true), REAR_PUNCH)],
    },
    {
      id: MOVE.P3, category: CAT.MEDIUM, moveString: 'P3', damage: 8, blockStun: 9, points: 2,
      anim: 'sp7sf10l20s5A1-B1-cpC2-njlB2-njlA1',
      footer: REACT.midLight,
      sprites: [sp(P.crouchPunch(b, 0, false, 0.7)), sp(P.crouchPunch(b, 0.55, false, 0.7), LEAD_PUNCH), sp(P.crouchPunch(b, 1, false, 0.7), LEAD_PUNCH)],
    },
    {
      id: MOVE.K3, category: CAT.LOW, moveString: 'K3', damage: 10, blockStun: 9, points: 2,
      anim: 'sp7sf10l20s5A1-B2-cpC2-nB2-nA1',
      footer: REACT.lowLight,
      sprites: [sp(P.lowKick(b, 0, false)), sp(P.lowKick(b, 0.55, false), LEAD_KICK), sp(P.lowKick(b, 1, false), LEAD_KICK)],
    },
    {
      id: MOVE.K2, category: CAT.LOW, moveString: 'K2', damage: 22, blockStun: 12, points: 4,
      anim: 'sp7sf-3l33s5A2-B3-cpC4-jhnB3-jhnA3',
      footer: REACT.lowMedium,
      sprites: [sp(P.lowKick(b, 0, true, 1.25)), sp(P.lowKick(b, 0.55, true, 1.25), REAR_KICK), sp(P.lowKick(b, 1, true, 1.25), REAR_KICK)],
    },
    {
      id: MOVE.K1, category: CAT.LOW, moveString: 'K1', damage: 32, blockStun: 13, points: 6,
      anim: 'A1-B2-sp7sf-18l48s5C2-cpD2-cpE3-jmnF3-jmnG3',
      footer: REACT.sweep,
      sprites: [0, 1, 2, 3, 4, 5, 6].map((k) => sp(P.sweep(b, k), k === 3 || k === 4 ? REAR_KICK : undefined)),
    },
    {
      id: MOVE.THROW, category: CAT.CLOSE, moveString: 'P6', damage: 45, blockStun: 0, successorId: 38, throwDuration: 21, points: 10,
      anim: 'A4-B4-C4-uD4-bb5cpE4-D1-C2-B1',
      footer: 'egx-34B4-egx-24y-22C4-frex+6y-84M4-rfex+30y-88L4-rfex+34y-78m56my+78C1-rfl40s4ex+34y-78m12my+78C3-gy-1M1-vx+4y-8M2-M200',
      sprites: [0, 1, 2, 3, 4].map((k) => sp(P.throwPose(b, k))),
    },
    {
      id: MOVE.JUMP_P, category: CAT.JUMPING, moveString: 'P', damage: 25, blockStun: 12, points: 6, posConstraint: 4,
      anim: 'A2-cpsp7sf-7l37s5B2-cpC10-nB2-nA1',
      footer: REACT.air,
      sprites: [sp(P.jumpPunch(b, 0)), sp(P.jumpPunch(b, 0.55), REAR_PUNCH), sp(P.jumpPunch(b, 1), REAR_PUNCH)],
    },
    {
      id: MOVE.JUMP_K, category: CAT.JUMPING, moveString: 'K', damage: 25, blockStun: 12, points: 6, posConstraint: 4,
      anim: 'A1-sp7sf-7l37s5B2-cpC2-cpD10-nC2-nB1-nA1',
      footer: REACT.air,
      sprites: [sp(P.jumpKick(b, 0)), sp(P.jumpKick(b, 0.4)), sp(P.jumpKick(b, 0.75), LEAD_KICK), sp(P.jumpKick(b, 1), LEAD_KICK)],
    },
  ];
}

export interface FinisherSpec {
  /** Inputs (the originals' notation: button, then directions most recent first). */
  scrap: string;
  destruction: string;
  /** The robot's big finishing blow: 0 wind-up .. 3 follow-through (4 sprites). */
  power: (k: number) => Pose;
  /** Extra tags on the destruction's strike frame (sounds, spawns). */
  strikeTags?: string;
}

/**
 * Scrap: walk up to the beaten robot, lift it overhead and slam it down behind (the victim's reaction is scripted by
 * the footer, as in the originals). Destruction (from the slam, a jf2 window): the robot's power blow and the victim
 * blows apart.
 */
export function finisherMoves(b: Body, f: FinisherSpec): GenMove[] {
  return [
    {
      id: MOVE.SCRAP, category: CAT.SCRAP, moveString: f.scrap, points: 7, extraStringSelector: 2,
      anim: 'bm10amebewx+30A1-bewA3-bewB4-bewC4-bewD14-uabewE6-uabejf2wF30-uabewG4-uabewH8',
      footer: 'uey-84X6-uex+18y-48L2-uex+28y-16fL2-ex+32gsp13s4l60bb8m56m12mi14N3-ex+32O4000',
      sprites: [
        sp(P.fight(b)), sp(P.throwPose(b, 0)), sp(P.throwPose(b, 1)), sp(P.throwPose(b, 2)), sp(P.throwPose(b, 3)),
        sp(P.throwPose(b, 4)), sp(P.crouch(b)), sp(P.victory(b, 4)),
      ],
    },
    {
      id: MOVE.DESTRUCTION, category: CAT.DESTRUCTION, moveString: f.destruction, points: 100, extraStringSelector: 2,
      anim: `uabewA4-uabewB8-${f.strikeTags ?? ''}s29l63sp20uabewbb8C6-uabewD30-uabegwE40`,
      footer: 'uex+32O6-m56my-12N6-bb6m55my-24N6-m57my-20m12mi24N4-s29l63bb10m55my-26N2-Z4000',
      sprites: [sp(f.power(0)), sp(f.power(1)), sp(f.power(2)), sp(f.power(3)), sp(P.victory(b, 6))],
    },
  ];
}

/** The robot select cell (a close-up of the head and shoulders) and the VS screen's full figure. */
export function portraitMoves(b: Body): GenMove[] {
  const cellModel = { ...b.model, turn: -48 };
  const cellPose = P.present(b);
  const scale = 1.45;
  const head = jointTransforms(cellModel, cellPose).get('head')!.pos;
  const cx = Math.round(head[0] * scale - CELL_W / 2 + 2), cy = Math.round((-(head[1] + 17) * scale) / 1.2);
  const vsModel = { ...b.model, turn: -70 };
  const vsPose = P.present(b);
  return [
    {
      id: MOVE.PORTRAIT_CELL, category: CAT.BASIC, moveString: '!', anim: 'A1',
      sprites: [{ pose: cellPose, view: { model: cellModel, scale, rect: [cx, cy, CELL_W, CELL_H], background: CELL_BACKGROUND } }],
    },
    {
      id: MOVE.PORTRAIT_VS, category: CAT.BASIC, moveString: '!', anim: 'A1',
      sprites: [{ pose: vsPose, view: { model: vsModel, scale: 1.55 } }],
    },
  ];
}
