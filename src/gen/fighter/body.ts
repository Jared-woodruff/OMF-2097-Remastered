// Measurements of a generated robot that its poses are built from, and its fighting style.
import type { RobotModel } from '../robot';

export interface Style {
  /** Half the distance between the feet in the fighting stance (fraction of the leg length). */
  stance: number;
  /** How far the pelvis sinks in the stance (fraction of the leg length). */
  drop: number;
  /** Forward lean of the chest (degrees). */
  lean: number;
  /** Lead fist in the guard: forward and above the shoulder (fractions of the arm length). */
  guardX: number;
  guardY: number;
  /** Rear fist in the guard. */
  rearX: number;
  rearY: number;
  /** Idle breathing (world units the pelvis moves). */
  bob: number;
}

export interface Body {
  model: RobotModel;
  style: Style;
  /** Leg length (thigh + shin). */
  L: number;
  /** Hip height at rest. */
  H: number;
  /** Arm length (upper arm + forearm). */
  A: number;
  /** Shoulder height above the floor at rest. */
  S: number;
  /** Ankle height above the soles. */
  ankle: number;
}

function offset(model: RobotModel, name: string): number[] {
  return model.joints.find((j) => j.name === name)?.offset ?? [0, 0, 0];
}

export function measure(model: RobotModel, style: Style): Body {
  const L = -offset(model, 'kneeF')[1] - offset(model, 'footF')[1];
  const A = -offset(model, 'elbowF')[1] - offset(model, 'handF')[1];
  const S = model.hipHeight + offset(model, 'spine')[1] + offset(model, 'chest')[1] + offset(model, 'shoulderF')[1];
  return { model, style, L, H: model.hipHeight, A, S, ankle: model.ankle };
}
