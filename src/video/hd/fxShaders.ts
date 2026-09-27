// Shaders of the remastered effects (see src/fx/director.ts): particles, light splats, the world post pass
// (lighting, rim light, heat haze, shockwaves, camera zoom/shake, chromatic aberration, flash) and light shafts.
// Screen positions follow the sprite convention: native coordinates * u_scale + u_offset = target pixels (top-down).

const NOISE = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

/** Particle quads (instanced triangle strips), built in screen space so round particles stay round. */
export const FX_PARTICLE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 a_p0;  // x, y, dx, dy (native)
layout(location = 1) in vec4 a_p1;  // size, stretch, kind, seed
layout(location = 2) in vec4 a_col; // r, g, b, a
uniform vec2 u_scale;
uniform vec2 u_offset;
uniform vec2 u_target;
out vec2 v_local;
flat out vec4 v_col;
flat out vec4 v_p1;
void main() {
  vec2 q = vec2(float(gl_VertexID & 1) * 2.0 - 1.0, float((gl_VertexID >> 1) & 1) * 2.0 - 1.0);
  int kind = int(a_p1.z + 0.5);
  float unit = u_scale.y;                    // screen pixels per native pixel (vertical)
  vec2 center = a_p0.xy * u_scale + u_offset;
  float size = max(a_p1.x, 0.05) * unit;
  vec2 ax, ay;
  if (kind == 0 || kind == 7) {
    // Streak along the motion; the head leads, the tail trails.
    vec2 v = a_p0.zw * u_scale;
    float sp = length(v);
    vec2 d = sp > 1e-3 ? v / sp : vec2(1.0, 0.0);
    float len = size + a_p1.y * sp;
    ax = d * len;
    ay = vec2(-d.y, d.x) * size * 0.5;
    center -= d * len * 0.5;
  } else if (kind == 6) {
    // Debris: a small square turning as it moves.
    float a = a_p1.w * 6.2832 + a_p0.x * 0.35 + a_p0.y * 0.2;
    vec2 d = vec2(cos(a), sin(a));
    ax = d * size;
    ay = vec2(-d.y, d.x) * size * 0.7;
  } else if (kind == 5) {
    ax = vec2(size * 1.5, 0.0);
    ay = vec2(0.0, size * 0.75);
  } else {
    ax = vec2(size, 0.0);
    ay = vec2(0.0, size);
  }
  vec2 p = center + ax * q.x + ay * q.y;
  gl_Position = vec4(p.x / u_target.x * 2.0 - 1.0, 1.0 - p.y / u_target.y * 2.0, 0.0, 1.0);
  v_local = q;
  v_col = a_col;
  v_p1 = a_p1;
}`;

/** Premultiplied output; light-like kinds write alpha 0 (pure addition), smoke/dust/debris blend over. */
export const FX_PARTICLE_FS = `#version 300 es
precision highp float;
in vec2 v_local;
flat in vec4 v_col;
flat in vec4 v_p1;
uniform float u_time;
uniform int u_glow;   // bloom source pass: only the light-emitting kinds
out vec4 o_color;
` + NOISE + `
void main() {
  int kind = int(v_p1.z + 0.5);
  if (u_glow != 0 && kind >= 4 && kind <= 7) discard;
  float seed = v_p1.w;
  vec2 q = v_local;
  vec3 col = v_col.rgb;
  float a = v_col.a;
  float d2 = dot(q, q);
  if (kind == 0) {
    // Spark: bright core, white-hot head fading into the tail.
    float across = exp(-q.y * q.y * 5.0) - exp(-5.0);
    float along = smoothstep(-1.0, 0.2, q.x) * smoothstep(1.0, 0.75, q.x);
    float i = across * along * (0.35 + 0.65 * (q.x * 0.5 + 0.5));
    vec3 c = mix(col, vec3(1.0), clamp(i * 0.8, 0.0, 1.0));
    o_color = vec4(c * i * a * 2.2, 0.0);
  } else if (kind == 1) {
    float i = max(exp(-d2 * 4.0) - exp(-4.0), 0.0);
    o_color = vec4(col * i * a * 1.25, 0.0);
  } else if (kind == 2) {
    float fl = 0.72 + 0.28 * sin(u_time * 23.0 + seed * 60.0);
    float i = exp(-d2 * 7.0) + 0.45 * max(exp(-d2 * 2.2) - exp(-2.2), 0.0);
    o_color = vec4(col * i * a * fl * 1.5, 0.0);
  } else if (kind == 3) {
    float d = sqrt(d2);
    float i = exp(-pow((d - 0.82) / 0.09, 2.0)) * step(d, 1.0);
    o_color = vec4(col * i * a, 0.0);
  } else if (kind == 4 || kind == 5) {
    // Smoke / dust: a soft billow with drifting noise.
    float n = vnoise(q * 1.9 + seed * 37.0 + vec2(0.0, -u_time * 0.35)) * 0.6 + vnoise(q * 3.7 - seed * 11.0) * 0.4;
    float shape = smoothstep(1.0, 0.15, d2 + (n - 0.5) * 0.7);
    float al = a * shape * (kind == 5 ? 0.85 : 1.0);
    o_color = vec4(col * al, al);
  } else if (kind == 6) {
    float box = max(abs(q.x), abs(q.y));
    float inside = smoothstep(1.0, 0.75, box);
    float shade = 0.75 + 0.45 * clamp(-q.x * 0.5 - q.y * 0.5, -1.0, 1.0);
    float al = a * inside;
    o_color = vec4(col * shade * al, al);
  } else if (kind == 8) {
    // Impact flare: a hot core with a four-pointed star, turned a little per impact.
    float an = seed * 1.2;
    vec2 r = vec2(cos(an) * q.x - sin(an) * q.y, sin(an) * q.x + cos(an) * q.y);
    float core = exp(-d2 * 9.0);
    float star = exp(-abs(r.x) * 7.0) * exp(-r.y * r.y * 90.0) + exp(-abs(r.y) * 7.0) * exp(-r.x * r.x * 90.0);
    float halo = max(exp(-d2 * 3.0) - exp(-3.0), 0.0) * 0.35;
    float i = (core + star * 0.8 + halo) * step(d2, 1.0);
    vec3 c = mix(col, vec3(1.0), clamp(core, 0.0, 1.0));
    o_color = vec4(c * i * a * 1.4, 0.0);
  } else {
    // Wisp (blown sand): a faint streak.
    float i = (1.0 - q.y * q.y) * (1.0 - q.x * q.x);
    float al = a * max(i, 0.0);
    o_color = vec4(col * al, al);
  }
}`;

/** Light splats (instanced quads), additive into the low-resolution light buffers. */
export const FX_LIGHT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 a_l0;  // x, y, radius (native), unused
layout(location = 1) in vec4 a_l1;  // r, g, b, unused
uniform vec2 u_scale;
uniform vec2 u_offset;
uniform vec2 u_target;
out vec2 v_local;
flat out vec3 v_col;
void main() {
  vec2 q = vec2(float(gl_VertexID & 1) * 2.0 - 1.0, float((gl_VertexID >> 1) & 1) * 2.0 - 1.0);
  vec2 center = a_l0.xy * u_scale + u_offset;
  vec2 p = center + q * a_l0.z * u_scale.y;
  gl_Position = vec4(p.x / u_target.x * 2.0 - 1.0, 1.0 - p.y / u_target.y * 2.0, 0.0, 1.0);
  v_local = q;
  v_col = a_l1.rgb;
}`;

export const FX_LIGHT_FS = `#version 300 es
precision highp float;
in vec2 v_local;
flat in vec3 v_col;
uniform float u_outScale;
out vec4 o_color;
void main() {
  float f = clamp(1.0 - dot(v_local, v_local), 0.0, 1.0);
  o_color = vec4(v_col * f * f * u_outScale, 1.0);
}`;

/**
 * World post pass (fights): camera zoom and shake, heat haze and shockwave distortion, dynamic lighting (lights on
 * everything, arena light and rim light on the robots), chromatic aberration, desaturation and flash.
 */
export const FX_WORLD_FS = `#version 300 es
precision highp float;
uniform sampler2D u_scene;
uniform sampler2D u_lightAll;
uniform sampler2D u_lightObj;
uniform sampler2D u_mask;
uniform sampler2D u_maskBlur;
uniform int u_lighting;
uniform float u_lightScale;
uniform vec2 u_targetSize;
uniform vec2 u_scale;
uniform vec2 u_offset;
uniform vec3 u_rim;          // light position (native) and strength
uniform vec3 u_rimColor;
uniform vec3 u_ambient;      // robots' color multiplier
uniform vec4 u_shock[4];     // x, y, radius, strength
uniform float u_shockW[4];
uniform int u_shockCount;
uniform vec4 u_haze[6];      // x0, y0, x1, y1
uniform float u_hazeStr[6];
uniform int u_hazeCount;
uniform float u_time;
uniform float u_flash;
uniform float u_chroma;
uniform float u_desat;
uniform vec3 u_zoom;         // center (native), factor
uniform vec2 u_shake;        // native pixels
out vec4 o_color;
` + NOISE + `
vec2 toUv(vec2 n) {
  vec2 px = n * u_scale + u_offset;
  return vec2(px.x / u_targetSize.x, 1.0 - px.y / u_targetSize.y);
}
void main() {
  vec2 px = vec2(gl_FragCoord.x, u_targetSize.y - gl_FragCoord.y);
  vec2 n = (px - u_offset) / u_scale;
  n = u_zoom.xy + (n - u_zoom.xy) / u_zoom.z - u_shake;
  vec2 off = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    if (i >= u_shockCount) break;
    vec2 d = n - u_shock[i].xy;
    float r = length(d);
    float w = u_shockW[i];
    float ring = exp(-pow((r - u_shock[i].z) / w, 2.0));
    off -= (d / max(r, 1e-3)) * ring * u_shock[i].w;
  }
  // Heat haze shimmers the arena, not the robots standing in it.
  float robot = u_hazeCount > 0 ? texture(u_mask, toUv(n)).r : 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= u_hazeCount) break;
    vec4 h = u_haze[i];
    float inside = smoothstep(h.x, h.x + 10.0, n.x) * smoothstep(h.z, h.z - 10.0, n.x) *
      smoothstep(h.y, h.y + 8.0, n.y) * smoothstep(h.w + 4.0, h.w - 2.0, n.y);
    if (inside <= 0.0) continue;
    float rise = 0.45 + 0.55 * clamp((n.y - h.y) / max(h.w - h.y, 1.0), 0.0, 1.0);
    vec2 np = n * vec2(0.18, 0.3) + vec2(0.0, u_time * 2.2);
    vec2 o = vec2(vnoise(np) - 0.5, vnoise(np + vec2(19.7, 7.3)) - 0.5) * 2.0;
    off += o * u_hazeStr[i] * inside * rise * (1.0 - 0.85 * robot);
  }
  n += off;
  vec2 uv = toUv(n);
  vec3 c;
  if (u_chroma > 0.01) {
    vec2 dir = (n - vec2(160.0, 100.0)) / 160.0;
    vec2 co = dir * u_chroma * u_scale / u_targetSize * vec2(1.0, -1.0);
    c = vec3(texture(u_scene, uv + co).r, texture(u_scene, uv).g, texture(u_scene, uv - co).b);
  } else {
    c = texture(u_scene, uv).rgb;
  }
  if (u_lighting != 0) {
    float m = texture(u_mask, uv).r;
    vec3 la = texture(u_lightAll, uv).rgb * u_lightScale;
    vec3 lo = texture(u_lightObj, uv).rgb * u_lightScale;
    if (m > 0.004 && u_rim.z > 0.0) {
      vec2 tx = 1.5 / vec2(textureSize(u_maskBlur, 0));
      float mb = texture(u_maskBlur, uv).r;
      // Coverage gradient in native orientation (y down); the outward normal points down the gradient.
      vec2 g = vec2(texture(u_maskBlur, uv + vec2(tx.x, 0.0)).r - texture(u_maskBlur, uv - vec2(tx.x, 0.0)).r,
                    texture(u_maskBlur, uv - vec2(0.0, tx.y)).r - texture(u_maskBlur, uv + vec2(0.0, tx.y)).r);
      float gl = length(g);
      if (gl > 1e-4) {
        vec2 nrm = -g / gl;
        vec2 L = normalize(u_rim.xy - n + vec2(0.0, 1e-3));
        float facing = max(dot(nrm, L), 0.0);
        float edge = clamp((1.0 - mb) * 2.4, 0.0, 1.0);
        float rim = m * edge * facing * facing * u_rim.z;
        c += rim * u_rimColor * (0.2 + c);
      }
    }
    c *= mix(vec3(1.0), u_ambient, m);
    c *= vec3(1.0) + la + lo * m;
  }
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(l), u_desat);
  c += vec3(u_flash) * (0.6 + 0.4 * l);
  o_color = vec4(c, 1.0);
}`;

/** Light shafts: bright pixels near each source smeared away from it (radial blur), at low resolution. */
export const FX_SHAFTS_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D u_src;
uniform vec4 u_shaft[2];   // source uv (x, y), strength, reach (uv)
uniform int u_shaftCount;
uniform vec2 u_aspect;     // uv -> isotropic units
out vec4 o_color;
void main() {
  vec3 sum = vec3(0.0);
  for (int s = 0; s < 2; s++) {
    if (s >= u_shaftCount) break;
    vec2 src = u_shaft[s].xy;
    vec2 delta = (uv - src) / 36.0;
    vec2 p = uv;
    float decay = 1.0;
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 36; i++) {
      p -= delta;
      vec3 c = texture(u_src, p).rgb;
      float b = max(max(c.r, c.g), c.b);
      float near = 1.0 - smoothstep(0.0, u_shaft[s].w, length((p - src) * u_aspect));
      acc += c * smoothstep(0.7, 0.97, b) * near * decay;
      decay *= 0.95;
    }
    float fall = 1.0 - smoothstep(0.0, 1.0, length((uv - src) * u_aspect));
    sum += acc / 36.0 * 3.0 * u_shaft[s].z * fall;
  }
  o_color = vec4(sum, 1.0);
}`;
