// HELIX: an industrial drilling robot in the originals' style: a barrel chest with a grille and twin exhaust stacks,
// a squat faceted head with a single round eye and an antenna, a giant spiral drill for its right hand and a
// three-fingered claw on the left, hydraulic pistons on the limbs and heavy tread boots.
import type { Part, RobotModel } from '../robot';
import { box, hinge, mat, mirrorZ, part, prism, ribs, segment, skeleton, tbox, wedge } from './parts';

const ARMOR = mat(2, 0, 0.7);
const ARMOR_HI = mat(2, 0.12, 0.9);
const ARMOR_DK = mat(2, -0.35, 0.4);
const JOINT = mat(0, -0.05, 0.8);
const JOINT_DK = mat(0, -0.35, 0.5);
const STEEL = mat(1, 0.05, 1);
const GLOW = mat(1, 0.6, 1, true);

/** The drill: five-sided sections turning a little each, a twisted cone around the hand's axis. */
const drill: Part[] = [
  part(prism(1.4, 4.4, 4.4, 8), [0, -1.4, 0], JOINT),
  ...[4.6, 3.9, 3.2, 2.5, 1.8, 1.1].map((r, i) => part(prism(2.2, r - 0.7, r, 5), [0, -5 - 4.4 * i, 0], STEEL, [0, 22 * i, 0])),
];
const claw: Part[] = [
  part(box(3.2, 2.8, 3.4, 0.6), [0.2, -2.6, 0], JOINT),
  part(wedge(1.5, 5.6, 1.2, 2, 0.3), [2.6, -8.2, 1.7], STEEL, [0, 0, 16]),
  part(wedge(1.5, 5.6, 1.2, 2, 0.3), [2.6, -8.2, -1.7], STEEL, [0, 0, 16]),
  part(wedge(1.5, 4.8, 1.2, -2, 0.3), [-2.6, -7.4, 0], STEEL, [0, 0, -16]),
];
const shoulder = [
  hinge(3.8, 2.2, JOINT),
  part(tbox(5.2, 2.6, 5.4, 0.66, 0.5), [0, 2, 1.4], ARMOR),
  part(box(4.4, 0.7, 5.6, 0.3), [0, -0.8, 1.4], JOINT_DK),
  segment(1.2, 13.5, 3.2, 2.8, ARMOR),
  part(prism(5, 0.9, 0.9, 6), [2.8, -7.5, 2.2], JOINT, [0, 0, 6]),
];
const forearm = [
  hinge(3.4, 2, JOINT),
  segment(1.5, 6, 3.4, 3.4, JOINT_DK, 8),
  ...ribs(2, 8.5, 3, 3.9, 4.1, JOINT, JOINT_DK),
  segment(8.5, 14.5, 4.2, 4.4, ARMOR, 8),
];
const thigh = [
  hinge(4, 2.3, JOINT),
  segment(1, 17.5, 5.2, 4.4, ARMOR, 8),
  ...ribs(17.5, 22, 2, 4, 3.9, JOINT, JOINT_DK),
  part(prism(6, 1, 1, 6), [2.2, -10.5, 4], JOINT, [0, 0, -4]),
];
const shin = [
  hinge(4, 2.3, JOINT),
  part(tbox(2, 3, 3.4, 0.7, 0.3), [4, 0.4, 0], ARMOR_HI),
  segment(1.5, 20, 4, 4.8, ARMOR, 8),
  part(box(1, 6, 3.4, 0.3), [4.8, -11, 0], ARMOR_HI),
];
const foot = [
  hinge(3, 1.8, JOINT),
  part(tbox(8.4, 2.2, 5, 0.85, 0.4), [2.6, -3, 0], ARMOR),
  part(box(8.8, 0.9, 5.3, 0.3), [2.6, -5.1, 0], JOINT_DK),
];

export const HELIX: RobotModel = {
  name: 'HELIX',
  hipHeight: 53,
  ankle: 6,
  turn: -38,
  joints: skeleton(
    { spine: 9, chest: 12, neck: 12, shoulderY: 9.5, shoulderZ: 13.5, upperArm: 15, foreArm: 15, hipZ: 7, thigh: 23, shin: 22 },
    {
      pelvis: [
        part(tbox(4.4, 3.2, 6.4, 1.1, 0.4), [0, -1.4, 0], ARMOR),
        part(box(4.8, 1.1, 6.8, 0.3), [0, 2.2, 0], JOINT),
        part(box(1.4, 2.6, 2.8, 0.3), [4.8, -1.8, 0], ARMOR_HI),
      ],
      spine: [
        part(prism(0.9, 3.6, 3.8, 8), [0, -4.2, 0], JOINT),
        part(prism(0.9, 3.8, 4, 8), [0, -1.8, 0], ARMOR_DK),
        part(prism(0.9, 4, 4.2, 8), [0, 0.6, 0], JOINT),
      ],
      chest: [
        part(tbox(4, 10.5, 5, 1.75, 0.6), [0, 1.5, 0], ARMOR),
        part(box(0.5, 0.45, 3.4, 0.2), [6.6, 8, 0], JOINT_DK),
        part(box(0.5, 0.45, 3.4, 0.2), [6.4, 5.8, 0], JOINT_DK),
        part(box(0.5, 0.45, 3.4, 0.2), [6.1, 3.6, 0], JOINT_DK),
        part(prism(5.5, 1.6, 1.6, 6), [-7, 13.5, 3.6], JOINT, [0, 0, 14]),
        part(prism(5.5, 1.6, 1.6, 6), [-7, 13.5, -3.6], JOINT, [0, 0, 14]),
        part(prism(0.8, 1.9, 1.9, 6), [-8.4, 19.2, 3.6], JOINT_DK, [0, 0, 14]),
        part(prism(0.8, 1.9, 1.9, 6), [-8.4, 19.2, -3.6], JOINT_DK, [0, 0, 14]),
        part(prism(1, 4, 3.6, 8), [0, 12.6, 0], JOINT),
      ],
      head: [
        part(prism(2, 2.6, 2.4, 6), [0, -1.2, 0], JOINT),
        part(prism(3.6, 4.8, 2.6, 8), [0.3, 3.8, 0], ARMOR),
        part(prism(0.9, 1.7, 1.7, 8), [4.4, 3.8, 0], JOINT_DK, [0, 0, -90]),
        part(prism(0.5, 1.2, 1.2, 8), [5.1, 3.8, 0], GLOW, [0, 0, -90]),
        part(prism(3.2, 0.35, 0.35, 4), [-1.6, 10, 1.4], JOINT, [0, 0, 14]),
        part(prism(0.6, 0.8, 0.8, 6), [-2.4, 13.4, 1.4], GLOW),
      ],
      shoulderF: shoulder,
      elbowF: forearm,
      handF: drill,
      shoulderB: mirrorZ(shoulder),
      elbowB: mirrorZ(forearm),
      handB: mirrorZ(claw),
      hipF: thigh,
      kneeF: shin,
      footF: foot,
      hipB: mirrorZ(thigh),
      kneeB: mirrorZ(shin),
      footB: mirrorZ(foot),
    },
  ),
};
