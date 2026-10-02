// JAGUAR (FIGHTR0.AF) as a 3D model for the Blender pipeline, measured from its sprites and paintings: a tall robot of
// boxes on gold ball joints; a broad chest with the red jaguar-face shield, two tall fins rising behind the shoulders,
// an inverted trapezoid helmet with a dark visor, slanted red eyes and a crest; two gold rods for a waist, a tapered
// pelvis block, long box limbs and pointed feet. World units are native pixels across, the sprites' rows 1.2 units
// tall (src/gen/raster.ts); tools/blender/originals refines the measures against the sprites.
import { ball, box, cylinder, mat, mirrorZ, part, skeleton, tbox, wedge } from '../../../../src/gen/robots/parts';
import type { RobotModel } from '../../../../src/gen/robot';

const ARMOR = mat(2, 0, 0.7);
const ARMOR_HI = mat(2, 0.12, 0.9);
const ARMOR_DK = mat(2, -0.35, 0.45);
const GOLD = mat(0, -0.05, 0.85);
const RED = mat(1, 0.1, 0.9);

const arm = [
  part(ball(3.2), [0, 0, 0], GOLD),
  part(tbox(3, 5.4, 3, 1.1, 0.5), [0, -7.2, 0], ARMOR),
  part(ball(2.5), [0, -13.5, 0], GOLD),
];
const forearm = [part(tbox(2.7, 5.2, 2.7, 1.12, 0.5), [0.3, -6.4, 0], ARMOR)];
const hand = [
  part(ball(1.9), [0, 0, 0], GOLD),
  part(box(2.2, 2, 1.6, 0.4), [0.5, -2.8, 0], ARMOR),
  part(box(0.8, 1.6, 1.4, 0.3), [2.2, -4.4, 0], ARMOR_HI),
  part(box(0.7, 1.3, 0.8, 0.3), [1.6, -3, 1.7], ARMOR_HI),
];
const thigh = [
  part(ball(3), [0, 0, 0], GOLD),
  part(tbox(4.2, 9.6, 3.9, 1.12, 0.6), [0.2, -11.6, 0], ARMOR),
  part(ball(2.9), [0, -22.8, 0], GOLD),
];
const shin = [part(tbox(3.6, 9.4, 3.1, 1.15, 0.5), [0, -11, 0], ARMOR)];
const foot = [
  part(ball(2.6), [0, 0, 0], GOLD),
  part(box(4.6, 1.8, 2.9, 0.5), [1.4, -3.6, 0], ARMOR),
  part(box(2.6, 1.2, 2.5, 0.4), [7.2, -4.4, 0], ARMOR_HI),
];

export const JAGUAR: RobotModel = {
  name: 'JAGUAR',
  hipHeight: 52.4,
  ankle: 6,
  turn: -38,
  joints: skeleton(
    { spine: 12, chest: 5.2, neck: 18, shoulderY: 13.2, shoulderZ: 13.5, upperArm: 13.5, foreArm: 12, hipZ: 4.5, thigh: 22.8, shin: 21.6 },
    {
      pelvis: [part(tbox(5.6, 5.6, 8, 1.18, 0.6), [0, 6.4, 0], ARMOR)],
      spine: [
        part(cylinder(2.4, 2.3, 0.4), [0, 2.6, 3.6], GOLD),
        part(cylinder(2.4, 2.3, 0.4), [0, 2.6, -3.6], GOLD),
      ],
      chest: [
        part(tbox(6.5, 7.8, 10.5, 1.12, 0.8), [0, 8.4, 0], ARMOR),
        part(tbox(0.6, 7.6, 1.4, 4.6, 0.2), [7.9, 6.6, 0], RED),
        part(wedge(2.2, 5.5, 0.7, 0, 0.3), [-2, 19, 13], ARMOR_HI, [38, 0, 0]),
        part(wedge(2.2, 5.5, 0.7, 0, 0.3), [-2, 19, -13], ARMOR_HI, [-38, 0, 0]),
        part(ball(3.2, 2.2, 3.2), [0, 18, 0], GOLD),
      ],
      head: [
        part(tbox(5.2, 4.8, 5.5, 1.45, 0.6), [0.5, 6, 0], ARMOR),
        part(tbox(0.8, 2.6, 4.4, 1.25, 0.3), [5.6, 6.6, 0], ARMOR_DK),
        part(box(0.5, 0.8, 1.4, 0.2), [6.4, 7, 2.2], RED, [25, 0, 0]),
        part(box(0.5, 0.8, 1.4, 0.2), [6.4, 7, -2.2], RED, [-25, 0, 0]),
        part(wedge(2, 3, 0.8, -2, 0.3), [-2, 11, 0], ARMOR_HI),
      ],
      shoulderF: arm,
      elbowF: forearm,
      handF: hand,
      shoulderB: mirrorZ(arm),
      elbowB: mirrorZ(forearm),
      handB: mirrorZ(hand),
      hipF: thigh,
      kneeF: shin,
      footF: foot,
      hipB: mirrorZ(thigh),
      kneeB: mirrorZ(shin),
      footB: mirrorZ(foot),
    },
  ),
};

/**
 * Details the renderings show that the fitting does not need (too small to place by the sprites): the jaguar face's
 * two slanted eyes on the chest emblem, wherever the refined model has the emblem.
 */
export function jaguarDecor(model: RobotModel): { joint: string; part: ReturnType<typeof part> }[] {
  const chest = model.joints.find((j) => j.name === 'chest');
  const emblem = chest?.parts.find((p) => p.mat.ramp === 1 && !p.mat.glow);
  if (!emblem) return [];
  const [x, y] = emblem.at;
  const { a, b, c, k = 1 } = emblem.shape;
  const top = c * k;
  const eye = (side: number) => part(box(0.3, b * 0.12, top * 0.2, 0.15), [x + a + 0.2, y + b * 0.3, side * top * 0.42], ARMOR_DK, [side * 30, 0, 0]);
  return [{ joint: 'chest', part: eye(1) }, { joint: 'chest', part: eye(-1) }];
}
