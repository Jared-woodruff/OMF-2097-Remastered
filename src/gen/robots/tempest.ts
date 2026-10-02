// TEMPEST: a slender aerial robot built around wind turbines, in the originals' style: a narrow V-shaped torso with a
// turbine intake, two swept wing blades on the back, a finned helmet, forearm fins and jet boosters on the calves.
// Light, fast and agile in the air.
import type { RobotModel } from '../robot';
import { box, hinge, mat, mirrorZ, part, prism, ribs, segment, skeleton, tbox, wedge } from './parts';

const ARMOR = mat(2, 0, 0.8);
const ARMOR_HI = mat(2, 0.12, 0.95);
const ARMOR_DK = mat(2, -0.35, 0.4);
const JOINT = mat(0, -0.05, 0.8);
const FIN = mat(1, 0.05, 1);
const GLOW = mat(1, 0.6, 1, true);

const shoulder = [
  hinge(3.2, 2, JOINT),
  part(prism(2, 4.4, 2.6, 6), [0, 1.4, 1.2], ARMOR),
  part(wedge(1.4, 4.8, 0.5, -3.2, 0.25), [-2, 5.4, 3.2], FIN, [18, 0, 40]),
  segment(1.2, 14.5, 2.8, 2.5, ARMOR),
];
const forearm = [
  hinge(2.8, 1.7, JOINT),
  segment(1.5, 15, 2.8, 3.2, ARMOR, 6, 0.2),
  part(prism(0.7, 3.5, 3.5, 8), [0.2, -4.5, 0], JOINT),
  part(prism(0.7, 3.7, 3.7, 8), [0.2, -11.5, 0], JOINT),
  part(wedge(1.3, 6.5, 0.5, -4.2, 0.25), [-3.6, -8.5, 0], FIN, [0, 0, 162]),
  hinge(2.7, 1, JOINT, [0, -15.6, 0]),
];
const fist = [part(box(2.8, 3, 2.9, 0.6), [0.3, -3, 0], JOINT)];
const thigh = [
  hinge(3.6, 2, JOINT),
  segment(1, 19, 4.6, 3.7, ARMOR, 8),
  part(box(0.9, 5.5, 2.8, 0.5), [4.3, -10, 0], ARMOR_HI),
  ...ribs(19, 24, 2, 3.4, 3.3, JOINT, ARMOR_DK),
];
const shin = [
  hinge(3.4, 2, JOINT),
  part(wedge(2.2, 3, 2.6, 1.2, 0.3), [3.4, 0.6, 0], ARMOR_HI, [0, 0, -12]),
  segment(1.5, 23, 3.4, 2.7, ARMOR, 6),
  part(prism(4.4, 2, 2.6, 8), [-3.7, -10, 0], JOINT),
  part(prism(0.4, 1.8, 1.8, 8), [-3.7, -14.8, 0], GLOW),
];
const foot = [
  hinge(2.4, 1.5, JOINT),
  part(tbox(7, 1.9, 3.2, 0.72, 0.3), [3.4, -3.1, 0], ARMOR),
  part(box(1.5, 1.5, 3.3, 0.3), [9.6, -3.5, 0], JOINT),
];

export const TEMPEST: RobotModel = {
  name: 'TEMPEST',
  hipHeight: 57,
  ankle: 5,
  turn: -38,
  joints: skeleton(
    { spine: 10, chest: 11, neck: 14, shoulderY: 9, shoulderZ: 12, upperArm: 16, foreArm: 16, hipZ: 6, thigh: 25, shin: 25 },
    {
      pelvis: [
        part(tbox(3.8, 3, 5.6, 1.1, 0.4), [0, -1.4, 0], ARMOR),
        part(box(4.2, 1, 6, 0.3), [0, 2, 0], JOINT),
        part(wedge(2.2, 2.6, 2, 0, 0.3), [4, -2.6, 0], ARMOR_HI, [0, 0, 180]),
      ],
      spine: ribs(-2.4, 6.5, 4, 3.5, 2.9, JOINT, ARMOR_DK),
      chest: [
        part(tbox(3, 11, 3.8, 2.3, 0.9), [0, 0.5, 0], ARMOR),
        part(prism(0.9, 3.2, 3.2, 8), [5.2, 5, 0], JOINT, [0, 0, -90]),
        part(prism(0.5, 2, 2, 8), [6, 5, 0], GLOW, [0, 0, -90]),
        part(prism(1, 3.6, 3.2, 8), [0, 11.8, 0], JOINT),
        part(wedge(4.6, 17, 0.7, -7, 0.3), [-11.5, 20, 5], FIN, [20, 0, 50]),
        part(wedge(4.6, 17, 0.7, -7, 0.3), [-11.5, 20, -5], FIN, [-20, 0, 50]),
        part(wedge(3, 11, 0.6, -5, 0.3), [-9.5, 12.5, 6.4], FIN, [26, 0, 66]),
        part(wedge(3, 11, 0.6, -5, 0.3), [-9.5, 12.5, -6.4], FIN, [-26, 0, 66]),
      ],
      head: [
        part(prism(2.2, 2.2, 2, 6), [0, -1.4, 0], JOINT),
        part(tbox(3.8, 4, 3.4, 0.75, 0.9), [0.4, 4, 0], ARMOR),
        part(wedge(2, 2.6, 2.8, 0, 0.3), [4, 1.6, 0], ARMOR_DK, [0, 0, -90]),
        part(box(0.5, 0.7, 2.7, 0.2), [4.1, 4.6, 0], GLOW),
        part(wedge(2, 8.5, 0.6, -6, 0.3), [-3, 10, 0], FIN, [0, 0, 52]),
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
