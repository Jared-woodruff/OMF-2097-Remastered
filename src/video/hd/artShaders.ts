// Shaders for the remastered HD artwork (see hd/assets.ts).
//
// The artwork was made against fixed palettes (the scene's palette, or reference robot colors for the robots), but
// the game changes colors at run time: player color choices, fades, flashes, lighting, tints. Every HD pixel is
// therefore mapped through the change of its original palette entry: the renderer finds the native pixel (index)
// the HD pixel belongs to — among the 3x3 native neighbors, the one whose original color matches it best — and
// transfers that entry's change from the artwork palette ("base") to the live palette onto the HD color:
//   brightness: lum(out) = lum(live) * lum(hd) / lum(base) (the artwork's shading),
//   color: the live color's chroma scaled by the artwork's saturation relative to the original, plus the artwork's
//   hue deviations as far as the live and original hues agree.
// This is exact when nothing changed (out = hd) and for uniform fades (out = k * hd), and recolors robots by
// keeping the artwork's shading and highlights in the player's colors.

const TRANSFER = `
const vec3 LUMA = vec3(0.299, 0.587, 0.114);

vec3 colorTransfer(vec3 c, vec3 b, vec3 l) {
  vec3 d = abs(l - b);
  if (max(d.r, max(d.g, d.b)) < 0.002) return c;
  float Lb = dot(b, LUMA);
  float Ll = dot(l, LUMA);
  float Lc = dot(c, LUMA);
  if (Lb < 0.03) return clamp(l + (c - b), 0.0, 1.0);
  // Brightness: the artwork's shading relative to the original color, applied to the live color.
  float L = Lc / Lb;
  vec3 cc = c - vec3(Lc);
  vec3 cb = b - vec3(Lb);
  vec3 cl = l - vec3(Ll);
  float nb = length(cb);
  vec3 co;
  if (nb < 0.04) {
    // Grey original (steel, chrome): keep the artwork's own color detail, scaled like the brightness.
    co = cl * L + cc * (Ll / Lb);
  } else {
    // Color: the artwork's saturation relative to the original (highlights whiten, shadows deepen) carried over to
    // the live hue; hue deviations only kept as far as live and original hues agree (fades, lighting).
    vec3 ub = cb / nb;
    float along = dot(cc, ub);
    vec3 perp = cc - along * ub;
    float nl = length(cl);
    // Hue agreement, reduced when the live color is less saturated than the original (e.g. steel-grey armor).
    float h = nl < 0.02 ? 0.0 : clamp(dot(cb, cl) / (nb * nl), 0.0, 1.0) * clamp((nl / max(Ll, 1e-3)) / (nb / Lb), 0.0, 1.0);
    co = cl * (max(along, 0.0) / nb) + perp * ((Ll / Lb) * h);
  }
  return clamp(vec3(Ll * L) + co, 0.0, 1.0);
}

// Distance between an HD color and an original palette color, weighting hue/saturation over brightness (the
// artwork is often brighter or darker than the original shade, but keeps its hue).
float matchDistance(vec3 c, vec3 b) {
  vec3 nc = c / (length(c) + 0.08);
  vec3 nb = b / (length(b) + 0.08);
  return length(nc - nb) + 0.35 * abs(dot(c - b, LUMA));
}
`;

export const HD_ASSET_VS = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_huv;
layout(location = 2) in vec2 a_nuv;
layout(location = 3) in ivec4 a_p0; // transparency, remapOffset, remapRounds, palOffset
layout(location = 4) in ivec4 a_p1; // palLimit, opacity, options, mode
layout(location = 5) in ivec4 a_p2; // native surface rect in the index atlas: x, y, w, h
layout(location = 6) in ivec4 a_p3; // base palette row, flags (1 grey, 2 keyed transparency)
layout(location = 7) in vec4 a_rect; // drawn part of the page, in texels: x0, y0, x1, y1
uniform vec2 u_scale;   // target pixels per native pixel
uniform vec2 u_offset;  // target-pixel offset of native x=0,y=0
uniform vec2 u_target;  // target size in pixels
out vec2 v_huv;
out vec2 v_nuv;
flat out ivec4 v_p0;
flat out ivec4 v_p1;
flat out ivec4 v_p2;
flat out ivec4 v_p3;
flat out vec4 v_rect;
void main() {
  v_huv = a_huv;
  v_nuv = a_nuv;
  v_p0 = a_p0;
  v_p1 = a_p1;
  v_p2 = a_p2;
  v_p3 = a_p3;
  v_rect = a_rect;
  vec2 p = a_pos * u_scale + u_offset;
  gl_Position = vec4(p.x / u_target.x * 2.0 - 1.0, 1.0 - p.y / u_target.y * 2.0, 0.0, 1.0);
}`;

export const HD_ASSET_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
in vec2 v_huv;
in vec2 v_nuv;          // native surface-local texel coordinates (may lie in the margin outside the surface)
flat in ivec4 v_p0;
flat in ivec4 v_p1;
flat in ivec4 v_p2;
flat in ivec4 v_p3;
flat in vec4 v_rect;
uniform vec2 u_pageSize;      // page size in texels
uniform sampler2D u_page;     // HD artwork (premultiplied alpha, mipmapped)
uniform usampler2D u_atlas;   // native indices
uniform usampler2D u_remaps;
uniform sampler2D u_palette;  // live palette (256x1)
uniform sampler2D u_basePal;  // artwork palettes (256 x rows)
uniform int u_shadowPass;
uniform vec2 u_hdStep;        // page uv of one native row (shadow coverage taps)
out vec4 o_color;
` + TRANSFER + `
int g_transparency;
int g_palOffset;
int g_palLimit;
int g_options;
int g_remapRow;

int rawAt(ivec2 p) {
  if (p.x < 0 || p.y < 0 || p.x >= v_p2.z || p.y >= v_p2.w) return g_transparency;
  return int(texelFetch(u_atlas, v_p2.xy + p, 0).r);
}

int finalIndex(int raw) {
  int index = raw;
  if (index <= g_palLimit) index = clamp(index + g_palOffset, 0, g_palLimit);
  bool noRemap = ((g_options & 8) != 0) && index > 0x30;
  if ((g_options & 1) != 0 && !noRemap) index = int(texelFetch(u_remaps, ivec2(index, g_remapRow), 0).r);
  return index;
}

vec3 basePal(int i) {
  return texelFetch(u_basePal, ivec2(clamp(i, 0, 255), v_p3.x), 0).rgb;
}
vec3 livePal(int i) {
  return texelFetch(u_palette, ivec2(clamp(i, 0, 255), 0), 0).rgb;
}

void main() {
  g_transparency = v_p0.x;
  int remapOffset = v_p0.y;
  g_palOffset = v_p0.w;
  g_palLimit = v_p1.x;
  int opacity = v_p1.y;
  g_options = v_p1.z;
  g_remapRow = clamp(remapOffset, 0, 18);
  int mode = v_p1.w;
  float op = float(opacity) / 255.0;

  if (u_shadowPass == 1) {
    // Shadow coverage: the sprite squashed to 1/4 height, averaged over the 4 native rows behind each output row.
    float cov = 0.0;
    for (int k = 0; k < 4; k++) {
      vec2 t = (v_huv + vec2(0.0, (float(k) - 1.5) * u_hdStep.y)) * u_pageSize;
      // Taps outside this image's rectangle are empty (they would read neighboring atlas images).
      if (t.y >= v_rect.y && t.y <= v_rect.w) cov += texture(u_page, v_huv + vec2(0.0, (float(k) - 1.5) * u_hdStep.y)).a;
    }
    cov *= 0.25;
    if (cov <= 0.004) discard;
    o_color = vec4(cov * op);
    return;
  }

  // Samples stay inside this image's rectangle: filtering must not blend its edges with the atlas gap (pieces that
  // tile edge to edge would show hairline seams).
  vec2 huv = clamp(v_huv * u_pageSize, v_rect.xy + 0.5, v_rect.zw - 0.5) / u_pageSize;
  vec4 hd = texture(u_page, huv);
  if (hd.a <= 0.002) discard;
  vec3 c = hd.rgb / hd.a;
  bool grey = (v_p3.y & 1) != 0;
  if ((v_p3.y & 2) != 0) {
    // Transparency keyed from this surface's own pixels (bilinear coverage for smooth edges).
    vec2 p = v_nuv - 0.5;
    ivec2 b = ivec2(floor(p));
    vec2 t = p - floor(p);
    float m00 = rawAt(b) != g_transparency ? 1.0 : 0.0;
    float m10 = rawAt(b + ivec2(1, 0)) != g_transparency ? 1.0 : 0.0;
    float m01 = rawAt(b + ivec2(0, 1)) != g_transparency ? 1.0 : 0.0;
    float m11 = rawAt(b + ivec2(1, 1)) != g_transparency ? 1.0 : 0.0;
    hd.a *= mix(mix(m00, m10, t.x), mix(m01, m11, t.x), t.y);
    if (hd.a <= 0.002) discard;
  }
  if (u_shadowPass == 2) {
    // Object mask (remastered lighting): coverage only.
    o_color = vec4(hd.a * op);
    return;
  }
  if (grey) c = vec3(dot(c, LUMA) * 0.55);

  // The native pixel this HD pixel belongs to: the best-matching original color among the 3x3 neighbors.
  ivec2 n = ivec2(floor(v_nuv));
  int best = -1;
  float bestD = 1e9;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      int raw = rawAt(n + ivec2(i, j));
      if (raw == g_transparency) continue;
      float dist = matchDistance(c, basePal(raw)) + 0.03 * float(i * i + j * j);
      if (dist < bestD) {
        bestD = dist;
        best = raw;
      }
    }
  }
  int fin = 0;
  if (best >= 0) {
    fin = finalIndex(best);
    vec3 b = basePal(best), l = livePal(fin);
    if (grey) {
      // Grey versions: only follow brightness changes of the palette (fades).
      c = c * (dot(l, LUMA) + 0.002) / (dot(b, LUMA) + 0.002);
    } else {
      // Blend the mapping of the 2x2 native pixels around this point that belong to the same color zone as the best
      // match, so it does not jump at native pixel borders (live and original ramps differ from shade to shade).
      vec2 p = v_nuv - 0.5;
      ivec2 i0 = ivec2(floor(p));
      vec2 t = p - floor(p);
      vec3 acc = vec3(0.0);
      float wsum = 0.0;
      for (int j = 0; j < 2; j++) {
        for (int i = 0; i < 2; i++) {
          int raw = rawAt(i0 + ivec2(i, j));
          if (raw == g_transparency) continue;
          vec3 bk = basePal(raw);
          float dk = matchDistance(c, bk);
          if (dk > bestD + 0.2) continue;
          float w = (i == 0 ? 1.0 - t.x : t.x) * (j == 0 ? 1.0 - t.y : t.y) * exp(-12.0 * max(dk - bestD, 0.0)) + 1e-4;
          acc += colorTransfer(c, bk, livePal(finalIndex(raw))) * w;
          wsum += w;
        }
      }
      c = wsum > 0.0 ? acc / wsum : colorTransfer(c, b, l);
    }
  }
  float a = hd.a * op;
  if (mode == 4) {
    // Dark tint (Shadow's clones, stasis): translucent, flames (>= 0x60) opaque.
    a *= (best >= 0 && fin >= 0x60) ? 1.0 : 0.6;
  }
  o_color = vec4(c * a, a);
}`;

/**
 * Fills the background cache from the HD background artwork (or its widescreen canvas), through the same palette
 * transfer as sprites, using the (extended) native background for the palette indices.
 */
export const HD_BGART_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
in vec2 v_uv;               // native atlas coordinates of the extended background
flat in ivec4 v_p0;
flat in ivec4 v_p1;
uniform sampler2D u_art;    // HD background (or widescreen canvas), premultiplied, opaque
uniform usampler2D u_atlas;
uniform sampler2D u_palette;
uniform sampler2D u_basePal;
uniform int u_baseRow;
uniform vec4 u_rect;        // extended background in the atlas: x, y, w, h
uniform float u_extNative;  // native pixels of extension on each side of the extended background
uniform int u_wide;         // 1: u_art covers the whole extended background; 0: only the 320 center (mirrored outside)
out vec4 o_color;
` + TRANSFER + `
vec3 basePal(int i) {
  return texelFetch(u_basePal, ivec2(clamp(i, 0, 255), u_baseRow), 0).rgb;
}
vec3 livePal(int i) {
  return texelFetch(u_palette, ivec2(clamp(i, 0, 255), 0), 0).rgb;
}
int rawAt(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(u_rect.zw) - 1);
  return int(texelFetch(u_atlas, ivec2(u_rect.xy) + p, 0).r);
}
void main() {
  vec2 local = v_uv - u_rect.xy;
  vec2 auv;
  if (u_wide != 0) {
    auv = local / u_rect.zw;
  } else {
    float sx = local.x - u_extNative;
    float w = u_rect.z - 2.0 * u_extNative;
    if (sx < 0.0) sx = -sx;
    if (sx > w) sx = 2.0 * w - sx;
    auv = vec2(sx / w, local.y / u_rect.w);
  }
  vec4 art = texture(u_art, auv);
  vec3 c = art.rgb / max(art.a, 1e-4);
  ivec2 n = ivec2(floor(local));
  int best = -1;
  float bestD = 1e9;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      int raw = rawAt(n + ivec2(i, j));
      float dist = matchDistance(c, basePal(raw)) + 0.03 * float(i * i + j * j);
      if (dist < bestD) {
        bestD = dist;
        best = raw;
      }
    }
  }
  c = colorTransfer(c, basePal(best), livePal(best));
  o_color = vec4(c, 1.0);
}`;
