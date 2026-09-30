// A minimal glTF 2.0 binary (.glb) writer and reader: the JSON document and one binary buffer
// (https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html).

type Typed = Float32Array | Uint32Array | Uint16Array | Uint8Array;
export type AccessorType = 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4';

export const ARRAY_BUFFER = 34962;
export const ELEMENT_ARRAY_BUFFER = 34963;

const COMPONENT_COUNT: Record<AccessorType, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const FLOAT = 5126, UNSIGNED_INT = 5125, UNSIGNED_SHORT = 5123, UNSIGNED_BYTE = 5121;

function componentType(data: Typed): number {
  if (data instanceof Float32Array) return FLOAT;
  if (data instanceof Uint32Array) return UNSIGNED_INT;
  if (data instanceof Uint16Array) return UNSIGNED_SHORT;
  return UNSIGNED_BYTE;
}

export interface GltfNode {
  name?: string;
  children?: number[];
  mesh?: number;
  skin?: number;
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  extras?: unknown;
}

export interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}

export interface GltfAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: AccessorType;
  min?: number[];
  max?: number[];
}

export interface GltfJson {
  asset: { version: string; generator?: string; copyright?: string };
  extensionsUsed?: string[];
  scene: number;
  scenes: { name?: string; nodes: number[]; extras?: unknown }[];
  nodes: GltfNode[];
  meshes: { name?: string; primitives: GltfPrimitive[] }[];
  materials: Record<string, unknown>[];
  skins: { name?: string; joints: number[]; inverseBindMatrices?: number; skeleton?: number }[];
  animations: {
    name?: string;
    channels: { sampler: number; target: { node: number; path: 'translation' | 'rotation' | 'scale' } }[];
    samplers: { input: number; output: number; interpolation?: 'LINEAR' | 'STEP' | 'CUBICSPLINE' }[];
  }[];
  accessors: GltfAccessor[];
  bufferViews: { buffer: number; byteOffset: number; byteLength: number; target?: number }[];
  buffers: { byteLength: number }[];
}

/** Collects a document and its binary data; glb() packs them. */
export class GltfBuilder {
  readonly json: GltfJson;
  private chunks: Uint8Array[] = [];
  private length = 0;

  constructor(generator: string) {
    this.json = {
      asset: { version: '2.0', generator },
      scene: 0,
      scenes: [],
      nodes: [],
      meshes: [],
      materials: [],
      skins: [],
      animations: [],
      accessors: [],
      bufferViews: [],
      buffers: [],
    };
  }

  /** Stores data (4-byte aligned) with an accessor of `type` elements over it; min / max are required for positions and animation times. */
  accessor(data: Typed, type: AccessorType, opts: { target?: number; bounds?: boolean } = {}): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) {
      this.chunks.push(new Uint8Array(pad));
      this.length += pad;
    }
    this.chunks.push(new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
    this.json.bufferViews.push({ buffer: 0, byteOffset: this.length, byteLength: data.byteLength, ...(opts.target ? { target: opts.target } : {}) });
    this.length += data.byteLength;
    const n = COMPONENT_COUNT[type];
    const acc: GltfAccessor = { bufferView: this.json.bufferViews.length - 1, componentType: componentType(data), count: data.length / n, type };
    if (opts.bounds) {
      acc.min = Array.from({ length: n }, () => Infinity);
      acc.max = Array.from({ length: n }, () => -Infinity);
      for (let i = 0; i < data.length; i++) {
        acc.min[i % n] = Math.min(acc.min[i % n], data[i]);
        acc.max[i % n] = Math.max(acc.max[i % n], data[i]);
      }
    }
    this.json.accessors.push(acc);
    return this.json.accessors.length - 1;
  }

  glb(): Uint8Array {
    const binLength = Math.ceil(this.length / 4) * 4;
    this.json.buffers = [{ byteLength: binLength }];
    // Empty top-level arrays are not allowed.
    const doc = Object.fromEntries(Object.entries(this.json).filter(([, v]) => !(Array.isArray(v) && v.length === 0)));
    const text = new TextEncoder().encode(JSON.stringify(doc));
    const jsonLength = Math.ceil(text.length / 4) * 4;
    const out = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true); // 'glTF'
    dv.setUint32(4, 2, true);
    dv.setUint32(8, out.length, true);
    dv.setUint32(12, jsonLength, true);
    dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
    out.set(text, 20);
    out.fill(0x20, 20 + text.length, 20 + jsonLength);
    const b = 20 + jsonLength;
    dv.setUint32(b, binLength, true);
    dv.setUint32(b + 4, 0x004e4942, true); // 'BIN'
    let at = b + 8;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

/** The JSON document and binary buffer of a .glb file. */
export function readGlb(bytes: Uint8Array): { json: GltfJson; bin: Uint8Array } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2) throw new Error('not a glTF 2.0 binary');
  if (dv.getUint32(8, true) !== bytes.length) throw new Error('glb length mismatch');
  const jsonLength = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('first chunk is not JSON');
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as GltfJson;
  const b = 20 + jsonLength;
  const binLength = dv.getUint32(b, true);
  if (dv.getUint32(b + 4, true) !== 0x004e4942) throw new Error('second chunk is not BIN');
  return { json, bin: bytes.subarray(b + 8, b + 8 + binLength) };
}

/** An accessor's elements as a flat array. */
export function accessorData(json: GltfJson, bin: Uint8Array, index: number): Float32Array | Uint32Array | Uint16Array | Uint8Array {
  const acc = json.accessors[index];
  const view = json.bufferViews[acc.bufferView];
  const n = acc.count * COMPONENT_COUNT[acc.type];
  const start = bin.byteOffset + view.byteOffset + (acc.byteOffset ?? 0);
  const copy = (bytesPer: number) => bin.buffer.slice(start, start + n * bytesPer);
  switch (acc.componentType) {
    case FLOAT: return new Float32Array(copy(4));
    case UNSIGNED_INT: return new Uint32Array(copy(4));
    case UNSIGNED_SHORT: return new Uint16Array(copy(2));
    default: return new Uint8Array(copy(1));
  }
}
