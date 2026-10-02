// Generated robots: a skeleton of joints, each carrying shapes (gen/geometry.ts) painted with one of the robot's three
// color ramps, and poses (joint rotations) that animations blend between. Units are native pixels horizontally; the
// renderers draw rows 1.2 units tall, the height of a native pixel on a 4:3 display.
import { apply3, boundingRadius, compose, euler, IDENTITY, type Mat3, type Shape, type Vec3, type Xform } from './geometry';

/** Color ramps (player colors 1..3) and how bright a material is within its ramp. */
export interface Material {
  ramp: 0 | 1 | 2;
  /** Shade offset (-1..1): darker (joints, recesses) or brighter (visors, glowing parts). */
  tone: number;
  /** Shininess 0..1 (metal highlights). */
  shine: number;
  /** Glows (ignores the lighting). */
  glow?: boolean;
  /**
   * Effect color instead of a player ramp: palette indices [first, count] (dark to bright) among the colors every arena
   * shares (0xA0..0xF9), for projectiles and energy that keep their color whatever the players chose.
   */
  fx?: [number, number];
}

export interface Part {
  shape: Shape;
  /** Placement in the joint's frame. */
  at: Vec3;
  /** Rotation in degrees (x, y, z) in the joint's frame. */
  rot?: Vec3;
  mat: Material;
  /** Parts with a tag can be hidden by a pose; optional ones are only shown when a pose asks for them. */
  tag?: string;
  optional?: boolean;
}

export interface Joint {
  name: string;
  parent: string | null;
  /** Offset from the parent joint in its frame (rest pose). */
  offset: Vec3;
  parts: Part[];
}

/** A pose: joint rotations in degrees (x = bend toward / away from the viewer, y = turn, z = swing in the side view). */
export interface Pose {
  j: Record<string, Vec3>;
  /** Root (pelvis) offset: x forward, y up from the rest hip height, z toward the viewer. */
  root?: Vec3;
  /** Tags of optional parts to show, and of parts to hide. */
  show?: string[];
  hide?: string[];
  /** Extra parts carried by joints in this pose only (effects held in a hand, trails). */
  attach?: { joint: string; part: Part }[];
}

export interface RobotModel {
  name: string;
  joints: Joint[];
  /** Height of the hips above the floor in the rest pose (world units). */
  hipHeight: number;
  /** Height of the ankle joints above the soles. */
  ankle: number;
  /** How the body is turned toward the viewer (degrees around the vertical axis; 0 = pure side view). */
  turn: number;
}

/** A shape placed in the world for rendering. */
export interface PlacedShape {
  shape: Shape;
  /** World to local. */
  inv: Mat3;
  pos: Vec3;
  mat: Material;
  /** Bounding radius (culling and marching). */
  radius: number;
  /** Index of the joint carrying the shape (model.joints order; -1 for loose props). */
  joint: number;
}

/** World transforms of all joints for a pose. The model faces +x; +y is up; +z points at the viewer. */
export function jointTransforms(model: RobotModel, pose: Pose): Map<string, Xform> {
  const out = new Map<string, Xform>();
  const root = pose.root ?? [0, 0, 0];
  const base: Xform = { rot: euler(0, model.turn, 0), pos: [root[0], model.hipHeight + root[1], root[2]] };
  for (const j of model.joints) {
    const parent = j.parent ? out.get(j.parent)! : base;
    const r = pose.j[j.name] ?? [0, 0, 0];
    const local: Xform = { rot: euler(r[0], r[1], r[2]), pos: j.offset };
    out.set(j.name, compose(parent, local));
  }
  return out;
}

function placePart(jx: Xform, part: Part, joint: number, radiusOf: (s: Shape) => number): PlacedShape {
  const local: Xform = { rot: part.rot ? euler(part.rot[0], part.rot[1], part.rot[2]) : IDENTITY, pos: part.at };
  const w = compose(jx, local);
  // The inverse of a rotation is its transpose.
  const inv = [w.rot[0], w.rot[3], w.rot[6], w.rot[1], w.rot[4], w.rot[7], w.rot[2], w.rot[5], w.rot[8]];
  return { shape: part.shape, inv, pos: w.pos, mat: part.mat, radius: radiusOf(part.shape), joint };
}

/** All shapes of the robot placed in the world for a pose. */
export function placeShapes(model: RobotModel, pose: Pose, radiusOf: (s: Shape) => number): PlacedShape[] {
  const xf = jointTransforms(model, pose);
  const out: PlacedShape[] = [];
  const show = new Set(pose.show ?? []), hide = new Set(pose.hide ?? []);
  model.joints.forEach((j, ji) => {
    const jx = xf.get(j.name)!;
    for (const part of j.parts) {
      if (part.tag && (hide.has(part.tag) || (part.optional && !show.has(part.tag)))) continue;
      if (!part.tag && part.optional) continue;
      out.push(placePart(jx, part, ji, radiusOf));
    }
  });
  for (const a of pose.attach ?? []) {
    const jx = xf.get(a.joint);
    if (jx) out.push(placePart(jx, a.part, model.joints.findIndex((j) => j.name === a.joint), radiusOf));
  }
  return out;
}

/** A loose shape (projectiles, effects) placed in the world: at a point, rotated (degrees x, y, z). */
export function prop(shape: Shape, at: Vec3, mat: Material, rot: Vec3 = [0, 0, 0]): PlacedShape {
  const r = euler(rot[0], rot[1], rot[2]);
  const inv = [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
  return { shape, inv, pos: at, mat, radius: boundingRadius(shape), joint: -1 };
}

/** Blends two poses (t = 0: a, 1: b); tags and attachments come from the nearer one. */
export function blendPose(a: Pose, b: Pose, t: number): Pose {
  const j: Record<string, Vec3> = {};
  for (const k of new Set([...Object.keys(a.j), ...Object.keys(b.j)])) {
    const va = a.j[k] ?? [0, 0, 0];
    const vb = b.j[k] ?? [0, 0, 0];
    j[k] = [va[0] + (vb[0] - va[0]) * t, va[1] + (vb[1] - va[1]) * t, va[2] + (vb[2] - va[2]) * t];
  }
  const ra = a.root ?? [0, 0, 0], rb = b.root ?? [0, 0, 0];
  const near = t < 0.5 ? a : b;
  return {
    j,
    root: [ra[0] + (rb[0] - ra[0]) * t, ra[1] + (rb[1] - ra[1]) * t, ra[2] + (rb[2] - ra[2]) * t],
    show: near.show,
    hide: near.hide,
    attach: near.attach,
  };
}

/** Applies a joint's world transform to a local point (e.g. a fist, for hit coordinates). */
export function jointPoint(model: RobotModel, pose: Pose, joint: string, local: Vec3): Vec3 {
  const x = jointTransforms(model, pose).get(joint);
  if (!x) return [0, 0, 0];
  const p = apply3(x.rot, local);
  return [p[0] + x.pos[0], p[1] + x.pos[1], p[2] + x.pos[2]];
}
