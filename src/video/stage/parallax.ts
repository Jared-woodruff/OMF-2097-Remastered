// The main menu's parallax scene (remastered): the menu's picture as painted layers — sky, city, the two towers, the
// robot (and the robot in the spotlight), two rows of crowd — made with tools/menu-pack and loaded from
// public/hd/menu/. The layers sit at their depths under a slowly drifting camera that also leans toward the mouse,
// and the scene is lit live like the original: a spotlight sweeps over the robot (blending in its lit layer) and the
// tower's top, its beam hangs in the haze with dust in it; searchlights sweep behind the city; stars twinkle and cloud
// shadows drift; the crowd catches a rim of light and fires camera flashes. (The painted crowd is not animated
// person by person: warping its columns to make heads bob sheared the silhouettes like heat haze.)
import type { Backdrop, BackdropView } from './backdrop';

interface LayerInfo {
  name: string;
  file: string;
  /** Native screen rectangle (x, y, w, h). */
  rect: [number, number, number, number];
  size: [number, number];
  /** Parallax depth: 0 = infinitely far, 1 = the nearest layer. */
  depth: number;
  /** A lit version of another layer, shown where the spotlight falls. */
  litOf?: string;
}

interface Manifest {
  version: number;
  source: string;
  covers: [number, number, number, number];
  layers: LayerInfo[];
}

interface Layer extends LayerInfo {
  bitmap: ImageBitmap | null;
  tex: WebGLTexture | null;
}

type Vec2 = [number, number];

/**
 * The spotlight's loop (native screen points on the painted robot, like the original's): the chest, up the raised arm
 * to the hand, across to the tower's top, back over the head, down the legs, along the lowered arm.
 */
const SWEEP: Vec2[] = [
  [120, 92], [106, 80], [93, 63], [80, 44], [62, 30], [52, 20], [70, 46], [100, 70], [126, 78], [114, 110], [98, 138], [117, 142],
  [140, 116], [128, 96],
];
const SWEEP_SECONDS = 1.2;
const POOL_RADIUS = 24;
/** Where the spotlight hangs: off the screen, top left. */
const SPOT_SOURCE: Vec2 = [-130, -70];
const SPOT_COLOR: [number, number, number] = [1.0, 0.95, 0.86];
const RIM_COLOR: [number, number, number] = [0.3, 0.42, 0.72];
/** Native pixels each layer quad reaches past its picture (edge pixels repeat; covers the parallax movement). */
const QUAD_MARGIN = 12;

const QUAD_VS = `#version 300 es
precision highp float;
uniform vec4 u_rect;    // target pixels (top-down): x, y, w, h
uniform vec4 u_uvRect;  // texture coordinates at the rectangle's corners: u0, v0, u1 - u0, v1 - v0
uniform vec2 u_target;
out vec2 v_uv;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 p = u_rect.xy + c * u_rect.zw;
  v_uv = u_uvRect.xy + c * u_uvRect.zw;
  gl_Position = vec4(p.x / u_target.x * 2.0 - 1.0, 1.0 - p.y / u_target.y * 2.0, 0.0, 1.0);
}`;

const NOISE = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
`;

const LAYER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_target;
uniform vec4 u_native;      // target pixel -> native: (px - zw) / xy
uniform vec2 u_uvPerNative; // texture coordinates per native pixel
uniform float u_time;
uniform vec4 u_pool;        // the spotlight's pool: native x, y, radius, strength
uniform int u_poolMode;     // 0 none, 1 brightens the layer, 2 shows the layer only in the pool (a lit layer)
uniform vec3 u_spotColor;
uniform float u_rim;        // crowd: rim light along the tops
uniform vec3 u_rimColor;
uniform float u_flash;      // camera flashes: brightening
uniform float u_sky;        // the sky: twinkling stars and drifting cloud shadows
uniform float u_bright;     // the whole scene's brightness (screens that darken the picture)
out vec4 o_color;
${NOISE}
float luma(vec3 c) { return dot(c, vec3(0.3, 0.55, 0.15)); }
void main() {
  vec2 px = vec2(gl_FragCoord.x, u_target.y - gl_FragCoord.y);
  vec2 nat = (px - u_native.zw) / u_native.xy;
  vec2 uv = v_uv;
  vec4 c = texture(u_tex, uv);
  if (u_sky > 0.0) {
    vec3 soft = textureLod(u_tex, uv, 3.0).rgb;
    float star = max(0.0, luma(c.rgb) - luma(soft) - 0.03);
    float tw = noise(nat * 0.9 + vec2(u_time * 2.1, u_time * 0.7));
    c.rgb += c.rgb * star * (tw - 0.4) * 7.0 * u_sky;
    float shade = noise(nat * vec2(0.012, 0.03) + vec2(u_time * 0.011, 0.0)) * 0.65 + noise(nat * vec2(0.03, 0.07) + vec2(u_time * 0.024, 4.0)) * 0.35;
    c.rgb *= mix(1.0, 0.84 + 0.3 * shade, u_sky);
  }
  float pool = 0.0;
  if (u_pool.w > 0.0) {
    vec2 d = (nat - u_pool.xy) / u_pool.z;
    d.y *= 0.85;
    pool = u_pool.w * smoothstep(1.0, 0.3, length(d));
  }
  if (u_poolMode == 2) {
    // The lit layer, only in the pool, a little brighter and warmer still.
    c *= pool;
    c.rgb *= 1.35 * mix(vec3(1.0), u_spotColor, 0.6);
  }
  else if (u_poolMode == 1) c.rgb += (c.rgb * 1.15 + 0.025 * c.a) * u_spotColor * pool;
  if (u_rim > 0.0) {
    // A faint cool light along the silhouettes' tops, from the stage.
    float above = texture(u_tex, uv - vec2(0.0, 1.1 * u_uvPerNative.y)).a;
    c.rgb += u_rimColor * u_rim * clamp(c.a - above, 0.0, 1.0) * c.a;
  }
  c.rgb += c.rgb * u_flash;
  c.rgb *= u_bright;
  o_color = c;
}`;

const FULL_VS = `#version 300 es
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  gl_Position = vec4(c * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Light beams in the haze (additive): up to 3 cones from a source toward an aim point, in target pixels. */
const BEAM_FS = `#version 300 es
precision highp float;
uniform vec2 u_target;
uniform float u_time;
uniform float u_unit;        // target pixels per native pixel (vertical)
uniform int u_count;
uniform vec4 u_beamA[3];     // source x, y; aim x, y (target pixels)
uniform vec4 u_beamB[3];     // tan of the half angle, intensity, stops at the aim (1) or fades with distance (0), dust
uniform vec3 u_beamColor[3];
uniform float u_bright;
out vec4 o_color;
${NOISE}
void main() {
  vec2 px = vec2(gl_FragCoord.x, u_target.y - gl_FragCoord.y);
  vec2 nat = px / u_unit;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    if (i >= u_count) break;
    vec2 S = u_beamA[i].xy, P = u_beamA[i].zw;
    vec2 axis = P - S;
    float L = length(axis);
    vec2 dir = axis / L;
    vec2 v = px - S;
    float along = dot(v, dir);
    if (along <= 0.0) continue;
    float across = abs(dir.x * v.y - dir.y * v.x);
    float halfW = along * u_beamB[i].x;
    float core = smoothstep(halfW, halfW * 0.2, across);
    float end = u_beamB[i].z > 0.5 ? smoothstep(L * 0.96, L * 0.66, along) * (0.35 + 0.65 * smoothstep(0.0, L, along))
                                   : exp(-along / (L * 0.9));
    float haze = 0.5 + 0.5 * noise(nat * vec2(0.035, 0.05) + vec2(-u_time * 0.06, u_time * 0.025));
    float I = core * end * haze * u_beamB[i].y;
    if (u_beamB[i].w > 0.0) {
      // Dust drifting in the light.
      vec2 g = nat * 0.42 + vec2(u_time * 0.35, -u_time * 0.2);
      vec2 cell = floor(g);
      vec2 f = fract(g) - 0.5 - (vec2(hash(cell + 1.3), hash(cell + 2.7)) - 0.5) * 0.6;
      float mote = hash(cell) > 0.9 ? smoothstep(0.13, 0.0, length(f)) * (0.5 + 0.5 * sin(u_time * 3.0 + hash(cell) * 40.0)) : 0.0;
      I += mote * core * end * u_beamB[i].w;
    }
    acc += u_beamColor[i] * I;
  }
  o_color = vec4(acc * u_bright, 0.0);
}`;

/** Camera flashes: a bright point with a star-shaped glare (additive). */
const GLARE_FS = `#version 300 es
precision highp float;
uniform vec2 u_target;
uniform vec4 u_flash[2];  // x, y (target pixels), radius, strength
uniform float u_bright;
out vec4 o_color;
void main() {
  vec2 px = vec2(gl_FragCoord.x, u_target.y - gl_FragCoord.y);
  float acc = 0.0;
  for (int i = 0; i < 2; i++) {
    if (u_flash[i].w <= 0.0) continue;
    vec2 d = (px - u_flash[i].xy) / u_flash[i].z;
    float r2 = dot(d, d);
    float streak = exp(-abs(d.y) * 55.0) * exp(-abs(d.x) * 2.4) + exp(-abs(d.x) * 55.0) * exp(-abs(d.y) * 2.4);
    acc += (exp(-r2 * 30.0) * 2.0 + exp(-r2 * 3.0) * 0.18 + streak * 0.7) * u_flash[i].w;
  }
  o_color = vec4(vec3(0.95, 0.97, 1.0) * acc * u_bright, 0.0);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string, name: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${name}: ${gl.getShaderInfoLog(s)}`);
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name}: ${gl.getProgramInfoLog(p)}`);
  return p;
}

class Prog {
  private locs = new Map<string, WebGLUniformLocation | null>();
  constructor(readonly gl: WebGL2RenderingContext, readonly prog: WebGLProgram) {}
  loc(n: string): WebGLUniformLocation | null {
    if (!this.locs.has(n)) this.locs.set(n, this.gl.getUniformLocation(this.prog, n));
    return this.locs.get(n)!;
  }
}

/** Catmull-Rom through the sweep's points, eased so the light lingers on each. */
function sweep(t: number): Vec2 {
  const n = SWEEP.length;
  const f = t / SWEEP_SECONDS;
  const i = Math.floor(f);
  const u = f - i;
  const e = u * u * (3 - 2 * u);
  const p = (k: number) => SWEEP[(((i + k) % n) + n) % n];
  const [a, b, c, d] = [p(-1), p(0), p(1), p(2)];
  const at = (k: 0 | 1) => 0.5 * (2 * b[k] + (-a[k] + c[k]) * e + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * e * e + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * e * e * e);
  return [at(0), at(1)];
}

function hash(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export class MenuScene implements Backdrop {
  readonly replaces = 'MAIN.BK/bg';
  readonly hide = ['MAIN.BK/10/', 'MAIN.BK/11/'];
  covers: readonly [number, number] = [0, 320];
  private layers: Layer[] = [];
  private state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  private gl: WebGL2RenderingContext | null = null;
  private layerProg: Prog | null = null;
  private beamProg: Prog | null = null;
  private glareProg: Prog | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  /** How bright the scene shows (1 = as painted): screens that darken the picture's palette darken it. */
  brightness = 1;
  private time = 0;
  private lean: Vec2 = [0, 0];
  private leanTarget: Vec2 = [0, 0];
  private lastUpdate = 0;

  /** Starts loading the layers (from `base`, e.g. 'hd/menu/'); `ready` once they are in. */
  load(base: string): void {
    if (this.state !== 'idle') return;
    this.state = 'loading';
    void (async () => {
      try {
        const manifest = (await (await fetch(`${base}layers.json`)).json()) as Manifest;
        const bitmaps = await Promise.all(manifest.layers.map(async (l) =>
          createImageBitmap(await (await fetch(`${base}${l.file}`)).blob(), { premultiplyAlpha: 'premultiply' })));
        this.layers = manifest.layers.map((l, i) => ({ ...l, bitmap: bitmaps[i], tex: null }));
        this.covers = [manifest.covers[0], manifest.covers[0] + manifest.covers[2]];
        this.state = 'ready';
      } catch (err) {
        this.state = 'failed';
        console.warn('The main menu layers are not available:', err);
      }
    })();
  }

  get ready(): boolean {
    return this.state === 'ready';
  }

  get loading(): boolean {
    return this.state === 'loading';
  }

  /** Resolves once the layers are in (or failed), or after `ms`. */
  whenReady(ms: number): Promise<void> {
    const end = performance.now() + ms;
    return new Promise((resolve) => {
      const check = () => (this.state === 'loading' && performance.now() < end ? setTimeout(check, 30) : resolve());
      check();
    });
  }

  /** Per frame: the clock (seconds) and where the mouse is (-1..1 across and down the screen; null = not over it). */
  update(time: number, pointer: Vec2 | null): void {
    const dt = Math.min(0.1, Math.max(0, time - this.lastUpdate));
    this.lastUpdate = time;
    this.time = time;
    if (pointer) this.leanTarget = pointer;
    const k = 1 - Math.exp(-dt * 2.5);
    this.lean = [this.lean[0] + (this.leanTarget[0] - this.lean[0]) * k, this.lean[1] + (this.leanTarget[1] - this.lean[1]) * k];
  }

  private ensureGl(gl: WebGL2RenderingContext): void {
    if (this.gl === gl && this.layerProg) return;
    this.gl = gl;
    this.layerProg = new Prog(gl, compile(gl, QUAD_VS, LAYER_FS, 'menu-layer'));
    this.beamProg = new Prog(gl, compile(gl, FULL_VS, BEAM_FS, 'menu-beams'));
    this.glareProg = new Prog(gl, compile(gl, FULL_VS, GLARE_FS, 'menu-glare'));
    this.vao = gl.createVertexArray();
  }

  private texture(gl: WebGL2RenderingContext, l: Layer): WebGLTexture | null {
    if (l.tex || !l.bitmap) return l.tex;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, l.bitmap);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    l.bitmap.close();
    l.bitmap = null;
    l.tex = t;
    return t;
  }

  /** The camera's offset at depth 1 (native pixels): a slow drift, leaning toward the mouse. */
  private camera(): Vec2 {
    const t = this.time;
    return [
      Math.sin(t * 0.13) * 4 + Math.sin(t * 0.047 + 2) * 2.5 - this.lean[0] * 6,
      Math.sin(t * 0.09 + 1) * 1.3 - this.lean[1] * 2.5,
    ];
  }

  /** Camera flashes in the crowd now: native position and strength (up to 2). */
  private flashes(): { x: number; y: number; a: number }[] {
    const out: { x: number; y: number; a: number }[] = [];
    const slot = 0.37;
    const t = this.time;
    for (let back = 0; back < 2 && out.length < 2; back++) {
      const s = Math.floor(t / slot) - back;
      if (hash(s, 1) > 0.11) continue;
      const age = t - s * slot - hash(s, 2) * 0.1;
      if (age < 0 || age > 0.16) continue;
      const a = age < 0.04 ? 1 : Math.exp(-(age - 0.04) * 26);
      out.push({ x: -110 + hash(s, 3) * 540, y: 146 + hash(s, 4) * 26, a });
    }
    return out;
  }

  draw(gl: WebGL2RenderingContext, view: BackdropView, target: WebGLFramebuffer): void {
    this.ensureGl(gl);
    const lp = this.layerProg!, bp = this.beamProg!, gp = this.glareProg!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, view.w, view.h);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    const t = this.time;
    const cam = this.camera();
    const flashes = this.flashes();
    const flash = flashes.reduce((m, f) => Math.max(m, f.a), 0);
    const hasLit = this.layers.some((l) => l.litOf === 'robot');
    const robotDepth = this.layers.find((l) => l.name === 'robot')?.depth ?? 0.5;
    const aim = sweep(t);
    const pool: [number, number] = [aim[0] + cam[0] * robotDepth, aim[1] + cam[1] * robotDepth];
    const toPx = (x: number, y: number): Vec2 => [x * view.sx + view.ox, y * view.sy + view.oy];

    const drawLayer = (l: Layer) => {
      const tex = this.texture(gl, l);
      if (!tex) return;
      gl.useProgram(lp.prog);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const drift = l.name === 'sky' ? Math.sin(t * 0.021) * 5 : 0;
      const [x, y, w, h] = l.rect;
      const ox = cam[0] * l.depth + drift, oy = cam[1] * l.depth;
      const m = QUAD_MARGIN;
      const p0 = toPx(x + ox - m, y + oy - m);
      gl.uniform4f(lp.loc('u_rect'), p0[0], p0[1], (w + 2 * m) * view.sx, (h + 2 * m) * view.sy);
      gl.uniform4f(lp.loc('u_uvRect'), -m / w, -m / h, 1 + (2 * m) / w, 1 + (2 * m) / h);
      gl.uniform2f(lp.loc('u_target'), view.w, view.h);
      gl.uniform4f(lp.loc('u_native'), view.sx, view.sy, view.ox, view.oy);
      gl.uniform2f(lp.loc('u_uvPerNative'), 1 / w, 1 / h);
      gl.uniform1f(lp.loc('u_time'), t);
      const crowd = l.name.startsWith('crowd');
      const lit = l.litOf === 'robot';
      const brightens = l.name === 'tower_left' || (l.name === 'robot' && !hasLit);
      gl.uniform4f(lp.loc('u_pool'), pool[0], pool[1], POOL_RADIUS, lit || brightens ? 1 : 0);
      gl.uniform1i(lp.loc('u_poolMode'), lit ? 2 : brightens ? 1 : 0);
      gl.uniform3f(lp.loc('u_spotColor'), ...SPOT_COLOR);
      gl.uniform1f(lp.loc('u_rim'), crowd ? 0.05 : 0);
      gl.uniform3f(lp.loc('u_rimColor'), ...RIM_COLOR);
      gl.uniform1f(lp.loc('u_flash'), crowd ? flash * 0.15 : l.name.startsWith('robot') ? flash * 0.3 : 0);
      gl.uniform1f(lp.loc('u_sky'), l.name === 'sky' ? 1 : 0);
      gl.uniform1f(lp.loc('u_bright'), this.brightness);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(lp.loc('u_tex'), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const beams = (list: { from: Vec2; to: Vec2; spread: number; power: number; stop: boolean; dust: number; color: [number, number, number] }[]) => {
      gl.useProgram(bp.prog);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.uniform2f(bp.loc('u_target'), view.w, view.h);
      gl.uniform1f(bp.loc('u_time'), t);
      gl.uniform1f(bp.loc('u_unit'), view.sy);
      gl.uniform1i(bp.loc('u_count'), list.length);
      gl.uniform1f(bp.loc('u_bright'), this.brightness);
      list.forEach((b, i) => {
        const s = toPx(...b.from), a = toPx(...b.to);
        gl.uniform4f(bp.loc(`u_beamA[${i}]`), s[0], s[1], a[0], a[1]);
        gl.uniform4f(bp.loc(`u_beamB[${i}]`), b.spread, b.power, b.stop ? 1 : 0, b.dust);
        gl.uniform3f(bp.loc(`u_beamColor[${i}]`), ...b.color);
      });
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    for (const l of this.layers) {
      if (l.litOf) continue;
      drawLayer(l);
      if (l.name === 'robot') {
        const litLayer = this.layers.find((x) => x.litOf === 'robot');
        if (litLayer) drawLayer(litLayer);
      }
      if (l.name === 'city') {
        // Searchlights behind the city, sweeping the clouds.
        const d = cam[0] * 0.14;
        const sweepA = Math.sin(t * 0.23) * 0.45 - 0.12, sweepB = Math.sin(t * 0.17 + 2.2) * 0.42 + 0.14;
        beams([
          { from: [150 + d, 146], to: [150 + d + Math.sin(sweepA) * 220, 146 - Math.cos(sweepA) * 220], spread: 0.035, power: 0.22, stop: false, dust: 0, color: [0.8, 0.88, 1] },
          { from: [176 + d, 148], to: [176 + d + Math.sin(sweepB) * 220, 148 - Math.cos(sweepB) * 220], spread: 0.035, power: 0.2, stop: false, dust: 0, color: [0.85, 0.88, 1] },
        ]);
      }
      if (l.name === 'robot') {
        // The spotlight's beam, from the top left onto its pool.
        const src: Vec2 = [SPOT_SOURCE[0] + cam[0] * robotDepth, SPOT_SOURCE[1] + cam[1] * robotDepth];
        const len = Math.hypot(pool[0] - src[0], (pool[1] - src[1]) * 1.2);
        beams([{ from: src, to: pool, spread: (POOL_RADIUS * 0.9) / len, power: 0.16, stop: true, dust: 0.5, color: SPOT_COLOR }]);
      }
    }

    if (flashes.length) {
      gl.useProgram(gp.prog);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.uniform2f(gp.loc('u_target'), view.w, view.h);
      gl.uniform1f(gp.loc('u_bright'), this.brightness);
      for (let i = 0; i < 2; i++) {
        const f = flashes[i];
        const p = f ? toPx(f.x + cam[0] * 0.85, f.y + cam[1] * 0.85) : [0, 0];
        gl.uniform4f(gp.loc(`u_flash[${i}]`), p[0], p[1], 14 * view.sy, f ? f.a : 0);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.disable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(null);
  }
}
