// Fitting a 3D robot model (src/gen's shapes on the humanoid skeleton) to an original robot's sprites: for each sprite,
// the pose (joint rotations, where the robot stands, how it is turned) whose picture covers the sprite's pixels with
// the same color zones. The original robots were 3D renders too; their models are lost, so tools/blender/originals
// models each robot from its sprites and this fits it to every one of them, which the Blender pipeline then renders.
import type { Sprite } from '../../../src/formats/sprite';
import { boundingRadius, ShapeKind, type Shape, type Vec3 } from '../../../src/gen/geometry';
import { ROW_H } from '../../../src/gen/raster';
import { placeShapes, type PlacedShape, type Pose, type RobotModel } from '../../../src/gen/robot';

/** Color zones: 0 nothing, 1 tertiary (ramp 0), 2 secondary (ramp 1), 3 primary (ramp 2), 4 fixed colors. */
export interface ZoneImage {
  x: number;
  y: number;
  w: number;
  h: number;
  z: Uint8Array;
}

export const zoneOfIndex = (v: number): number => (v === 0 ? 0 : v < 16 ? 1 : v < 32 ? 2 : v < 48 ? 3 : 4);

/** A sprite's color zones, placed where the game draws it (relative to the robot's floor position). */
export function spriteZones(sp: Sprite): ZoneImage {
  const px = sp.pixels();
  const z = new Uint8Array(sp.width * sp.height);
  for (let i = 0; i < z.length; i++) z[i] = zoneOfIndex(px[i]);
  return { x: sp.posX, y: sp.posY, w: sp.width, h: sp.height, z };
}

// ---- A fast, approximate rasterizer: every shape as the convex hull of its corners, one depth per shape ------------

const hullCache = new WeakMap<Shape, Vec3[]>();

/** Points of a shape whose convex hull is its silhouette from any side (its corners; round shapes sampled). */
function shapePoints(s: Shape): Vec3[] {
  let pts = hullCache.get(s);
  if (pts) return pts;
  pts = [];
  const ring = (y: number, rx: number, rz: number, n = 12) => {
    for (let i = 0; i < n; i++) {
      const t = (i / n) * 2 * Math.PI;
      pts!.push([Math.cos(t) * rx, y, Math.sin(t) * rz]);
    }
  };
  const ball = (y: number, r: number) => {
    for (const yy of [-0.7, 0, 0.7]) ring(y + yy * r, r * Math.sqrt(1 - yy * yy), r * Math.sqrt(1 - yy * yy), 10);
    pts!.push([0, y - r, 0], [0, y + r, 0]);
  };
  switch (s.kind) {
    case ShapeKind.RBOX: {
      const a = s.a + s.r * 0.6, b = s.b + s.r * 0.6, c = s.c + s.r * 0.6;
      for (const x of [-a, a]) for (const y of [-b, b]) for (const z of [-c, c]) pts.push([x, y, z]);
      break;
    }
    case ShapeKind.TBOX: {
      const k = s.k ?? 1, r = s.r * 0.6;
      for (const [y, f] of [[-s.b, 1], [s.b, k]] as const) {
        for (const x of [-1, 1]) for (const z of [-1, 1]) pts.push([x * (s.a * f + r), y + Math.sign(y) * r, z * (s.c * f + r)]);
      }
      break;
    }
    case ShapeKind.PRISM: {
      const n = Math.max(3, Math.round(s.k ?? 6)), zs = s.c || 1;
      for (const [y, ap] of [[-s.a, s.r], [s.a, s.b]] as const) {
        const R = ap / Math.cos(Math.PI / n);
        for (let i = 0; i < n; i++) {
          const t = ((i + 0.5) / n) * 2 * Math.PI;
          pts.push([Math.cos(t) * R, y, Math.sin(t) * R * zs]);
        }
      }
      break;
    }
    case ShapeKind.WEDGE: {
      const r = s.r * 0.6;
      for (const [x, y] of [[-s.a - r, -s.b - r], [s.a + r, -s.b - r], [(s.k ?? 0), s.b + r]] as const) {
        for (const z of [-s.c - r, s.c + r]) pts.push([x, y, z]);
      }
      break;
    }
    case ShapeKind.CYLINDER:
      ring(-s.a, s.r, s.r);
      ring(s.a, s.r, s.r);
      break;
    case ShapeKind.CONE:
      ring(-s.a, s.r, s.r);
      if (s.b > 0.05) ring(s.a, s.b, s.b);
      else pts.push([0, s.a, 0]);
      break;
    case ShapeKind.ELLIPSOID:
      for (const yy of [-0.92, -0.6, 0, 0.6, 0.92]) ring(yy * s.b, s.a * Math.sqrt(1 - yy * yy), s.c * Math.sqrt(1 - yy * yy), 12);
      pts.push([0, -s.b, 0], [0, s.b, 0]);
      break;
    case ShapeKind.CAPSULE:
      ball(-s.a, s.r);
      ball(s.a, s.r);
      break;
    case ShapeKind.RCONE:
      ball(-s.a, s.r);
      ball(s.a, s.b);
      break;
  }
  hullCache.set(s, pts);
  return pts;
}

/** Convex hull (monotone chain) of 2D points, counter-clockwise. */
function hull(xs: number[], ys: number[]): [number, number][] {
  const p = xs.map((x, i) => [x, ys[i]] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export const zoneOfShape = (s: PlacedShape): number => (s.mat.fx ? 4 : s.mat.ramp === 0 ? 1 : s.mat.ramp === 1 ? 2 : 3);

/** A convex shape's faces, n . p <= d in its own frame (round shapes as many-sided prisms), or an ellipsoid's radii. */
type Faces = { n: number[]; d: number[] } | { ellipsoid: Vec3 };
const faceCache = new WeakMap<Shape, Faces>();

function shapeFaces(s: Shape): Faces {
  let f = faceCache.get(s);
  if (f) return f;
  const n: number[] = [], d: number[] = [];
  const face = (x: number, y: number, z: number, dist: number) => {
    n.push(x, y, z);
    d.push(dist);
  };
  // A frustum of `sides` faces along y: apothem r0 at y = -a, r1 at y = a, z scaled by zs; one face toward +x.
  const frustum = (a: number, r0: number, r1: number, sides: number, zs = 1, offset = 0) => {
    const slope = (r1 - r0) / (2 * a);
    for (let i = 0; i < sides; i++) {
      const t = (i / sides) * 2 * Math.PI + offset;
      face(Math.cos(t), -slope, Math.sin(t) / zs, r0 + slope * a);
    }
    face(0, 1, 0, a);
    face(0, -1, 0, a);
  };
  switch (s.kind) {
    case ShapeKind.RBOX: {
      const a = s.a + s.r * 0.6, b = s.b + s.r * 0.6, c = s.c + s.r * 0.6;
      face(1, 0, 0, a); face(-1, 0, 0, a); face(0, 1, 0, b); face(0, -1, 0, b); face(0, 0, 1, c); face(0, 0, -1, c);
      break;
    }
    case ShapeKind.TBOX: {
      // x <= a f(y), f(y) = 1 + (k - 1)(y + b) / 2b, likewise z with c
      const k = s.k ?? 1, g = (k - 1) / (2 * s.b), r = s.r * 0.6;
      for (const sx of [1, -1]) face(sx, -s.a * g, 0, s.a * (1 + g * s.b) + r);
      for (const sz of [1, -1]) face(0, -s.c * g, sz, s.c * (1 + g * s.b) + r);
      face(0, 1, 0, s.b + r);
      face(0, -1, 0, s.b + r);
      break;
    }
    case ShapeKind.WEDGE: {
      let V: [number, number][] = [[-s.a, -s.b], [s.a, -s.b], [s.k ?? 0, s.b]];
      const area = (V[1][0] - V[0][0]) * (V[2][1] - V[0][1]) - (V[1][1] - V[0][1]) * (V[2][0] - V[0][0]);
      if (area < 0) V = [V[0], V[2], V[1]];
      const r = s.r * 0.6;
      for (let i = 0; i < 3; i++) {
        const [x0, y0] = V[i], [x1, y1] = V[(i + 1) % 3];
        const nx = y1 - y0, ny = -(x1 - x0), l = Math.hypot(nx, ny) || 1;
        face(nx / l, ny / l, 0, (nx * x0 + ny * y0) / l + r);
      }
      face(0, 0, 1, s.c + r);
      face(0, 0, -1, s.c + r);
      break;
    }
    case ShapeKind.PRISM:
      frustum(s.a, s.r, s.b, Math.max(3, Math.round(s.k ?? 6)), s.c || 1);
      break;
    case ShapeKind.CYLINDER:
      frustum(s.a, s.r, s.r, 12);
      break;
    case ShapeKind.CONE:
      frustum(s.a, s.r, Math.max(0.05, s.b), 12);
      break;
    case ShapeKind.CAPSULE:
      frustum(s.a + s.r * 0.7, s.r, s.r, 12);
      break;
    case ShapeKind.RCONE:
      frustum(s.a + Math.max(s.r, s.b) * 0.7, s.r, s.b, 12);
      break;
    case ShapeKind.ELLIPSOID:
      f = { ellipsoid: [s.a, s.b, s.c] };
      faceCache.set(s, f);
      return f;
  }
  f = { n, d };
  faceCache.set(s, f);
  return f;
}

const FAR = 1000;

/**
 * A placed shape's front surface as a function of the world point (wx, wy) seen down -z: each face's distance terms
 * linear in wx and wy (n . ro = c0 + cx wx + cy wy, n . rd constant), so a pixel costs a few multiplications per face.
 */
interface Surface {
  /** Per face: d - n . ro at the origin, its change per wx and wy, and n . rd. */
  faces: Float64Array;
  /** An ellipsoid's terms (scaled ray origin at the origin, its changes, the scaled direction). */
  ell: Float64Array | null;
}

function surfaceOf(s: PlacedShape, f: Faces): Surface {
  const m = s.inv;
  // ro(wx, wy) = inv ((wx, wy, FAR) - pos) = o0 + wx col0 + wy col1; rd = inv (0, 0, -1)
  const o0 = [-(m[0] * s.pos[0] + m[1] * s.pos[1]) + m[2] * (FAR - s.pos[2]), -(m[3] * s.pos[0] + m[4] * s.pos[1]) + m[5] * (FAR - s.pos[2]),
    -(m[6] * s.pos[0] + m[7] * s.pos[1]) + m[8] * (FAR - s.pos[2])];
  const cx = [m[0], m[3], m[6]], cy = [m[1], m[4], m[7]], rd = [-m[2], -m[5], -m[8]];
  if ('ellipsoid' in f) {
    const [a, b, c] = f.ellipsoid;
    const k = [a, b, c];
    const ell = new Float64Array(12);
    for (let i = 0; i < 3; i++) {
      ell[i] = o0[i] / k[i];
      ell[3 + i] = cx[i] / k[i];
      ell[6 + i] = cy[i] / k[i];
      ell[9 + i] = rd[i] / k[i];
    }
    return { faces: new Float64Array(0), ell };
  }
  const nf = f.d.length;
  const faces = new Float64Array(nf * 4);
  for (let i = 0; i < nf; i++) {
    const nx = f.n[i * 3], ny = f.n[i * 3 + 1], nz = f.n[i * 3 + 2];
    faces[i * 4] = f.d[i] - (nx * o0[0] + ny * o0[1] + nz * o0[2]);
    faces[i * 4 + 1] = -(nx * cx[0] + ny * cx[1] + nz * cx[2]);
    faces[i * 4 + 2] = -(nx * cy[0] + ny * cy[1] + nz * cy[2]);
    faces[i * 4 + 3] = nx * rd[0] + ny * rd[1] + nz * rd[2];
  }
  return { faces, ell: null };
}

/** The world depth (z, larger nearer the viewer) of a shape's front surface at a world point, or -Infinity. */
function frontDepth(sf: Surface, wx: number, wy: number): number {
  const e = sf.ell;
  if (e) {
    const px = e[0] + e[3] * wx + e[6] * wy, py = e[1] + e[4] * wx + e[7] * wy, pz = e[2] + e[5] * wx + e[8] * wy;
    const qx = e[9], qy = e[10], qz = e[11];
    const A = qx * qx + qy * qy + qz * qz, B = px * qx + py * qy + pz * qz, C = px * px + py * py + pz * pz - 1;
    const disc = B * B - A * C;
    if (disc < 0) return -Infinity;
    return FAR - (-B - Math.sqrt(disc)) / A;
  }
  let tIn = -Infinity, tOut = Infinity;
  const fc = sf.faces;
  for (let i = 0; i < fc.length; i += 4) {
    const num = fc[i] + fc[i + 1] * wx + fc[i + 2] * wy, den = fc[i + 3];
    if (den > -1e-12 && den < 1e-12) {
      if (num < 0) return -Infinity;
      continue;
    }
    const t = num / den;
    if (den < 0) {
      if (t > tIn) tIn = t;
    } else if (t < tOut) {
      tOut = t;
    }
    if (tIn > tOut) return -Infinity;
  }
  return FAR - tIn;
}

/**
 * The zones of placed shapes in a window of sprite pixels (x, y: the window's corner relative to the floor position):
 * each shape filled as the convex hull of its corners, nearer shapes (by their centers) over farther ones.
 */
export function rasterZones(shapes: PlacedShape[], x: number, y: number, w: number, h: number, out?: Uint8Array): Uint8Array {
  const z = out ?? new Uint8Array(w * h);
  z.fill(0);
  const depth = new Float32Array(w * h).fill(-Infinity);
  for (const s of shapes) {
    const pts = shapePoints(s.shape);
    const m = s.inv; // world to local: local to world is its transpose
    const xs: number[] = [], ys: number[] = [];
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      const wx = m[0] * p[0] + m[3] * p[1] + m[6] * p[2] + s.pos[0];
      const wy = m[1] * p[0] + m[4] * p[1] + m[7] * p[2] + s.pos[1];
      const sx = wx - x, sy = -wy / ROW_H - y;
      xs.push(sx);
      ys.push(sy);
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    }
    const poly = hull(xs, ys);
    if (poly.length < 3) continue;
    const zone = zoneOfShape(s);
    const sf = surfaceOf(s, shapeFaces(s.shape));
    const r0 = Math.max(0, Math.ceil(minY - 0.5)), r1 = Math.min(h - 1, Math.floor(maxY - 0.5));
    for (let r = r0; r <= r1; r++) {
      const yc = r + 0.5;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < poly.length; i++) {
        const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
        if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {
          const xi = ax + ((yc - ay) / (by - ay)) * (bx - ax);
          if (xi < lo) lo = xi;
          if (xi > hi) hi = xi;
        }
      }
      if (lo > hi) continue;
      const c0 = Math.max(0, Math.ceil(lo - 0.5)), c1 = Math.min(w - 1, Math.floor(hi - 0.5));
      for (let c = c0; c <= c1; c++) {
        const i = r * w + c;
        // (the front surface's depth there: parts in front of others hide them as in the rendering)
        let d = frontDepth(sf, x + c + 0.5, -(y + yc) * ROW_H);
        if (d === -Infinity) d = s.pos[2];
        if (d > depth[i]) {
          depth[i] = d;
          z[i] = zone;
        }
      }
    }
  }
  return z;
}

// ---- The loss --------------------------------------------------------------------------------------------------

/** Margin of sprite pixels around a sprite where the model's pixels count too (drawn outside the sprite). */
export const MARGIN = 10;

export interface Target {
  /** The sprite's zones in a window MARGIN pixels larger on every side. */
  x: number;
  y: number;
  w: number;
  h: number;
  z: Uint8Array;
  /** Distance (pixels) from each window pixel to the sprite's nearest pixel (0 on the sprite). */
  dist: Float32Array;
  /** Distance (pixels) from each of the sprite's pixels to the nearest pixel outside it (0 outside). */
  inner: Float32Array;
  /** The sprite's pixel count. */
  area: number;
  /** Distance (pixels) from each window pixel to the sprite's nearest joint-colored (tertiary) pixel. */
  joints: Float32Array;
  /** The sprite's joint-colored blobs: their centers (window pixels) and sizes. */
  blobs: { x: number; y: number; n: number }[];
}

/** Chamfer distance transform (two passes): the distance from each pixel to the nearest one where `seed` is true. */
function chamfer(w: number, h: number, seed: (i: number) => boolean): Float32Array {
  const dist = new Float32Array(w * h);
  for (let i = 0; i < dist.length; i++) dist[i] = seed(i) ? 0 : 1e6;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      if (c > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
      if (r > 0) {
        dist[i] = Math.min(dist[i], dist[i - w] + 1);
        if (c > 0) dist[i] = Math.min(dist[i], dist[i - w - 1] + 1.4);
        if (c < w - 1) dist[i] = Math.min(dist[i], dist[i - w + 1] + 1.4);
      }
    }
  }
  for (let r = h - 1; r >= 0; r--) {
    for (let c = w - 1; c >= 0; c--) {
      const i = r * w + c;
      if (c < w - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
      if (r < h - 1) {
        dist[i] = Math.min(dist[i], dist[i + w] + 1);
        if (c < w - 1) dist[i] = Math.min(dist[i], dist[i + w + 1] + 1.4);
        if (c > 0) dist[i] = Math.min(dist[i], dist[i + w - 1] + 1.4);
      }
    }
  }
  return dist;
}

export function target(img: ZoneImage): Target {
  const w = img.w + 2 * MARGIN, h = img.h + 2 * MARGIN;
  const z = new Uint8Array(w * h);
  for (let r = 0; r < img.h; r++) for (let c = 0; c < img.w; c++) z[(r + MARGIN) * w + c + MARGIN] = img.z[r * img.w + c];
  const dist = chamfer(w, h, (i) => z[i] > 0);
  const inner = chamfer(w, h, (i) => z[i] === 0);
  const joints = chamfer(w, h, (i) => z[i] === 1);
  let area = 0;
  for (let i = 0; i < z.length; i++) if (z[i]) area++;
  return { x: img.x - MARGIN, y: img.y - MARGIN, w, h, z, dist, inner, area, joints, blobs: blobsOf(z, w, h, 1) };
}

/** Connected blobs (4-neighbors) of one zone: their centers and pixel counts (blobs of 3 pixels and more). */
function blobsOf(z: Uint8Array, w: number, h: number, zone: number): { x: number; y: number; n: number }[] {
  const seen = new Uint8Array(z.length);
  const out: { x: number; y: number; n: number }[] = [];
  for (let i = 0; i < z.length; i++) {
    if (z[i] !== zone || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    let sx = 0, sy = 0, n = 0;
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % w, y = (k / w) | 0;
      sx += x;
      sy += y;
      n++;
      for (const j of [k - 1, k + 1, k - w, k + w]) {
        if (j < 0 || j >= z.length || seen[j] || z[j] !== zone) continue;
        if ((j === k - 1 && x === 0) || (j === k + 1 && x === w - 1)) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (n >= 3) out.push({ x: sx / n + 0.5, y: sy / n + 0.5, n });
  }
  return out;
}

/** How much the joints' landmarks count against the picture's pixels (loss per pixel of distance). */
export const JOINT_WEIGHT = 2.5;

/**
 * The joints as landmarks: the robot's ball joints (joint-colored ellipsoids) the picture shows against the sprite's
 * joint-colored blobs, both ways (each visible ball as far as the nearest joint-colored pixel, each blob as far as the
 * nearest ball), at most 14 pixels each. 0 for a model without ball joints.
 */
export function jointLoss(t: Target, shapes: PlacedShape[], m: Uint8Array): number {
  const balls: [number, number][] = [];
  for (const s of shapes) {
    if (s.shape.kind !== ShapeKind.ELLIPSOID || zoneOfShape(s) !== 1) continue;
    const c = s.pos[0] - t.x, r = -s.pos[1] / ROW_H - t.y;
    const i = Math.floor(r) * t.w + Math.floor(c);
    // (hidden behind another part: not in the picture)
    if (c < 0 || r < 0 || c >= t.w || r >= t.h || m[i] !== 1) continue;
    balls.push([c, r]);
  }
  if (!balls.length) return 0;
  let loss = 0;
  for (const [c, r] of balls) loss += Math.min(14, t.joints[Math.floor(r) * t.w + Math.floor(c)]);
  for (const b of t.blobs) {
    let best = 14;
    for (const [c, r] of balls) best = Math.min(best, Math.hypot(c - b.x, r - b.y));
    loss += best * Math.min(1, b.n / 6);
  }
  return loss * JOINT_WEIGHT;
}

/**
 * The share of the sprite's area that the model gets wrong by more than a pixel's edge: its pixels more than 1.5 pixels
 * outside the sprite, and the sprite's pixels more than 1.5 pixels inside it that the model leaves uncovered.
 */
export function hardError(t: Target, m: Uint8Array): number {
  let bad = 0;
  for (let i = 0; i < m.length; i++) {
    if (m[i] && !t.z[i] && t.dist[i] > 1.5) bad++;
    else if (!m[i] && t.z[i] && t.inner[i] > 1.5) bad++;
  }
  return bad / Math.max(1, t.area);
}

export interface Score {
  /** The loss (pixels, weighted). */
  loss: number;
  /** Silhouette intersection over union. */
  iou: number;
  /** Share of the pixels both cover that have the same zone. */
  zones: number;
}

/**
 * How well a model picture matches a sprite: pixels only one of them covers (the model's farther out of the sprite
 * cost more), pixels both cover in different zones (half; a fixed color of the sprite a quarter; the accent color,
 * which marks the robot's front (emblems, eyes), three times as much: front and back look alike in outline).
 */
export function score(t: Target, m: Uint8Array): Score {
  let loss = 0, both = 0, union = 0, same = 0;
  for (let i = 0; i < m.length; i++) {
    const a = t.z[i], b = m[i];
    if (!a && !b) continue;
    union++;
    if (a && b) {
      both++;
      if (a === b) same++;
      else loss += a === 2 || b === 2 ? 1.5 : a === 4 ? 0.25 : 0.5;
    } else if (b) {
      loss += 1 + 0.15 * Math.min(20, t.dist[i]);
    } else {
      loss += 1;
    }
  }
  return { loss, iou: both / Math.max(1, union), zones: same / Math.max(1, both) };
}

// ---- Pose parameters ---------------------------------------------------------------------------------------------

export interface Fit {
  pose: Pose;
  turn: number;
}

/** The parameters fitted: where the robot stands (x, y), its turn, and each joint's three angles. */
export function paramsOf(model: RobotModel, f: Fit): number[] {
  const root = f.pose.root ?? [0, 0, 0];
  const out = [root[0], root[1], f.turn];
  for (const j of model.joints) {
    const r = f.pose.j[j.name] ?? [0, 0, 0];
    out.push(r[0], r[1], r[2]);
  }
  return out;
}

export function fitOf(model: RobotModel, p: number[], base?: Pose): Fit {
  const j: Record<string, Vec3> = {};
  model.joints.forEach((jt, k) => {
    j[jt.name] = [p[3 + k * 3], p[4 + k * 3], p[5 + k * 3]];
  });
  return { pose: { ...(base ?? {}), j, root: [p[0], p[1], base?.root?.[2] ?? 0] }, turn: p[2] };
}

export function shapesOf(model: RobotModel, f: Fit): PlacedShape[] {
  return placeShapes({ ...model, turn: f.turn }, f.pose, boundingRadius);
}

export function evaluate(model: RobotModel, t: Target, f: Fit): Score {
  const shapes = shapesOf(model, f);
  const m = rasterZones(shapes, t.x, t.y, t.w, t.h);
  const s = score(t, m);
  return { ...s, loss: s.loss + jointLoss(t, shapes, m) };
}

// ---- CMA-ES -----------------------------------------------------------------------------------------------------

/** A seeded random number generator (mulberry32) and normal deviates. */
function rng(seed: number): { u: () => number; n: () => number } {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare: number | null = null;
  const n = () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let x = 0, y = 0, s = 0;
    do {
      x = u() * 2 - 1;
      y = u() * 2 - 1;
      s = x * x + y * y;
    } while (s >= 1 || s === 0);
    const k = Math.sqrt((-2 * Math.log(s)) / s);
    spare = y * k;
    return x * k;
  };
  return { u, n };
}

/** Eigen decomposition of a symmetric matrix (Jacobi rotations): C = B diag(d) B^T. */
function eigen(C: Float64Array, n: number): { B: Float64Array; d: Float64Array } {
  const A = C.slice();
  const B = new Float64Array(n * n);
  for (let i = 0; i < n; i++) B[i * n + i] = 1;
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p * n + q] * A[p * n + q];
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q];
        if (Math.abs(apq) < 1e-14) continue;
        const theta = (A[q * n + q] - A[p * n + p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k * n + p], akq = A[k * n + q];
          A[k * n + p] = c * akp - s * akq;
          A[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p * n + k], aqk = A[q * n + k];
          A[p * n + k] = c * apk - s * aqk;
          A[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const bkp = B[k * n + p], bkq = B[k * n + q];
          B[k * n + p] = c * bkp - s * bkq;
          B[k * n + q] = s * bkp + c * bkq;
        }
      }
    }
  }
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = Math.max(1e-20, A[i * n + i]);
  return { B, d };
}

/**
 * Minimizes f over x (CMA-ES, Hansen's standard settings): `sigma` the starting step for each coordinate (its scale),
 * `evals` the budget. Returns the best point found and its value.
 */
export function cmaes(f: (x: number[]) => number, x0: number[], sigma: number[], evals: number, seed = 1): { x: number[]; f: number } {
  const n = x0.length;
  const R = rng(seed);
  const lambda = 4 + Math.floor(3 * Math.log(n)) + 4;
  const mu = Math.floor(lambda / 2);
  const wRaw = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1));
  const wSum = wRaw.reduce((a, b) => a + b, 0);
  const w = wRaw.map((v) => v / wSum);
  const mueff = 1 / w.reduce((a, b) => a + b * b, 0);
  const cc = (4 + mueff / n) / (n + 4 + (2 * mueff) / n);
  const cs = (mueff + 2) / (n + mueff + 5);
  const c1 = 2 / ((n + 1.3) * (n + 1.3) + mueff);
  const cmu = Math.min(1 - c1, (2 * (mueff - 2 + 1 / mueff)) / ((n + 2) * (n + 2) + mueff));
  const damps = 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (n + 1)) - 1) + cs;
  const chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));
  // (searched in coordinates scaled by sigma: every coordinate starts with a step of 1)
  const scale = sigma.slice();
  let m = x0.map((v, i) => v / scale[i]);
  let s = 1;
  const pc = new Float64Array(n), ps = new Float64Array(n);
  let C = new Float64Array(n * n);
  for (let i = 0; i < n; i++) C[i * n + i] = 1;
  let { B, d } = eigen(C, n);
  let D = d.map(Math.sqrt);
  let best = { x: x0.slice(), f: f(x0) };
  let used = 1, gen = 0;
  while (used + lambda <= evals) {
    gen++;
    const zs: Float64Array[] = [], ys: Float64Array[] = [], xs: number[][] = [], fs: number[] = [];
    for (let k = 0; k < lambda; k++) {
      const z = new Float64Array(n);
      for (let i = 0; i < n; i++) z[i] = R.n();
      const y = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let v = 0;
        for (let j = 0; j < n; j++) v += B[i * n + j] * D[j] * z[j];
        y[i] = v;
      }
      const x = Array.from({ length: n }, (_, i) => (m[i] + s * y[i]) * scale[i]);
      const fx = f(x);
      used++;
      zs.push(z);
      ys.push(y);
      xs.push(x);
      fs.push(fx);
      if (fx < best.f) best = { x, f: fx };
    }
    const order = fs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
    const old = m;
    const yw = new Float64Array(n);
    for (let k = 0; k < mu; k++) {
      const y = ys[order[k]];
      for (let i = 0; i < n; i++) yw[i] += w[k] * y[i];
    }
    m = old.map((v, i) => v + s * yw[i]);
    // C^(-1/2) yw = B D^-1 B^T yw
    const t1 = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      let v = 0;
      for (let i = 0; i < n; i++) v += B[i * n + j] * yw[i];
      t1[j] = v / D[j];
    }
    const cInvSqrtYw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let j = 0; j < n; j++) v += B[i * n + j] * t1[j];
      cInvSqrtYw[i] = v;
    }
    let psNorm = 0;
    for (let i = 0; i < n; i++) {
      ps[i] = (1 - cs) * ps[i] + Math.sqrt(cs * (2 - cs) * mueff) * cInvSqrtYw[i];
      psNorm += ps[i] * ps[i];
    }
    psNorm = Math.sqrt(psNorm);
    const hsig = psNorm / Math.sqrt(1 - Math.pow(1 - cs, 2 * gen)) / chiN < 1.4 + 2 / (n + 1) ? 1 : 0;
    for (let i = 0; i < n; i++) pc[i] = (1 - cc) * pc[i] + hsig * Math.sqrt(cc * (2 - cc) * mueff) * yw[i];
    const Cn = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let rankMu = 0;
        for (let k = 0; k < mu; k++) {
          const y = ys[order[k]];
          rankMu += w[k] * y[i] * y[j];
        }
        const v = (1 - c1 - cmu) * C[i * n + j] + c1 * (pc[i] * pc[j] + (1 - hsig) * cc * (2 - cc) * C[i * n + j]) + cmu * rankMu;
        Cn[i * n + j] = v;
        Cn[j * n + i] = v;
      }
    }
    C = Cn;
    s *= Math.exp((cs / damps) * (psNorm / chiN - 1));
    if (gen % Math.max(1, Math.floor(1 / (10 * n * (c1 + cmu)))) === 0 || gen < 3) {
      ({ B, d } = eigen(C, n));
      D = d.map(Math.sqrt);
    }
    if (s * Math.max(...D) < 1e-4) break;
  }
  return best;
}

// ---- Fitting a sprite: in stages, one part of the body at a time ---------------------------------------------------

/** The skeleton's joints (src/gen/robots/parts.ts JOINTS) in groups that move together. */
const GROUPS: Record<string, string[]> = {
  torso: ['pelvis', 'spine', 'chest', 'head'],
  legF: ['hipF', 'kneeF', 'footF'],
  legB: ['hipB', 'kneeB', 'footB'],
  armF: ['shoulderF', 'elbowF', 'handF'],
  armB: ['shoulderB', 'elbowB', 'handB'],
};

/** How far each joint may plausibly turn (degrees: x, y and z each between -limit and limit; z ranges for hinges). */
function limits(name: string): [number, number][] {
  if (name.startsWith('knee')) return [[-25, 25], [-25, 25], [-160, 8]];
  if (name.startsWith('elbow')) return [[-45, 45], [-45, 45], [-8, 165]];
  if (name.startsWith('hip')) return [[-70, 70], [-60, 60], [-120, 120]];
  if (name.startsWith('shoulder')) return [[-120, 120], [-90, 90], [-180, 180]];
  if (name.startsWith('foot') || name.startsWith('hand')) return [[-50, 50], [-50, 50], [-90, 90]];
  // (the pelvis carries the whole robot: it turns it over in jumps and falls)
  if (name === 'pelvis') return [[-90, 90], [-90, 90], [-200, 200]];
  // (a robot's back and neck bend and turn a little: twisted far, its box-like torso would fit the picture as well
  // seen from behind)
  if (name === 'head') return [[-25, 25], [-50, 50], [-35, 35]];
  return [[-20, 20], [-35, 35], [-30, 30]];
}

/** Moves a fit so the model's picture is centered where the sprite's is (they may start far apart: jumps). */
export function centered(model: RobotModel, t: Target, f: Fit): Fit {
  const R = 160;
  const w = t.w + 2 * R, h = t.h + 2 * R;
  const m = rasterZones(shapesOf(model, f), t.x - R, t.y - R, w, h);
  let mx = 0, my = 0, mn = 0, sx = 0, sy = 0, sn = 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (m[r * w + c]) {
        mx += c;
        my += r;
        mn++;
      }
    }
  }
  for (let r = 0; r < t.h; r++) {
    for (let c = 0; c < t.w; c++) {
      if (t.z[r * t.w + c]) {
        sx += c + R;
        sy += r + R;
        sn++;
      }
    }
  }
  if (!mn || !sn) return f;
  const dx = sx / sn - mx / mn, dy = sy / sn - my / mn;
  const root = f.pose.root ?? [0, 0, 0];
  return { ...f, pose: { ...f.pose, root: [root[0] + dx, root[1] - dy * ROW_H, root[2]] } };
}

/** The cost of a pose beyond the joints' limits, and of bending toward or away from the viewer (less usual). */
/**
 * The cost of a pose (parameters p): angles beyond the joints' limits; bends toward or away from the viewer, and twists
 * (the turn is the whole robot's: the pelvis does not twist), being less usual than swings; and, given the previous
 * sprite's pose (`ref`), every change from it, so the same pose is found from sprite to sprite where the pictures allow
 * several (a limb twisted about its axis looks the same from the side).
 */
function penalty(model: RobotModel, p: number[], ref?: number[]): number {
  let c = 0;
  model.joints.forEach((j, k) => {
    const lim = limits(j.name);
    for (let a = 0; a < 3; a++) {
      const v = p[3 + k * 3 + a];
      const over = Math.max(0, lim[a][0] - v, v - lim[a][1]);
      c += over * over * 0.05;
    }
    const twist = j.name === 'pelvis' ? 0.05 : j.name === 'spine' || j.name === 'chest' || j.name === 'head' ? 0.004 : 0.008;
    c += p[3 + k * 3] ** 2 * 0.002 + p[4 + k * 3] ** 2 * twist + p[5 + k * 3] ** 2 * 0.0001;
  });
  if (ref) {
    for (let i = 3; i < p.length; i++) c += (p[i] - ref[i]) ** 2 * 0.002;
    c += (p[2] - ref[2]) ** 2 * 0.01;
  }
  return c;
}

/** The parameter indices of joint groups (and the root's: x, y, turn). */
function indices(model: RobotModel, groups: string[], root: number[] = []): number[] {
  const out = [...root];
  model.joints.forEach((j, k) => {
    if (groups.some((g) => GROUPS[g].includes(j.name))) out.push(3 + k * 3, 4 + k * 3, 5 + k * 3);
  });
  return out;
}

/** Optimizes some parameters (the others stay as they are). */
function stage(model: RobotModel, t: Target, x: number[], idx: number[], step: number, evals: number, seed: number, base?: Pose, ref?: number[]): number[] {
  if (!idx.length) return x;
  const f = (sub: number[]) => {
    const full = x.slice();
    idx.forEach((i, k) => (full[i] = sub[k]));
    return evaluate(model, t, fitOf(model, full, base)).loss + penalty(model, full, ref);
  };
  const sigma = idx.map((i) => (i < 2 ? step * 0.25 : step));
  const best = cmaes(f, idx.map((i) => x[i]), sigma, evals, seed);
  const out = x.slice();
  idx.forEach((i, k) => (out[i] = best.x[k]));
  return out;
}

/**
 * Fits a sprite starting from a pose: the legs with where the robot stands and how it is turned, then the torso, then
 * each arm, then everything together; twice, the second time in smaller steps. `effort` scales the evaluations.
 */
export function fitSprite(model: RobotModel, t: Target, start: Fit, effort = 1, seed = 1, prev?: Fit, fixTurn = false): { fit: Fit; score: Score } {
  let x = paramsOf(model, centered(model, t, start));
  const base = start.pose;
  const ref = prev ? paramsOf(model, prev) : undefined;
  const e = (n: number) => Math.round(n * effort);
  const root = fixTurn ? [0, 1] : [0, 1, 2];
  for (const [round, step] of [[0, 24], [1, 10]] as const) {
    const s = seed * 10 + round * 5;
    x = stage(model, t, x, indices(model, ['legF', 'legB'], root), step, e(3000), s, base, ref);
    x = stage(model, t, x, indices(model, ['torso'], root), step, e(1500), s + 1, base, ref);
    x = stage(model, t, x, indices(model, ['armF']), step, e(1500), s + 2, base, ref);
    x = stage(model, t, x, indices(model, ['armB']), step, e(1500), s + 3, base, ref);
    x = stage(model, t, x, indices(model, Object.keys(GROUPS), root), step * 0.4, e(2500), s + 4, base, ref);
  }
  const fit = fitOf(model, x, base);
  return { fit, score: evaluate(model, t, fit) };
}

// ---- Refining the model: its proportions and parts, against fitted sprites ---------------------------------------

export interface Sample {
  t: Target;
  fit: Fit;
}

/** The joint whose parts mirror this one's (F <-> B), if any. */
const twinOf = (name: string): string | null => (/[FB]$/.test(name) ? name.slice(0, -1) + (name.endsWith('F') ? 'B' : 'F') : null);

/** A deep copy of a model. */
export function cloneModel(model: RobotModel): RobotModel {
  return JSON.parse(JSON.stringify(model));
}

function totalLoss(model: RobotModel, samples: Sample[]): number {
  let l = 0;
  for (const s of samples) l += evaluate(model, s.t, s.fit).loss;
  return l;
}

/** The numbers of a shape that size it (by kind), as names of its fields. */
function sizeFields(s: Shape): (keyof Shape)[] {
  switch (s.kind) {
    case ShapeKind.RBOX: return ['a', 'b', 'c'];
    case ShapeKind.TBOX: return ['a', 'b', 'c', 'k'];
    case ShapeKind.WEDGE: return ['a', 'b', 'c', 'k'];
    case ShapeKind.PRISM: return ['a', 'r', 'b'];
    case ShapeKind.ELLIPSOID: return ['a', 'b', 'c'];
    case ShapeKind.CAPSULE: return ['a', 'r'];
    case ShapeKind.CYLINDER: return ['a', 'r'];
    case ShapeKind.CONE: return ['a', 'r', 'b'];
    case ShapeKind.RCONE: return ['a', 'r', 'b'];
  }
  return [];
}

/**
 * Refines the model against sprites whose poses are fitted: first the skeleton's proportions (where each joint sits on
 * its parent), then every part's size and place (a far-side limb's part mirrors its near-side twin's, and so does a
 * part mirrored on the same joint). It is held to `base` (the model as designed): every change costs, so a part only
 * moves or grows where the sprites agree it should, not to make up for a pose fitted wrong. Parts smaller than about
 * a pixel and a half stay as they are. Returns the refined copy and the losses.
 */
export function refineModel(model: RobotModel, samples: Sample[], base: RobotModel, evals = 500, move = 6, seed = 7):
  { model: RobotModel; before: number; after: number } {
  let m = cloneModel(model);
  const before = totalLoss(m, samples);
  const byName = new Map(m.joints.map((j, k) => [j.name, k]));
  const weight = samples.length / 20;
  // The skeleton: each joint's offset (its twin's mirrored), all at once.
  {
    const keys = m.joints.map((j, k) => ({ j, k })).filter(({ j }) => j.parent && !j.name.endsWith('B'));
    const x0 = keys.flatMap(({ j }) => [j.offset[1], j.offset[2]]);
    const xb = keys.flatMap(({ k }) => [base.joints[k].offset[1], base.joints[k].offset[2]]);
    const apply = (mm: RobotModel, x: number[]) => {
      keys.forEach(({ j, k }, i) => {
        mm.joints[k].offset = [j.offset[0], x[i * 2], x[i * 2 + 1]];
        const twin = twinOf(j.name);
        const tk = twin ? byName.get(twin) : undefined;
        if (tk !== undefined) mm.joints[tk].offset = [j.offset[0], x[i * 2], -x[i * 2 + 1]];
      });
    };
    const f = (x: number[]) => {
      const mm = cloneModel(m);
      apply(mm, x);
      let reg = 0;
      x.forEach((v, i) => (reg += (v - xb[i]) ** 2));
      return totalLoss(mm, samples) + reg * 3 * weight;
    };
    const best = cmaes(f, x0, x0.map(() => 1.2), evals * 2, seed);
    apply(m, best.x);
  }
  // Every part (near-side limbs and the body; the far side follows).
  m.joints.forEach((j, k) => {
    if (j.name.endsWith('B') && twinOf(j.name) && byName.has(twinOf(j.name)!)) return;
    const twin = twinOf(j.name);
    const tk = twin ? byName.get(twin) : undefined;
    const mirrored = new Set<number>();
    j.parts.forEach((_, pi) => {
      if (mirrored.has(pi)) return;
      const p0 = m.joints[k].parts[pi];
      const b0 = base.joints[k]?.parts[pi] ?? p0;
      if (boundingRadius(p0.shape) < 1.6) return;
      // (a part mirrored on the same joint: the fins either side of the chest, the waist's two rods)
      const mate = Math.abs(p0.at[2]) > 1 ? j.parts.findIndex((q, qi) => qi !== pi && q.shape.kind === p0.shape.kind &&
        Math.abs(q.at[2] + p0.at[2]) < 0.6 && Math.abs(q.at[1] - p0.at[1]) < 0.6) : -1;
      if (mate >= 0) mirrored.add(mate);
      const fields = sizeFields(p0.shape);
      const x0 = [...fields.map((fld) => Math.log((p0.shape[fld] as number) / ((b0.shape[fld] as number) || 1e-6))), p0.at[0], p0.at[1], p0.at[2]];
      const apply = (mm: RobotModel, x: number[]) => {
        const p = mm.joints[k].parts[pi];
        const shape = { ...p0.shape };
        fields.forEach((fld, i) => {
          (shape as unknown as Record<string, number>)[fld] = (b0.shape[fld] as number) * Math.exp(Math.max(-0.5, Math.min(0.5, x[i])));
        });
        const n = fields.length;
        const at: Vec3 = [
          b0.at[0] + Math.max(-move, Math.min(move, x[n] - b0.at[0])),
          b0.at[1] + Math.max(-move, Math.min(move, x[n + 1] - b0.at[1])),
          b0.at[2] + Math.max(-move, Math.min(move, x[n + 2] - b0.at[2])),
        ];
        mm.joints[k].parts[pi] = { ...p, shape, at };
        if (mate >= 0) {
          const q = mm.joints[k].parts[mate];
          mm.joints[k].parts[mate] = { ...q, shape: { ...shape }, at: [at[0], at[1], -at[2]], rot: p.rot ? [-p.rot[0], -p.rot[1], p.rot[2]] : q.rot };
        }
        if (tk !== undefined && mm.joints[tk].parts[pi]) {
          const q = mm.joints[tk].parts[pi];
          mm.joints[tk].parts[pi] = { ...q, shape: { ...shape }, at: [at[0], at[1], -at[2]] };
        }
      };
      const f = (x: number[]) => {
        const mm = cloneModel(m);
        apply(mm, x);
        let reg = 0;
        for (let i = 0; i < fields.length; i++) reg += x[i] * x[i] * 60;
        for (let i = 0; i < 3; i++) reg += (x[fields.length + i] - b0.at[i]) ** 2 * 2;
        return totalLoss(mm, samples) + reg * weight;
      };
      const sigma = [...fields.map(() => 0.1), 0.8, 0.8, 0.8];
      const best = cmaes(f, x0, sigma, evals, seed + k * 31 + pi);
      apply(m, best.x);
    });
  });
  return { model: m, before, after: totalLoss(m, samples) };
}

// ---- A wider search, for sprites far from any pose fitted so far ------------------------------------------------

/** Each limb's grid: the first joint's bend and swing, the second joint's swing (degrees). */
const LIMB_GRID: Record<string, { first: string; second: string; bend: number[]; swing: number[]; second2: number[] }> = {
  legF: { first: 'hipF', second: 'kneeF', bend: [-45, -25, -10, 0, 10, 25, 45], swing: range(-120, 120, 15), second2: [0, -30, -65, -100, -140] },
  legB: { first: 'hipB', second: 'kneeB', bend: [-45, -25, -10, 0, 10, 25, 45], swing: range(-120, 120, 15), second2: [0, -30, -65, -100, -140] },
  armF: { first: 'shoulderF', second: 'elbowF', bend: [-110, -80, -50, -25, 0, 25, 50], swing: range(-180, 165, 20), second2: [0, 40, 80, 120, 150] },
  armB: { first: 'shoulderB', second: 'elbowB', bend: [-50, -25, 0, 25, 50, 80, 110], swing: range(-180, 165, 20), second2: [0, 40, 80, 120, 150] },
};

function range(a: number, b: number, step: number): number[] {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += step) out.push(v);
  return out;
}

/**
 * Fits a sprite without relying on a nearby pose: the robot's turn and torso first (every turn tried), then each limb
 * over a grid of its main joints' angles, each grid's best refined; then everything together, as fitSprite does.
 */
export function searchSprite(model: RobotModel, t: Target, start: Fit, seed = 1, fixTurn = false): { fit: Fit; score: Score } {
  const base = start.pose;
  const lossOf = (x: number[]) => evaluate(model, t, fitOf(model, x, base)).loss + penalty(model, x);
  let x = paramsOf(model, start);
  // The turn (and the torso with it).
  const turns = (fixTurn ? [start.turn] : range(-180, 165, 15)).map((turn) => {
    const p = paramsOf(model, centered(model, t, fitOf(model, [...x.slice(0, 2), turn, ...x.slice(3)], base)));
    return { p, loss: lossOf(p) };
  }).sort((a, b) => a.loss - b.loss).slice(0, 3);
  let best = { x, loss: Infinity };
  turns.forEach(({ p }, k) => {
    const r = stage(model, t, p, indices(model, ['torso'], fixTurn ? [0, 1] : [0, 1, 2]), 18, 1200, seed * 7 + k, base);
    const l = lossOf(r);
    if (l < best.loss) best = { x: r, loss: l };
  });
  x = best.x;
  const jointIndex = new Map(model.joints.map((j, k) => [j.name, k]));
  for (let pass = 0; pass < 2; pass++) {
    for (const group of ['legF', 'legB', 'armF', 'armB']) {
      const g = LIMB_GRID[group];
      const a = jointIndex.get(g.first), b = jointIndex.get(g.second);
      if (a === undefined || b === undefined) continue;
      const tried: { p: number[]; loss: number }[] = [];
      for (const bend of g.bend) {
        for (const swing of g.swing) {
          for (const s2 of g.second2) {
            const p = x.slice();
            p[3 + a * 3] = bend;
            p[4 + a * 3] = 0;
            p[5 + a * 3] = swing;
            p[3 + b * 3] = 0;
            p[4 + b * 3] = 0;
            p[5 + b * 3] = s2;
            tried.push({ p, loss: lossOf(p) });
          }
        }
      }
      tried.sort((u, v) => u.loss - v.loss);
      let bestLimb = { x, loss: lossOf(x) };
      for (const [k, c] of tried.slice(0, 2).entries()) {
        const r = stage(model, t, c.p, indices(model, [group]), 15, 900, seed * 13 + k + pass * 7, base);
        const l = lossOf(r);
        if (l < bestLimb.loss) bestLimb = { x: r, loss: l };
      }
      x = bestLimb.x;
    }
  }
  return fitSprite(model, t, fitOf(model, x, base), 0.6, seed + 3, undefined, fixTurn);
}
