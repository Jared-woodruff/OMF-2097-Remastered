// Triangle meshes of the generated robots' shapes (src/gen/geometry.ts), for 3D tools such as Blender. The game draws
// the shapes from their distance functions; here each kind is built from its definition instead, so flat faces stay
// flat (one normal per prism face, like the originals' low-polygon models) and rounded edges get their exact curve.
import { prismSides, sdfNormal, ShapeKind, type Shape, type Vec3 } from '../../src/gen/geometry';

export interface Mesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface Detail {
  /** Segments around round shapes (ellipsoids, capsules, cylinders, cones). */
  around: number;
  /** Segments per quarter circle of rounded edges and caps. */
  quarter: number;
}

export const DEFAULT_DETAIL: Detail = { around: 48, quarter: 6 };

/** Sizes below this are treated as zero (sharp edges, pointed ends). */
const EPS = 1e-4;
const HALF_PI = Math.PI / 2;

class Builder {
  private p: number[] = [];
  private n: number[] = [];
  private t: number[] = [];

  vertex(p: Vec3, n: Vec3): number {
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    this.p.push(p[0], p[1], p[2]);
    this.n.push(n[0] / l, n[1] / l, n[2] / l);
    return this.p.length / 3 - 1;
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.t.push(a, b, c, a, c, d);
  }

  /** A flat convex polygon (corners in order) with one normal. */
  polygon(corners: Vec3[], n: Vec3): void {
    const ids = corners.map((c) => this.vertex(c, n));
    for (let i = 1; i + 1 < ids.length; i++) this.t.push(ids[0], ids[i], ids[i + 1]);
  }

  /** Stretches the mesh along its axes (normals by the inverse, as for any non-uniform scale). */
  scale(sx: number, sy: number, sz: number): void {
    for (let i = 0; i < this.p.length; i += 3) {
      this.p[i] *= sx;
      this.p[i + 1] *= sy;
      this.p[i + 2] *= sz;
      const nx = this.n[i] / sx, ny = this.n[i + 1] / sy, nz = this.n[i + 2] / sz;
      const l = Math.hypot(nx, ny, nz) || 1;
      this.n[i] = nx / l;
      this.n[i + 1] = ny / l;
      this.n[i + 2] = nz / l;
    }
  }

  /**
   * The mesh: vertices with the same position and normal merged (smooth surfaces connected, creases kept apart),
   * degenerate triangles (collapsed rings at poles and tips) dropped, and every triangle wound counter-clockwise seen
   * from the side its normals point to (outside).
   */
  build(): Mesh {
    const key = (i: number) => {
      const q = (v: number) => Math.round(v * 1e5);
      return `${q(this.p[i * 3])},${q(this.p[i * 3 + 1])},${q(this.p[i * 3 + 2])}|${q(this.n[i * 3])},${q(this.n[i * 3 + 1])},${q(this.n[i * 3 + 2])}`;
    };
    const merged = new Map<string, number>();
    const remap = new Int32Array(this.p.length / 3);
    const P: number[] = [], N: number[] = [];
    for (let i = 0; i < remap.length; i++) {
      const k = key(i);
      let j = merged.get(k);
      if (j === undefined) {
        j = P.length / 3;
        merged.set(k, j);
        P.push(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]);
        N.push(this.n[i * 3], this.n[i * 3 + 1], this.n[i * 3 + 2]);
      }
      remap[i] = j;
    }
    const T: number[] = [];
    const used = new Uint8Array(P.length / 3);
    for (let i = 0; i < this.t.length; i += 3) {
      const a = remap[this.t[i]];
      let b = remap[this.t[i + 1]], c = remap[this.t[i + 2]];
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
      const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
      const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
      if (Math.hypot(gx, gy, gz) < 1e-9) continue;
      const side = gx * (N[a * 3] + N[b * 3] + N[c * 3]) + gy * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) + gz * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]);
      if (side < 0) [b, c] = [c, b];
      T.push(a, b, c);
      used[a] = used[b] = used[c] = 1;
    }
    // Vertices only degenerate triangles used (the poles of collapsed rings) go.
    const keep = new Int32Array(used.length).fill(-1);
    const positions: number[] = [], normals: number[] = [];
    for (let i = 0; i < used.length; i++) {
      if (!used[i]) continue;
      keep[i] = positions.length / 3;
      positions.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      normals.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: Uint32Array.from(T, (i) => keep[i]) };
  }
}

/** A point of a lathe profile: distance from the y axis, height, and the profile's outward normal there. */
interface ProfilePoint {
  r: number;
  y: number;
  nr: number;
  ny: number;
}

const pt = (r: number, y: number, nr: number, ny: number): ProfilePoint => ({ r, y, nr, ny });

/** Segments for an arc of `angle` radians. */
const arcSteps = (angle: number, d: Detail) => Math.max(1, Math.ceil((Math.abs(angle) / HALF_PI) * d.quarter));

/** Profile points on an arc around (cr, cy): angle 0 points away from the axis, pi / 2 up. */
function arc(cr: number, cy: number, radius: number, a0: number, a1: number, d: Detail): ProfilePoint[] {
  const n = arcSteps(a1 - a0, d);
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return pt(cr + radius * Math.cos(a), cy + radius * Math.sin(a), Math.cos(a), Math.sin(a));
  });
}

/** Revolves profile runs around the y axis: smooth within a run, a crease where one run ends and the next begins. */
function lathe(b: Builder, runs: ProfilePoint[][], around: number): void {
  const dirs = Array.from({ length: around }, (_, s) => [Math.cos((2 * Math.PI * s) / around), Math.sin((2 * Math.PI * s) / around)]);
  for (const run of runs) {
    const rings = run.map((q) => dirs.map(([c, s]) => b.vertex([q.r * c, q.y, q.r * s], [q.nr * c, q.ny, q.nr * s])));
    for (let k = 0; k + 1 < rings.length; k++) {
      for (let s = 0; s < around; s++) {
        const s1 = (s + 1) % around;
        b.quad(rings[k][s], rings[k][s1], rings[k + 1][s1], rings[k + 1][s]);
      }
    }
  }
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Normal of a flat face of a convex shape, pointing away from `inside` (a point within the shape). */
function faceNormal(corners: Vec3[], inside: Vec3): Vec3 {
  let n: Vec3 = [0, 0, 0];
  for (let i = 1; i + 1 < corners.length && Math.hypot(...n) < 1e-9; i++) n = cross(sub(corners[i], corners[0]), sub(corners[i + 1], corners[0]));
  const c = corners.reduce<Vec3>((acc, p) => [acc[0] + p[0] / corners.length, acc[1] + p[1] / corners.length, acc[2] + p[2] / corners.length], [0, 0, 0]);
  return dot(n, sub(c, inside)) < 0 ? [-n[0], -n[1], -n[2]] : n;
}

/** PRISM: `sides` flat faces (one toward +x), apothem r at y = -a to b at y = a, z squashed by c. */
function prism(b: Builder, s: Shape): void {
  const n = prismSides(s), zs = s.c || 1, corner = 1 / Math.cos(Math.PI / n);
  const ring = (y: number, apothem: number): Vec3[] =>
    Array.from({ length: n }, (_, j) => {
      const t = ((j + 0.5) * 2 * Math.PI) / n;
      return [apothem * corner * Math.cos(t), y, apothem * corner * Math.sin(t) * zs];
    });
  const lo = ring(-s.a, s.r), hi = ring(s.a, s.b);
  for (let j = 0; j < n; j++) {
    const j1 = (j + 1) % n;
    const face = [lo[j], lo[j1], hi[j1], hi[j]];
    const c = face.reduce((acc, p) => acc + p[1], 0) / 4;
    b.polygon(face, faceNormal(face, [0, c, 0]));
  }
  if (s.r > EPS) b.polygon(lo, [0, -1, 0]);
  if (s.b > EPS) b.polygon(hi, [0, 1, 0]);
}

/**
 * RBOX and TBOX: a box of half size (a, b, c) rounded by r, its x and z sizes scaled along y from 1 at the bottom to
 * `taper` at the top. Each face is a grid whose outer cells wrap its half of the rounded edges: a grid point p on the
 * box enlarged by r is pushed onto the surface around its nearest point of the inner box (tan-spaced, so the rounded
 * edges get even segments).
 */
function roundedBox(b: Builder, s: Shape, taper: number, d: Detail): void {
  const H: Vec3 = [s.a, s.b, s.c];
  const r = s.r;
  const k = (y: number) => 1 + ((taper - 1) * (Math.max(-s.b, Math.min(s.b, y)) + s.b)) / (2 * s.b || 1);
  const warp = (p: Vec3): Vec3 => (taper === 1 ? p : [p[0] * k(p[1]), p[1], p[2] * k(p[1])]);
  if (r <= EPS) {
    for (let axis = 0; axis < 3; axis++) {
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      for (const sign of [-1, 1]) {
        const face = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([du, dv]) => {
          const p: Vec3 = [0, 0, 0];
          p[axis] = sign * H[axis];
          p[u] = du * H[u];
          p[v] = dv * H[v];
          return warp(p);
        });
        b.polygon(face, faceNormal(face, [0, 0, 0]));
      }
    }
    return;
  }
  // Each face covers half of the quarter circle of an edge (45 degrees).
  const m = Math.max(1, Math.round(d.quarter / 2));
  const band = (h: number): number[] => {
    const t = (i: number) => h + r * Math.tan((i / m) * (Math.PI / 4));
    const out: number[] = [];
    for (let i = m; i >= 1; i--) out.push(-t(i));
    out.push(-h, h);
    for (let i = 1; i <= m; i++) out.push(t(i));
    return out;
  };
  const clamp = (v: number, h: number) => Math.max(-h, Math.min(h, v));
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3;
    const cu = band(H[u]), cv = band(H[v]);
    for (const sign of [-1, 1]) {
      const ids = cu.map((x) =>
        cv.map((y) => {
          const p: Vec3 = [0, 0, 0];
          p[axis] = sign * (H[axis] + r);
          p[u] = x;
          p[v] = y;
          const inner: Vec3 = [clamp(p[0], s.a), clamp(p[1], s.b), clamp(p[2], s.c)];
          const off = sub(p, inner);
          const l = Math.hypot(...off);
          const n: Vec3 = [off[0] / l, off[1] / l, off[2] / l];
          const w = warp(inner);
          const q: Vec3 = [w[0] + n[0] * r, w[1] + n[1] * r, w[2] + n[2] * r];
          // (tapered sides lean: their normals come from the distance field)
          return b.vertex(q, taper === 1 ? n : sdfNormal(q, s));
        }),
      );
      for (let i = 0; i + 1 < cu.length; i++) {
        for (let j = 0; j + 1 < cv.length; j++) b.quad(ids[i][j], ids[i + 1][j], ids[i + 1][j + 1], ids[i][j + 1]);
      }
    }
  }
}

/**
 * WEDGE: the triangle (-a, -b), (a, -b), (k, b) in the x-y plane, c thick either side, rounded by r (the triangular
 * prism grown by r in every direction): flat faces offset by r, cylinders around the edges and spheres at the corners.
 */
function wedge(b: Builder, s: Shape, d: Detail): void {
  let V: [number, number][] = [[-s.a, -s.b], [s.a, -s.b], [s.k ?? 0, s.b]];
  const area = (V[1][0] - V[0][0]) * (V[2][1] - V[0][1]) - (V[1][1] - V[0][1]) * (V[2][0] - V[0][0]);
  if (area < 0) V = [V[0], V[2], V[1]];
  // Outward normal of the edge p -> q of a counter-clockwise polygon.
  const edgeNormal = (p: [number, number], q: [number, number]): [number, number] => {
    const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
    return [dy / l, -dx / l];
  };
  const { c, r } = s;
  if (r <= EPS) {
    const top = V.map(([x, y]): Vec3 => [x, y, c]), bottom = V.map(([x, y]): Vec3 => [x, y, -c]);
    b.polygon(top, [0, 0, 1]);
    b.polygon(bottom, [0, 0, -1]);
    for (let i = 0; i < 3; i++) {
      const i1 = (i + 1) % 3, e = edgeNormal(V[i], V[i1]);
      b.polygon([bottom[i], bottom[i1], top[i1], top[i]], [e[0], e[1], 0]);
    }
    return;
  }
  // The outline: at each corner, an arc from the incoming edge's normal to the outgoing one's.
  const outline: { x: number; y: number; ux: number; uy: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const nIn = edgeNormal(V[(i + 2) % 3], V[i]), nOut = edgeNormal(V[i], V[(i + 1) % 3]);
    const a0 = Math.atan2(nIn[1], nIn[0]);
    let da = Math.atan2(nOut[1], nOut[0]) - a0;
    while (da <= 0) da += 2 * Math.PI;
    const n = arcSteps(da, d);
    for (let j = 0; j <= n; j++) {
      const a = a0 + (da * j) / n;
      outline.push({ x: V[i][0], y: V[i][1], ux: Math.cos(a), uy: Math.sin(a) });
    }
  }
  // Across the thickness: a quarter circle around the edge at z = -c, the straight side, a quarter circle at z = c.
  const rows: { cz: number; phi: number }[] = [];
  for (let e = 0; e <= d.quarter; e++) rows.push({ cz: -c, phi: -HALF_PI + (HALF_PI * e) / d.quarter });
  for (let e = 0; e <= d.quarter; e++) rows.push({ cz: c, phi: (HALF_PI * e) / d.quarter });
  const ids = outline.map((o) =>
    rows.map(({ cz, phi }) => {
      const h = Math.cos(phi);
      return b.vertex([o.x + r * h * o.ux, o.y + r * h * o.uy, cz + r * Math.sin(phi)], [h * o.ux, h * o.uy, Math.sin(phi)]);
    }),
  );
  for (let j = 0; j < outline.length; j++) {
    const j1 = (j + 1) % outline.length;
    for (let e = 0; e + 1 < rows.length; e++) b.quad(ids[j][e], ids[j1][e], ids[j1][e + 1], ids[j][e + 1]);
  }
  b.polygon(V.map(([x, y]): Vec3 => [x, y, c + r]), [0, 0, 1]);
  b.polygon(V.map(([x, y]): Vec3 => [x, y, -c - r]), [0, 0, -1]);
}

/** A triangle mesh of a shape in its own frame (see ShapeKind for the parameters). */
export function tessellate(s: Shape, d: Detail = DEFAULT_DETAIL): Mesh {
  const b = new Builder();
  switch (s.kind) {
    case ShapeKind.ELLIPSOID:
      lathe(b, [arc(0, 0, 1, -HALF_PI, HALF_PI, d)], d.around);
      b.scale(s.a, s.b, s.c);
      break;
    case ShapeKind.CAPSULE:
      lathe(b, [[...arc(0, -s.a, s.r, -HALF_PI, 0, d), ...arc(0, s.a, s.r, 0, HALF_PI, d)]], d.around);
      break;
    case ShapeKind.CYLINDER: {
      const c = Math.min(s.c, s.a, s.r);
      if (c > EPS) {
        lathe(b, [[pt(0, -s.a, 0, -1), ...arc(s.r - c, -s.a + c, c, -HALF_PI, 0, d), ...arc(s.r - c, s.a - c, c, 0, HALF_PI, d), pt(0, s.a, 0, 1)]], d.around);
      } else {
        lathe(b, [[pt(0, -s.a, 0, -1), pt(s.r, -s.a, 0, -1)], [pt(s.r, -s.a, 1, 0), pt(s.r, s.a, 1, 0)], [pt(s.r, s.a, 0, 1), pt(0, s.a, 0, 1)]], d.around);
      }
      break;
    }
    case ShapeKind.CONE: {
      // Radius r at the bottom, b at the top; the side's normal leans by the slope.
      const l = Math.hypot(2 * s.a, s.r - s.b), nr = (2 * s.a) / l, ny = (s.r - s.b) / l;
      const runs = [[pt(s.r, -s.a, nr, ny), pt(s.b, s.a, nr, ny)]];
      if (s.r > EPS) runs.unshift([pt(0, -s.a, 0, -1), pt(s.r, -s.a, 0, -1)]);
      if (s.b > EPS) runs.push([pt(s.b, s.a, 0, 1), pt(0, s.a, 0, 1)]);
      lathe(b, runs, d.around);
      break;
    }
    case ShapeKind.RCONE: {
      // Spheres r (y = -a) and b (y = a) joined by their common tangent (normal at angle t).
      const k = (s.r - s.b) / (2 * s.a), t = Math.atan2(k, Math.sqrt(Math.max(0, 1 - k * k)));
      lathe(b, [[...arc(0, -s.a, s.r, -HALF_PI, t, d), ...arc(0, s.a, s.b, t, HALF_PI, d)]], d.around);
      break;
    }
    case ShapeKind.PRISM:
      prism(b, s);
      break;
    case ShapeKind.RBOX:
      roundedBox(b, s, 1, d);
      break;
    case ShapeKind.TBOX:
      roundedBox(b, s, s.k ?? 1, d);
      break;
    case ShapeKind.WEDGE:
      wedge(b, s, d);
      break;
  }
  return b.build();
}
