// HD renderings of the generated robots on the GPU: the same shapes and lights as the native sprites (gen/raster.ts),
// drawn at the HD artwork scale (5 x 6 texels per native pixel: square texels on a 4:3 display) as smooth polished
// metal like the original robots' remastered artwork (rounded facets and rims, a reflected studio, contact shadows)
// with anti-aliased edges, into atlas pages that the remastered renderer uses like installed HD artwork. Colors come
// from a reference palette; the renderer recolors them to the players' colors like every robot's artwork.
import { prismSides, ShapeKind } from './geometry';
import { LIGHT_FILL, LIGHT_KEY, ROW_H, SHADING } from './raster';
import type { PlacedShape } from './robot';

const f = (v: number) => v.toFixed(4);
/** How far box and blade normals bend toward their centers in the HD renderings (gently curved plates). */
const HD_SOFTNESS = 0.3;

export const HD_SX = 5;
export const HD_SY = 6;
/** World units per HD texel at magnification 1 (1 / 5 horizontally, 1.2 / 6 vertically). */
export const HD_UNIT = 1 / HD_SX;

const MAX_SHAPES = 128;
/** RGBA32F texels per shape: inverse rotation rows (+ ramp, tone, shine), position + kind, size, flags. */
const TEXELS = 6;

const VS = `#version 300 es
precision highp float;
uniform vec4 u_dst;
uniform vec2 u_page;
out vec2 v_px;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  v_px = c * u_dst.zw;
  vec2 p = u_dst.xy + c * u_dst.zw;
  gl_Position = vec4(p / u_page * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Distance functions matching gen/geometry.ts sdf(), and the shapes' half extents (for soft normals). */
export const SDF_GLSL = `
float sdTriangle(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
  vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                   vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
float sdShape(vec3 p, int kind, vec4 q, float k) {
  float a = q.x, b = q.y, c = q.z, r = q.w;
  if (kind == 0) {
    vec3 d = abs(p) - vec3(a, b, c);
    return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0) - r;
  } else if (kind == 1) {
    vec3 ra = vec3(a, b, c);
    float k0 = length(p / ra);
    float k1 = length(p / (ra * ra));
    return k1 == 0.0 ? -min(a, min(b, c)) : k0 * (k0 - 1.0) / k1;
  } else if (kind == 2) {
    return length(vec3(p.x, p.y - clamp(p.y, -a, a), p.z)) - r;
  } else if (kind == 3) {
    vec2 d = vec2(length(p.xz) - r + c, abs(p.y) - a + c);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - c;
  } else if (kind == 4) {
    vec2 qq = vec2(length(p.xz), p.y);
    vec2 k1 = vec2(b, a);
    vec2 k2 = vec2(b - r, 2.0 * a);
    vec2 ca = vec2(qq.x - min(qq.x, qq.y < 0.0 ? r : b), abs(qq.y) - a);
    vec2 cb = qq - k1 + k2 * clamp(dot(k1 - qq, k2) / dot(k2, k2), 0.0, 1.0);
    float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
    return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
  } else if (kind == 5) {
    float h = 2.0 * a;
    vec2 qq = vec2(length(p.xz), p.y + a);
    float bb = (r - b) / h;
    float aa = sqrt(max(0.0, 1.0 - bb * bb));
    float kk = dot(qq, vec2(-bb, aa));
    if (kk < 0.0) return length(qq) - r;
    if (kk > aa * h) return length(qq - vec2(0.0, h)) - b;
    return dot(qq, vec2(aa, bb)) - r;
  } else if (kind == 6) {
    float d2 = sdTriangle(p.xy, vec2(-a, -b), vec2(a, -b), vec2(k, b));
    vec2 w = vec2(d2, abs(p.z) - c);
    return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - r;
  } else if (kind == 8) {
    float zs = c == 0.0 ? 1.0 : c;
    vec2 xz = vec2(p.x, p.z / zs);
    float sector = 6.28318530718 / k;
    float th = atan(xz.y, xz.x);
    th -= sector * floor(th / sector + 0.5);
    float u = length(xz) * cos(th);
    float h2 = 2.0 * a, dr = b - r;
    float side = ((u - r) * h2 - dr * (p.y + a)) / length(vec2(h2, dr));
    return max(side, abs(p.y) - a) * min(1.0, zs);
  }
  float f = 1.0 + (k - 1.0) * (clamp(p.y, -b, b) + b) / (2.0 * b);
  vec3 d = abs(p) - vec3(a * f, b, c * f);
  return (length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0) - r) * 0.8;
}
vec3 shapeExtents(int kind, vec4 q, float k) {
  float a = q.x, b = q.y, c = q.z, r = q.w;
  if (kind == 0) return vec3(a + r, b + r, c + r);
  if (kind == 1) return vec3(a, b, c);
  if (kind == 2) return vec3(r, a + r, r);
  if (kind == 3) return vec3(r, a, r);
  if (kind == 4) return vec3(max(r, b), a, max(r, b));
  if (kind == 5) return vec3(max(r, b), a + max(r, b), max(r, b));
  if (kind == 6) return vec3(max(a, abs(k)) + r, b + r, c + r);
  if (kind == 8) {
    float corner = max(r, b) / cos(3.14159265 / k);
    return vec3(corner, a, corner * (c == 0.0 ? 1.0 : c));
  }
  return vec3(a * max(1.0, k) + r, b + r, c * max(1.0, k) + r);
}
`;

const FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_px;
uniform highp sampler2D u_shapes;
uniform int u_count;
uniform vec2 u_origin;   // world position of the rectangle's top-left corner
uniform float u_unit;    // world units per texel
uniform sampler2D u_pal; // reference palette, 256x1
uniform vec3 u_key;
uniform vec3 u_fill;
out vec4 o_color;
${SDF_GLSL}
vec4 T(int s, int k) { return texelFetch(u_shapes, ivec2(s * ${TEXELS} + k, 0), 0); }

// The color of brightness v in a material's range: ramp 0 = indices 1..15, 1 and 2 = 16 entries; effects: [first, count].
vec3 rampColor(float first, float count, float v) {
  float f = first + v * (count - 1.0);
  int i0 = int(floor(f));
  int i1 = min(int(first + count - 1.0), i0 + 1);
  vec3 c0 = texelFetch(u_pal, ivec2(i0, 0), 0).rgb;
  vec3 c1 = texelFetch(u_pal, ivec2(i1, 0), 0).rgb;
  return mix(c0, c1, fract(f));
}

// The HD renderings show the parts as smooth, machined metal, like the original robots' remastered artwork (the
// native sprites keep the low-polygon facets of their 1994 renders): prisms get round sides and rounded rims.
vec3 prismNormal(vec3 p, vec3 nf, vec4 q) {
  float a = q.x, b = q.y, zs = q.z == 0.0 ? 1.0 : q.z, r = q.w;
  vec2 xz = vec2(p.x, p.z / zs);
  float rho = length(xz);
  vec2 rad = rho > 1e-5 ? xz / rho : vec2(1.0, 0.0);
  vec3 side = normalize(vec3(rad.x, (r - b) / (2.0 * a), rad.y / zs));
  float R = mix(r, b, clamp((p.y + a) / (2.0 * a), 0.0, 1.0));
  float bev = min(0.7, 0.3 * max(R, 0.5));
  if (abs(nf.y) > 0.9) return normalize(mix(nf, side, 0.75 * smoothstep(R - bev, R, rho)));
  vec3 n = normalize(mix(nf, side, 0.85));
  return normalize(mix(n, vec3(0.0, sign(p.y), 0.0), 0.65 * smoothstep(a - bev, a, abs(p.y))));
}

// A studio around the robot, reflected by its chrome: a bright sky with a softbox, a dark band at the horizon and a
// dim floor below, the bands that curved polished metal shows.
float envLight(vec3 r) {
  float sky = smoothstep(-0.05, 0.45, r.y);
  float horizon = exp(-pow((r.y + 0.05) * 5.0, 2.0));
  float box = exp(-pow((r.y - 0.45) * 3.0, 2.0)) * smoothstep(0.7, -0.5, r.x);
  float key = pow(max(0.0, dot(r, u_key)), 16.0);
  float back = pow(max(0.0, dot(r, normalize(vec3(0.85, 0.35, -0.4)))), 6.0);
  return clamp(0.3 + 0.52 * sky - 0.3 * horizon + 0.3 * box + 0.9 * key + 0.3 * back, 0.0, 1.0);
}

// Distance from a world point to the nearest other part (up to maxD), for the contact shadows.
float sceneDist(vec3 pw, float maxD, int skip) {
  float d = maxD;
  for (int s = 0; s < ${MAX_SHAPES}; s++) {
    if (s >= u_count) break;
    if (s == skip) continue;
    vec4 pk = T(s, 3);
    vec4 fl = T(s, 5);
    vec3 dp = pw - pk.xyz;
    if (length(dp) - fl.y > d) continue;
    mat3 m = mat3(T(s, 0).xyz, T(s, 1).xyz, T(s, 2).xyz);
    d = min(d, sdShape(dp * m, int(pk.w + 0.5), T(s, 4), fl.z));
  }
  return d;
}

// Ambient occlusion: how much the other parts crowd the space above the surface (0 open .. 1 buried).
float occlusion(vec3 pw, vec3 n, int skip) {
  float occ = 0.0;
  occ += 0.5 * (0.8 - max(0.0, sceneDist(pw + n * 0.8, 0.8, skip))) / 0.8;
  occ += 0.32 * (2.2 - max(0.0, sceneDist(pw + n * 2.2, 2.2, skip))) / 2.2;
  occ += 0.18 * (4.5 - max(0.0, sceneDist(pw + n * 4.5, 4.5, skip))) / 4.5;
  return clamp(occ, 0.0, 1.0);
}

// Color of the nearest surface along the ray into the screen at world (x, y); alpha 0 when nothing is hit.
vec4 sampleAt(vec2 w) {
  float bestT = 1e9;
  int bestS = -1;
  vec3 bestN = vec3(0.0, 0.0, 1.0);
  vec3 bestP = vec3(0.0);
  for (int s = 0; s < ${MAX_SHAPES}; s++) {
    if (s >= u_count) break;
    vec4 pk = T(s, 3);
    vec4 q = T(s, 4);
    vec4 fl = T(s, 5);
    float R = fl.y + 0.01;
    float kk = fl.z;
    vec2 dxy = w - pk.xy;
    if (dot(dxy, dxy) > R * R) continue;
    int kind = int(pk.w + 0.5);
    mat3 m = mat3(T(s, 0).xyz, T(s, 1).xyz, T(s, 2).xyz);
    vec3 roL = (vec3(w, 1000.0) - pk.xyz) * m;
    vec3 rdL = vec3(0.0, 0.0, -1.0) * m;
    float b = dot(roL, rdL);
    float c = dot(roL, roL) - R * R;
    float h = b * b - c;
    if (h < 0.0) continue;
    float sq = sqrt(h);
    float t = max(0.0, -b - sq);
    float tEnd = min(-b + sq, bestT);
    for (int i = 0; i < 80; i++) {
      if (t > tEnd) break;
      vec3 p = roL + rdL * t;
      float d = sdShape(p, kind, q, kk);
      if (d < 0.004) {
        bestT = t;
        bestS = s;
        bestP = p;
        vec2 e = vec2(0.003, 0.0);
        bestN = normalize(vec3(sdShape(p + e.xyy, kind, q, kk) - sdShape(p - e.xyy, kind, q, kk),
                               sdShape(p + e.yxy, kind, q, kk) - sdShape(p - e.yxy, kind, q, kk),
                               sdShape(p + e.yyx, kind, q, kk) - sdShape(p - e.yyx, kind, q, kk)));
        break;
      }
      t += max(d, 0.002);
    }
  }
  if (bestS < 0) return vec4(0.0);
  vec4 fl = T(bestS, 5);
  bool glow = fl.x > 0.5;
  int bestKind = int(T(bestS, 3).w + 0.5);
  if (!glow && bestKind == 8) {
    bestN = prismNormal(bestP, bestN, T(bestS, 4));
  } else if (!glow && (bestKind == 0 || bestKind == 6 || bestKind == 7)) {
    // Gently curved faces on boxes and blades.
    vec3 e = shapeExtents(bestKind, T(bestS, 4), fl.z);
    bestN = normalize(bestN + ${f(HD_SOFTNESS)} * normalize(bestP / e));
  }
  mat3 m = mat3(T(bestS, 0).xyz, T(bestS, 1).xyz, T(bestS, 2).xyz);
  vec3 n = normalize(m * bestN);
  float ramp = T(bestS, 0).w;
  float tone = T(bestS, 1).w, shine = T(bestS, 2).w;
  float v;
  if (glow) {
    v = min(1.0, 0.85 + 0.15 * tone);
  } else {
    // gen/raster.ts shade() (diffuse saturating at the ramp's base shade), mixed with the reflected studio and a
    // tight highlight like polished metal, darkened where other parts crowd the surface.
    float diffuse = clamp(${f(SHADING.ambient)} + ${f(SHADING.key)} * max(0.0, dot(n, u_key))
      + ${f(SHADING.fill)} * max(0.0, dot(n, u_fill)) + ${f(SHADING.tone)} * tone, 0.0, 1.0);
    float env = envLight(reflect(vec3(0.0, 0.0, -1.0), n));
    vec3 hv = normalize(u_key + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(0.0, dot(n, hv)), 40.0) * shine;
    v = mix(diffuse * ${f(SHADING.base)} + 0.06, env, 0.3 + 0.45 * shine) + 0.45 * spec + 0.18 * tone;
    vec3 pw = vec3(w, 1000.0 - bestT);
    v *= 1.0 - 0.7 * occlusion(pw, n, bestS);
    v = clamp(v, 0.0, 1.0);
  }
  // Player ramps (0: indices 1..15, 1 and 2: 16..31, 32..47) or an effect range (first index + 3, count in w).
  vec3 col = ramp < 2.5
    ? (ramp < 0.5 ? rampColor(1.0, 15.0, v) : rampColor(ramp * 16.0, 16.0, v))
    : rampColor(ramp - 3.0, fl.w, v);
  return vec4(col, 1.0);
}

void main() {
  vec4 acc = vec4(0.0);
  vec2 base = floor(v_px);
  for (int sy = 0; sy < 2; sy++) {
    for (int sx = 0; sx < 2; sx++) {
      vec2 px = base + (vec2(float(sx), float(sy)) + 0.5) * 0.5;
      acc += sampleAt(vec2(u_origin.x + px.x * u_unit, u_origin.y - px.y * u_unit));
    }
  }
  // Premultiplied: the color sum already carries the coverage.
  o_color = acc * 0.25;
}`;

/** A page of HD renderings (RGBA8, premultiplied alpha, mipmapped after drawing). */
export interface HdPage {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
  /** Shelf packing state. */
  x: number;
  y: number;
  rowH: number;
  dirty: boolean;
}

export interface HdRect {
  page: HdPage;
  x: number;
  y: number;
  w: number;
  h: number;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`robot HD shader: ${gl.getShaderInfoLog(s)}`);
  return s;
}

/** Atlas pages for one set of renderings (one robot), freed together. */
export class HdPageSet {
  readonly pages: HdPage[] = [];

  constructor(private gl: WebGL2RenderingContext, readonly pageSize = 4096) {}

  private newPage(): HdPage {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const levels = Math.floor(Math.log2(this.pageSize)) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, this.pageSize, this.pageSize);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const page: HdPage = { tex, fbo, w: this.pageSize, h: this.pageSize, x: 0, y: 0, rowH: 0, dirty: true };
    this.pages.push(page);
    return page;
  }

  /** Space for a w x h rendering (with a gutter). */
  allocate(w: number, h: number): HdRect {
    const gap = 4;
    let page = this.pages[this.pages.length - 1];
    if (!page) page = this.newPage();
    if (page.x + w + gap > page.w) {
      page.x = 0;
      page.y += page.rowH + gap;
      page.rowH = 0;
    }
    if (page.y + h + gap > page.h) {
      page = this.newPage();
    }
    const r: HdRect = { page, x: page.x, y: page.y, w, h };
    page.x += w + gap;
    page.rowH = Math.max(page.rowH, h);
    return r;
  }

  /** Builds the mipmaps of the pages drawn to since the last call. */
  finish(): void {
    const gl = this.gl;
    for (const p of this.pages) {
      if (!p.dirty) continue;
      gl.bindTexture(gl.TEXTURE_2D, p.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      p.dirty = false;
    }
  }

  /** GPU memory of the pages (with mipmaps). */
  get bytes(): number {
    return this.pages.length * this.pageSize * this.pageSize * 4 * 1.34;
  }

  dispose(): void {
    const gl = this.gl;
    for (const p of this.pages) {
      gl.deleteTexture(p.tex);
      gl.deleteFramebuffer(p.fbo);
    }
    this.pages.length = 0;
  }
}

export class RobotHdRenderer {
  private prog: WebGLProgram;
  private shapesTex: WebGLTexture;
  private palTex: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  private data = new Float32Array(MAX_SHAPES * TEXELS * 4);
  private loc: Record<string, WebGLUniformLocation | null> = {};

  constructor(private gl: WebGL2RenderingContext) {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`robot HD program: ${gl.getProgramInfoLog(p)}`);
    this.prog = p;
    for (const n of ['u_dst', 'u_page', 'u_shapes', 'u_count', 'u_origin', 'u_unit', 'u_pal', 'u_key', 'u_fill']) this.loc[n] = gl.getUniformLocation(p, n);
    this.shapesTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.shapesTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, MAX_SHAPES * TEXELS, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.palTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.palTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 256, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.vao = gl.createVertexArray()!;
  }

  /** The reference palette the renderings are colored with (768 bytes RGB). */
  setPalette(rgb: Uint8Array): void {
    const gl = this.gl;
    const rgba = new Uint8Array(1024);
    for (let i = 0; i < 256; i++) rgba.set([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], 255], i * 4);
    gl.bindTexture(gl.TEXTURE_2D, this.palTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  }

  /**
   * Renders placed shapes into a rectangle whose top-left corner shows world (ox, oy), `unit` world units per texel.
   * Leaves the GL state changed (framebuffer, viewport, program, textures, blending): callers restore it.
   */
  draw(rect: HdRect, ox: number, oy: number, shapes: PlacedShape[], unit = HD_UNIT): void {
    const gl = this.gl;
    const n = Math.min(shapes.length, MAX_SHAPES);
    const d = this.data;
    d.fill(0);
    for (let i = 0; i < n; i++) {
      const s = shapes[i];
      const o = i * TEXELS * 4;
      const m = s.inv;
      const ramp = s.mat.fx ? 3 + s.mat.fx[0] : s.mat.ramp;
      d.set([m[0], m[1], m[2], ramp, m[3], m[4], m[5], s.mat.tone, m[6], m[7], m[8], s.mat.shine], o);
      const k = s.shape.kind === ShapeKind.PRISM ? prismSides(s.shape) : (s.shape.k ?? (s.shape.kind === ShapeKind.TBOX ? 1 : 0));
      d.set([s.pos[0], s.pos[1], s.pos[2], s.shape.kind, s.shape.a, s.shape.b, s.shape.c, s.shape.r, s.mat.glow ? 1 : 0, s.radius, k, s.mat.fx ? s.mat.fx[1] : 0], o + 12);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.shapesTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAX_SHAPES * TEXELS, 1, gl.RGBA, gl.FLOAT, d);
    gl.bindFramebuffer(gl.FRAMEBUFFER, rect.page.fbo);
    gl.viewport(0, 0, rect.page.w, rect.page.h);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.useProgram(this.prog);
    gl.uniform4f(this.loc.u_dst, rect.x, rect.y, rect.w, rect.h);
    gl.uniform2f(this.loc.u_page, rect.page.w, rect.page.h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shapesTex);
    gl.uniform1i(this.loc.u_shapes, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.palTex);
    gl.uniform1i(this.loc.u_pal, 1);
    gl.uniform1i(this.loc.u_count, n);
    gl.uniform2f(this.loc.u_origin, ox, oy);
    gl.uniform1f(this.loc.u_unit, unit);
    gl.uniform3f(this.loc.u_key, LIGHT_KEY[0], LIGHT_KEY[1], LIGHT_KEY[2]);
    gl.uniform3f(this.loc.u_fill, LIGHT_FILL[0], LIGHT_FILL[1], LIGHT_FILL[2]);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    rect.page.dirty = true;
  }
}

/** World coordinates of the top-left corner of a native sprite rectangle (columns / rows from the anchor). */
export function spriteOrigin(x: number, y: number, scale = 1): [number, number] {
  return [x / scale, (-y * ROW_H) / scale];
}
