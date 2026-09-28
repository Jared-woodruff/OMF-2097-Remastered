// Posing the generated robots: limbs by inverse kinematics (feet planted and fists or feet aimed at points on the
// screen), everything else by joint angles. Angles are degrees; z rotations swing limbs forward (toward +x, the way the
// robot faces), and a limb solved by IK stays in the plane of its parent joint.
import { apply3, sub, transpose3, type Vec3 } from './geometry';
import { jointTransforms, type Pose, type RobotModel } from './robot';

/** A screen point: x forward from the object's position, y above the floor (world units). */
export type Target = [number, number];

export interface Stance {
  /** Pelvis offset from its rest position: x forward, y up. */
  root?: [number, number];
  /** Whole-body tilt around the pelvis (degrees, forward positive). */
  tilt?: number;
  /** Ankle targets (near and far leg). */
  footF?: Target;
  footB?: Target;
  /** Foot angles relative to level (toes down positive); default level. */
  footAngleF?: number;
  footAngleB?: number;
  /** Wrist targets (near and far arm); the elbow bends down and back. */
  handF?: Target;
  handB?: Target;
  /** Joint angles for everything else (applied before the IK; IK results override). */
  joints?: Record<string, Vec3>;
  show?: string[];
  hide?: string[];
  attach?: Pose['attach'];
}

/**
 * Angles (degrees) of a two-bone limb whose end must reach (x, y) in the plane of its parent (relative to the root
 * joint, rest direction -y): `bend` +1 folds the middle joint forward of the line (knees), -1 behind it (elbows).
 */
export function twoBoneIK(x: number, y: number, a: number, b: number, bend: 1 | -1): [number, number] {
  const D = Math.max(0.01, Math.min(Math.hypot(x, y), a + b - 0.01));
  const phi = Math.atan2(x, -y);
  const cosA = Math.max(-1, Math.min(1, (a * a + D * D - b * b) / (2 * a * D)));
  const cosB = Math.max(-1, Math.min(1, (a * a + b * b - D * D) / (2 * a * b)));
  const root = phi + bend * Math.acos(cosA);
  const mid = -bend * (Math.PI - Math.acos(cosB));
  return [(root * 180) / Math.PI, (mid * 180) / Math.PI];
}

function jointOffset(model: RobotModel, name: string): Vec3 {
  return model.joints.find((j) => j.name === name)?.offset ?? [0, 0, 0];
}

function parentOf(model: RobotModel, name: string): string | null {
  return model.joints.find((j) => j.name === name)?.parent ?? null;
}

/**
 * Aims a limb (root joint, e.g. 'hipF' or 'shoulderB') so its end reaches a screen point: the viewing ray through
 * the point meets the limb's plane (its parent's x-y plane through the root joint), and the two-bone IK solves in that
 * plane. Writes the root and middle joint angles into the pose.
 */
export function aimLimb(model: RobotModel, pose: Pose, rootJoint: string, midJoint: string, endJoint: string, target: Target, bend: 1 | -1): void {
  const xf = jointTransforms(model, pose);
  const parent = parentOf(model, rootJoint);
  const px = parent ? xf.get(parent)! : null;
  const jx = xf.get(rootJoint)!;
  if (!px) return;
  const n = apply3(px.rot, [0, 0, 1]);
  const p0 = jx.pos;
  const nz = Math.abs(n[2]) < 0.05 ? (n[2] < 0 ? -0.05 : 0.05) : n[2];
  const z = p0[2] + (n[0] * (p0[0] - target[0]) + n[1] * (p0[1] - target[1])) / nz;
  const local = apply3(transpose3(px.rot), sub([target[0], target[1], z], p0));
  const a = -jointOffset(model, midJoint)[1];
  const b = -jointOffset(model, endJoint)[1];
  const [r, m] = twoBoneIK(local[0], local[1], a, b, bend);
  const keep = pose.j[rootJoint] ?? [0, 0, 0];
  pose.j[rootJoint] = [keep[0], keep[1], r];
  const keepMid = pose.j[midJoint] ?? [0, 0, 0];
  pose.j[midJoint] = [keepMid[0], keepMid[1], m];
}

/** Sum of the z rotations from the pelvis down a chain (the limb's angle in the side view). */
function chainAngle(pose: Pose, joints: string[]): number {
  return joints.reduce((acc, j) => acc + (pose.j[j]?.[2] ?? 0), 0);
}

/** Builds a pose from a stance. */
export function stance(model: RobotModel, s: Stance): Pose {
  const pose: Pose = { j: { ...(s.joints ?? {}) }, show: s.show, hide: s.hide, attach: s.attach };
  const root = s.root ?? [0, 0];
  pose.root = [root[0], root[1], 0];
  const pelvis = pose.j.pelvis ?? [0, 0, 0];
  pose.j.pelvis = [pelvis[0], pelvis[1], pelvis[2] - (s.tilt ?? 0)];
  for (const side of ['F', 'B'] as const) {
    const target = side === 'F' ? s.footF : s.footB;
    if (!target) continue;
    aimLimb(model, pose, `hip${side}`, `knee${side}`, `foot${side}`, target, 1);
    const footAngle = (side === 'F' ? s.footAngleF : s.footAngleB) ?? 0;
    const f = pose.j[`foot${side}`] ?? [0, 0, 0];
    pose.j[`foot${side}`] = [f[0], f[1], -chainAngle(pose, ['pelvis', `hip${side}`, `knee${side}`]) - footAngle];
  }
  for (const side of ['F', 'B'] as const) {
    const target = side === 'F' ? s.handF : s.handB;
    if (!target) continue;
    aimLimb(model, pose, `shoulder${side}`, `elbow${side}`, `hand${side}`, target, -1);
  }
  return pose;
}

/** Screen position (x forward, y above the floor) of a point in a joint's frame for a pose. */
export function screenPoint(model: RobotModel, pose: Pose, joint: string, local: Vec3 = [0, 0, 0]): Target {
  const x = jointTransforms(model, pose).get(joint);
  if (!x) return [0, 0];
  const p = apply3(x.rot, local);
  return [p[0] + x.pos[0], p[1] + x.pos[1]];
}
