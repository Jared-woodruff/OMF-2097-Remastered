// A generated robot's sprites as one glTF 2.0 scene for Blender, exactly as the game draws them: every shape of every
// sprite (gen/fighter/build.ts spriteShapes: the posed parts, the parts attached for a pose, loose props such as
// projectiles, and the menu pictures' other views of the model) is an object that keeps its identity from sprite to
// sprite, animated to its place in each (STEP keyframes: sprite i at Blender frame i + 1) and scaled to nothing in the
// sprites without it. Every object's mesh is its shape in the shape's own frame, so whatever is laid on a part in
// Blender (panel seams, rivets, wear: in object coordinates) stays put from frame to frame.
//
// Axes and units as in robotGltf.ts: the game's (x forward, y up, z toward the viewer), 1 world unit (a native pixel's
// width) = metersPerUnit meters. The scene's extras list the sprites: their names, moves, rectangles (in the sprite's
// own pixels) and world units per pixel (1 for fight sprites, 1 / magnification for the menu pictures).
import { boundingRadius, compose, euler, IDENTITY, type Mat3, type Shape, type Vec3, type Xform } from '../../src/gen/geometry';
import { spriteShapes, type GenSprite } from '../../src/gen/fighter/build';
import { ROW_H, traceShapes } from '../../src/gen/raster';
import { HD_SX, HD_SY, HD_UNIT } from '../../src/gen/hdRender';
import { jointTransforms, type Material, type Part, type PlacedShape, type RobotModel } from '../../src/gen/robot';
import { ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER, GltfBuilder, type GltfNode } from './glb';
import { gltfMaterial, materialKey, materialName, quatOf, zoneOf } from './robotGltf';
import { DEFAULT_DETAIL, tessellate, type Detail, type Mesh } from './tessellate';

/** What an object is: a part of the robot, a part attached to a joint for some poses, or a loose prop. */
export type Role = 'part' | 'attach' | 'prop';

/** A shape of a sprite with the identity of the object it belongs to. */
export interface KeyedShape {
  /** The object's name: the same object in every sprite that shows it ('chest.3', 'handF+...', 'prop....'). */
  key: string;
  role: Role;
  /** The joint carrying it (parts and attachments). */
  joint?: string;
  /** A part's index among its joint's parts and its place on the joint (for detail that runs across parts). */
  part?: { index: number; at: Vec3; rot?: Vec3 };
  placed: PlacedShape;
}

const shapeKey = (s: Shape) => [s.kind, s.a, s.b, s.c, s.r, s.k ?? ''].map((v) => (typeof v === 'number' ? +v.toFixed(4) : v)).join(',');
const partKey = (p: Part) => `${shapeKey(p.shape)}|${materialKey(p.mat)}|${(p.at ?? []).map((v) => +v.toFixed(3)).join(',')}|${(p.rot ?? []).join(',')}`;

/** A part placed on its joint (gen/robot.ts placePart). */
function place(jx: Xform, part: Part, joint: number): PlacedShape {
  const w = compose(jx, { rot: part.rot ? euler(part.rot[0], part.rot[1], part.rot[2]) : IDENTITY, pos: part.at });
  const inv = [w.rot[0], w.rot[3], w.rot[6], w.rot[1], w.rot[4], w.rot[7], w.rot[2], w.rot[5], w.rot[8]];
  return { shape: part.shape, inv, pos: w.pos, mat: part.mat, radius: boundingRadius(part.shape), joint };
}

/**
 * A sprite's shapes as spriteShapes places them (the same shapes, in the same order), each with its object's key: a
 * robot part by its joint and index (the menu pictures' turned model has the same parts), an attachment by its joint
 * and what it is, a prop by what it is and how many of the same came before it in the sprite.
 */
export function keyedShapes(model: RobotModel, s: GenSprite): KeyedShape[] {
  const out: KeyedShape[] = [];
  if (s.pose) {
    const m = s.view?.model ?? model;
    const xf = jointTransforms(m, s.pose);
    const show = new Set(s.pose.show ?? []), hide = new Set(s.pose.hide ?? []);
    m.joints.forEach((j, ji) => {
      j.parts.forEach((part, pi) => {
        if (part.tag && (hide.has(part.tag) || (part.optional && !show.has(part.tag)))) return;
        if (!part.tag && part.optional) return;
        out.push({ key: `${j.name}.${pi}`, role: 'part', joint: j.name, part: { index: pi, at: part.at, rot: part.rot }, placed: place(xf.get(j.name)!, part, ji) });
      });
    });
    for (const a of s.pose.attach ?? []) {
      const jx = xf.get(a.joint);
      if (!jx) continue;
      out.push({ key: `${a.joint}+${partKey(a.part)}`, role: 'attach', joint: a.joint, placed: place(jx, a.part, m.joints.findIndex((j) => j.name === a.joint)) });
    }
  }
  const seen = new Map<string, number>();
  for (const p of s.props ?? []) {
    const k = `${shapeKey(p.shape)}|${materialKey(p.mat)}`;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    out.push({ key: `prop|${k}|${n}`, role: 'prop', placed: p });
  }
  return out;
}

/** A sprite's picture: its rectangle in its own pixels (x, y from the robot's floor position) and world units per pixel. */
export function spriteRect(model: RobotModel, s: GenSprite): { rect: [number, number, number, number]; unit: number } {
  const unit = s.view ? 1 / s.view.scale : 1;
  const t = traceShapes(spriteShapes(model, s), unit, ROW_H * unit);
  return { rect: s.view?.rect ?? [t.x, t.y, t.w, t.h], unit };
}

export interface SceneFrame {
  name: string;
  shapes: KeyedShape[];
  info?: Record<string, unknown>;
}

export interface SceneOptions {
  metersPerUnit?: number;
  palette: Uint8Array;
  detail?: Detail;
  fps?: number;
  extras?: Record<string, unknown>;
}

/** The world transform of a placed shape: its rotation (local to world, the transpose of `inv`) and position. */
function worldOf(p: PlacedShape): { rot: Mat3; pos: Vec3 } {
  const i = p.inv;
  return { rot: [i[0], i[3], i[6], i[1], i[4], i[7], i[2], i[5], i[8]], pos: p.pos };
}

/** Writes the sprites as a glTF scene (see above). */
export function sceneGlb(name: string, frames: SceneFrame[], opts: SceneOptions): { glb: Uint8Array; objects: number; triangles: number } {
  const s = opts.metersPerUnit ?? 0.01;
  const fps = opts.fps ?? 24;
  const detail = opts.detail ?? DEFAULT_DETAIL;
  const g = new GltfBuilder('OMF 2097 Remastered tools/blender');
  const json = g.json;

  // The objects, in the order they first appear, with the shape, material and role they have in every sprite.
  const objects = new Map<string, { k: KeyedShape; place: (PlacedShape | null)[] }>();
  frames.forEach((f, i) => {
    for (const k of f.shapes) {
      let o = objects.get(k.key);
      if (!o) objects.set(k.key, (o = { k, place: new Array(frames.length).fill(null) }));
      o.place[i] = k.placed;
    }
  });

  // Materials, shared by the objects of the same one; meshes, shared by the objects of the same shape.
  const materialIndex = new Map<string, number>();
  const taken = new Set<string>();
  const materialOf = (m: Material) => {
    const key = materialKey(m);
    let i = materialIndex.get(key);
    if (i === undefined) {
      json.materials.push(gltfMaterial(materialName(m, taken), m, opts.palette));
      materialIndex.set(key, (i = json.materials.length - 1));
    }
    return i;
  };
  const meshIndex = new Map<string, number>();
  let triangles = 0;
  const meshOf = (shape: Shape, mat: Material) => {
    const key = `${shapeKey(shape)}|${materialKey(mat)}`;
    let i = meshIndex.get(key);
    if (i !== undefined) return i;
    const m: Mesh = tessellate(shape, detail);
    const pos = new Float32Array(m.positions.length);
    for (let v = 0; v < pos.length; v++) pos[v] = m.positions[v] * s;
    triangles += m.indices.length / 3;
    json.meshes.push({
      name: `shape ${shapeKey(shape)}`,
      primitives: [{
        attributes: {
          POSITION: g.accessor(pos, 'VEC3', { target: ARRAY_BUFFER, bounds: true }),
          NORMAL: g.accessor(m.normals, 'VEC3', { target: ARRAY_BUFFER }),
        },
        indices: g.accessor(m.indices, 'SCALAR', { target: ELEMENT_ARRAY_BUFFER }),
        material: materialOf(mat),
      }],
    });
    meshIndex.set(key, (i = json.meshes.length - 1));
    return i;
  };

  const scene: GltfNode = { name, children: [] };
  json.nodes.push(scene);
  const nodeOf = new Map<string, number>();
  for (const [key, o] of objects) {
    const first = o.place.find((p) => p)!;
    const w = worldOf(first);
    const sh = o.k.placed.shape, mat = o.k.placed.mat;
    const node: GltfNode = {
      name: key,
      mesh: meshOf(sh, mat),
      translation: [w.pos[0] * s, w.pos[1] * s, w.pos[2] * s],
      rotation: quatOf(w.rot),
      extras: {
        omf: {
          role: o.k.role, ...(o.k.joint ? { joint: o.k.joint } : {}), ...(o.k.part ? { part: o.k.part } : {}),
          shape: { kind: sh.kind, a: sh.a, b: sh.b, c: sh.c, r: sh.r, ...(sh.k !== undefined ? { k: sh.k } : {}) },
          zone: zoneOf(mat), ramp: mat.ramp, tone: mat.tone, shine: mat.shine, glow: !!mat.glow, ...(mat.fx ? { fx: mat.fx } : {}),
        },
      },
    };
    nodeOf.set(key, json.nodes.length);
    scene.children!.push(json.nodes.length);
    json.nodes.push(node);
  }

  // The sprites: every object's place in each (held where it is absent, scaled to nothing).
  if (frames.length) {
    const times = g.accessor(Float32Array.from(frames, (_, i) => (i + 1) / fps), 'SCALAR', { bounds: true });
    const anim: (typeof json.animations)[number] = { name: 'sprites', channels: [], samplers: [] };
    const channel = (node: number, path: 'translation' | 'rotation' | 'scale', data: Float32Array) => {
      anim.samplers.push({ input: times, output: g.accessor(data, path === 'rotation' ? 'VEC4' : 'VEC3'), interpolation: 'STEP' });
      anim.channels.push({ sampler: anim.samplers.length - 1, target: { node, path } });
    };
    for (const [key, o] of objects) {
      const t = new Float32Array(frames.length * 3), r = new Float32Array(frames.length * 4), sc = new Float32Array(frames.length * 3);
      let last = worldOf(o.place.find((p) => p)!);
      let prev: number[] | null = null;
      o.place.forEach((p, i) => {
        if (p) last = worldOf(p);
        t.set([last.pos[0] * s, last.pos[1] * s, last.pos[2] * s], i * 3);
        let q = quatOf(last.rot);
        if (prev && q[0] * prev[0] + q[1] * prev[1] + q[2] * prev[2] + q[3] * prev[3] < 0) q = [-q[0], -q[1], -q[2], -q[3]];
        r.set(q, i * 4);
        prev = q;
        const v = p ? 1 : 0;
        sc.set([v, v, v], i * 3);
      });
      const node = nodeOf.get(key)!;
      channel(node, 'translation', t);
      channel(node, 'rotation', r);
      channel(node, 'scale', sc);
    }
    json.animations.push(anim);
  }

  json.scenes.push({
    name,
    nodes: [0],
    extras: {
      omf: {
        robot: name,
        format: 'sprites',
        metersPerUnit: s,
        rowHeight: ROW_H,
        hd: { sx: HD_SX, sy: HD_SY, unit: HD_UNIT },
        fps,
        zones: { primary: 'ramp 2 (armor)', secondary: 'ramp 1 (accents)', tertiary: 'ramp 0 (joints)', effect: 'fixed colors' },
        ...opts.extras,
        frames: frames.map((f, i) => ({ name: f.name, frame: i + 1, ...f.info })),
      },
    },
  });
  const used = [...new Set(json.materials.flatMap((m) => Object.keys((m.extensions as object | undefined) ?? {})))];
  if (used.length) json.extensionsUsed = used;
  return { glb: g.glb(), objects: objects.size, triangles };
}
