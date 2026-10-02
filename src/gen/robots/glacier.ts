// GLACIER: a heavy ice juggernaut, built like the original robots: faceted armor plates over a slim frame, broad
// shoulders crowned with ice crystals, a crystal core in the chest, heavy gauntlets and boots. The biggest of the new
// robots; slow and strong.
import type { RobotModel } from '../robot';
import { box, hinge, mat, mirrorZ, part, prism, ribs, segment, skeleton, tbox } from './parts';

const ARMOR = mat(2, 0, 0.7);
const ARMOR_HI = mat(2, 0.12, 0.9);
const ARMOR_DK = mat(2, -0.35, 0.4);
const JOINT = mat(0, -0.05, 0.8);
const CRYSTAL = mat(1, 0.08, 1);
const GLOW = mat(1, 0.6, 1, true);

/** An ice crystal: a five-sided spike. */
const crystal = (len: number, r: number, at: [number, number, number], rot: [number, number, number]) =>
  part(prism(len / 2, r, 0.05, 5), at, CRYSTAL, rot);

const shoulder = [
  hinge(4.2, 2.4, JOINT),
  part(prism(2.6, 6.4, 3.6, 8), [0, 1.6, 1.8], ARMOR),
  part(prism(0.7, 6.6, 6.6, 8), [0, -1.4, 1.8], ARMOR_DK),
  crystal(13, 3.2, [-1, 10.6, 3], [22, 0, 14]),
  crystal(9, 2.4, [3.4, 8, 4.4], [34, 0, -24]),
  crystal(7, 1.8, [-4.6, 7, 4.6], [40, 0, 46]),
  segment(1.5, 9.5, 3.7, 3.5, ARMOR),
  ...ribs(9.5, 15.5, 3, 3.1, 3, JOINT, ARMOR_DK),
];
const forearm = [
  hinge(3.7, 2.1, JOINT),
  segment(2, 16, 4.1, 4.7, ARMOR, 6, 0.3),
  part(box(1, 6, 3.8, 0.3), [5.1, -9.5, 0], ARMOR_HI),
  crystal(7, 1.7, [-5.4, -8.5, 0], [0, 0, 70]),
  hinge(3.6, 1.3, JOINT, [0, -16.6, 0]),
];
const fist = [
  part(box(3.3, 3.4, 3.4, 0.9), [0.4, -3.6, 0], ARMOR_DK),
  part(box(0.9, 3.2, 3.5, 0.5), [4, -4, 0], JOINT),
];
const thigh = [
  hinge(4.4, 2.5, JOINT),
  segment(1, 18, 6, 5, ARMOR, 8),
  part(box(1.1, 6.5, 3.8, 0.5), [5.6, -10, 0], ARMOR_HI),
  ...ribs(18, 23, 2, 4.4, 4.2, JOINT, ARMOR_DK),
];
const shin = [
  hinge(4.4, 2.5, JOINT),
  part(tbox(2.2, 3.4, 3.8, 0.66, 0.3), [4.6, 0.8, 0], ARMOR_HI),
  segment(1.5, 21, 4.2, 5, ARMOR, 6),
  part(box(1.1, 7, 3.8, 0.3), [5.2, -11.5, 0], ARMOR_HI),
];
const foot = [
  hinge(3.2, 1.9, JOINT),
  part(tbox(8.6, 2.5, 5, 0.8, 0.8), [3.2, -3.5, 0], ARMOR),
  part(box(2, 1.9, 5, 0.7), [11.2, -4, 0], JOINT),
];

export const GLACIER: RobotModel = {
  name: 'GLACIER',
  hipHeight: 55,
  ankle: 6,
  turn: -38,
  joints: skeleton(
    { spine: 10, chest: 12, neck: 15.5, shoulderY: 9.5, shoulderZ: 14, upperArm: 16, foreArm: 17, hipZ: 7, thigh: 24, shin: 23 },
    {
      pelvis: [
        part(tbox(4.6, 3.4, 6.8, 1.12, 0.4), [0, -1.4, 0], ARMOR),
        part(box(5, 1.2, 7.4, 0.3), [0, 2.4, 0], JOINT),
        part(tbox(1.6, 2.8, 2.6, 0.6, 0.3), [4.8, -2, 0], ARMOR_HI),
      ],
      spine: ribs(-2.6, 7, 4, 4.2, 3.4, JOINT, ARMOR_DK),
      chest: [
        part(tbox(3.5, 11.6, 4.6, 2.2, 1), [0, 0.4, 0], ARMOR),
        part(box(1.4, 4, 3.8, 0.3), [5.8, 6.6, 3.8], ARMOR_HI, [0, 14, -8]),
        part(box(1.4, 4, 3.8, 0.3), [5.8, 6.6, -3.8], ARMOR_HI, [0, -14, -8]),
        part(prism(1, 2.3, 2.3, 6), [5.8, 0.2, 0], GLOW, [0, 0, -90]),
        part(prism(1.1, 4.2, 3.6, 8), [0, 12.4, 0], JOINT),
        crystal(16, 3.6, [-5.5, 14, 3.2], [10, 0, 34]),
        crystal(12, 2.8, [-6.6, 12, -3.4], [-10, 0, 48]),
      ],
      head: [
        part(prism(2.4, 2.6, 2.4, 6), [0, -1.6, 0], JOINT),
        part(tbox(5, 5.2, 4.6, 0.78, 0.9), [0.5, 5, 0], ARMOR),
        part(box(1.6, 2.2, 3.5, 0.3), [5.1, 2, 0], ARMOR_DK),
        part(box(0.5, 0.9, 3.4, 0.2), [5.5, 5.8, 0], GLOW),
        crystal(9, 2.1, [-1, 13.2, 0], [0, 0, 18]),
      ],
      shoulderF: shoulder,
      elbowF: forearm,
      handF: fist,
      shoulderB: mirrorZ(shoulder),
      elbowB: mirrorZ(forearm),
      handB: mirrorZ(fist),
      hipF: thigh,
      kneeF: shin,
      footF: foot,
      hipB: mirrorZ(thigh),
      kneeB: mirrorZ(shin),
      footB: mirrorZ(foot),
    },
  ),
};
