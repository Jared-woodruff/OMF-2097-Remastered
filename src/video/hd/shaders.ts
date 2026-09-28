// Remastered (HD) renderer shaders.
//
// Sprites keep their original 8-bit indexed pixels; every output pixel is reconstructed at display
// resolution from the source neighborhood, using colors from the LIVE palette (so player colors,
// palette flashes and fades keep working):
//   - Silhouettes: Hyllian's xBR level 2 edge-directed upscaler (MIT license, see NOTICE below) run on the
//     opaque/transparent mask, giving clean anti-aliased diagonals (premultiplied alpha).
//   - Material boundaries: xBR on the colors decides which side of an edge each output pixel belongs to.
//   - Shading: a joint-bilateral Catmull-Rom filter around that color smooths shading steps inside a material
//     without blurring across edges.
// Backgrounds get the same reconstruction (without the mask) into a cache that is refreshed whenever the
// colors they use change. Shadows and remap effects (glows) use the original remap tables exactly: see
// HD_SHADOWRATIO_FS / HD_BG_FS and DELTA_FS / HD_DELTA_FS.
//
// NOTICE — xBR-lv2 logic adapted from "Hyllian's xBR-lv2 Shader",
// Copyright (C) 2011-2016 Hyllian - sergiogdb@gmail.com. Permission is hereby granted, free of charge,
// to any person obtaining a copy of this software and associated documentation files (the "Software"),
// to deal in the Software without restriction, including without limitation the rights to use, copy,
// modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the following conditions: The above
// copyright notice and this permission notice shall be included in all copies or substantial portions
// of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

const COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
`;

export const HD_SPRITE_VS = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in ivec4 a_p0; // transparency, remapOffset, remapRounds, palOffset
layout(location = 3) in ivec4 a_p1; // palLimit, opacity, options, mode
uniform vec2 u_scale;   // target pixels per native pixel
uniform vec2 u_offset;  // target-pixel offset of native x=0,y=0
uniform vec2 u_target;  // target size in pixels
out vec2 v_uv;
flat out ivec4 v_p0;
flat out ivec4 v_p1;
void main() {
  v_uv = a_uv;
  v_p0 = a_p0;
  v_p1 = a_p1;
  vec2 p = a_pos * u_scale + u_offset;
  gl_Position = vec4(p.x / u_target.x * 2.0 - 1.0, 1.0 - p.y / u_target.y * 2.0, 0.0, 1.0);
}`;

const SAMPLING = `
uniform usampler2D u_atlas;
uniform usampler2D u_remaps;  // 256x19
uniform sampler2D u_palette;  // 256x1 live palette
uniform float u_rangeK;       // bilateral range weight (1 / (2 sigma^2))

int g_transparency;
int g_palOffset;
int g_palLimit;
int g_options;
int g_remapRow;

vec3 pal(int i) {
  return texelFetch(u_palette, ivec2(clamp(i, 0, 255), 0), 0).rgb;
}

int rawAt(ivec2 p) {
  return int(texelFetch(u_atlas, p, 0).r);
}

// Final palette index for a raw sprite index (palette offset/limit, optional sprite-side remap).
int finalIndex(int raw) {
  int index = raw;
  if (index <= g_palLimit) index = clamp(index + g_palOffset, 0, g_palLimit);
  bool noRemap = ((g_options & 8) != 0) && index > 0x30;
  if ((g_options & 1) != 0 && !noRemap) index = int(texelFetch(u_remaps, ivec2(index, g_remapRow), 0).r);
  return index;
}

// 5x5 source neighborhood around E = floor(uv), row-major from offset (-2,-2).
// NC: premultiplied color (transparent = 0), NR: raw index.
vec4 NC[25];
int NR[25];

void loadNeighborhood(ivec2 e) {
  for (int j = 0; j < 5; j++) {
    for (int i = 0; i < 5; i++) {
      int r = rawAt(e + ivec2(i - 2, j - 2));
      NR[j * 5 + i] = r;
      NC[j * 5 + i] = r == g_transparency ? vec4(0.0) : vec4(pal(finalIndex(r)), 1.0);
    }
  }
}

const vec3 RGBW = vec3(14.352, 28.176, 5.472);
float colorKey(int k) {
  return NR[k] == g_transparency ? -300.0 : dot(NC[k].rgb, RGBW);
}
float maskKey(int k) {
  return NR[k] == g_transparency ? 0.0 : 100.0;
}
`;

const XBR = `
// ---- Hyllian's xBR-lv2 (CORNER_C, SMOOTH_TIPS) ----
const vec4 Ao = vec4(1.0, -1.0, -1.0, 1.0);
const vec4 Bo = vec4(1.0, 1.0, -1.0, -1.0);
const vec4 Co = vec4(1.5, 0.5, -0.5, 0.5);
const vec4 Ax = vec4(1.0, -1.0, -1.0, 1.0);
const vec4 Bx = vec4(0.5, 2.0, -0.5, -2.0);
const vec4 Cx = vec4(1.0, 1.0, -0.5, 0.0);
const vec4 Ay = vec4(1.0, -1.0, -1.0, 1.0);
const vec4 By = vec4(2.0, 0.5, -2.0, -0.5);
const vec4 Cy = vec4(2.0, 0.0, -1.0, 0.5);
const vec4 Ci = vec4(0.25);
const float EQ_THRESHOLD = 15.0;
const float LV2_CF = 2.0;

vec4 df(vec4 A, vec4 B) { return abs(A - B); }
// Colors closer than DIFF_T (shading steps, texture noise) count as the same region: edge rules only fire on
// real boundaries; the bilateral pass smooths everything inside a region.
uniform float u_diffT;
vec4 diff4(vec4 A, vec4 B) { return step(vec4(u_diffT), df(A, B)); }
vec4 eq4(vec4 A, vec4 B) { return step(df(A, B), vec4(EQ_THRESHOLD)); }
vec4 neq4(vec4 A, vec4 B) { return vec4(1.0) - eq4(A, B); }
vec4 wd(vec4 a, vec4 b, vec4 c, vec4 d, vec4 e, vec4 f, vec4 g, vec4 h) {
  return df(a, b) + df(a, c) + df(d, e) + df(d, f) + 4.0 * df(g, h);
}
float cdf(vec4 c1, vec4 c2) {
  vec4 d = abs(c1 - c2);
  return d.r + d.g + d.b + d.a;
}

// Keys: b = (B,D,H,F), c = (C,A,G,I), e = E, i4 = (I4,C1,A0,G5), i5 = (I5,C4,A1,G0), h5 = (H5,F4,B1,D0).
// Payloads PE..PH are blended exactly as xBR blends the center/neighbor colors.
vec4 xbrCore(vec4 b, vec4 c, vec4 ee, vec4 i4, vec4 i5, vec4 h5, vec2 fp, float s,
             vec4 PE, vec4 PB, vec4 PD, vec4 PF, vec4 PH) {
  vec4 d = b.yzwx;
  vec4 f = b.wxyz;
  vec4 g = c.zwxy;
  vec4 h = b.zwxy;
  vec4 i = c.wxyz;
  vec4 f4 = h5.yzwx;
  vec4 delta = vec4(1.0 / s);
  vec4 delta_l = vec4(0.5 / s, 1.0 / s, 0.5 / s, 1.0 / s);
  vec4 delta_u = delta_l.yxwz;

  vec4 fx = Ao * fp.y + Bo * fp.x;
  vec4 fx_l = Ax * fp.y + Bx * fp.x;
  vec4 fx_u = Ay * fp.y + By * fp.x;

  vec4 irlv0 = diff4(ee, f) * diff4(ee, h);
  vec4 irlv1 = irlv0 * (neq4(f, b) * neq4(f, c) + neq4(h, d) * neq4(h, g) + eq4(ee, i) * (neq4(f, f4) * neq4(f, i4) + neq4(h, h5) * neq4(h, i5)) + eq4(ee, g) + eq4(ee, c));
  vec4 irlv2l = diff4(ee, g) * diff4(d, g);
  vec4 irlv2u = diff4(ee, c) * diff4(b, c);

  vec4 fx45i = clamp((fx + delta - Co - Ci) / (2.0 * delta), 0.0, 1.0);
  vec4 fx45 = clamp((fx + delta - Co) / (2.0 * delta), 0.0, 1.0);
  vec4 fx30 = clamp((fx_l + delta_l - Cx) / (2.0 * delta_l), 0.0, 1.0);
  vec4 fx60 = clamp((fx_u + delta_u - Cy) / (2.0 * delta_u), 0.0, 1.0);

  vec4 wd1 = wd(ee, c, g, i, h5, f4, h, f);
  vec4 wd2 = wd(h, d, i5, f, i4, b, ee, i);

  vec4 edri = step(wd1, wd2) * irlv0;
  vec4 edr = step(wd1 + vec4(0.1), wd2) * step(vec4(0.5), irlv1);
  vec4 edr_l = step(LV2_CF * df(f, g), df(h, c)) * irlv2l * edr;
  vec4 edr_u = step(LV2_CF * df(h, c), df(f, g)) * irlv2u * edr;

  fx45 = edr * fx45;
  fx30 = edr_l * fx30;
  fx60 = edr_u * fx60;
  fx45i = edri * fx45i;

  vec4 px = step(df(ee, f), df(ee, h));
  vec4 maximos = max(max(fx30, fx60), max(fx45, fx45i));

  vec4 res1 = PE;
  res1 = mix(res1, mix(PH, PF, px.x), maximos.x);
  res1 = mix(res1, mix(PB, PD, px.z), maximos.z);
  vec4 res2 = PE;
  res2 = mix(res2, mix(PF, PB, px.y), maximos.y);
  res2 = mix(res2, mix(PD, PH, px.w), maximos.w);
  return mix(res1, res2, step(cdf(PE, res1), cdf(PE, res2)));
}

// Joint-bilateral Catmull-Rom over the opaque texels: smooth shading inside a material, while texels whose
// color differs from 'ref' (another material / an outline) get little weight, keeping edges where the
// edge-directed pass put them. Clamped to the local range (no ringing).
float crKernel(float x) {
  x = abs(x);
  if (x < 1.0) return (1.5 * x - 2.5) * x * x + 1.0;
  if (x < 2.0) return ((-0.5 * x + 2.5) * x - 4.0) * x + 2.0;
  return 0.0;
}

vec3 bilateralCubic(vec2 uv, ivec2 e, vec3 ref, float kRange) {
  // Sample position in 5x5-grid coordinates (grid texel (i, j) is centered on (i, j)). Every index below is a
  // compile-time constant once the loops are unrolled, so the neighborhood stays in registers.
  vec2 p = uv - vec2(e - 2) - 0.5;
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  vec3 lo = vec3(1.0);
  vec3 hi = vec3(0.0);
  for (int j = 0; j < 5; j++) {
    float dy = float(j) - p.y;
    float wy = crKernel(dy);
    for (int i = 0; i < 5; i++) {
      float dx = float(i) - p.x;
      float w0 = crKernel(dx) * wy;
      vec4 c = NC[j * 5 + i];
      if (c.a < 0.5 || w0 == 0.0) continue;
      vec3 d = c.rgb - ref;
      float sim = exp(-dot(d, d) * kRange);
      float w = w0 * sim;
      sum += w * c.rgb;
      wsum += w;
      if (abs(dx) < 1.0 && abs(dy) < 1.0 && sim > 0.2) {
        lo = min(lo, c.rgb);
        hi = max(hi, c.rgb);
      }
    }
  }
  if (wsum < 0.05) return ref;
  vec3 r = sum / wsum;
  return hi.r >= lo.r ? clamp(r, lo, hi) : r;
}

// Reconstructs the sprite at continuous atlas position uv (premultiplied RGBA).
//  - silhouette (alpha): xBR on the opaque/transparent mask -> clean diagonal edges,
//  - material boundaries: xBR on colors decides which side each output pixel belongs to,
//  - shading: bilateral bicubic around that color -> smooth gradients, no pixel steps.
vec4 hqSample(vec2 uv, float scale, bool withMask) {
  ivec2 e = ivec2(floor(uv));
  vec2 fp = fract(uv);
  float s = clamp(scale, 1.0, 16.0);
  // Fast path: a uniform 3x3 neighborhood (flat areas, empty sprite space) reconstructs to its own color.
  int r0 = rawAt(e);
  bool uniformArea = true;
  for (int j = -1; j <= 1 && uniformArea; j++) {
    for (int i = -1; i <= 1; i++) {
      if (rawAt(e + ivec2(i, j)) != r0) {
        uniformArea = false;
        break;
      }
    }
  }
  if (uniformArea) return r0 == g_transparency ? vec4(0.0) : vec4(pal(finalIndex(r0)), 1.0);
  loadNeighborhood(e);
  vec4 kb = vec4(colorKey(7), colorKey(11), colorKey(17), colorKey(13));
  vec4 kc = vec4(colorKey(8), colorKey(6), colorKey(16), colorKey(18));
  vec4 ke = vec4(colorKey(12));
  vec4 ki4 = vec4(colorKey(19), colorKey(3), colorKey(5), colorKey(21));
  vec4 ki5 = vec4(colorKey(23), colorKey(9), colorKey(1), colorKey(15));
  vec4 kh5 = vec4(colorKey(22), colorKey(14), colorKey(2), colorKey(10));
  vec4 ref = xbrCore(kb, kc, ke, ki4, ki5, kh5, fp, s, NC[12], NC[7], NC[11], NC[13], NC[17]);
  float alpha = 1.0;
  if (withMask) {
    vec4 mb = vec4(maskKey(7), maskKey(11), maskKey(17), maskKey(13));
    vec4 mc = vec4(maskKey(8), maskKey(6), maskKey(16), maskKey(18));
    vec4 me = vec4(maskKey(12));
    vec4 mi4 = vec4(maskKey(19), maskKey(3), maskKey(5), maskKey(21));
    vec4 mi5 = vec4(maskKey(23), maskKey(9), maskKey(1), maskKey(15));
    vec4 mh5 = vec4(maskKey(22), maskKey(14), maskKey(2), maskKey(10));
    alpha = xbrCore(mb, mc, me, mi4, mi5, mh5, fp, s, vec4(NC[12].a), vec4(NC[7].a), vec4(NC[11].a), vec4(NC[13].a), vec4(NC[17].a)).x;
    if (alpha <= 0.002) return vec4(0.0);
  }
  vec3 refRgb;
  if (ref.a > 0.02) refRgb = ref.rgb / ref.a;
  else refRgb = bilateralCubic(uv, e, vec3(0.5), 0.0);
  vec3 rgb = bilateralCubic(uv, e, refRgb, u_rangeK);
  return vec4(rgb * alpha, alpha);
}
`;

/**
 * Text: the original bitmap fonts as clean shapes, sharp at any size. Every ink pixel is a square whose outward
 * corners are rounded, and ink pixels that touch diagonally are joined by a stroke (which also bevels the
 * stair-step corners of curves), so letters keep their exact design without pixel steps or upscaling blur.
 */
const TEXT = `
float g_ink[25];
float inkK(int i, int j) {
  return g_ink[(j + 2) * 5 + (i + 2)];
}

// Box of half size 0.5 with a radius per corner: r = (+x+y, +x-y, -x+y, -x-y), y pointing down.
float sdCornerBox(vec2 p, vec4 r) {
  vec2 rr = p.x > 0.0 ? r.xy : r.zw;
  float rad = p.y > 0.0 ? rr.x : rr.y;
  vec2 q = abs(p) - 0.5 + rad;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - rad;
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// Radii of the outward corners of ink pixel (i, j): where both neighbors at a corner are empty.
vec4 cornerRadii(int i, int j) {
  const float R = 0.45;
  return vec4(
    inkK(i + 1, j) + inkK(i, j + 1) < 0.5 ? R : 0.0,
    inkK(i + 1, j) + inkK(i, j - 1) < 0.5 ? R : 0.0,
    inkK(i - 1, j) + inkK(i, j + 1) < 0.5 ? R : 0.0,
    inkK(i - 1, j) + inkK(i, j - 1) < 0.5 ? R : 0.0);
}

// Signed distance (in font pixels) from atlas position p to the ink of the glyph.
float glyphDistance(vec2 p) {
  ivec2 e = ivec2(floor(p));
  for (int j = 0; j < 5; j++) {
    for (int i = 0; i < 5; i++) g_ink[j * 5 + i] = rawAt(e + ivec2(i - 2, j - 2)) == g_transparency ? 0.0 : 1.0;
  }
  const float W = 0.5;    // half width of diagonal strokes
  float d = 1e3;
  vec2 q = p - vec2(e) - 0.5;
  if (inkK(0, 0) > 0.5) {
    // Inside an ink pixel: the distance to its own exposed edges. The box reaches into ink neighbors, so the seams
    // between pixels are no edges.
    vec2 lo = vec2(-0.5) - vec2(inkK(-1, 0), inkK(0, -1));
    vec2 hi = vec2(0.5) + vec2(inkK(1, 0), inkK(0, 1));
    vec2 c = (lo + hi) * 0.5;
    vec2 h = (hi - lo) * 0.5;
    vec4 r = cornerRadii(0, 0);
    vec2 rr = q.x > c.x ? r.xy : r.zw;
    float rad = q.y > c.y ? rr.x : rr.y;
    vec2 t = abs(q - c) - h + rad;
    d = min(max(t.x, t.y), 0.0) + length(max(t, 0.0)) - rad;
  } else {
    // Outside the ink: the nearest pixel of it (two pixels around, for the halo; the outer ring without rounding).
    for (int j = -2; j <= 2; j++) {
      for (int i = -2; i <= 2; i++) {
        if (inkK(i, j) < 0.5) continue;
        bool near = abs(i) <= 1 && abs(j) <= 1;
        d = min(d, sdCornerBox(q - vec2(i, j), near ? cornerRadii(i, j) : vec4(0.0)));
      }
    }
  }
  for (int j = -1; j <= 0; j++) {
    for (int i = -1; i <= 0; i++) {
      float a = inkK(i, j), b = inkK(i + 1, j), c = inkK(i, j + 1), f = inkK(i + 1, j + 1);
      vec2 o = vec2(e + ivec2(i, j));
      if (a > 0.5 && f > 0.5 && b + c < 1.5) d = min(d, sdSegment(p, o + 0.5, o + 1.5) - W);
      if (b > 0.5 && c > 0.5 && a + f < 1.5) d = min(d, sdSegment(p, o + vec2(1.5, 0.5), o + vec2(0.5, 1.5)) - W);
    }
  }
  return d;
}
`;

export const HD_SPRITE_FS = COMMON + SAMPLING + XBR + TEXT + `
in vec2 v_uv;
flat in ivec4 v_p0;
flat in ivec4 v_p1;
uniform float u_remapA[19];
uniform vec3 u_remapB[19];
uniform int u_shadowPass;
uniform int u_textStyle;   // font glyphs: 0 clean HD shapes, 1 crisp pixels, 2 the typeface (flag 0x200 quads)
uniform int u_textPass;    // clean HD text: 1 draws the soft contrast halo that goes under a run of text
uniform sampler2D u_glyphSdf;  // the remastered typeface's glyphs as distance fields (hd/typeface.ts)
uniform vec2 u_glyphSdfSize;
uniform float u_glyphTexels;   // texels per native pixel
uniform float u_glyphRange;    // native pixels of distance each side of an edge
uniform vec4 u_addBg;      // the credits: atlas rect of the background that index-adding sprites brighten (w 0: none)
uniform vec2 u_scale;      // (as in the vertex shader: target pixels per native pixel, offset, target size)
uniform vec2 u_offset;
uniform vec2 u_target;
out vec4 o_color;

// Applies remap table 'row' n times as the fitted RGB transform: dst' = a*dst + b.
void remapTransform(int row, int rounds, out float A, out vec3 B) {
  float a = u_remapA[row];
  vec3 b = u_remapB[row];
  A = 1.0;
  B = vec3(0.0);
  for (int k = 0; k < 16; k++) {
    if (k >= rounds) break;
    B = a * B + b;
    A *= a;
  }
}

float maskAt(ivec2 p) {
  return rawAt(p) == g_transparency ? 0.0 : 1.0;
}
float bilinearMask(vec2 uv) {
  vec2 p = uv - 0.5;
  vec2 fl = floor(p);
  vec2 t = p - fl;
  ivec2 b = ivec2(fl);
  float a = mix(maskAt(b), maskAt(b + ivec2(1, 0)), t.x);
  float c = mix(maskAt(b + ivec2(0, 1)), maskAt(b + ivec2(1, 1)), t.x);
  return mix(a, c, t.y);
}

void main() {
  g_transparency = v_p0.x;
  int remapOffset = v_p0.y;
  int remapRounds = v_p0.z;
  g_palOffset = v_p0.w;
  g_palLimit = v_p1.x;
  int opacity = v_p1.y;
  g_options = v_p1.z;
  g_remapRow = clamp(remapOffset, 0, 18);
  int mode = v_p1.w; // 0 set, 1 remap, 2 shadow, 3 add, 4 dark tint
  float op = float(opacity) / 255.0;

  if (mode == 2) {
    // Shadow: the sprite squashed to 1/4 height. As in the original, the darkness follows how many of the
    // 4 source rows behind each output row are covered (remap tables 0..3); filtered for soft edges.
    float cov = 0.0;
    for (int k = 0; k < 4; k++) cov += bilinearMask(v_uv + vec2(0.0, float(k) - 1.5));
    cov *= 0.25;
    if (cov <= 0.004) discard;
    if (u_shadowPass != 0) {
      // Coverage into the shadow buffer (MAX blended); the background pass applies the exact remaps.
      o_color = vec4(cov * op);
      return;
    }
    float c4 = cov * 4.0;
    int r0 = remapOffset + 1;
    int lower = int(floor(c4));
    float f = c4 - float(lower);
    float A0 = 1.0;
    vec3 B0 = vec3(0.0);
    float A1 = 1.0;
    vec3 B1 = vec3(0.0);
    if (lower >= 1) remapTransform(clamp(r0 + lower - 1, 0, 18), 1, A0, B0);
    if (lower < 4) remapTransform(clamp(r0 + lower, 0, 18), 1, A1, B1);
    else { A1 = A0; B1 = B0; }
    float A = mix(A0, A1, f);
    vec3 B = mix(B0, B1, f);
    o_color = vec4(B * op, mix(1.0, A, op));
    return;
  }

  if ((g_options & 0x200) != 0) {
    // Text in the remastered typeface: the glyph's distance field, fitted in its original cell (v_uv in its texels).
    float dist = (texture(u_glyphSdf, v_uv / u_glyphSdfSize).r * 255.0 - 128.0) * u_glyphRange / 127.0;
    float px = max(max(fwidth(v_uv.x), fwidth(v_uv.y)) / u_glyphTexels, 1e-4);
    bool halfTone = (g_options & 0x400) != 0;
    if (halfTone) op *= 0.5;
    if (u_textPass == 1) {
      if (halfTone) discard;
      vec3 ink = pal(finalIndex(1));
      float h = 0.5 * (1.0 - smoothstep(0.0, 1.6, max(dist, 0.0))) * op * smoothstep(0.08, 0.2, dot(ink, vec3(0.299, 0.587, 0.114)));
      if (h <= 0.002) discard;
      o_color = vec4(0.0, 0.0, 0.0, h);
      return;
    }
    float m = clamp(0.5 - dist / px, 0.0, 1.0);
    if (m <= 0.002) discard;
    if (u_shadowPass == 2) {
      o_color = vec4(m * op);
      return;
    }
    vec3 ink = pal(finalIndex(1));
    float a = m * op;
    o_color = vec4(ink * a, a);
    return;
  }
  if ((g_options & 0x100) != 0 && u_textStyle == 0 && mode == 0) {
    // Text: the original letters as clean shapes (see TEXT), anti-aliased over one screen pixel.
    float px = max(max(fwidth(v_uv.x), fwidth(v_uv.y)), 1e-4);
    float dist = glyphDistance(v_uv);
    if (u_textPass == 1) {
      // Halo: a soft shadow around the letters that keeps them readable on busy backgrounds (none for near-black
      // text, which would only get muddier).
      vec3 ink = pal(finalIndex(1));
      float h = 0.5 * (1.0 - smoothstep(0.0, 1.6, max(dist, 0.0))) * op * smoothstep(0.08, 0.2, dot(ink, vec3(0.299, 0.587, 0.114)));
      if (h <= 0.002) discard;
      o_color = vec4(0.0, 0.0, 0.0, h);
      return;
    }
    float m = clamp(0.5 - dist / px, 0.0, 1.0);
    if (m <= 0.002) discard;
    if (u_shadowPass == 2) {
      o_color = vec4(m * op);
      return;
    }
    vec3 ink = pal(finalIndex(1));
    float a = m * op;
    o_color = vec4(ink * a, a);
    return;
  }
  if ((g_options & 0x100) != 0 && u_textStyle == 1 && mode == 0) {
    // Text: the original pixel font kept crisp at any size, anti-aliased over one screen pixel.
    vec2 px = max(fwidth(v_uv), vec2(1e-4));
    vec2 t = v_uv - 0.5;
    vec2 fl = floor(t);
    vec2 k = clamp((t - fl - 0.5) / px + 0.5, 0.0, 1.0);
    ivec2 b = ivec2(fl);
    float m = mix(mix(maskAt(b), maskAt(b + ivec2(1, 0)), k.x), mix(maskAt(b + ivec2(0, 1)), maskAt(b + ivec2(1, 1)), k.x), k.y);
    if (m <= 0.002) discard;
    if (u_shadowPass == 2) {
      o_color = vec4(m * op);
      return;
    }
    vec3 ink = pal(finalIndex(1));
    float a = m * op;
    o_color = vec4(ink * a, a);
    return;
  }
  float scale = 1.0 / max(max(fwidth(v_uv.x), fwidth(v_uv.y)), 1e-4);
  vec4 s = hqSample(v_uv, scale, true);
  if (s.a <= 0.002) discard;
  if (u_shadowPass == 2) {
    // Object mask (remastered lighting): coverage only.
    o_color = vec4(s.a * op);
    return;
  }
  vec3 rgb = s.rgb / s.a;

  if (mode == 1) {
    // Remap effects (glows): the sprite pixel's index selects the remap table and repeat count, applied to
    // what is behind as the fitted transform  dst' = A*dst + B.
    int raw = NR[12];
    int idx = raw == g_transparency ? 0 : finalIndex(raw);
    int enc = clamp(remapOffset + remapRounds * 19 + idx, 0, 255);
    float A; vec3 B;
    remapTransform(enc % 19, enc / 19, A, B);
    float cov = s.a * op;
    o_color = vec4(B * cov, 1.0 - cov + cov * A);
    return;
  }
  if (mode == 3 && u_addBg.w > 0.0) {
    // The credits' names add 60 per step of their pixels to the palette index of the background under them (the
    // palette holds brighter copies of the background's colors there): that color, with the smooth silhouette.
    vec2 np = (vec2(gl_FragCoord.x, u_target.y - gl_FragCoord.y) - u_offset) / u_scale;
    ivec2 bp = clamp(ivec2(floor(np)), ivec2(0), ivec2(u_addBg.zw) - 1);
    int bg = int(texelFetch(u_atlas, ivec2(u_addBg.xy) + bp, 0).r);
    int k = 0;
    for (int j = 1; j <= 3; j++) {
      for (int i = 1; i <= 3; i++) {
        int r = NR[j * 5 + i];
        if (r != g_transparency) k = max(k, r);
      }
    }
    float a = s.a * op;
    o_color = vec4(pal(bg + 60 * k) * a, a);
    return;
  }
  if (mode == 4) {
    // Dark tint (Shadow HAR clones, stasis): translucent silhouette; flames (>= 0x60) stay opaque.
    int raw = NR[12];
    int fin = raw == g_transparency ? 0 : finalIndex(raw);
    float a = (fin >= 0x60 ? 1.0 : 0.6) * s.a;
    o_color = vec4(rgb * a, a);
    return;
  }
  float a = s.a * op;
  o_color = vec4(rgb * a, a);
}`;

/** Background cache pass: the same reconstruction as sprites (no transparency) into an RGB cache. */
export const HD_BGCACHE_FS = COMMON + SAMPLING + XBR + `
in vec2 v_uv;
flat in ivec4 v_p0;
flat in ivec4 v_p1;
uniform float u_cacheScale;
out vec4 o_color;
void main() {
  g_transparency = -1;
  g_palOffset = 0;
  g_palLimit = 255;
  g_options = 0;
  g_remapRow = 0;
  vec4 s = hqSample(v_uv, u_cacheScale, false);
  o_color = vec4(clamp(s.rgb, 0.0, 1.0), 1.0);
}`;

/**
 * Exact shadow colors for the background: for each (extended) background texel, the RGB ratio between the
 * color after shadow remap table 0..3 and the original color (MRT, one attachment per shadow level).
 */
export const HD_SHADOWRATIO_FS = COMMON + `
in vec2 v_uv;
flat in ivec4 v_p0;
flat in ivec4 v_p1;
uniform usampler2D u_atlas;
uniform usampler2D u_remaps;
uniform sampler2D u_palette;
layout(location = 0) out vec4 o_r0;
layout(location = 1) out vec4 o_r1;
layout(location = 2) out vec4 o_r2;
layout(location = 3) out vec4 o_r3;
vec3 pal(int i) {
  return texelFetch(u_palette, ivec2(clamp(i, 0, 255), 0), 0).rgb;
}
vec4 ratio(int idx, int row, vec3 c0) {
  vec3 c = pal(int(texelFetch(u_remaps, ivec2(idx, row), 0).r));
  return vec4(clamp((c + 0.004) / (c0 + 0.004), 0.0, 1.0), 1.0);
}
void main() {
  int idx = int(texelFetch(u_atlas, ivec2(floor(v_uv)), 0).r);
  vec3 c0 = pal(idx);
  o_r0 = ratio(idx, 0, c0);
  o_r1 = ratio(idx, 1, c0);
  o_r2 = ratio(idx, 2, c0);
  o_r3 = ratio(idx, 3, c0);
}`;

/** Draws the cached background (bilinear), applies HAR shadows exactly, darkens the widescreen extension. */
export const HD_BG_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D u_cache;     // RGB, LINEAR filtered
uniform vec2 u_cacheSize;      // texels
uniform vec4 u_region;         // visible region in cache texel coords (top-down): x0, y0, w, h
uniform float u_extLeft;       // cache texel x where the original background starts
uniform float u_extRight;      // cache texel x where it ends
uniform float u_extFade;       // falloff width in cache texels
uniform float u_extBlurLod;    // blur (mip level) at the far end of the extension
uniform float u_extStrength;   // 1 = mirrored extension (full treatment), less for real widescreen artwork
uniform float u_cacheScale;    // cache texels per native pixel
uniform sampler2D u_shadow;    // screen-space shadow coverage (0..1 = 0..4 covered rows)
uniform sampler2D u_ratio0;    // per-level RGB shadow ratios at native resolution (bottom-up)
uniform sampler2D u_ratio1;
uniform sampler2D u_ratio2;
uniform sampler2D u_ratio3;
out vec4 o_color;
void main() {
  vec2 c = u_region.xy + vec2(uv.x, 1.0 - uv.y) * u_region.zw;
  // Cache rows are bottom-up.
  vec2 tuv = vec2(c.x / u_cacheSize.x, 1.0 - c.y / u_cacheSize.y);
  vec3 col = texture(u_cache, tuv).rgb;
  float lvl = texelFetch(u_shadow, ivec2(gl_FragCoord.xy), 0).r * 4.0;
  if (lvl > 0.01) {
    vec3 r0 = texture(u_ratio0, tuv).rgb;
    vec3 r1 = texture(u_ratio1, tuv).rgb;
    vec3 r2 = texture(u_ratio2, tuv).rgb;
    vec3 r3 = texture(u_ratio3, tuv).rgb;
    float f = fract(lvl);
    int L = int(floor(lvl));
    vec3 lo = L <= 0 ? vec3(1.0) : L == 1 ? r0 : L == 2 ? r1 : L == 3 ? r2 : r3;
    vec3 hi = L <= 0 ? r0 : L == 1 ? r1 : L == 2 ? r2 : r3;
    col *= mix(lo, hi, f);
  }
  float d = max(u_extLeft - c.x, c.x - u_extRight);
  if (d > 0.0) {
    // Widescreen extension (mirrored scene): progressively blurred, desaturated and darkened away from the
    // original playfield, so it reads as surroundings rather than a copy.
    float k = clamp(d / u_extFade, 0.0, 1.0) * u_extStrength;
    col = textureLod(u_cache, tuv, sqrt(k) * u_extBlurLod).rgb;
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(l), 0.35 * k) * (1.0 - 0.55 * k * k);
  }
  o_color = vec4(col, 1.0);
}`;

/** Final composite: bloom + vignette + gentle highlight shoulder onto the canvas. */
export const HD_POST_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform float u_bloomStrength;
uniform float u_vignette;
uniform float u_fade;          // whole-screen palette fades (the scene is drawn without them)
uniform vec4 u_srcRect;
uniform sampler2D u_shafts;    // light shafts (remastered effects), low resolution
uniform float u_shaftStrength;
out vec4 o_color;
void main() {
  vec2 tuv = u_srcRect.xy + uv * u_srcRect.zw;
  vec3 c = texture(u_scene, tuv).rgb;
  vec3 bl = texture(u_bloom, tuv).rgb;
  c += bl * u_bloomStrength;
  c += texture(u_shafts, tuv).rgb * u_shaftStrength;
  vec2 d = uv - 0.5;
  c *= 1.0 - u_vignette * dot(d, d) * 1.6;
  o_color = vec4(c * u_fade, 1.0);
}`;

/**
 * Bright-pass + downsample for bloom. Only luminous things glow: near-white highlights (sparks, lightning cores,
 * lamps) and the brightening part of the game's glow effects (remap delta). Colored surfaces, skies and light
 * backgrounds keep their original palette colors.
 */
export const HD_BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform sampler2D u_delta;     // remap-effect delta (see HD_DELTA_FS), when u_hasDelta
uniform int u_hasDelta;
uniform vec2 u_deltaSize;
uniform vec2 u_scale;          // target pixels per native pixel
uniform vec2 u_offset;         // native offset of the delta texture's x=0 (includes shake)
uniform vec2 u_targetSize;
out vec4 o_color;
void main() {
  vec3 c = vec3(0.0);
  c += texture(u_src, uv + u_texel * vec2(-1.0, -1.0)).rgb;
  c += texture(u_src, uv + u_texel * vec2(1.0, -1.0)).rgb;
  c += texture(u_src, uv + u_texel * vec2(-1.0, 1.0)).rgb;
  c += texture(u_src, uv + u_texel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float lo = min(min(c.r, c.g), c.b);
  vec3 b = c * smoothstep(0.8, 0.97, lo);
  if (u_hasDelta != 0) {
    vec2 px = vec2(uv.x, 1.0 - uv.y) * u_targetSize;
    vec2 n = px / u_scale - u_offset;
    vec2 duv = vec2(n.x / u_deltaSize.x, 1.0 - n.y / u_deltaSize.y);
    if (duv.x >= 0.0 && duv.x <= 1.0 && duv.y >= 0.0 && duv.y <= 1.0) {
      b += max(texture(u_delta, duv).rgb * 2.0 - 1.0, 0.0) * 1.2;
    }
  }
  o_color = vec4(b, 1.0);
}`;

/** Separable 9-tap gaussian blur. */
export const HD_BLUR_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D u_src;
uniform vec2 u_dir;
out vec4 o_color;
void main() {
  vec3 c = texture(u_src, uv).rgb * 0.2270270270;
  c += texture(u_src, uv + u_dir * 1.3846153846).rgb * 0.3162162162;
  c += texture(u_src, uv - u_dir * 1.3846153846).rgb * 0.3162162162;
  c += texture(u_src, uv + u_dir * 3.2307692308).rgb * 0.0702702703;
  c += texture(u_src, uv - u_dir * 3.2307692308).rgb * 0.0702702703;
  o_color = vec4(c, 1.0);
}`;

/** Adds the bloom and light shafts onto the world image (fights with effects: before the overlay is drawn). */
export const HD_GLOW_ADD_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D u_bloom;
uniform sampler2D u_shafts;
uniform float u_bloomStrength;
uniform float u_shaftStrength;
out vec4 o_color;
void main() {
  o_color = vec4(texture(u_bloom, uv).rgb * u_bloomStrength + texture(u_shafts, uv).rgb * u_shaftStrength, 1.0);
}`;

/** Tent-filtered upsample of a smaller bloom level, weighted (added onto the larger level with additive blending). */
export const HD_UP_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D u_src;
uniform vec2 u_texel;   // source texel size
uniform float u_weight;
out vec4 o_color;
void main() {
  vec2 d = u_texel;
  vec3 c = texture(u_src, uv).rgb * 4.0;
  c += (texture(u_src, uv + vec2(d.x, 0.0)).rgb + texture(u_src, uv - vec2(d.x, 0.0)).rgb +
        texture(u_src, uv + vec2(0.0, d.y)).rgb + texture(u_src, uv - vec2(0.0, d.y)).rgb) * 2.0;
  c += texture(u_src, uv + d).rgb + texture(u_src, uv - d).rgb + texture(u_src, uv + vec2(d.x, -d.y)).rgb +
       texture(u_src, uv + vec2(-d.x, d.y)).rgb;
  o_color = vec4(c / 16.0 * u_weight, 1.0);
}`;

/** 4-tap box downsample of a sub-rectangle of the source (u_srcRect in source uv). */
export const HD_DOWN_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D u_src;
uniform vec4 u_srcRect;
uniform vec2 u_texel;
out vec4 o_color;
void main() {
  vec2 p = u_srcRect.xy + uv * u_srcRect.zw;
  vec3 c = texture(u_src, p + u_texel * vec2(-1.0, -1.0)).rgb;
  c += texture(u_src, p + u_texel * vec2(1.0, -1.0)).rgb;
  c += texture(u_src, p + u_texel * vec2(-1.0, 1.0)).rgb;
  c += texture(u_src, p + u_texel * vec2(1.0, 1.0)).rgb;
  o_color = vec4(c * 0.25, 1.0);
}`;

/** Widescreen "ambient" fill for non-arena screens: a blurred, zoomed, dimmed copy of the 4:3 frame. */
export const HD_AMBIENT_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D u_amb;
uniform float u_zoom;   // target width / 4:3 frame width
uniform float u_dim;
out vec4 o_color;
void main() {
  vec2 a = vec2(uv.x, 0.5 + (uv.y - 0.5) / u_zoom);
  vec3 c = texture(u_amb, a).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(l), 0.2) * u_dim;
  o_color = vec4(c, 1.0);
}`;

/** Applies the remap-effect color delta (native resolution, bilinear) onto the HD image; one sign per pass. */
export const HD_DELTA_FS = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D u_delta;
uniform vec2 u_deltaSize;   // native texels
uniform vec2 u_targetSize;  // HD target pixels
uniform vec2 u_scale;       // HD pixels per native pixel
uniform vec2 u_offset;      // native offset of the delta texture's x=0 (includes shake)
uniform float u_sign;       // +1: brightening part (additive), -1: darkening part (reverse subtract)
out vec4 o_color;
void main() {
  vec2 px = vec2(gl_FragCoord.x, u_targetSize.y - gl_FragCoord.y); // top-down HD pixel
  vec2 n = px / u_scale - u_offset;                                  // native, top-down
  vec2 tuv = vec2(n.x / u_deltaSize.x, 1.0 - n.y / u_deltaSize.y);
  if (tuv.x < 0.0 || tuv.x > 1.0 || tuv.y < 0.0 || tuv.y > 1.0) discard;
  vec3 d = texture(u_delta, tuv).rgb * 2.0 - 1.0;
  vec3 c = max(d * u_sign, 0.0);
  if (max(c.r, max(c.g, c.b)) < 0.004) discard;
  o_color = vec4(c, 0.0);
}`;
