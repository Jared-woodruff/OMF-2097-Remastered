// GLSL ES 3.00 ports of the indexed compositing shaders.
//
// Indexed framebuffer channel layout (RGBA8):
//   R: palette index                      (BlendMode.SET writes RGBA)
//   G: remap encoding = offset + rounds*19 [+ index], clamped to 255 (REMAP / SHADOW(max) / DARK_TINT)
//   B: dark-tint palette index            (DARK_TINT)
//   A: additive index (x60 at resolve)     (ADD)
// A second attachment (R8) holds the shade fraction used by the HD renderer (0 in classic mode).

export const SPRITE_VS = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in ivec4 a_p0; // transparency, remapOffset, remapRounds, palOffset
layout(location = 3) in ivec4 a_p1; // palLimit, opacity, options, unused
uniform vec2 u_fbSize;
out vec2 v_uv;
flat out ivec4 v_p0;
flat out ivec4 v_p1;
void main() {
  v_uv = a_uv;
  v_p0 = a_p0;
  v_p1 = a_p1;
  vec2 ndc = vec2(a_pos.x / u_fbSize.x * 2.0 - 1.0, 1.0 - a_pos.y / u_fbSize.y * 2.0);
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

export const SPRITE_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
in vec2 v_uv;
flat in ivec4 v_p0;
flat in ivec4 v_p1;
uniform usampler2D u_atlas;
uniform sampler2D u_fracAtlas;
uniform usampler2D u_remaps;
uniform float u_ditherScale; // FBO pixels per native pixel (for the opacity dither pattern)
uniform int u_hd;
layout(location = 0) out vec4 o_color;
layout(location = 1) out vec4 o_frac;

const int MAGIC_REMAP_ROUNDS = 12;
const float PHI = 1.61803398874989484820459;

float noise(vec2 v) {
  // The original dithered translucency row by row with a pseudo random row offset,
  // advancing the threshold by 0x6b for each subsequent x.
  return fract(tan(10.0 * PHI * v.y) + (107.0 * v.x) / 256.0);
}

vec4 handle(int index, int remapOffset, int remapRounds, int options) {
  bool darkTint = (options & 0x10) != 0;
  bool indexAdd = (options & 4) != 0;
  if (darkTint) {
    int enc = remapOffset + MAGIC_REMAP_ROUNDS * 19;
    return vec4(0.0, float(clamp(enc, 0, 255)) / 255.0, float(index) / 255.0, 0.0);
  }
  if (remapRounds > 0) {
    int enc = remapOffset + remapRounds * 19 + index;
    return vec4(0.0, float(clamp(enc, 0, 255)) / 255.0, 0.0, 0.0);
  }
  if (indexAdd) {
    return vec4(0.0, 0.0, 0.0, float(clamp(index, 0, 255)) / 255.0);
  }
  return vec4(float(index) / 255.0, 0.0, 0.0, 0.0);
}

void main() {
  int transparency = v_p0.x;
  int remapOffset = v_p0.y;
  int remapRounds = v_p0.z;
  int palOffset = v_p0.w;
  int palLimit = v_p1.x;
  int opacity = v_p1.y;
  int options = v_p1.z;

  float limit = float(opacity) / 255.0;
  if (opacity < 255) {
    vec2 np = floor(gl_FragCoord.xy / u_ditherScale) + 0.5;
    if (noise(np) > limit) discard;
  }

  ivec2 tc = ivec2(floor(v_uv));
  if ((options & 2) != 0) {
    // Shadow: squashed sprite, coverage of 4 vertical source texels selects the shadow darkness.
    int coverage = 0;
    for (int y = 0; y < 4; y++) {
      int idx = int(texelFetch(u_atlas, tc + ivec2(0, y - 1), 0).r);
      coverage += (idx != transparency) ? 1 : 0;
    }
    if (coverage == 0) discard;
    o_color = handle(coverage, remapOffset, remapRounds, options);
    o_frac = vec4(0.0);
    return;
  }

  int index = int(texelFetch(u_atlas, tc, 0).r);
  if (index == transparency) discard;

  float frac = 0.0;
  if (u_hd != 0) frac = texelFetch(u_fracAtlas, tc, 0).r;

  if (index <= palLimit) {
    index = clamp(index + palOffset, 0, palLimit);
  }
  bool noRemap = ((options & 8) != 0) && index > 0x30;
  if ((options & 1) != 0 && !noRemap) {
    index = int(texelFetch(u_remaps, ivec2(index, remapOffset), 0).r);
  }
  o_color = handle(index, remapOffset, remapRounds, options);
  o_frac = vec4(frac, 0.0, 0.0, 0.0);
}`;

const RESOLVE_COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
in vec2 uv;
uniform sampler2D u_fb;
uniform sampler2D u_frac;
uniform usampler2D u_remaps;
uniform sampler2D u_palette;
uniform uint u_fbOptions;
uniform int u_hd;
out vec4 o_color;

const int MAGIC_REMAP_ROUNDS = 12;

vec3 pal(int i) {
  return texelFetch(u_palette, ivec2(clamp(i, 0, 255), 0), 0).rgb;
}

int remap(int idx, int row) {
  return int(texelFetch(u_remaps, ivec2(clamp(idx, 0, 255), row), 0).r);
}

int resolveIndex(int idx, int remapEnc, int darktint, int idxAdd) {
  int remapRow = remapEnc % 19;
  int remapRounds = remapEnc / 19;
  idx += idxAdd;
  if (darktint > 0 && remapRounds != MAGIC_REMAP_ROUNDS) {
    // Dark tint's remap was trampled by a later overlay (e.g. pause menu).
    idx = darktint;
  } else if (darktint >= 0x60) {
    // Pyros flames draw opaque, no remaps.
    idx = darktint;
    remapRounds = 0;
  } else if (darktint > 0) {
    int behind = 1 + clamp(remap(idx, 4) - 0xA8, 0, 7) * 2;
    idx = (darktint & 0xF0) + ((darktint & 0x0F) * 3 + behind * 2) / 5;
  }
  for (int i = 0; i < remapRounds; i++) {
    idx = remap(idx, remapRow);
  }
  return idx;
}
`;

export const RESOLVE_FS = RESOLVE_COMMON + `
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 t = texelFetch(u_fb, p, 0);
  int idx = int(t.r * 255.0 + 0.5);
  int remapEnc = int(t.g * 255.0 + 0.5);
  int darktint = int(t.b * 255.0 + 0.5);
  int idxAdd = int(t.a * 255.0 + 0.5) * 60;

  if ((u_fbOptions & 1u) != 0u) {
    o_color = vec4(pal(idx + idxAdd), 1.0);
    return;
  }

  vec3 c = pal(resolveIndex(idx, remapEnc, darktint, idxAdd));
  if (u_hd != 0) {
    float f = texelFetch(u_frac, p, 0).r;
    if (f > 0.0 && darktint == 0) {
      vec3 c1 = pal(resolveIndex(idx + 1, remapEnc, darktint, idxAdd));
      c = mix(c, c1, f);
    }
  }
  o_color = vec4(c, 1.0);
}`;

/**
 * Remastered helper: for an indexed frame whose effects are only remaps (glows), outputs the color change the
 * effects cause, (with - without) * 0.5 + 0.5. The HD renderer adds it to its own image, so glows use the
 * original remap tables exactly.
 */
export const DELTA_FS = RESOLVE_COMMON + `
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 t = texelFetch(u_fb, p, 0);
  int idx = int(t.r * 255.0 + 0.5);
  int remapEnc = int(t.g * 255.0 + 0.5);
  int idxAdd = int(t.a * 255.0 + 0.5) * 60;
  vec3 d = pal(resolveIndex(idx, remapEnc, 0, idxAdd)) - pal(idx + idxAdd);
  o_color = vec4(d * 0.5 + 0.5, 1.0);
}`;

export const PRESENT_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D u_image;    // must use LINEAR filtering
uniform vec4 u_srcRect;       // x, y, w, h in texture UV space
uniform vec2 u_texSize;       // texture size in texels
uniform vec2 u_pixelScale;    // output pixels per texel (x, y)
uniform int u_mode;           // 0 = sharp (pixel art), 1 = smooth, 2 = CRT
out vec4 o_color;

vec3 sharpBilinear(vec2 tuv) {
  // Nearest-neighbor look without shimmering: interpolate only across texel borders.
  vec2 texel = tuv * u_texSize;
  vec2 fl = floor(texel);
  vec2 s = fract(texel) - 0.5;
  vec2 range = 0.5 - 0.5 / max(u_pixelScale, vec2(1.0));
  vec2 f = (s - clamp(s, -range, range)) * max(u_pixelScale, vec2(1.0)) + 0.5;
  return texture(u_image, (fl + f) / u_texSize).rgb;
}

void main() {
  // Render targets keep GL's bottom-up convention end to end, so no flip is needed here.
  vec2 tuv = u_srcRect.xy + uv * u_srcRect.zw;
  vec3 c;
  if (u_mode == 2) {
    vec2 texel = tuv * u_texSize;
    vec3 base = sharpBilinear(tuv);
    float scan = 0.72 + 0.28 * cos((fract(texel.y) - 0.5) * 6.2831853);
    float mask = 0.93 + 0.07 * cos(gl_FragCoord.x * 2.0943951);
    c = base * scan * mask * 1.15;
  } else if (u_mode == 1) {
    c = texture(u_image, tuv).rgb;
  } else {
    c = sharpBilinear(tuv);
  }
  o_color = vec4(c, 1.0);
}`;
