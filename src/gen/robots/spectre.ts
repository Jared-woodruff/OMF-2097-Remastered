// SPECTRE: a phantom-like laser robot in the originals' style: skeletal limbs, a narrow V-shaped torso with a glowing
// emblem, a pointed hood with a visor slit, a cloak of long blades hanging from its back, forearm blades with laser
// emitters and pointed feet.
import type { RobotModel } from '../robot';
import { box, hinge, mat, mirrorZ, part, prism, ribs, segment, skeleton, tbox, wedge } from './parts';

const ARMOR = mat(2, 0, 0.85);
const ARMOR_HI = mat(2, 0.12, 1);
const ARMOR_DK = mat(2, -0.35, 0.45);
const JOINT = mat(0, -0.05, 0.8);
const BLADE = mat(1, 0.05, 1);
const GLOW = mat(1, 0.6, 1, true);

const shoulder = [
  hinge(3, 1.8, JOINT),
  part(tbox(4.2, 2.4, 4.6, 0.55, 0.4), [-0.4, 1.8, 1.2], ARMOR),
  part(wedge(2, 4.6, 1.4, -2.6, 0.3), [-1.4, 6.4, 2.8], ARMOR_HI, [10, 0, 34]),
  segment(1.2, 7, 2.6, 2.4, ARMOR),
  segment(7, 15.5, 1.3, 1.3, JOINT, 6),
  ...ribs(7.5, 15, 4, 2.3, 2.1, ARMOR_DK, JOINT),
];
const forearm = [
  hinge(2.6, 1.6, JOINT),
  segment(1.4, 16, 2.4, 2.8, ARMOR, 6),
  part(wedge(1.5, 9.5, 0.5, -1, 0.2), [-3, -9.5, 0], BLADE, [0, 0, 180]),
  part(prism(0.8, 1.4, 1.4, 6), [2.6, -15.5, 0], GLOW, [0, 0, -90]),
];
const hand = [
  part(box(2.3, 2.6, 2.4, 0.5), [0.2, -2.8, 0], JOINT),
  part(wedge(0.8, 2.6, 0.7, 1, 0.2), [2.2, -6.4, 0], BLADE, [0, 0, 180]),
];
const thigh = [
  hinge(3.2, 1.8, JOINT),
  segment(1, 23.5, 3.9, 3, ARMOR, 6),
  ...ribs(2, 6, 2, 4.1, 4, JOINT, ARMOR_DK),
  part(wedge(2.4, 5, 1.4, 1, 0.3), [3.4, -9, 0], ARMOR_HI, [0, 0, 180]),
];
const shin = [
  hinge(3, 1.8, JOINT),
  part(wedge(2.4, 4.4, 2.4, 1.6, 0.3), [3.2, 1.6, 0], ARMOR_HI, [0, 0, -14]),
  segment(1.4, 23.5, 3, 2.3, ARMOR, 6),
];
const foot = [
  hinge(2.2, 1.4, JOINT),
  part(tbox(4, 1.6, 3, 0.8, 0.3), [1.4, -3.2, 0], ARMOR),
  part(wedge(2.8, 5.5, 2.8, 0, 0.3), [10, -3.2, 0], ARMOR_DK, [0, 0, -90]),
];

export const SPECTRE: RobotModel = {
  name: 'SPECTRE',
  hipHeight: 57,
  ankle: 5,
  turn: -38,
  joints: skeleton(
    { spine: 11, chest: 12, neck: 13.5, shoulderY: 9, shoulderZ: 11.5, upperArm: 17, foreArm: 17, hipZ: 6, thigh: 25, shin: 25 },
    {
      pelvis: [
        part(tbox(3.4, 3, 5, 1.1, 0.4), [0, -1.4, 0], ARMOR_DK),
        part(box(3.8, 0.9, 5.4, 0.3), [0, 2, 0], JOINT),
        part(wedge(3.4, 6, 4.6, 0, 0.3), [3.2, -6.4, 0], ARMOR, [0, 0, 180]),
        part(wedge(3.8, 7, 4.8, 0, 0.3), [-3.6, -7.2, 0], ARMOR_DK, [0, 0, 172]),
      ],
      spine: [
        part(prism(0.9, 2.4, 2.6, 6), [0, -5, 0], JOINT),
        part(prism(0.9, 2.6, 2.8, 6), [0, -2.8, 0], JOINT),
        part(prism(0.9, 2.8, 3, 6), [0, -0.6, 0], JOINT),
        part(prism(0.9, 3, 3.2, 6), [0, 1.6, 0], JOINT),
      ],
      chest: [
        part(tbox(2.8, 10.5, 3.6, 2.25, 0.5), [0, 0.8, 0], ARMOR),
        part(wedge(3.4, 4.6, 0.8, 0, 0.3), [5.4, 4.2, 0], GLOW, [0, 90, 180]),
        part(prism(1, 3.2, 2.8, 6), [0, 12, 0], JOINT),
        part(wedge(4.6, 22, 0.6, 3, 0.3), [-11.5, -6, 6.2], ARMOR_DK, [16, 0, 197]),
        part(wedge(5, 24, 0.6, 3, 0.3), [-13, -8, 0], ARMOR, [0, 0, 200]),
        part(wedge(4.6, 22, 0.6, 3, 0.3), [-11.5, -6, -6.2], ARMOR_DK, [-16, 0, 197]),
      ],
      head: [
        part(prism(2.2, 2, 1.8, 6), [0, -1.4, 0], JOINT),
        part(tbox(3.8, 4.4, 3.3, 0.5, 0.4), [0, 4.4, 0], ARMOR),
        part(wedge(3.2, 7.5, 2.6, -7, 0.3), [-3.2, 9.6, 0], ARMOR, [0, 0, 62]),
        part(box(1.2, 2.6, 2.8, 0.3), [3.2, 3.2, 0], ARMOR_DK),
        part(box(0.5, 0.5, 2.7, 0.2), [4.2, 5, 0], GLOW),
      ],
      shoulderF: shoulder,
      elbowF: forearm,
      handF: hand,
      shoulderB: mirrorZ(shoulder),
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
