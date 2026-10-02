// Geometry for the generated robots and arenas: vectors, rotations, and ray intersections with the shapes they are
// built from. Shapes are signed distance functions (after Inigo Quilez, https://iquilezles.org/articles/distfunctions):
// a ray enters the shape's bounding sphere and then marches its distance field to the surface. The same functions run
// in GLSL for the HD renderings (gen/gpuShaders.ts), so both resolutions show the same shapes.

export type Vec3 = [number, number, number];

export const v3 = (x: number, y: number, z: number): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec3): number => Math.sqrt(dot(a, a));
export const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** 3x3 matrix, row-major: m[r * 3 + c]. */
export type Mat3 = number[];

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  }
  return o;
}

export function apply3(m: Mat3, v: Vec3): Vec3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

/** Transpose (the inverse of a rotation). */
export function transpose3(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function rotX(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
export function rotY(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
export function rotZ(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** Rotation from angles in degrees: Z (in the side view's plane) first, then X, then Y. */
export function euler(x: number, y: number, z: number): Mat3 {
  const d = Math.PI / 180;
  return mul3(rotY(y * d), mul3(rotX(x * d), rotZ(z * d)));
}

/** A rigid transform: world = rot * local + pos. */
export interface Xform {
  rot: Mat3;
  pos: Vec3;
}

export const IDENTITY_XFORM: Xform = { rot: IDENTITY, pos: [0, 0, 0] };

export function compose(parent: Xform, child: Xform): Xform {
  return { rot: mul3(parent.rot, child.rot), pos: add(apply3(parent.rot, child.pos), parent.pos) };
}

export function toWorld(x: Xform, p: Vec3): Vec3 {
  return add(apply3(x.rot, p), x.pos);
}

// ---- shapes ------------------------------------------------------------------------------------------------------

/**
 * Shape kinds, in the shape's local frame:
 *  - RBOX: box of half size (a, b, c) with edges rounded by r,
 *  - ELLIPSOID: radii (a, b, c),
 *  - CAPSULE: segment from y = -a to y = a, radius r,
 *  - CYLINDER: along y from -a to a, radius r, edges rounded by c,
 *  - CONE: along y from -a (radius r) to a (radius b), flat caps,
 *  - RCONE: sphere of radius r at y = -a joined to a sphere of radius b at y = a,
 *  - WEDGE: triangle with base corners (-a, -b), (a, -b) and apex (k, b) in the x-y plane, c thick (half), rounded by r
 *    (fins, spikes, blades),
 *  - TBOX: box of half size (a, b, c) at y = -b narrowing (or widening) to (a * k, b, c * k) at y = b, rounded by r,
 *  - PRISM: k-sided frustum along y (a face toward +x), apothem r at y = -a to b at y = a, z scaled by c: the flat faces
 *    of the original robots' low-polygon models (limbs, joint rings, crystals).
 */
export const enum ShapeKind {
  RBOX = 0,
  ELLIPSOID = 1,
  CAPSULE = 2,
  CYLINDER = 3,
  CONE = 4,
  RCONE = 5,
  WEDGE = 6,
  TBOX = 7,
  PRISM = 8,
}

export interface Shape {
  kind: ShapeKind;
  a: number;
  b: number;
  c: number;
  r: number;
  /** WEDGE apex x, TBOX taper (1 = straight), PRISM sides. */
  k?: number;
}

/** Signed distance to the triangle (p0, p1, p2) in 2D (Inigo Quilez). */
function sdTriangle(px: number, py: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): number {
  const e0x = x1 - x0, e0y = y1 - y0, e1x = x2 - x1, e1y = y2 - y1, e2x = x0 - x2, e2y = y0 - y2;
  const v0x = px - x0, v0y = py - y0, v1x = px - x1, v1y = py - y1, v2x = px - x2, v2y = py - y2;
  const cl = (v: number) => Math.max(0, Math.min(1, v));
  const t0 = cl((v0x * e0x + v0y * e0y) / (e0x * e0x + e0y * e0y));
  const t1 = cl((v1x * e1x + v1y * e1y) / (e1x * e1x + e1y * e1y));
  const t2 = cl((v2x * e2x + v2y * e2y) / (e2x * e2x + e2y * e2y));
  const q0x = v0x - e0x * t0, q0y = v0y - e0y * t0;
  const q1x = v1x - e1x * t1, q1y = v1y - e1y * t1;
  const q2x = v2x - e2x * t2, q2y = v2y - e2y * t2;
  const s = Math.sign(e0x * e2y - e0y * e2x);
  const d = Math.min(q0x * q0x + q0y * q0y, q1x * q1x + q1y * q1y, q2x * q2x + q2y * q2y);
  const w = Math.min(s * (v0x * e0y - v0y * e0x), s * (v1x * e1y - v1y * e1x), s * (v2x * e2y - v2y * e2x));
  return -Math.sqrt(d) * Math.sign(w);
}

export interface Hit {
  t: number;
  /** Normal in the shape's local frame. */
  n: Vec3;
  /** Hit point in the shape's local frame. */
  p: Vec3;
}

/** Signed distance from local point p to the shape. */
export function sdf(p: Vec3, s: Shape): number {
  const [x, y, z] = p;
  switch (s.kind) {
    case ShapeKind.RBOX: {
      const qx = Math.abs(x) - s.a, qy = Math.abs(y) - s.b, qz = Math.abs(z) - s.c;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - s.r;
    }
    case ShapeKind.ELLIPSOID: {
      // Bound (not exact): good enough for marching, refined by the small final steps.
      const k0 = Math.hypot(x / s.a, y / s.b, z / s.c);
      const k1 = Math.hypot(x / (s.a * s.a), y / (s.b * s.b), z / (s.c * s.c));
      return k1 === 0 ? -Math.min(s.a, s.b, s.c) : (k0 * (k0 - 1)) / k1;
    }
    case ShapeKind.CAPSULE: {
      const cy = Math.max(-s.a, Math.min(s.a, y));
      return Math.hypot(x, y - cy, z) - s.r;
    }
    case ShapeKind.CYLINDER: {
      const rr = s.c;
      const dx = Math.hypot(x, z) - s.r + rr, dy = Math.abs(y) - s.a + rr;
      return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - rr;
    }
    case ShapeKind.CONE: {
      // Capped cone (IQ sdCappedCone), bottom radius r at -a, top radius b at +a.
      const h = s.a, r1 = s.r, r2 = s.b;
      const qx = Math.hypot(x, z), qy = y;
      const k1x = r2, k1y = h;
      const k2x = r2 - r1, k2y = 2 * h;
      const cax = qx - Math.min(qx, qy < 0 ? r1 : r2), cay = Math.abs(qy) - h;
      const dk = k2x * k2x + k2y * k2y;
      const tt = Math.max(0, Math.min(1, ((k1x - qx) * k2x + (k1y - qy) * k2y) / dk));
      const cbx = qx - k1x + k2x * tt, cby = qy - k1y + k2y * tt;
      const sgn = cbx < 0 && cay < 0 ? -1 : 1;
      return sgn * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));
    }
    case ShapeKind.RCONE: {
      // Rounded cone (IQ sdRoundCone) from y = -a (radius r) to y = a (radius b).
      const r1 = s.r, r2 = s.b, h = 2 * s.a;
      const qx = Math.hypot(x, z), qy = y + s.a;
      const b = (r1 - r2) / h;
      const a = Math.sqrt(Math.max(0, 1 - b * b));
      const k = qx * -b + qy * a;
      if (k < 0) return Math.hypot(qx, qy) - r1;
      if (k > a * h) return Math.hypot(qx, qy - h) - r2;
      return qx * a + qy * b - r1;
    }
    case ShapeKind.WEDGE: {
      const d2 = sdTriangle(x, y, -s.a, -s.b, s.a, -s.b, s.k ?? 0, s.b);
      const wz = Math.abs(z) - s.c;
      return Math.min(Math.max(d2, wz), 0) + Math.hypot(Math.max(d2, 0), Math.max(wz, 0)) - s.r;
    }
    case ShapeKind.TBOX: {
      // Scaled box: not an exact distance; scaled down so marching does not step through the surface.
      const k = s.k ?? 1;
      const f = 1 + (k - 1) * (Math.max(-s.b, Math.min(s.b, y)) + s.b) / (2 * s.b);
      const qx = Math.abs(x) - s.a * f, qy = Math.abs(y) - s.b, qz = Math.abs(z) - s.c * f;
      return (Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - s.r) * 0.8;
    }
    case ShapeKind.PRISM: {
      // The nearest side face (the angle folded into one sector) and the caps: planes, so faces stay flat.
      const n = prismSides(s);
      const zs = s.c || 1;
      const zc = z / zs;
      const sector = (2 * Math.PI) / n;
      let th = Math.atan2(zc, x);
      th -= sector * Math.round(th / sector);
      const u = Math.hypot(x, zc) * Math.cos(th);
      const h2 = 2 * s.a, dr = s.b - s.r;
      const side = ((u - s.r) * h2 - dr * (y + s.a)) / Math.hypot(h2, dr);
      return Math.max(side, Math.abs(y) - s.a) * Math.min(1, zs);
    }
  }
  return 1e9;
}

export function prismSides(s: Shape): number {
  return Math.max(3, Math.round(s.k ?? 6));
}

/** Distance from a prism's axis to its corners (the radius of its circumscribed cylinder). */
function prismCorner(s: Shape): number {
  return Math.max(s.r, s.b) / Math.cos(Math.PI / prismSides(s));
}

/** Radius of a sphere around the shape's origin that contains it (for culling and marching). */
export function boundingRadius(s: Shape): number {
  switch (s.kind) {
    case ShapeKind.RBOX: return Math.hypot(s.a, s.b, s.c) + s.r;
    case ShapeKind.ELLIPSOID: return Math.max(s.a, s.b, s.c);
    case ShapeKind.CAPSULE: return s.a + s.r;
    case ShapeKind.CYLINDER: return Math.hypot(s.a, s.r);
    case ShapeKind.CONE: return Math.hypot(s.a, Math.max(s.r, s.b));
    case ShapeKind.RCONE: return s.a + Math.max(s.r, s.b);
    case ShapeKind.WEDGE: return Math.hypot(Math.max(s.a, Math.abs(s.k ?? 0)), s.b, s.c) + s.r;
    case ShapeKind.TBOX: return Math.hypot(s.a * Math.max(1, s.k ?? 1), s.b, s.c * Math.max(1, s.k ?? 1)) + s.r;
    case ShapeKind.PRISM: return Math.hypot(prismCorner(s) * Math.max(1, s.c || 1), s.a);
  }
  return 0;
}

/** Half extents of the shape along its local axes. */
export function extents(s: Shape): Vec3 {
  switch (s.kind) {
    case ShapeKind.RBOX: return [s.a + s.r, s.b + s.r, s.c + s.r];
    case ShapeKind.ELLIPSOID: return [s.a, s.b, s.c];
    case ShapeKind.CAPSULE: return [s.r, s.a + s.r, s.r];
    case ShapeKind.CYLINDER: return [s.r, s.a, s.r];
    case ShapeKind.CONE: return [Math.max(s.r, s.b), s.a, Math.max(s.r, s.b)];
    case ShapeKind.RCONE: return [Math.max(s.r, s.b), s.a + Math.max(s.r, s.b), Math.max(s.r, s.b)];
    case ShapeKind.WEDGE: return [Math.max(s.a, Math.abs(s.k ?? 0)) + s.r, s.b + s.r, s.c + s.r];
    case ShapeKind.TBOX: return [s.a * Math.max(1, s.k ?? 1) + s.r, s.b + s.r, s.c * Math.max(1, s.k ?? 1) + s.r];
    case ShapeKind.PRISM: return [prismCorner(s), s.a, prismCorner(s) * (s.c || 1)];
  }
  return [1, 1, 1];
}

/**
 * Soft normal: the surface normal bent toward the direction from the shape's center, like the smooth (Gouraud)
 * shading of the original robots' polygons, so flat faces get gradients instead of a single shade.
 */
export function softNormal(p: Vec3, n: Vec3, s: Shape, softness: number): Vec3 {
  if (softness <= 0) return n;
  const e = extents(s);
  const d = norm([p[0] / e[0], p[1] / e[1], p[2] / e[2]]);
  return norm([n[0] + softness * d[0], n[1] + softness * d[1], n[2] + softness * d[2]]);
}

/**
 * Where a ray enters and leaves the box of half extents e around the origin (slab test), or null. Boxes start the
 * marching right at their surface, so rays grazing large flat shapes (floors toward the horizon) still converge.
 */
function slab(ro: Vec3, rd: Vec3, e: Vec3): [number, number] | null {
  let t0 = -Infinity, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(rd[k]) < 1e-9) {
      if (Math.abs(ro[k]) > e[k]) return null;
      continue;
    }
    const a = (-e[k] - ro[k]) / rd[k], b = (e[k] - ro[k]) / rd[k];
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t0 <= t1 && t1 >= 0 ? [Math.max(0, t0), t1] : null;
}

/** Nearest intersection of a ray (local frame, unit direction) with the shape, or null. */
export function intersect(ro: Vec3, rd: Vec3, s: Shape, eps = 0.01): Hit | null {
  const R = boundingRadius(s) + eps;
  const b = dot(ro, rd);
  const c = dot(ro, ro) - R * R;
  const h = b * b - c;
  if (h < 0) return null;
  const sq = Math.sqrt(h);
  let t = Math.max(0, -b - sq);
  let tEnd = -b + sq;
  if (tEnd < 0) return null;
  if (s.kind === ShapeKind.RBOX || s.kind === ShapeKind.TBOX) {
    const e = extents(s);
    const span = slab(ro, rd, [e[0] + eps, e[1] + eps, e[2] + eps]);
    if (!span) return null;
    t = Math.max(t, span[0]);
    tEnd = Math.min(tEnd, span[1]);
  }
  for (let i = 0; i < 96; i++) {
    const p: Vec3 = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
    const d = sdf(p, s);
    if (d < eps) return { t, n: sdfNormal(p, s), p };
    t += Math.max(d, eps * 0.5);
    if (t > tEnd) return null;
  }
  return null;
}

/** Surface normal from the distance field's gradient. */
export function sdfNormal(p: Vec3, s: Shape): Vec3 {
  const e = 0.005;
  const dx = sdf([p[0] + e, p[1], p[2]], s) - sdf([p[0] - e, p[1], p[2]], s);
  const dy = sdf([p[0], p[1] + e, p[2]], s) - sdf([p[0], p[1] - e, p[2]], s);
  const dz = sdf([p[0], p[1], p[2] + e], s) - sdf([p[0], p[1], p[2] - e], s);
  return norm([dx, dy, dz]);
}
