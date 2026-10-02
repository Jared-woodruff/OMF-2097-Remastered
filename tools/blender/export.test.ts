// The generated robots as glTF for Blender (tools/blender): checks of the meshes and the skeleton against the game's
// own shapes and joint math, of the sprites' objects against the game's placement, and the export itself, run by
// `npm run blender:export` (sets OMF_BLENDER_OUT):
//   <out>/<robot>.glb             every sprite of the robot as a scene of objects, one keyframe per sprite (sceneGltf.ts),
//                                 and the mechlab's turning robot (mech0..mech19)
//   <out>/<robot>/sprites/*.png   each sprite as the game has it (reference colors, 4 transparent pixels around)
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { apply3, boundingRadius, compose, euler, extents, sdf, type Shape, type Vec3, type Xform } from '../../src/gen/geometry';
import { spriteShapes, type GenSprite } from '../../src/gen/fighter/build';
import { turntable } from '../../src/gen/mechlabModel';
import { writePng } from '../../src/gen/dev/png';
import { ROW_H, traceShapes } from '../../src/gen/raster';
import { jointTransforms, placeShapes, type Pose } from '../../src/gen/robot';
import { box, ball, capsule, cone, cylinder, limb, prism, tbox, wedge } from '../../src/gen/robots/parts';
import { HELIX } from '../../src/gen/robots/helix';
import { fighterOf, GEN_ROBOTS } from '../../src/gen/roster';
import { robotBasePalette } from '../../src/mods/hdArt';
import { loadGameData } from '../../src/test/harness';
import { FIGHTER_RAMPS } from '../hd-pack/catalog';
import { accessorData, readGlb, type GltfJson } from './glb';
import { quatOf, robotGlb, type ExportFrame } from './robotGltf';
import { keyedShapes, sceneGlb, spriteRect, type SceneFrame } from './sceneGltf';
import { tessellate } from './tessellate';

const OUT = process.env.OMF_BLENDER_OUT;
const ROBOT = (process.env.OMF_BLENDER_ROBOT || 'HELIX').toUpperCase();
/** Moves to export (move ids, comma separated); all of them when not set. */
const MOVES = process.env.OMF_BLENDER_MOVES ? process.env.OMF_BLENDER_MOVES.split(',').map(Number) : null;
/** Native pixels of margin around the sprites (the HD packs' and the mods' HD pictures'). */
const PAD = 4;

const SHAPES: [string, Shape][] = [
  ['rounded box', box(3.2, 2.8, 3.4, 0.6)],
  ['sharp box', box(2, 1, 0.5, 0)],
  ['ellipsoid', ball(3, 2, 1.5)],
  ['capsule', capsule(4, 1.5)],
  ['rounded cylinder', cylinder(2.2, 5.4, 1)],
  ['sharp cylinder', cylinder(1, 2, 0)],
  ['cone', cone(9, 5, 0.3)],
  ['pointed cone', cone(3, 2, 0)],
  ['rounded cone', limb(5, 2, 1.2)],
  ['wedge', wedge(1.5, 5.6, 1.2, 2, 0.3)],
  ['leaning spike', wedge(0.8, 2.6, 0.7, 3, 0.2)],
  ['sharp wedge', wedge(2, 3, 0.5, -1, 0)],
  ['tapered box', tbox(4, 10.5, 5, 1.75, 0.6)],
  ['narrowing box', tbox(8.4, 2.2, 5, 0.85, 0.4)],
  ['sharp tapered box', tbox(2, 3, 1, 0.5, 0)],
  ['prism', prism(2.2, 3.9, 4.6, 5)],
  ['squashed prism', prism(5, 1, 1.2, 6, 0.5)],
  ['crystal', prism(6.5, 3.2, 0.05, 5)],
];

/** Volume inside the shape's surface, counted on a grid over its bounds. */
function sampledVolume(s: Shape, n = 64): number {
  const e = extents(s).map((v) => v * 1.02 + 0.01);
  let inside = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        const p: Vec3 = [((i + 0.5) / n * 2 - 1) * e[0], ((j + 0.5) / n * 2 - 1) * e[1], ((k + 0.5) / n * 2 - 1) * e[2]];
        if (sdf(p, s) < 0) inside++;
      }
    }
  }
  return (inside / n ** 3) * 8 * e[0] * e[1] * e[2];
}

describe('tessellation', () => {
  for (const [name, shape] of SHAPES) {
    it(`${name}: on the surface, facing out, the same volume`, () => {
      const m = tessellate(shape);
      const size = Math.max(...extents(shape));
      const p = (i: number): Vec3 => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
      const n = (i: number): Vec3 => [m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]];
      const step = 1e-3 * size;
      const at = (q: Vec3, d: Vec3, k: number): Vec3 => [q[0] + d[0] * k, q[1] + d[1] * k, q[2] + d[2] * k];
      for (let i = 0; i < m.positions.length / 3; i++) {
        expect(Math.abs(sdf(p(i), shape))).toBeLessThan(2e-3 * size);
        // (the shapes are convex: out along any face's normal leaves them, creases included)
        expect(sdf(at(p(i), n(i), step), shape)).toBeGreaterThan(0);
      }
      let volume = 0;
      for (let t = 0; t < m.indices.length; t += 3) {
        const [ia, ib, ic] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
        const [a, b, c] = [p(ia), p(ib), p(ic)];
        // Against the surface (no triangle cuts through the shape) and wound outward: its winding's normal leads out.
        const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const g: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const gl = Math.hypot(...g);
        const mid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
        const gn: Vec3 = [g[0] / gl, g[1] / gl, g[2] / gl];
        expect(Math.abs(sdf(mid, shape))).toBeLessThan(0.01 * size);
        expect(sdf(at(mid, gn, step), shape)).toBeGreaterThan(sdf(at(mid, gn, -step), shape));
        const vn = [0, 1, 2].map((k) => n(ia)[k] + n(ib)[k] + n(ic)[k]);
        expect(gn[0] * vn[0] + gn[1] * vn[1] + gn[2] * vn[2]).toBeGreaterThan(0);
        // Closed: the signed volume of the triangles is the shape's.
        volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
      }
      expect(Math.abs(volume / sampledVolume(shape) - 1)).toBeLessThan(0.03);
    });
  }
});

/** World transforms of the glTF nodes at keyframe `k` of the first animation (none: the nodes' own transforms). */
function nodeTransforms(json: GltfJson, bin: Uint8Array, k: number | null): Map<number, Xform> {
  const local = json.nodes.map((nd) => ({ t: (nd.translation ?? [0, 0, 0]) as Vec3, r: nd.rotation ?? [0, 0, 0, 1] }));
  if (k !== null) {
    const anim = json.animations[0];
    for (const ch of anim.channels) {
      const out = accessorData(json, bin, anim.samplers[ch.sampler].output);
      if (ch.target.path === 'rotation') local[ch.target.node].r = Array.from(out.subarray(k * 4, k * 4 + 4));
      if (ch.target.path === 'translation') local[ch.target.node].t = Array.from(out.subarray(k * 3, k * 3 + 3)) as Vec3;
    }
  }
  const matOf = ([x, y, z, w]: number[]) => [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
  const out = new Map<number, Xform>();
  const visit = (i: number, parent: Xform) => {
    const x = compose(parent, { rot: matOf(local[i].r), pos: local[i].t });
    out.set(i, x);
    for (const c of json.nodes[i].children ?? []) visit(c, x);
  };
  visit(0, { rot: [1, 0, 0, 0, 1, 0, 0, 0, 1], pos: [0, 0, 0] });
  return out;
}

describe('glTF export', () => {
  const b = { model: HELIX };
  const poses: Pose[] = [
    { j: {} },
    { j: { pelvis: [0, 30, -10], chest: [5, -20, 15], shoulderF: [10, 0, 80], elbowF: [0, 0, -60], hipB: [0, 0, 45], kneeB: [0, 0, 60] }, root: [6, -9, 2] },
    { j: { handF: [0, 120, 0], head: [0, -12, 20], footF: [0, 0, 30] }, root: [0, 12, 0] },
  ];
  const frames: ExportFrame[] = poses.map((pose, i) => ({ name: `pose${i}`, pose }));
  const s = 0.01;
  const { glb, joints } = robotGlb(b.model, frames, { metersPerUnit: s });
  const { json, bin } = readGlb(glb);

  it('writes a valid binary glTF', () => {
    expect(json.asset.version).toBe('2.0');
    for (const v of json.bufferViews) {
      expect(v.byteOffset % 4).toBe(0);
      expect(v.byteOffset + v.byteLength).toBeLessThanOrEqual(bin.length);
    }
    for (const prim of json.meshes[0].primitives) {
      const pos = accessorData(json, bin, prim.attributes.POSITION);
      const acc = json.accessors[prim.attributes.POSITION];
      for (let i = 0; i < pos.length; i++) {
        expect(pos[i]).toBeGreaterThanOrEqual(acc.min![i % 3]);
        expect(pos[i]).toBeLessThanOrEqual(acc.max![i % 3]);
      }
      const idx = accessorData(json, bin, prim.indices!);
      expect(Math.max(...idx)).toBeLessThan(pos.length / 3);
      const jnt = accessorData(json, bin, prim.attributes.JOINTS_0);
      expect(Math.max(...jnt)).toBeLessThan(joints.length);
    }
    expect(json.skins[0].joints.length).toBe(joints.length);
    expect(json.animations[0].samplers.every((sm) => sm.interpolation === 'STEP')).toBe(true);
    const zones = new Set(json.materials.map((m) => (m.extras as { omf: { zone: string } }).omf.zone));
    expect([...zones].sort()).toEqual(['primary', 'secondary', 'tertiary']);
  });

  it('turns rotation matrices into the same quaternions', () => {
    for (const r of [[0, 0, 0], [10, 20, 30], [-80, 170, 45], [90, -90, 180], [0, 180, 0]] as Vec3[]) {
      const m = euler(r[0], r[1], r[2]);
      const [x, y, z, w] = quatOf(m);
      const back = [
        1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
        2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
        2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
      ];
      back.forEach((v, i) => expect(v).toBeCloseTo(m[i], 6));
    }
  });

  it('poses the skeleton like the game', () => {
    const nodeOf = new Map(json.nodes.map((nd, i) => [nd.name, i]));
    poses.forEach((pose, k) => {
      const got = nodeTransforms(json, bin, k);
      const want = jointTransforms(b.model, pose);
      for (const j of b.model.joints) {
        const g = got.get(nodeOf.get(j.name)!)!, w = want.get(j.name)!;
        g.rot.forEach((v, i) => expect(v).toBeCloseTo(w.rot[i], 5));
        g.pos.forEach((v, i) => expect(v / s).toBeCloseTo(w.pos[i], 3));
      }
    });
  });

  it("skins the mesh onto the game's shapes", () => {
    // Every posed vertex (joint transform x inverse bind matrix x bind position) lies on one of the pose's shapes.
    const ibm = accessorData(json, bin, json.skins[0].inverseBindMatrices!);
    poses.forEach((pose, k) => {
      const nodes = nodeTransforms(json, bin, k);
      const placed = placeShapes(b.model, pose, boundingRadius);
      for (const prim of json.meshes[0].primitives) {
        const pos = accessorData(json, bin, prim.attributes.POSITION);
        const jnt = accessorData(json, bin, prim.attributes.JOINTS_0);
        for (let v = 0; v < pos.length / 3; v += 5) {
          const j = jnt[v * 4];
          const m = ibm.subarray(j * 16, j * 16 + 16);
          const bp = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
          const local: Vec3 = [0, 1, 2].map((r) => m[r] * bp[0] + m[4 + r] * bp[1] + m[8 + r] * bp[2] + m[12 + r]) as Vec3;
          const x = nodes.get(json.skins[0].joints[j])!;
          const wp = apply3(x.rot, local).map((c, i) => (c + x.pos[i]) / s) as Vec3;
          const d = Math.min(...placed.map((sh) => Math.abs(sdf(apply3(sh.inv, [wp[0] - sh.pos[0], wp[1] - sh.pos[1], wp[2] - sh.pos[2]]), sh.shape))));
          expect(d).toBeLessThan(0.02);
        }
      }
    });
  });
});

describe('the sprites as objects', () => {
  for (const robot of GEN_ROBOTS) {
    it(`${robot.name}: every sprite's objects are the shapes the game places, each object one shape in every sprite`, () => {
      const kinds = new Map<string, string>();
      let sprites = 0;
      for (const m of fighterOf(robot).moves) {
        for (const gs of m.sprites) {
          const want = spriteShapes(robot.model, gs);
          const got = keyedShapes(robot.model, gs);
          expect(got.length).toBe(want.length);
          got.forEach((k, i) => {
            const w = want[i];
            expect(k.placed.shape).toEqual(w.shape);
            expect(k.placed.mat).toEqual(w.mat);
            expect(k.placed.joint).toBe(w.joint);
            k.placed.pos.forEach((v, c) => expect(v).toBeCloseTo(w.pos[c], 9));
            k.placed.inv.forEach((v, c) => expect(v).toBeCloseTo(w.inv[c], 9));
            // (an object is the same shape and material wherever it shows)
            const what = JSON.stringify([w.shape, w.mat]);
            expect(kinds.get(k.key) ?? what).toBe(what);
            kinds.set(k.key, what);
          });
          expect(new Set(got.map((k) => k.key)).size).toBe(got.length);
          sprites++;
        }
      }
      expect(sprites).toBeGreaterThan(140);
    });
  }
});

describe.skipIf(!OUT)('export', () => {
  it(`writes ${ROBOT} as glTF`, () => {
    loadGameData();
    const robot = GEN_ROBOTS.find((r) => r.name === ROBOT);
    if (!robot) throw new Error(`no generated robot ${ROBOT} (${GEN_ROBOTS.map((r) => r.name).join(', ')})`);
    // The colors of the HD packs' sources, which the mod's HD pictures are painted in (hd.json colors).
    const palette = robotBasePalette([FIGHTER_RAMPS.primary, FIGHTER_RAMPS.secondary, FIGHTER_RAMPS.tertiary]);
    const dir = path.join(OUT!, robot.name.toLowerCase(), 'sprites');
    fs.mkdirSync(dir, { recursive: true });
    const frames: SceneFrame[] = [];
    const t0 = performance.now();
    // The idle stance first (the pose a still render of the file shows), then the moves in order.
    const moves = [...fighterOf(robot).moves].sort((a, b) => (a.id === 11 ? -1 : b.id === 11 ? 1 : a.id - b.id));
    const kinds = { pose: 0, effect: 0, menu: 0, mech: 0 };
    // The fighter file's sprites, then the mechlab's turning robot (gen/mechlabModel.ts: its frames are the
    // presentation pose turned and magnified, like a menu picture without a frame).
    const tt = MOVES ? null : turntable(robot);
    const extra = (tt?.models ?? []).map((model): GenSprite => ({ pose: tt!.pose, view: { model, scale: tt!.scale } }));
    for (const m of [...moves, ...(extra.length ? [{ id: -1, sprites: extra }] : [])]) {
      if (MOVES && !MOVES.includes(m.id)) continue;
      m.sprites.forEach((gs, i) => {
        const shapes = keyedShapes(robot.model, gs);
        if (!shapes.length) return;
        const kind = m.id < 0 ? 'mech' : gs.view ? 'menu' : gs.pose ? 'pose' : 'effect';
        kinds[kind]++;
        const { rect, unit } = spriteRect(robot.model, gs);
        const name = m.id < 0 ? `mech${i}` : `m${m.id}s${i}`;
        frames.push({ name, shapes, info: { ...(m.id < 0 ? {} : { move: m.id, sprite: i }), kind, rect, ...(unit !== 1 ? { unit } : {}) } });
        // The sprite as the game draws it (a menu picture cut to its frame, without its background).
        const t = traceShapes(spriteShapes(robot.model, gs), unit, ROW_H * unit);
        const w = rect[2] + 2 * PAD, h = rect[3] + 2 * PAD;
        const rgba = new Uint8Array(w * h * 4);
        for (let r = 0; r < t.h; r++) {
          for (let c = 0; c < t.w; c++) {
            const v = t.data[r * t.w + c];
            const x = t.x + c - rect[0] + PAD, y = t.y + r - rect[1] + PAD;
            if (v && x >= PAD && y >= PAD && x < w - PAD && y < h - PAD) rgba.set([palette[v * 3], palette[v * 3 + 1], palette[v * 3 + 2], 255], (y * w + x) * 4);
          }
        }
        writePng(path.join(dir, `${name}.png`), w, h, rgba);
      });
    }
    // The three ramps' colors (sRGB), dark to bright: the render's grading shades each zone along its ramp.
    const ramp = (first: number, count: number) => Array.from({ length: count }, (_, k) => [...palette.subarray((first + k) * 3, (first + k) * 3 + 3)]);
    const { glb, objects, triangles } = sceneGlb(robot.name, frames, {
      palette,
      extras: {
        har: robot.id, pad: PAD,
        palette: { primary: FIGHTER_RAMPS.primary, secondary: FIGHTER_RAMPS.secondary, tertiary: FIGHTER_RAMPS.tertiary },
        ramps: { tertiary: ramp(1, 15), secondary: ramp(16, 16), primary: ramp(32, 16) },
      },
    });
    const file = path.join(OUT!, `${robot.name.toLowerCase()}.glb`);
    fs.writeFileSync(file, glb);
    console.log(`${file}: ${frames.length} sprites (${kinds.pose} poses, ${kinds.effect} effects, ${kinds.menu} menu pictures, ${kinds.mech} mechlab frames), ${objects} objects, ` +
      `${triangles} triangles, ${(glb.length / 1e6).toFixed(1)} MB, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  });
});
