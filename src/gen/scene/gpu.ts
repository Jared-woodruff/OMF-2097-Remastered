// The arena scene renderer (scene/render.ts) on the GPU, for the generated arenas' HD backgrounds: the same shapes,
// patterns, lights, soft shadows, mirror bounce, fog and sky, at any resolution. Used by the development tool that
// makes the HD images (gen/dev/arenaHd.ts); the game loads the images.
import { SDF_GLSL } from '../hdRender';
import { CAMERA, type SceneDef, type SceneMaterial } from './types';

const MAX_LIGHTS = 8;
/** RGBA32F texels per shape and per material. */
const SHAPE_TEXELS = 6;
const MAT_TEXELS = 4;

const VS = `#version 300 es
precision highp float;
uniform vec4 u_tile;   // x, y, w, h in target pixels
uniform vec2 u_size;   // target size
out vec2 v_px;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 p = u_tile.xy + c * u_tile.zw;
  v_px = p;
  gl_Position = vec4(p / u_size * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_px;
uniform highp sampler2D u_shapes;
uniform highp sampler2D u_mats;
uniform int u_count;
uniform vec2 u_size;          // target pixels
uniform vec4 u_view;          // native x0, native width, native height (200), samples per axis
uniform vec3 u_lightPos[${MAX_LIGHTS}];
uniform vec4 u_lightCol[${MAX_LIGHTS}]; // rgb, range
uniform int u_lightShadow[${MAX_LIGHTS}];
uniform int u_lights;
uniform vec3 u_ambient;
uniform vec3 u_skyTop;
uniform vec3 u_skyHorizon;
uniform float u_stars;
uniform vec4 u_aurora;        // rgb, strength
uniform vec4 u_fog;           // rgb, density
uniform float u_exposure;
out vec4 o_color;
${SDF_GLSL}
vec4 S(int s, int k) { return texelFetch(u_shapes, ivec2(s * ${SHAPE_TEXELS} + k, 0), 0); }
vec4 M(int m, int k) { return texelFetch(u_mats, ivec2(m * ${MAT_TEXELS} + k, 0), 0); }

float hash3(vec3 c) { return fract(sin(c.x * 127.1 + c.y * 311.7 + c.z * 74.7) * 43758.5453); }
float noise3(vec3 p) {
  vec3 i = floor(p), f = p - i;
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), u.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), u.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
float fbm3(vec3 p) { return (noise3(p) * 4.0 + noise3(p * 2.03) * 2.0 + noise3(p * 4.1)) / 7.0; }

// Surface color (rgb) and self illumination at a local point / normal of material m.
void surface(int m, vec3 p, vec3 n, out vec3 albedo, out vec3 emit) {
  vec4 m0 = M(m, 0), m1 = M(m, 1), m2 = M(m, 2);
  vec3 c1 = m0.rgb, c2 = m1.rgb;
  int pattern = int(m0.a + 0.5);
  float size = m1.a, amount = m2.x;
  vec3 an = abs(n);
  vec2 uv = an.y >= an.x && an.y >= an.z ? p.xz : (an.x >= an.z ? p.zy : p.xy);
  vec2 UV = uv / size;
  float t = 0.0, shade = 1.0;
  if (pattern == 1 || pattern == 2) {
    vec2 f = fract(UV);
    float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    t = edge < amount * 0.5 ? 1.0 : 0.0;
    shade = 0.9 + 0.2 * hash3(vec3(floor(UV), 7.0));
    if (pattern == 2) {
      shade *= 0.8 + 0.2 * min(1.0, edge * 16.0);
      vec2 cc = min(f, 1.0 - f);
      if (length(cc - 0.08) < 0.035) shade *= 1.35;
    }
  } else if (pattern == 3) {
    t = clamp((fbm3(p / size) - 0.5) * amount * 4.0 + 0.5, 0.0, 1.0);
  } else if (pattern == 4) {
    t = fract(UV.x) < amount ? 1.0 : 0.0;
  } else if (pattern == 5) {
    float row = floor(UV.y * 2.0);
    float bu = fract(UV.x + mod(row, 2.0) * 0.5), bv = fract(UV.y * 2.0);
    t = (min(bu, 1.0 - bu) < amount * 0.5 || min(bv, 1.0 - bv) < amount) ? 1.0 : 0.0;
    shade = 0.88 + 0.24 * hash3(vec3(floor(UV.x + mod(row, 2.0) * 0.5), row, 3.0));
  } else if (pattern == 6) {
    vec2 f = fract(UV);
    t = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) < amount * 0.5 ? 1.0 : 0.0;
  } else if (pattern == 7) {
    float fu = fract(UV.x), fv = fract(UV.y * 1.6);
    bool inside = fu > 0.22 && fu < 0.78 && fv > 0.25 && fv < 0.8;
    bool lit = hash3(vec3(floor(UV.x), floor(UV.y * 1.6), 11.0)) < amount;
    t = inside && lit ? 1.0 : 0.0;
    shade = inside ? 0.7 : 1.0;
  }
  albedo = mix(c1, c2, t) * shade;
  float e = m2.y * (1.0 - t) + m2.z * t;
  emit = e > 0.0 ? mix(c1, c2, t) * e : vec3(0.0);
}

struct Hit { float t; int s; vec3 lp; vec3 ln; vec3 n; };

bool trace(vec3 ro, vec3 rd, out Hit hit) {
  hit.t = 1e9;
  hit.s = -1;
  for (int s = 0; s < 1024; s++) {
    if (s >= u_count) break;
    vec4 pk = S(s, 3);
    vec4 fl = S(s, 5);
    vec3 o = ro - pk.xyz;
    float R = fl.y + 0.05;
    float b = dot(o, rd);
    float c = dot(o, o) - R * R;
    float h = b * b - c;
    if (h < 0.0) continue;
    float sq = sqrt(h);
    if (-b - sq > hit.t || -b + sq < 0.0) continue;
    mat3 m = mat3(S(s, 0).xyz, S(s, 1).xyz, S(s, 2).xyz);
    vec3 lo = o * m, ld = rd * m;
    int kind = int(pk.w + 0.5);
    vec4 q = S(s, 4);
    float t = max(0.0, -b - sq), tEnd = min(-b + sq, hit.t);
    if (kind == 0 || kind == 7) {
      // Boxes: march from where the ray enters the box (grazing floors converge).
      vec3 e = shapeExtents(kind, q, fl.x) + 0.02;
      vec3 inv = 1.0 / (ld + sign(ld) * 1e-9 + 1e-12);
      vec3 ta = (-e - lo) * inv, tb = (e - lo) * inv;
      vec3 tmin = min(ta, tb), tmax = max(ta, tb);
      float t0 = max(max(tmin.x, tmin.y), tmin.z), t1 = min(min(tmax.x, tmax.y), tmax.z);
      if (t0 > t1 || t1 < 0.0) continue;
      t = max(t, t0);
      tEnd = min(tEnd, t1);
    }
    for (int i = 0; i < 96; i++) {
      if (t > tEnd) break;
      vec3 p = lo + ld * t;
      float d = sdShape(p, kind, q, fl.x);
      if (d < 0.02) {
        vec2 ee = vec2(0.005, 0.0);
        vec3 nl = normalize(vec3(sdShape(p + ee.xyy, kind, q, fl.x) - sdShape(p - ee.xyy, kind, q, fl.x),
                                 sdShape(p + ee.yxy, kind, q, fl.x) - sdShape(p - ee.yxy, kind, q, fl.x),
                                 sdShape(p + ee.yyx, kind, q, fl.x) - sdShape(p - ee.yyx, kind, q, fl.x)));
        hit.t = t;
        hit.s = s;
        hit.lp = p;
        hit.ln = nl;
        hit.n = normalize(m * nl);
        break;
      }
      t += max(d, 0.01);
    }
  }
  return hit.s >= 0;
}

float shadowDistance(vec3 p) {
  float d = 1e9;
  for (int s = 0; s < 1024; s++) {
    if (s >= u_count) break;
    vec4 fl = S(s, 5);
    if (fl.z < 0.5) continue;
    vec4 pk = S(s, 3);
    vec3 o = p - pk.xyz;
    float far = length(o) - fl.y;
    if (far > d) continue;
    mat3 m = mat3(S(s, 0).xyz, S(s, 1).xyz, S(s, 2).xyz);
    d = min(d, sdShape(o * m, int(pk.w + 0.5), S(s, 4), fl.x));
  }
  return d;
}

float softShadow(vec3 p, vec3 l, float dist) {
  float res = 1.0, t = 2.0, prev = 1e9;
  for (int i = 0; i < 64; i++) {
    if (t >= dist - 1.0) break;
    float d = shadowDistance(p + l * t);
    if (d < 0.01) return 0.0;
    float y = d * d / (2.0 * prev);
    float e = sqrt(max(0.0, d * d - y * y));
    res = min(res, 10.0 * e / max(0.001, t - y));
    prev = d;
    t += clamp(d, 0.25, 24.0);
  }
  float r = clamp(res, 0.0, 1.0);
  return r * r * (3.0 - 2.0 * r);
}

vec3 sky(vec3 rd) {
  vec3 c = mix(u_skyHorizon, u_skyTop, clamp(rd.y * 2.5 + 0.1, 0.0, 1.0));
  if (u_aurora.w > 0.0 && rd.y > 0.0) {
    float a = 0.0;
    for (int i = 0; i < 2; i++) {
      float fi = float(i);
      float base = 0.16 + fi * 0.1 + 0.05 * sin(rd.x * (5.0 + fi * 3.0) + fi * 2.0) + 0.03 * (noise3(vec3(rd.x * 9.0 + fi * 7.0, 0.0, fi)) - 0.5);
      float h = rd.y - base;
      if (h > 0.0) a += exp(-h * 14.0) * (0.55 + 0.45 * noise3(vec3(rd.x * 26.0 + fi * 3.0, rd.y * 4.0, fi * 5.0)));
    }
    c += u_aurora.rgb * a * u_aurora.w;
  }
  if (u_stars > 0.0 && rd.y > -0.1) {
    // Stars on a finer grid than the native render's, so they stay small points.
    float sc = 90.0 * 3.0;
    vec3 cell = floor(rd * sc);
    if (hash3(cell) > 1.0 - u_stars * 0.08 / 9.0) {
      float tw = 0.4 + 0.6 * hash3(cell.xzy);
      vec2 f = fract(rd.xy * sc) - 0.5;
      float glow = max(0.0, 1.0 - length(f) * 3.2);
      c += vec3(1.4, 1.4, 1.6) * glow * tw;
    }
  }
  return c;
}

vec3 shade(Hit h, vec3 ro, vec3 rd, bool shadows, out float mirror) {
  vec3 p = ro + rd * h.t;
  int mi = int(S(h.s, 5).w + 0.5);
  vec3 albedo, emit;
  surface(mi, h.lp, h.ln, albedo, emit);
  vec4 m2 = M(mi, 2), m3 = M(mi, 3);
  float spec = m2.w, gloss = m3.x;
  mirror = m3.y;
  vec3 n = h.n;
  vec3 col = albedo * u_ambient;
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= u_lights) break;
    vec3 lv = u_lightPos[i] - p;
    float dist = length(lv);
    float range = u_lightCol[i].w;
    if (dist > range) continue;
    vec3 l = lv / dist;
    float ndl = dot(n, l);
    if (ndl <= 0.0) continue;
    float f = 1.0 - (dist / range) * (dist / range);
    float att = f * f;
    float sh = shadows && u_lightShadow[i] != 0 ? softShadow(p + n * 1.5, l, dist) : 1.0;
    col += albedo * u_lightCol[i].rgb * ndl * att * sh;
    if (spec > 0.0) {
      vec3 hv = normalize(l - rd);
      col += u_lightCol[i].rgb * spec * pow(max(0.0, dot(n, hv)), gloss) * att * sh;
    }
  }
  return col + emit;
}

vec3 fogged(vec3 c, float t) {
  return u_fog.w > 0.0 ? mix(c, u_fog.rgb, 1.0 - exp(-t * u_fog.w)) : c;
}

vec3 radiance(vec3 ro, vec3 rd) {
  Hit h;
  if (!trace(ro, rd, h)) return sky(rd);
  float mirror;
  vec3 c = shade(h, ro, rd, true, mirror);
  if (mirror > 0.0) {
    vec3 r = reflect(rd, h.n);
    vec3 p = ro + rd * h.t + h.n * 0.3;
    Hit h2;
    vec3 rc;
    if (trace(p, r, h2)) {
      float m2;
      rc = fogged(shade(h2, p, r, false, m2), h2.t);
    } else {
      rc = sky(r);
    }
    c = mix(c, rc, mirror);
  }
  return fogged(c, h.t);
}

vec3 toDisplay(vec3 c) {
  return pow(1.0 - exp(-max(c, 0.0) * 1.6 * u_exposure), vec3(0.8));
}

void main() {
  // Target pixel -> native screen position (x0 .. x0 + width, 0 .. 200); rows are top-down.
  vec2 px = vec2(v_px.x, u_size.y - v_px.y);
  float ss = u_view.w;
  vec3 acc = vec3(0.0);
  for (float sy = 0.0; sy < 4.0; sy++) {
    if (sy >= ss) break;
    for (float sx = 0.0; sx < 4.0; sx++) {
      if (sx >= ss) break;
      vec2 sub = floor(px) + (vec2(sx, sy) + 0.5) / ss;
      float nx = u_view.x + sub.x / u_size.x * u_view.y;
      float ny = sub.y / u_size.y * u_view.z;
      vec3 rd = normalize(vec3((nx - 160.0) / ${CAMERA.f.toFixed(1)}, -(ny - ${CAMERA.cy.toFixed(1)}) * 1.2 / ${CAMERA.f.toFixed(1)}, -1.0));
      acc += toDisplay(radiance(vec3(0.0, ${CAMERA.height.toFixed(1)}, ${CAMERA.f.toFixed(1)}), rd));
    }
  }
  o_color = vec4(acc / (ss * ss), 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`arena shader: ${gl.getShaderInfoLog(s)}`);
  return s;
}

/** Renders an arena scene to RGBA pixels (top row first) on the GPU. */
export function renderSceneGpu(gl: WebGL2RenderingContext, scene: SceneDef, x0: number, nativeW: number, w: number, h: number, ss = 2): Uint8Array {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`arena program: ${gl.getProgramInfoLog(prog)}`);
  // Materials (deduplicated) and shapes as float textures.
  const mats: SceneMaterial[] = [];
  const matIndex = new Map<SceneMaterial, number>();
  for (const s of scene.shapes) if (!matIndex.has(s.mat)) matIndex.set(s.mat, mats.push(s.mat) - 1);
  const md = new Float32Array(Math.max(1, mats.length) * MAT_TEXELS * 4);
  mats.forEach((m, i) => {
    const c2 = m.color2 ?? m.color;
    md.set([...m.color, m.pattern ?? 0, ...c2, m.size ?? 16, m.amount ?? 0.08, m.emit ?? 0, m.emit2 ?? 0, m.spec ?? 0, m.gloss ?? 24, m.mirror ?? 0, 0, 0], i * MAT_TEXELS * 4);
  });
  const sd = new Float32Array(Math.max(1, scene.shapes.length) * SHAPE_TEXELS * 4);
  scene.shapes.forEach((s, i) => {
    const m = s.inv;
    const k = s.shape.k ?? (s.shape.kind === 7 ? 1 : 0);
    sd.set([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, ...s.pos, s.shape.kind, s.shape.a, s.shape.b, s.shape.c, s.shape.r,
      k, s.radius, s.shadow ? 1 : 0, matIndex.get(s.mat)!], i * SHAPE_TEXELS * 4);
  });
  const tex = (data: Float32Array, texels: number) => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, texels, 1, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  };
  const shapesTex = tex(sd, sd.length / 4);
  const matsTex = tex(md, md.length / 4);
  const target = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, target);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
  gl.viewport(0, 0, w, h);
  gl.disable(gl.BLEND);
  gl.disable(gl.SCISSOR_TEST);
  gl.colorMask(true, true, true, true);
  gl.useProgram(prog);
  const u = (n: string) => gl.getUniformLocation(prog, n);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, shapesTex);
  gl.uniform1i(u('u_shapes'), 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, matsTex);
  gl.uniform1i(u('u_mats'), 1);
  gl.uniform1i(u('u_count'), scene.shapes.length);
  gl.uniform2f(u('u_size'), w, h);
  gl.uniform4f(u('u_view'), x0, nativeW, 200, ss);
  const lights = scene.lights.slice(0, MAX_LIGHTS);
  gl.uniform1i(u('u_lights'), lights.length);
  lights.forEach((l, i) => {
    gl.uniform3f(u(`u_lightPos[${i}]`), l.pos[0], l.pos[1], l.pos[2]);
    gl.uniform4f(u(`u_lightCol[${i}]`), l.color[0], l.color[1], l.color[2], l.range);
    gl.uniform1i(u(`u_lightShadow[${i}]`), l.shadow ? 1 : 0);
  });
  gl.uniform3f(u('u_ambient'), ...scene.ambient);
  gl.uniform3f(u('u_skyTop'), ...scene.skyTop);
  gl.uniform3f(u('u_skyHorizon'), ...scene.skyHorizon);
  gl.uniform1f(u('u_stars'), scene.stars ?? 0);
  const au = scene.aurora;
  gl.uniform4f(u('u_aurora'), au?.color[0] ?? 0, au?.color[1] ?? 0, au?.color[2] ?? 0, au?.strength ?? 0);
  const fog = scene.fog;
  gl.uniform4f(u('u_fog'), fog?.color[0] ?? 0, fog?.color[1] ?? 0, fog?.color[2] ?? 0, fog?.density ?? 0);
  gl.uniform1f(u('u_exposure'), scene.exposure ?? 1);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  // Tiles, each finished before the next (long draws can trip the GPU watchdog).
  const T = 128;
  for (let ty = 0; ty < h; ty += T) {
    for (let tx = 0; tx < w; tx += T) {
      gl.uniform4f(u('u_tile'), tx, ty, Math.min(T, w - tx), Math.min(T, h - ty));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.finish();
    }
  }
  const out = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
  // GL rows are bottom-up; images are top-down.
  const flipped = new Uint8Array(out.length);
  for (let y = 0; y < h; y++) flipped.set(out.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  gl.bindVertexArray(null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(target);
  gl.deleteTexture(shapesTex);
  gl.deleteTexture(matsTex);
  gl.deleteProgram(prog);
  return flipped;
}
