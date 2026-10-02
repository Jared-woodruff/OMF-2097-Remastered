// A generated robot (src/gen) as a glTF 2.0 binary for Blender and other 3D tools: its parts as one mesh skinned to its
// skeleton (every part moves with its joint, as in the game), a material per color ramp and shade, and poses as the
// keyframes of one animation (one keyframe per pose, held until the next: STEP interpolation).
//
// Axes are the game's: the robot faces +x, +y is up, +z points at the viewer, so a camera looking down -z sees the
// sprites' view (glTF's own convention; Blender turns it into -Y forward, +Z up). One world unit, a native pixel's
// width, is `metersPerUnit` (default 1 cm: the robots are about a meter tall).
import { add, apply3, euler, mul3, type Mat3, type Vec3 } from '../../src/gen/geometry';
import { ROW_H, SHADING } from '../../src/gen/raster';
import { HD_SX, HD_SY, HD_UNIT } from '../../src/gen/hdRender';
import { jointTransforms, type Material, type Pose, type RobotModel } from '../../src/gen/robot';
import { ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER, GltfBuilder, type GltfNode, type GltfPrimitive } from './glb';
import { DEFAULT_DETAIL, tessellate, type Detail, type Mesh } from './tessellate';

export interface ExportFrame {
  /** A unique name (e.g. 'm11s0': move 11, sprite 0). */
  name: string;
  pose: Pose;
  /** Kept with the frame in the document's extras (move, sprite, native sprite rectangle...). */
  info?: Record<string, unknown>;
}

export interface ExportOptions {
  /** Meters per world unit. */
  metersPerUnit?: number;
  /** The colors the materials take: a 256-color RGB palette whose entries 1-47 are the robot's three color ramps. */
  palette?: Uint8Array;
  detail?: Detail;
  /** Keyframes per second: pose i is at (i + 1) / fps seconds, so frame i + 1 in Blender (whose frames start at 1). */
  fps?: number;
  /** More document information (in the scene's extras, next to the frames). */
  extras?: Record<string, unknown>;
}

/** The color zones: the player's three color ramps (Material.ramp 0, 1, 2), and effect colors that never change. */
export const ZONES = ['tertiary', 'secondary', 'primary'] as const;
export type Zone = (typeof ZONES)[number] | 'effect';

export const zoneOf = (m: Material): Zone => (m.fx ? 'effect' : ZONES[m.ramp]);

type Quat = [number, number, number, number];

/** Rotation matrix (row-major, applied to column vectors like gen/geometry.ts apply3) to a unit quaternion (x, y, z, w). */
export function quatOf(m: Mat3): Quat {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  const l = Math.hypot(...q);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

const rot = (r: Vec3 | undefined): Mat3 => euler(r?.[0] ?? 0, r?.[1] ?? 0, r?.[2] ?? 0);

/** The inverse of a rigid transform as a column-major 4x4 matrix (glTF's inverse bind matrices). */
function inverseRigid(r: Mat3, p: Vec3): number[] {
  // The transpose, and the position rotated back and negated.
  const t = [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
  const q = [-(t[0] * p[0] + t[1] * p[1] + t[2] * p[2]), -(t[3] * p[0] + t[4] * p[1] + t[5] * p[2]), -(t[6] * p[0] + t[7] * p[1] + t[8] * p[2])];
  return [t[0], t[3], t[6], 0, t[1], t[4], t[7], 0, t[2], t[5], t[8], 0, q[0], q[1], q[2], 1];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * Stand-in colors when no palette is given: the remaster's reference hues (steel blue, red, gold), 16 shades each,
 * from dark to light.
 */
function fallbackPalette(): Uint8Array {
  const pal = new Uint8Array(768);
  const hues: [number, number, number][] = [[214, 170, 60], [220, 40, 60], [70, 140, 220]];
  hues.forEach((c, ramp) => {
    for (let k = 0; k < 16; k++) {
      const t = 0.12 + (k / 15) * 1.1;
      pal.set(c.map((v) => Math.min(255, Math.round(v * t + Math.max(0, t - 1) * 255))), (ramp * 16 + k) * 3);
    }
  });
  return pal;
}

/** The color of brightness v (0..1) in a material's ramp (or effect range), as sRGB 0..1 (like gen/hdRender.ts rampColor). */
function rampColor(pal: Uint8Array, m: Material, v: number): [number, number, number] {
  const [first, count] = m.fx ? m.fx : m.ramp === 0 ? [1, 15] : [m.ramp * 16, 16];
  const f = first + Math.max(0, Math.min(1, v)) * (count - 1);
  const i0 = Math.floor(f), i1 = Math.min(first + count - 1, i0 + 1), t = f - i0;
  const c = (k: number) => (pal[i0 * 3 + k] * (1 - t) + pal[i1 * 3 + k] * t) / 255;
  return [c(0), c(1), c(2)];
}

/**
 * A glTF material for a robot material: its ramp's color at the shade lit faces show in the game (the ramp's base
 * shade, darker or lighter by its tone), shinier the higher its shine. Armor is paint (with a clear coat), the joints
 * and accents bare metal; glowing parts emit their color.
 */
export function gltfMaterial(name: string, m: Material, pal: Uint8Array): Record<string, unknown> {
  const zone = zoneOf(m);
  const metallic = zone === 'primary' ? 0 : zone === 'effect' ? 0.5 : 0.9;
  // (bare metal shows its color in its reflections, a shade brighter)
  const base = SHADING.base + (metallic > 0.5 ? 0.1 : 0);
  const v = m.glow ? Math.min(1, 0.85 + 0.15 * m.tone) : Math.max(0.05, Math.min(1, base * (1 + SHADING.tone * m.tone)));
  const color = rampColor(pal, m, v).map(toLinear);
  const roughness = Math.max(0.12, Math.min(0.7, 0.55 - 0.35 * m.shine));
  const out: Record<string, unknown> = {
    name,
    pbrMetallicRoughness: { baseColorFactor: [...color, 1], metallicFactor: metallic, roughnessFactor: roughness },
    extras: { omf: { zone, ramp: m.ramp, tone: m.tone, shine: m.shine, glow: !!m.glow, ...(m.fx ? { fx: m.fx } : {}) } },
  };
  const ext: Record<string, unknown> = {};
  if (zone === 'primary' && !m.glow) ext.KHR_materials_clearcoat = { clearcoatFactor: 0.3, clearcoatRoughnessFactor: 0.2 };
  if (m.glow) {
    out.emissiveFactor = color;
    ext.KHR_materials_emissive_strength = { emissiveStrength: 3 };
  }
  if (Object.keys(ext).length) out.extensions = ext;
  return out;
}

/** A readable, unique material name: its zone, and its shade (dark, hi, bright) and glow. */
export function materialName(m: Material, taken: Set<string>): string {
  const shade = m.tone < -0.15 ? '_dark' : m.tone > 0.3 ? '_bright' : m.tone > 0.05 ? '_hi' : '';
  const base = zoneOf(m) + shade + (m.glow ? '_glow' : '');
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
  taken.add(name);
  return name;
}

export const materialKey = (m: Material) => JSON.stringify([m.ramp, m.tone, m.shine, !!m.glow, m.fx ?? null]);

export interface RobotGlb {
  glb: Uint8Array;
  /** Skin joint order: the root (the robot's floor position turned toward the viewer) and the skeleton's joints. */
  joints: string[];
  triangles: number;
}

/** Exports a robot, posed by `frames` (none: the rest pose only). */
export function robotGlb(model: RobotModel, frames: ExportFrame[], opts: ExportOptions = {}): RobotGlb {
  const s = opts.metersPerUnit ?? 0.01;
  const fps = opts.fps ?? 24;
  const detail = opts.detail ?? DEFAULT_DETAIL;
  const pal = opts.palette ?? fallbackPalette();
  const g = new GltfBuilder('OMF 2097 Remastered tools/blender');
  const json = g.json;
  const scaled = (p: Vec3): Vec3 => [p[0] * s, p[1] * s, p[2] * s];

  // Skeleton: 'root' carries the robot's height and turn (gen/robot.ts jointTransforms' base), then the joints.
  const turn = rot([0, model.turn, 0]);
  const rootNode: GltfNode = { name: 'root', translation: [0, model.hipHeight * s, 0], rotation: quatOf(turn), children: [] };
  json.nodes.push({ name: model.name, children: [1] }, rootNode);
  const nodeOf = new Map<string, number>();
  for (const j of model.joints) {
    nodeOf.set(j.name, json.nodes.length);
    json.nodes.push({ name: j.name, translation: scaled(j.offset) });
  }
  for (const j of model.joints) {
    const parent = j.parent ? json.nodes[nodeOf.get(j.parent)!] : rootNode;
    (parent.children ??= []).push(nodeOf.get(j.name)!);
  }
  const jointNames = ['root', ...model.joints.map((j) => j.name)];
  const skinIndex = new Map(jointNames.map((n, i) => [n, i]));

  // Bind pose: every joint at rest (limbs hanging down).
  const rest = jointTransforms(model, { j: {} });
  const ibm = new Float32Array(jointNames.length * 16);
  ibm.set(inverseRigid(turn, [0, model.hipHeight * s, 0]), 0);
  model.joints.forEach((j, i) => {
    const x = rest.get(j.name)!;
    ibm.set(inverseRigid(x.rot, scaled(x.pos)), (i + 1) * 16);
  });

  // The mesh: the parts in the bind pose, one primitive per material, every vertex bound to its part's joint.
  const groups = new Map<string, { mat: Material; parts: { mesh: Mesh; r: Mat3; p: Vec3; joint: number }[] }>();
  const cache = new Map<string, Mesh>();
  for (const j of model.joints) {
    const x = rest.get(j.name)!;
    for (const part of j.parts) {
      // (parts shown only when a pose asks for them are left out)
      if (part.optional) continue;
      const shapeKey = JSON.stringify(part.shape);
      let mesh = cache.get(shapeKey);
      if (!mesh) cache.set(shapeKey, (mesh = tessellate(part.shape, detail)));
      const pr = rot(part.rot);
      // Part to world: the joint's rotation after the part's own; the part's position in the joint's frame.
      const r = mul3(x.rot, pr);
      const p = add(x.pos, apply3(x.rot, part.at));
      const key = materialKey(part.mat);
      let grp = groups.get(key);
      if (!grp) groups.set(key, (grp = { mat: part.mat, parts: [] }));
      grp.parts.push({ mesh, r, p, joint: skinIndex.get(j.name)! });
    }
  }
  const taken = new Set<string>();
  const primitives: GltfPrimitive[] = [];
  let triangles = 0;
  for (const { mat, parts } of groups.values()) {
    const nv = parts.reduce((a, q) => a + q.mesh.positions.length / 3, 0);
    const ni = parts.reduce((a, q) => a + q.mesh.indices.length, 0);
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), jnt = new Uint8Array(nv * 4), wgt = new Float32Array(nv * 4);
    const idx = new Uint32Array(ni);
    let v0 = 0, i0 = 0;
    for (const q of parts) {
      const m = q.mesh;
      for (let v = 0; v < m.positions.length / 3; v++) {
        const lp: Vec3 = [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]];
        const ln: Vec3 = [m.normals[v * 3], m.normals[v * 3 + 1], m.normals[v * 3 + 2]];
        pos.set(scaled(add(q.p, apply3(q.r, lp))), (v0 + v) * 3);
        nor.set(apply3(q.r, ln), (v0 + v) * 3);
        jnt[(v0 + v) * 4] = q.joint;
        wgt[(v0 + v) * 4] = 1;
      }
      for (let k = 0; k < m.indices.length; k++) idx[i0 + k] = m.indices[k] + v0;
      v0 += m.positions.length / 3;
      i0 += m.indices.length;
    }
    triangles += ni / 3;
    json.materials.push(gltfMaterial(materialName(mat, taken), mat, pal));
    primitives.push({
      attributes: {
        POSITION: g.accessor(pos, 'VEC3', { target: ARRAY_BUFFER, bounds: true }),
        NORMAL: g.accessor(nor, 'VEC3', { target: ARRAY_BUFFER }),
        JOINTS_0: g.accessor(jnt, 'VEC4', { target: ARRAY_BUFFER }),
        WEIGHTS_0: g.accessor(wgt, 'VEC4', { target: ARRAY_BUFFER }),
      },
      indices: g.accessor(idx, 'SCALAR', { target: ELEMENT_ARRAY_BUFFER }),
      material: json.materials.length - 1,
    });
  }
  json.meshes.push({ name: model.name, primitives });
  json.nodes[0].children!.push(json.nodes.length);
  json.nodes.push({ name: `${model.name}_mesh`, mesh: 0, skin: 0 });
  json.skins.push({
    name: model.name,
    joints: jointNames.map((n) => (n === 'root' ? 1 : nodeOf.get(n)!)),
    inverseBindMatrices: g.accessor(ibm, 'MAT4'),
    skeleton: 1,
  });

  // The poses: keyframe i at (i + 1) / fps, the joints' rotations and the root's position.
  if (frames.length) {
    const times = g.accessor(Float32Array.from(frames, (_, i) => (i + 1) / fps), 'SCALAR', { bounds: true });
    const anim: (typeof json.animations)[number] = { name: 'poses', channels: [], samplers: [] };
    const channel = (node: number, path: 'translation' | 'rotation', data: Float32Array) => {
      anim.samplers.push({ input: times, output: g.accessor(data, path === 'rotation' ? 'VEC4' : 'VEC3'), interpolation: 'STEP' });
      anim.channels.push({ sampler: anim.samplers.length - 1, target: { node, path } });
    };
    const rootPos = new Float32Array(frames.length * 3);
    frames.forEach((f, i) => {
      const r = f.pose.root ?? [0, 0, 0];
      rootPos.set(scaled([r[0], model.hipHeight + r[1], r[2]]), i * 3);
    });
    channel(1, 'translation', rootPos);
    for (const j of model.joints) {
      const data = new Float32Array(frames.length * 4);
      let prev: Quat | null = null;
      frames.forEach((f, i) => {
        let q = quatOf(rot(f.pose.j[j.name]));
        // (the same hemisphere as the previous key, should anyone interpolate them)
        if (prev && q[0] * prev[0] + q[1] * prev[1] + q[2] * prev[2] + q[3] * prev[3] < 0) q = [-q[0], -q[1], -q[2], -q[3]];
        data.set(q, i * 4);
        prev = q;
      });
      channel(nodeOf.get(j.name)!, 'rotation', data);
    }
    json.animations.push(anim);
  }

  json.scenes.push({
    name: model.name,
    nodes: [0],
    extras: {
      omf: {
        robot: model.name,
        metersPerUnit: s,
        // A native pixel is 1 world unit wide and ROW_H tall; the HD pictures have HD_SX x HD_SY pixels per native pixel.
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
  return { glb: g.glb(), joints: jointNames, triangles };
}
