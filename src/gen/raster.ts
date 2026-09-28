// Renders generated robots (and props) to native sprites: palette indices in the robot's three color ramps, like the
// original robots' sprites (ramp 0 = 0x01..0x0F, ramp 1 = 0x10..0x1F, ramp 2 = 0x20..0x2F, index 0 transparent), so
// player colors, flashes and shadows work as for any robot. The HD renderings use the same lighting (gen/hdRender.ts).
import { apply3, boundingRadius, intersect, norm, ShapeKind, softNormal, type Shape, type Vec3 } from './geometry';
import { placeShapes, type Material, type PlacedShape, type Pose, type RobotModel } from './robot';

/** Height of a native pixel in world units (a 320x200 image shown at 4:3). */
export const ROW_H = 1.2;

export interface IndexedSprite {
  w: number;
  h: number;
  data: Uint8Array;
  /** Top-left corner relative to the object's position (the point on the floor under the robot). */
  x: number;
  y: number;
}

/** A rendered sprite plus, per pixel, the joint whose shape it shows (-1: empty or a loose prop). */
export interface TracedSprite extends IndexedSprite {
  owner: Int16Array;
}

/** Lights as on the original robots' renders: a key from the upper left front, a weak fill from the right. */
export const LIGHT_KEY: Vec3 = norm([-0.45, 0.65, 0.62]);
export const LIGHT_FILL: Vec3 = norm([0.75, 0.1, 0.65]);
/** Half vector of the key light and the view direction (+z), for the highlights. */
const HALF: Vec3 = norm([LIGHT_KEY[0], LIGHT_KEY[1], LIGHT_KEY[2] + 1]);

/**
 * Shading like the original robots' 1994 renders (shared with gen/hdRender.ts): diffuse light saturates at the
 * material's own color, shade 9 of the ramp's 16 (`base`), so most lit faces show that one shade; highlights run from
 * there to white. `ambient`, `key` and `fill` weigh the lights, `tone` a material's shade offset.
 */
export const SHADING = { ambient: 0.2, key: 1.35, fill: 0.24, tone: 0.55, base: 0.6, specPower: 12, specFloor: 0.05, spec: 4.5 };

/** Brightness 0..1 of a surface point with world normal n. */
export function shade(n: Vec3, m: Material): number {
  if (m.glow) return Math.min(1, 0.85 + 0.15 * m.tone);
  const S = SHADING;
  const nl = n[0] * LIGHT_KEY[0] + n[1] * LIGHT_KEY[1] + n[2] * LIGHT_KEY[2];
  const nf = n[0] * LIGHT_FILL[0] + n[1] * LIGHT_FILL[1] + n[2] * LIGHT_FILL[2];
  const diffuse = Math.max(0, Math.min(1, S.ambient + S.key * Math.max(0, nl) + S.fill * Math.max(0, nf) + S.tone * m.tone));
  const nh = Math.max(0, n[0] * HALF[0] + n[1] * HALF[1] + n[2] * HALF[2]);
  // Highlights with a hard start, like the originals' (faces are either the plain color or clearly lit).
  const spec = Math.max(0, Math.pow(nh, S.specPower) * m.shine - S.specFloor) * S.spec;
  return Math.max(0, Math.min(1, diffuse * S.base + spec * (1 - S.base)));
}

/** Palette index for a brightness in a material's ramp. */
export function rampIndex(m: Material, v: number): number {
  if (m.fx) return m.fx[0] + Math.round(v * (m.fx[1] - 1));
  if (m.ramp === 0) return 1 + Math.round(v * 14);
  return m.ramp * 16 + Math.round(v * 15);
}

/**
 * How far normals bend toward a shape's center (0 = flat faces): a slight gradient across the large flat faces of boxes
 * and blades; prisms keep flat facets and round shapes their own normals.
 */
export function softness(s: Shape): number {
  return s.kind === ShapeKind.RBOX || s.kind === ShapeKind.TBOX || s.kind === ShapeKind.WEDGE ? SOFTNESS : 0;
}
export const SOFTNESS = 0.18;

/** Brightness removed from a surface right behind the edge of a nearer part (the separation lines between parts). */
const CONTACT_DARKEN = 0.08;
/** Share of the rounding error passed on to the neighbors (error diffusion within a part, as the originals show). */
const DITHER = 0.85;
/** Depth difference (world units) that counts as a separate part in front. */
const CONTACT_DEPTH = 2.5;

interface Candidate {
  s: PlacedShape;
  index: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** A robot pose as a native sprite. */
export function renderRobot(model: RobotModel, pose: Pose, extra: PlacedShape[] = []): TracedSprite {
  const shapes = placeShapes(model, pose, boundingRadius);
  return traceShapes([...shapes, ...extra], 1, ROW_H);
}

/**
 * Ray traces placed shapes (looking down -z) into an indexed sprite: one sample per pixel center, sx world units per
 * column and sy per row, with separation lines where a part passes in front of another.
 */
export function traceShapes(shapes: PlacedShape[], sx: number, sy: number): TracedSprite {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const cands: Candidate[] = shapes.map((s, index) => {
    const x0 = s.pos[0] - s.radius, x1 = s.pos[0] + s.radius, y0 = s.pos[1] - s.radius, y1 = s.pos[1] + s.radius;
    minX = Math.min(minX, x0);
    maxX = Math.max(maxX, x1);
    minY = Math.min(minY, y0);
    maxY = Math.max(maxY, y1);
    return { s, index, x0, x1, y0, y1 };
  });
  if (cands.length === 0) return { w: 1, h: 1, data: new Uint8Array(1), x: 0, y: 0, owner: new Int16Array([-1]) };
  const px0 = Math.floor(minX / sx), px1 = Math.ceil(maxX / sx);
  const py0 = Math.floor(-maxY / sy), py1 = Math.ceil(-minY / sy);
  const w = Math.max(1, px1 - px0), h = Math.max(1, py1 - py0);
  const value = new Float32Array(w * h);
  const depth = new Float32Array(w * h).fill(Infinity);
  const shapeOf = new Int32Array(w * h).fill(-1);
  const rd: Vec3 = [0, 0, -1];
  for (let r = 0; r < h; r++) {
    const wy = -((py0 + r + 0.5) * sy);
    const row = cands.filter((c) => wy >= c.y0 && wy <= c.y1);
    if (row.length === 0) continue;
    for (let c = 0; c < w; c++) {
      const wx = (px0 + c + 0.5) * sx;
      let bestT = Infinity;
      let bestN: Vec3 | null = null;
      let bestP: Vec3 | null = null;
      let best: Candidate | null = null;
      for (const cand of row) {
        if (wx < cand.x0 || wx > cand.x1) continue;
        const s = cand.s;
        const ro: Vec3 = apply3(s.inv, [wx - s.pos[0], wy - s.pos[1], 1000 - s.pos[2]]);
        const rl: Vec3 = apply3(s.inv, rd);
        const hit = intersect(ro, rl, s.shape, 0.01);
        if (hit && hit.t < bestT) {
          bestT = hit.t;
          bestN = hit.n;
          bestP = hit.p;
          best = cand;
        }
      }
      if (!best || !bestN || !bestP) continue;
      if (!best.s.mat.glow) bestN = softNormal(bestP, bestN, best.s.shape, softness(best.s.shape));
      // Local normal to world: multiply by the transpose of the world-to-local rotation.
      const m = best.s.inv;
      const n: Vec3 = norm([
        m[0] * bestN[0] + m[3] * bestN[1] + m[6] * bestN[2],
        m[1] * bestN[0] + m[4] * bestN[1] + m[7] * bestN[2],
        m[2] * bestN[0] + m[5] * bestN[1] + m[8] * bestN[2],
      ]);
      const i = r * w + c;
      value[i] = shade(n, best.s.mat);
      depth[i] = bestT;
      shapeOf[i] = best.index;
    }
  }
  const data = new Uint8Array(w * h);
  const owner = new Int16Array(w * h).fill(-1);
  const err = new Float32Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      const si = shapeOf[i];
      if (si < 0) continue;
      const s = shapes[si];
      let v = value[i];
      owner[i] = s.joint;
      if (s.mat.glow || s.mat.fx) {
        data[i] = rampIndex(s.mat, v);
        continue;
      }
      // A nearer, different part right next to this pixel: darken (the line where parts overlap).
      const d = depth[i];
      const nearer = (j: number) => shapeOf[j] >= 0 && shapeOf[j] !== si && depth[j] < d - CONTACT_DEPTH;
      if ((c > 0 && nearer(i - 1)) || (c < w - 1 && nearer(i + 1)) || (r > 0 && nearer(i - w)) || (r < h - 1 && nearer(i + w))) {
        v = Math.max(0, v - CONTACT_DARKEN);
      }
      // Floyd-Steinberg within the part: gradients become the originals' mixed shades instead of bands.
      const steps = s.mat.ramp === 0 ? 14 : 15;
      const want = v * steps + err[i];
      const q = Math.max(0, Math.min(steps, Math.round(want)));
      const e = (want - q) * DITHER;
      const pass = (j: number, f: number) => {
        if (shapeOf[j] === si) err[j] += e * f;
      };
      if (c < w - 1) pass(i + 1, 7 / 16);
      if (r < h - 1) {
        if (c > 0) pass(i + w - 1, 3 / 16);
        pass(i + w, 5 / 16);
        if (c < w - 1) pass(i + w + 1, 1 / 16);
      }
      data[i] = s.mat.ramp === 0 ? 1 + q : s.mat.ramp * 16 + q;
    }
  }
  return { w, h, data, x: px0, y: py0, owner };
}
