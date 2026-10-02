// Building blocks for the generated robots: shape constructors, materials and the shared humanoid skeleton.
import { ShapeKind, type Shape, type Vec3 } from '../geometry';
import type { Joint, Material, Part } from '../robot';

export const box = (a: number, b: number, c: number, r = 1): Shape => ({ kind: ShapeKind.RBOX, a, b, c, r });
export const ball = (a: number, b = a, c = a): Shape => ({ kind: ShapeKind.ELLIPSOID, a, b, c, r: 0 });
export const capsule = (halfLen: number, r: number): Shape => ({ kind: ShapeKind.CAPSULE, a: halfLen, b: 0, c: 0, r });
export const cylinder = (halfLen: number, r: number, round = 0.6): Shape => ({ kind: ShapeKind.CYLINDER, a: halfLen, b: 0, c: round, r });
export const cone = (halfLen: number, r0: number, r1: number): Shape => ({ kind: ShapeKind.CONE, a: halfLen, b: r1, c: 0, r: r0 });
export const limb = (halfLen: number, r0: number, r1: number): Shape => ({ kind: ShapeKind.RCONE, a: halfLen, b: r1, c: 0, r: r0 });
/** Triangular fin: base half width a at y = -b, apex at (k, b), half thickness c, rounded by r. */
export const wedge = (a: number, b: number, c: number, k = 0, r = 0.4): Shape => ({ kind: ShapeKind.WEDGE, a, b, c, r, k });
/** Box (half size a, b, c at the bottom) tapering by factor k toward the top, rounded by r. */
export const tbox = (a: number, b: number, c: number, k: number, r = 1): Shape => ({ kind: ShapeKind.TBOX, a, b, c, r, k });
/**
 * Faceted prism along y, `sides` flat faces (one toward +x): apothem r0 at the bottom, r1 at the top (0: a pyramid),
 * squash < 1 thins it sideways (z). The originals' limbs and joints were low-polygon tubes like these.
 */
export const prism = (halfLen: number, r0: number, r1 = r0, sides = 6, squash = 1): Shape => ({
  kind: ShapeKind.PRISM, a: halfLen, b: r1, c: squash, r: r0, k: sides,
});

/**
 * Materials in the player's three color ramps, used as on the original robots: 2 = primary (the armor, most of the
 * robot), 0 = tertiary (joint rings, belts, the mechanics between the plates), 1 = secondary (a few signature accents:
 * emblems, eyes, claws, blades, crystals).
 */
export const mat = (ramp: 0 | 1 | 2, tone = 0, shine = 0.5, glow = false): Material => ({ ramp, tone, shine, glow });

/** Effect colors shared by every arena palette (dark to bright). */
export const FX = {
  green: [0xa0, 8],
  blue: [0xa8, 8],
  red: [0xb0, 8],
  purple: [0xb8, 8],
  steel: [0xc0, 8],
  gold: [0xc8, 8],
  grey: [0xd0, 16],
  cyan: [0xe0, 8],
  sand: [0xe8, 8],
  fire: [0xf0, 4],
} as const satisfies Record<string, [number, number]>;

export const fxMat = (range: readonly [number, number], glow = false, tone = 0, shine = 0.8): Material => ({
  ramp: 0,
  tone,
  shine,
  glow,
  fx: [range[0], range[1]],
});

export const part = (shape: Shape, at: Vec3, m: Material, rot?: Vec3, opts?: { tag?: string; optional?: boolean }): Part => ({
  shape,
  at,
  mat: m,
  rot,
  tag: opts?.tag,
  optional: opts?.optional,
});

/** A joint ring around the hinge axis (z): radius r, half width w. */
export const hinge = (r: number, w: number, m: Material, at: Vec3 = [0, 0, 0], sides = 8): Part => part(prism(w, r, r, sides), at, m, [90, 0, 0]);

/**
 * Rings stacked along y from y = -from to y = -to (radius r0 to r1), alternating two materials: the ribbed, segmented
 * sections many of the original robots have.
 */
export function ribs(from: number, to: number, count: number, r0: number, r1: number, m0: Material, m1: Material, sides = 8): Part[] {
  const step = (to - from) / count;
  return Array.from({ length: count }, (_, i) => {
    const r = r0 + ((r1 - r0) * (i + 0.5)) / count;
    return part(prism(step * 0.42, r, r, sides), [0, -(from + step * (i + 0.5)), 0], i % 2 ? m1 : m0);
  });
}

/**
 * A limb segment hanging from its joint: a prism from y = -from to y = -to, radius rTop at the joint end and rEnd at
 * the far end, set forward by dx.
 */
export const segment = (from: number, to: number, rTop: number, rEnd: number, m: Material, sides = 6, dx = 0, squash = 1): Part =>
  part(prism((to - from) / 2, rEnd, rTop, sides, squash), [dx, -(from + to) / 2, 0], m);

/** Skeleton proportions (world units: native pixels wide; the renderers make rows 1.2 units tall). */
export interface Proportions {
  spine: number;
  chest: number;
  neck: number;
  shoulderY: number;
  shoulderZ: number;
  upperArm: number;
  foreArm: number;
  hipZ: number;
  thigh: number;
  shin: number;
}

export const JOINTS = [
  'pelvis', 'spine', 'chest', 'head',
  'shoulderF', 'elbowF', 'handF', 'shoulderB', 'elbowB', 'handB',
  'hipF', 'kneeF', 'footF', 'hipB', 'kneeB', 'footB',
] as const;
export type JointName = (typeof JOINTS)[number];

/**
 * The humanoid skeleton every generated robot uses (F = the limbs on the viewer's side, B = the far side). Limbs hang
 * down in the rest pose; z rotations swing them forward (toward +x), x rotations spread them sideways.
 */
export function skeleton(p: Proportions, parts: Partial<Record<JointName, Part[]>>): Joint[] {
  const j = (name: JointName, parent: JointName | null, offset: Vec3): Joint => ({ name, parent, offset, parts: parts[name] ?? [] });
  return [
    j('pelvis', null, [0, 0, 0]),
    j('spine', 'pelvis', [0, p.spine, 0]),
    j('chest', 'spine', [0, p.chest, 0]),
    j('head', 'chest', [0, p.neck, 0]),
    j('shoulderF', 'chest', [0, p.shoulderY, p.shoulderZ]),
    j('elbowF', 'shoulderF', [0, -p.upperArm, 0]),
    j('handF', 'elbowF', [0, -p.foreArm, 0]),
    j('shoulderB', 'chest', [0, p.shoulderY, -p.shoulderZ]),
    j('elbowB', 'shoulderB', [0, -p.upperArm, 0]),
    j('handB', 'elbowB', [0, -p.foreArm, 0]),
    j('hipF', 'pelvis', [0, -2, p.hipZ]),
    j('kneeF', 'hipF', [0, -p.thigh, 0]),
    j('footF', 'kneeF', [0, -p.shin, 0]),
    j('hipB', 'pelvis', [0, -2, -p.hipZ]),
    j('kneeB', 'hipB', [0, -p.thigh, 0]),
    j('footB', 'kneeB', [0, -p.shin, 0]),
  ];
}

/** Parts mirrored for the far-side limb. */
export function mirrorZ(parts: Part[]): Part[] {
  return parts.map((q) => ({ ...q, at: [q.at[0], q.at[1], -q.at[2]] as Vec3, rot: q.rot ? ([-q.rot[0], -q.rot[1], q.rot[2]] as Vec3) : undefined }));
}
