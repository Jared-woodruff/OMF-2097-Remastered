// GPU passes of the remastered effects: particles, light buffers, the object mask blur, the world post pass and
// light shafts (see hd/fxShaders.ts and src/fx/director.ts).
import { PARTICLE_FLOATS, type FxFrame, type FxLight } from '../fx/types';
import type { ArenaGeometry } from '../hd/geometry';
import { FX_BARRIER_FS, FX_LIGHT_FS, FX_LIGHT_VS, FX_PARTICLE_FS, FX_PARTICLE_VS, FX_SHAFTS_FS, FX_WORLD_FS } from '../hd/fxShaders';
import { HD_BLUR_FS, HD_DOWN_FS } from '../hd/shaders';
import { createTexture, FULLSCREEN_VS, Program, RenderTarget } from './glutil';

const LIGHT_FLOATS = 8;
/** Native y the fighting area's edges stand on: the robots' feet (ARENA_FLOOR), their emitters just below. */
const BARRIER_FLOOR = 191;
const MAX_LIGHTS = 64;
/** Lights on the background lit by its shape (per pixel). */
const MAX_BG_LIGHTS = 16;

/** Where native coordinates land in a target: target pixel = native * scale + offset (top-down). */
export interface FxView {
  sx: number;
  sy: number;
  ox: number;
  oy: number;
}

export class FxPasses {
  private particleProg: Program;
  private lightProg: Program;
  private worldProg: Program;
  private shaftsProg: Program;
  private barrierProg: Program;
  private barrierSpots = new Float32Array(8 * 4);
  private barrierRipples = new Float32Array(8);
  private downProg: Program;
  private blurProg: Program;
  private particleVao: WebGLVertexArrayObject;
  private particleVbo: WebGLBuffer;
  private particleCap = 0;
  private lightVao: WebGLVertexArrayObject;
  private lightVbo: WebGLBuffer;
  private lightData = new Float32Array(MAX_LIGHTS * LIGHT_FLOATS);
  private bgLights = new Float32Array(MAX_BG_LIGHTS * 4);
  /** Native pixels per unit of depth (1 / disparity), and how much depth counts in a light's reach (it still lights
   * what is behind the robots, less). */
  geoDepthScale = 50;
  geoDepthReach = 0.55;
  private bgLightCols = new Float32Array(MAX_BG_LIGHTS * 3);
  private emptyVao: WebGLVertexArrayObject;
  private lightAll: RenderTarget | null = null;
  private lightObj: RenderTarget | null = null;
  private maskA: RenderTarget | null = null;
  private maskB: RenderTarget | null = null;
  private shaftTarget: RenderTarget | null = null;
  private readonly floatLights: boolean;
  readonly black: WebGLTexture;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.particleProg = new Program(gl, FX_PARTICLE_VS, FX_PARTICLE_FS, 'fxParticles');
    this.lightProg = new Program(gl, FX_LIGHT_VS, FX_LIGHT_FS, 'fxLights');
    this.worldProg = new Program(gl, FULLSCREEN_VS, FX_WORLD_FS, 'fxWorld');
    this.shaftsProg = new Program(gl, FULLSCREEN_VS, FX_SHAFTS_FS, 'fxShafts');
    this.barrierProg = new Program(gl, FULLSCREEN_VS, FX_BARRIER_FS, 'fxBarrier');
    this.downProg = new Program(gl, FULLSCREEN_VS, HD_DOWN_FS, 'fxDown');
    this.blurProg = new Program(gl, FULLSCREEN_VS, HD_BLUR_FS, 'fxBlur');
    this.floatLights = !!gl.getExtension('EXT_color_buffer_float');

    this.particleVao = gl.createVertexArray()!;
    this.particleVbo = gl.createBuffer()!;
    gl.bindVertexArray(this.particleVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVbo);
    for (let a = 0; a < 3; a++) {
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 4, gl.FLOAT, false, PARTICLE_FLOATS * 4, a * 16);
      gl.vertexAttribDivisor(a, 1);
    }
    this.lightVao = gl.createVertexArray()!;
    this.lightVbo = gl.createBuffer()!;
    gl.bindVertexArray(this.lightVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lightVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.lightData.byteLength, gl.DYNAMIC_DRAW);
    for (let a = 0; a < 2; a++) {
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 4, gl.FLOAT, false, LIGHT_FLOATS * 4, a * 16);
      gl.vertexAttribDivisor(a, 1);
    }
    gl.bindVertexArray(null);
    this.emptyVao = gl.createVertexArray()!;
    this.black = createTexture(gl, 1, 1, { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE }, new Uint8Array([0, 0, 0, 255]));
  }

  private bindTex(unit: number, tex: WebGLTexture, prog: Program, name: string): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    prog.i(name, unit);
  }

  /**
   * Draws the particles onto the bound target (w x h pixels). `glow`: only the light-emitting ones (sparks, flares,
   * embers), for the bloom source.
   */
  drawParticles(fx: FxFrame, view: FxView, w: number, h: number, glow = false): void {
    const n = fx.particleCount;
    if (n <= 0) return;
    const gl = this.gl;
    gl.bindVertexArray(this.particleVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVbo);
    const bytes = n * PARTICLE_FLOATS * 4;
    if (bytes > this.particleCap) {
      this.particleCap = Math.max(bytes, fx.particles.byteLength);
      gl.bufferData(gl.ARRAY_BUFFER, this.particleCap, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, fx.particles, 0, n * PARTICLE_FLOATS);
    const p = this.particleProg;
    p.use();
    p.f2('u_scale', view.sx, view.sy);
    p.f2('u_offset', view.ox, view.oy);
    p.f2('u_target', w, h);
    p.f('u_time', fx.time);
    p.i('u_glow', glow ? 1 : 0);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  /**
   * Adds the fighting area's edges (see FxBarrier) onto the bound target (w x h pixels); `fade` (0..1): how much of
   * the view lies past them (none in the 4:3 view, where they are the screen's edges).
   */
  drawBarrier(fx: FxFrame, view: FxView, w: number, h: number, fade: number): void {
    const b = fx.barrier;
    const level = b.level * fade;
    if (level <= 0.01) return;
    const gl = this.gl;
    const n = Math.min(8, b.spots.length);
    for (let i = 0; i < n; i++) {
      const s = b.spots[i];
      this.barrierSpots.set([s.side, s.y, s.h, s.glow * fade], i * 4);
      this.barrierRipples[i] = s.ripple;
    }
    const p = this.barrierProg;
    p.use();
    p.f2('u_targetSize', w, h);
    p.f2('u_scale', view.sx, view.sy);
    p.f2('u_offset', view.ox, view.oy);
    p.f('u_time', fx.time);
    gl.uniform3f(p.loc('u_color'), b.r, b.g, b.b);
    p.f('u_level', level);
    p.f2('u_x', b.left, b.right);
    p.f('u_floor', BARRIER_FLOOR);
    gl.uniform4fv(p.loc('u_spot'), this.barrierSpots);
    gl.uniform1fv(p.loc('u_ripple'), this.barrierRipples);
    p.i('u_spotCount', n);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  private ensureTargets(w: number, h: number): void {
    const gl = this.gl;
    const lw = Math.max(1, Math.ceil(w / 4)), lh = Math.max(1, Math.ceil(h / 4));
    if (this.lightAll && this.lightAll.w === lw && this.lightAll.h === lh) return;
    for (const t of [this.lightAll, this.lightObj, this.maskA, this.maskB, this.shaftTarget]) t?.dispose();
    const lf = this.floatLights
      ? { internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, filter: gl.LINEAR }
      : { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR };
    const rgba = { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR };
    this.lightAll = new RenderTarget(gl, lw, lh, [lf]);
    this.lightObj = new RenderTarget(gl, lw, lh, [lf]);
    this.maskA = new RenderTarget(gl, lw, lh, [rgba]);
    this.maskB = new RenderTarget(gl, lw, lh, [rgba]);
    this.shaftTarget = new RenderTarget(gl, lw, lh, [rgba]);
  }

  /** Scale of values stored in the light buffers (8-bit buffers store a quarter to leave headroom). */
  private get lightStore(): number {
    return this.floatLights ? 1 : 0.25;
  }

  /** Renders the frame's lights into the two light buffers (everything / robots only). */
  renderLights(fx: FxFrame, view: FxView, w: number, h: number): void {
    const gl = this.gl;
    this.ensureTargets(w, h);
    const lw = this.lightAll!.w, lh = this.lightAll!.h;
    const kx = lw / w, ky = lh / h;
    const p = this.lightProg;
    for (const [target, objectsOnly] of [[this.lightAll!, false], [this.lightObj!, true]] as const) {
      target.bind();
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const n = this.packLights(fx.lights, objectsOnly);
      if (n === 0) continue;
      gl.bindVertexArray(this.lightVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lightVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.lightData, 0, n * LIGHT_FLOATS);
      p.use();
      p.f2('u_scale', view.sx * kx, view.sy * ky);
      p.f2('u_offset', view.ox * kx, view.oy * ky);
      p.f2('u_target', lw, lh);
      p.f('u_outScale', this.lightStore);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    }
  }

  private packLights(lights: FxLight[], objectsOnly: boolean): number {
    let n = 0;
    const d = this.lightData;
    for (const l of lights) {
      if (l.objectsOnly !== objectsOnly || n >= MAX_LIGHTS) continue;
      if (l.r + l.g + l.b < 0.005) continue;
      const o = n * LIGHT_FLOATS;
      d[o] = l.x;
      d[o + 1] = l.y;
      d[o + 2] = l.radius;
      d[o + 3] = 0;
      d[o + 4] = l.r;
      d[o + 5] = l.g;
      d[o + 6] = l.b;
      d[o + 7] = 0;
      n++;
    }
    return n;
  }

  /** Low-resolution blurred copy of the robots' coverage mask (for the rim light's edge normals). */
  blurMask(mask: WebGLTexture, w: number, h: number): void {
    const gl = this.gl;
    this.ensureTargets(w, h);
    const a = this.maskA!, b = this.maskB!;
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.emptyVao);
    const down = this.downProg;
    down.use();
    a.bind();
    this.bindTex(0, mask, down, 'u_src');
    down.f4('u_srcRect', 0, 0, 1, 1);
    down.f2('u_texel', 1 / w, 1 / h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const blur = this.blurProg;
    blur.use();
    b.bind();
    this.bindTex(0, a.textures[0], blur, 'u_src');
    blur.f2('u_dir', 1 / a.w, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    a.bind();
    this.bindTex(0, b.textures[0], blur, 'u_src');
    blur.f2('u_dir', 0, 1 / a.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * World post pass: `src` -> bound `dst` (same size). `mask` is the robots' coverage at full resolution (or null
   * when lighting is off). `geo`: the arena's geometry drawn like the background (aligned with `src`) and its map,
   * to light the background by its shape.
   */
  worldPost(fx: FxFrame, src: RenderTarget, dst: RenderTarget, view: FxView, mask: WebGLTexture | null,
    geo: { buf: WebGLTexture; map: ArenaGeometry } | null = null): void {
    const gl = this.gl;
    const w = src.w, h = src.h;
    this.ensureTargets(w, h);
    dst.bind();
    gl.disable(gl.BLEND);
    const p = this.worldProg;
    p.use();
    this.bindTex(0, src.textures[0], p, 'u_scene');
    const lighting = mask !== null;
    this.bindTex(1, lighting ? this.lightAll!.textures[0] : this.black, p, 'u_lightAll');
    this.bindTex(2, lighting ? this.lightObj!.textures[0] : this.black, p, 'u_lightObj');
    this.bindTex(3, mask ?? this.black, p, 'u_mask');
    this.bindTex(4, lighting ? this.maskA!.textures[0] : this.black, p, 'u_maskBlur');
    p.i('u_lighting', lighting ? 1 : 0);
    p.f('u_lightScale', 1 / this.lightStore);
    p.f2('u_targetSize', w, h);
    p.f2('u_scale', view.sx, view.sy);
    p.f2('u_offset', view.ox, view.oy);
    const rim = fx.rim;
    if (rim) {
      gl.uniform3f(p.loc('u_rim'), rim.x, rim.y, 1);
      gl.uniform3f(p.loc('u_rimColor'), rim.r, rim.g, rim.b);
      gl.uniform3f(p.loc('u_ambient'), rim.ambR, rim.ambG, rim.ambB);
    } else {
      gl.uniform3f(p.loc('u_rim'), 0, 0, 0);
      gl.uniform3f(p.loc('u_rimColor'), 0, 0, 0);
      gl.uniform3f(p.loc('u_ambient'), 1, 1, 1);
    }
    const shocks = new Float32Array(16), widths = new Float32Array(4);
    const ns = Math.min(4, fx.shockwaves.length);
    for (let i = 0; i < ns; i++) {
      const s = fx.shockwaves[i];
      shocks.set([s.x, s.y, s.radius, s.strength], i * 4);
      widths[i] = Math.max(1, s.width);
    }
    gl.uniform4fv(p.loc('u_shock'), shocks);
    gl.uniform1fv(p.loc('u_shockW'), widths);
    p.i('u_shockCount', ns);
    const haze = new Float32Array(24), hazeStr = new Float32Array(6);
    const nh = Math.min(6, fx.haze.length);
    for (let i = 0; i < nh; i++) {
      const r = fx.haze[i];
      haze.set([r.x0, r.y0, r.x1, r.y1], i * 4);
      hazeStr[i] = r.strength;
    }
    gl.uniform4fv(p.loc('u_haze'), haze);
    gl.uniform1fv(p.loc('u_hazeStr'), hazeStr);
    p.i('u_hazeCount', nh);
    p.f('u_time', fx.time);
    p.f('u_flash', fx.flash);
    p.f('u_chroma', fx.chroma);
    p.f('u_desat', fx.desaturate);
    gl.uniform3f(p.loc('u_zoom'), fx.zoomX, fx.zoomY, Math.max(1, fx.zoom));
    p.f2('u_shake', fx.shakeX, fx.shakeY);
    const nl = lighting && geo ? this.packBgLights(fx.lights, geo.map) : 0;
    p.i('u_geoOn', nl > 0 ? 1 : 0);
    this.bindTex(5, nl > 0 ? geo!.buf : this.black, p, 'u_geoBuf');
    if (nl > 0) {
      gl.uniform3f(p.loc('u_geoDepth'), geo!.map.far, this.geoDepthScale, this.geoDepthReach);
      gl.uniform4fv(p.loc('u_bgLight'), this.bgLights);
      gl.uniform3fv(p.loc('u_bgLightCol'), this.bgLightCols);
    }
    p.i('u_bgLightCount', nl);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * The lights on the background (the strongest MAX_BG_LIGHTS of them): positions, reach and depth, colors. A light
   * from the fight is at the robots' depth; one on the scenery (an arena's lamp) just in front of what it is on.
   */
  private packBgLights(lights: FxLight[], map: ArenaGeometry): number {
    const list = lights.filter((l) => !l.objectsOnly && l.r + l.g + l.b > 0.005)
      .sort((a, b) => (b.r + b.g + b.b) * b.radius - (a.r + a.g + a.b) * a.radius)
      .slice(0, MAX_BG_LIGHTS);
    const plane = 1 / (map.floor + map.far);
    list.forEach((l, i) => {
      const depth = l.onSurface ? 1 / (map.disparityAt(l.x, l.y) + map.far) - 0.1 : plane;
      this.bgLights.set([l.x, l.y, l.radius, depth], i * 4);
      this.bgLightCols.set([l.r, l.g, l.b], i * 3);
    });
    return list.length;
  }

  /** Light shafts from `src` (the finished world image); returns the low-resolution result, or null without shafts. */
  renderShafts(fx: FxFrame, src: RenderTarget, view: FxView): WebGLTexture | null {
    if (fx.shafts.length === 0) return null;
    const gl = this.gl;
    const w = src.w, h = src.h;
    this.ensureTargets(w, h);
    const t = this.shaftTarget!;
    t.bind();
    gl.disable(gl.BLEND);
    const p = this.shaftsProg;
    p.use();
    this.bindTex(0, src.textures[0], p, 'u_src');
    const data = new Float32Array(8);
    const n = Math.min(2, fx.shafts.length);
    for (let i = 0; i < n; i++) {
      const s = fx.shafts[i];
      const px = s.x * view.sx + view.ox, py = s.y * view.sy + view.oy;
      data.set([px / w, 1 - py / h, s.strength, 0.4], i * 4);
    }
    gl.uniform4fv(p.loc('u_shaft'), data);
    p.i('u_shaftCount', n);
    p.f2('u_aspect', w / h, 1);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return t.textures[0];
  }
}
