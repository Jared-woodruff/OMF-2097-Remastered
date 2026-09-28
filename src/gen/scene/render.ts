// Renders an arena scene (scene/types.ts) to linear RGB on the CPU: ray traced shapes (their distance fields marched
// from their bounding spheres), procedural patterns, point lights with soft shadows, one mirror bounce, fog and a
// starry sky. The GLSL twin (scene/gpu.ts) renders the HD backgrounds the same way.
import { apply3, intersect, norm, sdf, type Vec3 } from '../geometry';
import { CAMERA, Pattern, type RGB, type SceneDef, type SceneMaterial, type SceneShape } from './types';

// ---- noise (identical formulas in the GLSL twin) --------------------------------------------------------------------

function fract(x: number): number {
  return x - Math.floor(x);
}

/** Hash of a 3D integer cell to 0..1. */
export function hash3(x: number, y: number, z: number): number {
  return fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453);
}

/** Smooth value noise 0..1. */
export function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const h = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz);
  return l(
    l(l(h(0, 0, 0), h(1, 0, 0), ux), l(h(0, 1, 0), h(1, 1, 0), ux), uy),
    l(l(h(0, 0, 1), h(1, 0, 1), ux), l(h(0, 1, 1), h(1, 1, 1), ux), uy),
    uz,
  );
}

/** Three octaves of noise, 0..1. */
export function fbm3(x: number, y: number, z: number): number {
  return (noise3(x, y, z) * 4 + noise3(x * 2.03, y * 2.03, z * 2.03) * 2 + noise3(x * 4.1, y * 4.1, z * 4.1)) / 7;
}

// ---- materials ---------------------------------------------------------------------------------------------------

const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mulRGB = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

/** Surface color and self illumination at a local point with local normal n. */
export function surface(m: SceneMaterial, p: Vec3, n: Vec3): { albedo: RGB; emit: RGB } {
  const c2 = m.color2 ?? m.color;
  const size = m.size ?? 16;
  const amount = m.amount ?? 0.08;
  // Face coordinates: the plane across the normal's main axis.
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const [u, v] = ay >= ax && ay >= az ? [p[0], p[2]] : ax >= az ? [p[2], p[1]] : [p[0], p[1]];
  const U = u / size, V = v / size;
  let t = 0; // amount of color2
  let shade = 1;
  switch (m.pattern ?? Pattern.NONE) {
    case Pattern.TILES:
    case Pattern.PANELS: {
      const fu = fract(U), fv = fract(V);
      const edge = Math.min(fu, 1 - fu, fv, 1 - fv);
      t = edge < amount / 2 ? 1 : 0;
      shade = 0.9 + 0.2 * hash3(Math.floor(U), Math.floor(V), 7);
      if ((m.pattern ?? 0) === Pattern.PANELS) {
        // Bevel: darker toward the joints, rivets near the corners.
        shade *= 0.8 + 0.2 * Math.min(1, edge * 16);
        const cu = Math.min(fu, 1 - fu), cv = Math.min(fv, 1 - fv);
        if (Math.hypot(cu - 0.08, cv - 0.08) < 0.035) shade *= 1.35;
      }
      break;
    }
    case Pattern.NOISE:
      t = Math.min(1, Math.max(0, (fbm3(p[0] / size, p[1] / size, p[2] / size) - 0.5) * amount * 4 + 0.5));
      break;
    case Pattern.STRIPES:
      t = fract(U) < amount ? 1 : 0;
      break;
    case Pattern.BRICKS: {
      const row = Math.floor(V * 2);
      const bu = fract(U + (row % 2) * 0.5), bv = fract(V * 2);
      t = Math.min(bu, 1 - bu) < amount / 2 || Math.min(bv, 1 - bv) < amount ? 1 : 0;
      shade = 0.88 + 0.24 * hash3(Math.floor(U + (row % 2) * 0.5), row, 3);
      break;
    }
    case Pattern.GRID: {
      const fu = fract(U), fv = fract(V);
      t = Math.min(fu, 1 - fu, fv, 1 - fv) < amount / 2 ? 1 : 0;
      break;
    }
    case Pattern.WINDOWS: {
      const fu = fract(U), fv = fract(V * 1.6);
      const inside = fu > 0.22 && fu < 0.78 && fv > 0.25 && fv < 0.8;
      const lit = hash3(Math.floor(U), Math.floor(V * 1.6), 11) < amount;
      t = inside && lit ? 1 : 0;
      shade = inside ? 0.7 : 1;
      break;
    }
  }
  const albedo = mulRGB(mixRGB(m.color, c2, t), shade);
  const e = (m.emit ?? 0) * (1 - t) + (m.emit2 ?? 0) * t;
  return { albedo, emit: e > 0 ? mulRGB(mixRGB(m.color, c2, t), e) : [0, 0, 0] };
}

// ---- tracing -----------------------------------------------------------------------------------------------------

interface Hit {
  t: number;
  s: SceneShape;
  /** Local point and normal, world normal. */
  lp: Vec3;
  ln: Vec3;
  n: Vec3;
}

function trace(scene: SceneDef, ro: Vec3, rd: Vec3, tMax = 1e9): Hit | null {
  let best: Hit | null = null;
  let bestT = tMax;
  for (const s of scene.shapes) {
    // Bounding sphere first.
    const ox = ro[0] - s.pos[0], oy = ro[1] - s.pos[1], oz = ro[2] - s.pos[2];
    const b = ox * rd[0] + oy * rd[1] + oz * rd[2];
    const c = ox * ox + oy * oy + oz * oz - (s.radius + 0.05) ** 2;
    const h = b * b - c;
    if (h < 0 || -b - Math.sqrt(h) > bestT) continue;
    const lo = apply3(s.inv, [ox, oy, oz]);
    const ld = apply3(s.inv, rd);
    const hit = intersect(lo, ld, s.shape, 0.02);
    if (hit && hit.t < bestT) {
      bestT = hit.t;
      const m = s.inv;
      const n: Vec3 = norm([
        m[0] * hit.n[0] + m[3] * hit.n[1] + m[6] * hit.n[2],
        m[1] * hit.n[0] + m[4] * hit.n[1] + m[7] * hit.n[2],
        m[2] * hit.n[0] + m[5] * hit.n[1] + m[8] * hit.n[2],
      ]);
      best = { t: hit.t, s, lp: hit.p, ln: hit.n, n };
    }
  }
  return best;
}

/** Distance from a world point to the nearest shadow-casting shape. */
function shadowDistance(scene: SceneDef, p: Vec3): number {
  let d = 1e9;
  for (const s of scene.shapes) {
    if (!s.shadow) continue;
    const dx = p[0] - s.pos[0], dy = p[1] - s.pos[1], dz = p[2] - s.pos[2];
    // The bounding sphere only rules shapes out: its distance is too rough for the penumbra estimate.
    const far = Math.sqrt(dx * dx + dy * dy + dz * dz) - s.radius;
    if (far > d) continue;
    d = Math.min(d, sdf(apply3(s.inv, [dx, dy, dz]), s.shape));
  }
  return d;
}

/** Soft shadow toward a light (1 = lit), with the penumbra estimate of Inigo Quilez's improved soft shadows. */
function softShadow(scene: SceneDef, p: Vec3, l: Vec3, dist: number): number {
  let res = 1;
  let t = 2;
  let prev = 1e9;
  for (let i = 0; i < 64 && t < dist - 1; i++) {
    const d = shadowDistance(scene, [p[0] + l[0] * t, p[1] + l[1] * t, p[2] + l[2] * t]);
    if (d < 0.01) return 0;
    const y = (d * d) / (2 * prev);
    const e = Math.sqrt(Math.max(0, d * d - y * y));
    res = Math.min(res, (10 * e) / Math.max(0.001, t - y));
    prev = d;
    t += Math.min(Math.max(d, 0.25), 24);
  }
  const r = Math.max(0, Math.min(1, res));
  return r * r * (3 - 2 * r);
}

function sky(scene: SceneDef, rd: Vec3): RGB {
  const k = Math.max(0, Math.min(1, rd[1] * 2.5 + 0.1));
  let c = mixRGB(scene.skyHorizon, scene.skyTop, k);
  if (scene.aurora && rd[1] > 0) {
    // Two wavy curtains: bright lower edges fading upward, rippled by noise.
    let a = 0;
    for (let i = 0; i < 2; i++) {
      const base = 0.16 + i * 0.1 + 0.05 * Math.sin(rd[0] * (5 + i * 3) + i * 2) + 0.03 * (noise3(rd[0] * 9 + i * 7, 0, i) - 0.5);
      const h = rd[1] - base;
      if (h > 0) a += Math.exp(-h * 14) * (0.55 + 0.45 * noise3(rd[0] * 26 + i * 3, rd[1] * 4, i * 5));
    }
    const s = a * scene.aurora.strength;
    c = [c[0] + scene.aurora.color[0] * s, c[1] + scene.aurora.color[1] * s, c[2] + scene.aurora.color[2] * s];
  }
  const density = scene.stars ?? 0;
  if (density > 0 && rd[1] > -0.1) {
    // Stars: cells on the direction sphere, one star in some of them.
    const sc = 90;
    const cx = Math.floor(rd[0] * sc), cy = Math.floor(rd[1] * sc), cz = Math.floor(rd[2] * sc);
    const h = hash3(cx, cy, cz);
    if (h > 1 - density * 0.08) {
      const tw = 0.4 + 0.6 * hash3(cx, cz, cy);
      const fx = fract(rd[0] * sc) - 0.5, fy = fract(rd[1] * sc) - 0.5;
      const glow = Math.max(0, 1 - Math.hypot(fx, fy) * 3.2);
      c = [c[0] + glow * tw * 1.4, c[1] + glow * tw * 1.4, c[2] + glow * tw * 1.6];
    }
  }
  return c;
}

/** Light arriving at a hit, without reflections (`shadows` false for the mirror bounce). */
function shadeHit(scene: SceneDef, hit: Hit, ro: Vec3, rd: Vec3, shadows: boolean): { color: RGB; mirror: number } {
  const p: Vec3 = [ro[0] + rd[0] * hit.t, ro[1] + rd[1] * hit.t, ro[2] + rd[2] * hit.t];
  const { albedo, emit } = surface(hit.s.mat, hit.lp, hit.ln);
  const n = hit.n;
  let col: RGB = [albedo[0] * scene.ambient[0], albedo[1] * scene.ambient[1], albedo[2] * scene.ambient[2]];
  const spec = hit.s.mat.spec ?? 0, gloss = hit.s.mat.gloss ?? 24;
  for (const light of scene.lights) {
    const lx = light.pos[0] - p[0], ly = light.pos[1] - p[1], lz = light.pos[2] - p[2];
    const dist = Math.sqrt(lx * lx + ly * ly + lz * lz);
    if (dist > light.range) continue;
    const l: Vec3 = [lx / dist, ly / dist, lz / dist];
    const ndl = n[0] * l[0] + n[1] * l[1] + n[2] * l[2];
    if (ndl <= 0) continue;
    const f = 1 - (dist / light.range) ** 2;
    const att = f * f;
    const sh = shadows && light.shadow ? softShadow(scene, [p[0] + n[0] * 1.5, p[1] + n[1] * 1.5, p[2] + n[2] * 1.5], l, dist) : 1;
    const k = ndl * att * sh;
    col = [col[0] + albedo[0] * light.color[0] * k, col[1] + albedo[1] * light.color[1] * k, col[2] + albedo[2] * light.color[2] * k];
    if (spec > 0) {
      const hx = l[0] - rd[0], hy = l[1] - rd[1], hz = l[2] - rd[2];
      const hl = Math.hypot(hx, hy, hz) || 1;
      const s = spec * Math.pow(Math.max(0, (n[0] * hx + n[1] * hy + n[2] * hz) / hl), gloss) * att * sh;
      col = [col[0] + light.color[0] * s, col[1] + light.color[1] * s, col[2] + light.color[2] * s];
    }
  }
  col = [col[0] + emit[0], col[1] + emit[1], col[2] + emit[2]];
  return { color: col, mirror: hit.s.mat.mirror ?? 0 };
}

function applyFog(scene: SceneDef, c: RGB, t: number): RGB {
  if (!scene.fog) return c;
  const k = 1 - Math.exp(-t * scene.fog.density);
  return mixRGB(c, scene.fog.color, k);
}

/** Linear light along a camera ray. */
export function radiance(scene: SceneDef, ro: Vec3, rd: Vec3): RGB {
  const hit = trace(scene, ro, rd);
  if (!hit) return sky(scene, rd);
  const s = shadeHit(scene, hit, ro, rd, true);
  let c = s.color;
  if (s.mirror > 0) {
    const n = hit.n;
    const d = 2 * (rd[0] * n[0] + rd[1] * n[1] + rd[2] * n[2]);
    const r: Vec3 = [rd[0] - d * n[0], rd[1] - d * n[1], rd[2] - d * n[2]];
    const p: Vec3 = [ro[0] + rd[0] * hit.t + n[0] * 0.3, ro[1] + rd[1] * hit.t + n[1] * 0.3, ro[2] + rd[2] * hit.t + n[2] * 0.3];
    const h2 = trace(scene, p, r);
    const rc = h2 ? applyFog(scene, shadeHit(scene, h2, p, r, false).color, h2.t) : sky(scene, r);
    c = mixRGB(c, rc, s.mirror);
  }
  return applyFog(scene, c, hit.t);
}

/** The ray through native screen point (x, y) (fractional; x may lie outside 0..320 for widescreen). */
export function cameraRay(x: number, y: number): { ro: Vec3; rd: Vec3 } {
  const f = CAMERA.f;
  return { ro: [0, CAMERA.height, f], rd: norm([(x - 160) / f, (-(y - CAMERA.cy) * 1.2) / f, -1]) };
}

/** Tone curve (colors are display-referred; lights add up and roll off softly): light to 0..255. */
export function toDisplay(c: RGB, exposure = 1): RGB {
  return c.map((v) => Math.round(255 * Math.pow(1 - Math.exp(-Math.max(0, v) * 1.6 * exposure), 0.8))) as RGB;
}

export interface RenderedImage {
  w: number;
  h: number;
  /** Display RGB (0..255), row major. */
  rgb: Uint8Array;
}

/**
 * Renders native columns x0 .. x0 + w (320 wide for the classic screen, wider for widescreen) and 200 rows, with
 * `ss` x `ss` samples per pixel.
 */
export function renderScene(scene: SceneDef, x0 = 0, w = 320, h = 200, ss = 2): RenderedImage {
  const rgb = new Uint8Array(w * h * 3);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const { ro, rd } = cameraRay(x0 + i + (sx + 0.5) / ss, j + (sy + 0.5) / ss);
          const c = toDisplay(radiance(scene, ro, rd), scene.exposure ?? 1);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const n = ss * ss;
      rgb.set([Math.round(r / n), Math.round(g / n), Math.round(b / n)], (j * w + i) * 3);
    }
  }
  return { w, h, rgb };
}
