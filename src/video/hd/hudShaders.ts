// Remastered HUD: progress bars (health, endurance, pilot stats) drawn as vector graphics from their description
// (HudBar in video/draw.ts) in the colors of the original theme: a beveled frame, a dark glass track, a glossy fill
// and a trail that shows recent damage. The original warnings (flashing endurance track) become smooth pulses.

export const HUD_BAR_VS = `#version 300 es
precision highp float;
uniform vec2 u_scale;   // target pixels per native pixel
uniform vec2 u_offset;  // target-pixel offset of native x=0,y=0
uniform vec2 u_target;  // target size in pixels
uniform vec4 u_rect;    // bar x, y, w, h (native pixels)
uniform float u_margin; // native pixels drawn around the bar (shadow, glow)
out vec2 v_p;           // native pixels from the bar's top-left corner
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  v_p = mix(vec2(-u_margin), u_rect.zw + u_margin, corner);
  vec2 p = (u_rect.xy + v_p) * u_scale + u_offset;
  gl_Position = vec4(p.x / u_target.x * 2.0 - 1.0, 1.0 - p.y / u_target.y * 2.0, 0.0, 1.0);
}`;

export const HUD_BAR_FS = `#version 300 es
precision highp float;
in vec2 v_p;
uniform vec4 u_rect;
uniform float u_value;      // 0..1
uniform float u_trail;      // 0..1, at least u_value
uniform float u_dir;        // 1: filled from the right end
uniform vec3 u_col[7];      // frame top-left, frame bottom-right, track, flashing track, fill top-left, fill bottom-right, fill
uniform float u_trackAlpha; // 0: see-through track
uniform float u_flash;      // 0..1 flashing track (low endurance)
uniform float u_low;        // 0..1 low health pulse
out vec4 o_color;

float box(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// Premultiplied "over".
void over(inout vec4 dst, vec3 c, float a) {
  dst = vec4(c * a, a) + dst * (1.0 - a);
}

void main() {
  vec2 size = u_rect.zw;
  vec2 c = v_p - size * 0.5;
  float aa = max(fwidth(v_p.x), 0.02);           // native pixels per screen pixel
  float r = min(1.1, size.y * 0.28);             // corner radius
  float frame = size.y >= 6.0 ? 0.8 : 0.65;      // a slim version of the original's one pixel bevel
  vec4 o = vec4(0.0);

  float dOuter = box(c, size * 0.5, r);
  vec2 ip = v_p - frame;                         // inside the frame
  vec2 isz = size - 2.0 * frame;
  float dInner = box(c, isz * 0.5, max(r - frame * 0.6, 0.2));
  float inInner = 1.0 - smoothstep(-0.5 * aa, 0.5 * aa, dInner);
  float y01 = clamp(ip.y / isz.y, 0.0, 1.0);
  // What the frame and its shadow cover: the whole bar, or only the ring around a see-through track.
  float ring = mix(1.0 - inInner, 1.0, u_trackAlpha);

  // Soft drop shadow (keeps the bars readable on bright arenas), and a glow while a warning pulses.
  o.a = 0.5 * ring * (1.0 - smoothstep(-0.4, 1.5, box(c - vec2(0.3, 0.7), size * 0.5, r)));
  float glow = max(u_flash * 0.8, u_low * 0.95) * exp(-max(dOuter, 0.0) * 1.1) * step(0.0, dOuter);
  vec3 glowCol = u_flash > 0.0 ? u_col[3] : u_col[6];
  o = vec4(glowCol * glow, glow * 0.6) + o * (1.0 - glow * 0.6);

  // Frame: dark top and left edges, bright bottom and right edges like the original bevel, blended at the corners.
  float inFrame = 1.0 - smoothstep(-0.5 * aa, 0.5 * aa, dOuter);
  float nearTL = min(v_p.x, v_p.y), nearBR = min(size.x - v_p.x, size.y - v_p.y);
  vec3 fc = mix(u_col[0], u_col[1] * 0.85, smoothstep(-0.7, 0.7, nearTL - nearBR));
  fc += 0.1 * (1.0 - smoothstep(-0.9, -0.2, dOuter)) * step(v_p.y, size.y * 0.5);   // thin highlight on the upper rim
  over(o, fc, inFrame * ring);

  // Track: dark glass, shaded under the top edge, with fine diagonal lines; pulses toward the flash color.
  vec3 track = mix(u_col[2], u_col[3], u_flash);
  track *= mix(0.4, 0.78, smoothstep(0.0, 1.0, y01)) * (0.93 + 0.07 * sin((v_p.x + v_p.y) * 2.2));
  over(o, track, inInner * u_trackAlpha);

  // Fill and trail, measured from the anchored end.
  float ux = u_dir > 0.5 ? isz.x - ip.x : ip.x;
  float fillEnd = u_value * isz.x;
  float trailEnd = u_trail * isz.x;
  // (Empty fills and trails draw nothing, not an antialiased sliver at their start.)
  float beforeFill = (1.0 - smoothstep(-0.5 * aa, 0.5 * aa, ux - fillEnd)) * step(0.001, u_value);
  float inTrail = inInner * (1.0 - smoothstep(-0.5 * aa, 0.5 * aa, ux - trailEnd)) * (1.0 - beforeFill) *
    step(0.001, u_trail - u_value);
  vec3 trailCol = mix(vec3(1.0, 0.93, 0.78), u_col[6], 0.22) * mix(1.05, 0.78, y01);
  over(o, trailCol, inTrail * 0.92);

  // Glossy fill: the original's bevel colors as a vertical gradient, a glass highlight on top, a bright leading edge.
  vec3 top = mix(u_col[4], vec3(1.0), 0.2);
  vec3 fill = y01 < 0.5 ? mix(top, u_col[6], smoothstep(0.0, 0.5, y01)) : mix(u_col[6], u_col[5], smoothstep(0.5, 1.0, y01));
  fill += vec3(0.22) * (1.0 - smoothstep(0.06, 0.45, y01));
  fill = mix(fill, fill * 1.35 + 0.12, u_low);
  float moving = step(0.001, u_value) * step(u_value, 0.999);
  fill += vec3(0.3) * exp(-abs(ux - fillEnd) / 0.45) * moving;
  over(o, fill, inInner * beforeFill);

  o_color = o;
}`;
