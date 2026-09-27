import { BlendMode, drawList, FLIP_HORIZONTAL, FLIP_VERTICAL, NATIVE_H, NATIVE_W, TAG_HAR, TAG_HUD, WIDE_AMBIENT, WIDE_MIRROR, type DrawCmd } from '../draw';
import type { FxFrame } from '../fx/types';
import { FxPasses, type FxView } from './fxPasses';
import { vga } from '../vga';
import { fitRemaps, paletteHash, type RemapFit } from '../hd/analysis';
import { EXT_MAX, extendedBackground } from '../hd/extend';
import { HD_AMBIENT_FS, HD_BG_FS, HD_BGCACHE_FS, HD_BLUR_FS, HD_BRIGHT_FS, HD_DELTA_FS, HD_DOWN_FS, HD_GLOW_ADD_FS, HD_POST_FS, HD_SHADOWRATIO_FS, HD_SPRITE_FS, HD_SPRITE_VS, HD_UP_FS } from '../hd/shaders';
import type { Surface } from '../surface';
import { hdAssets, type HdImage } from '../hd/assets';
import { HD_ASSET_FS, HD_ASSET_VS, HD_BGART_FS } from '../hd/artShaders';
import { IndexAtlas, type AtlasRect } from './atlas';
import { createTexture, FULLSCREEN_VS, Program, RenderTarget } from './glutil';
import { DELTA_FS, PRESENT_FS, RESOLVE_FS, SPRITE_FS, SPRITE_VS } from './shaders';

const MAX_QUADS = 4096;
const VERTEX_BYTES = 32;
/** HD artwork quads: pos, HD uv, native uv (floats), 4 x ivec4 (shorts), drawn page rect (4 floats, texels). */
const HD_VERTEX_BYTES = 72;
const MAX_HD_QUADS = 2048;
/** Width/height ratio of one native pixel when the 320x200 image is shown at 4:3. */
const PIXEL_ASPECT = (4 / 320) / (3 / 200);

/** Tunables of the HD reconstruction (exposed for experimentation). */
export interface HdTuning {
  /** Bilateral range sigma (0..1 RGB units) for sprites / backgrounds. */
  spriteSigma: number;
  bgSigma: number;
  /** Edge-rule color threshold (luma-weighted key units, 0..48) for sprites / backgrounds. */
  spriteDiff: number;
  bgDiff: number;
}

export type ScaleMode = 'sharp' | 'smooth' | 'crt';
export type RenderMode = 'classic' | 'remastered';

export interface PresentOptions {
  mode: RenderMode;
  scaleMode: ScaleMode;
  /** Classic mode: fill widescreen displays with the extended background instead of black bars. */
  classicWidescreen: boolean;
  bloom: boolean;
  /**
   * Remastered internal resolution: 'auto' measures the GPU time of each frame and lowers the render scale
   * (then upscales smoothly) when the GPU cannot keep up; 'full' always renders at display resolution.
   */
  hdResolution: 'auto' | 'full';
}

interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Native pixels shown on each side of the 320-wide playfield. */
  ext: number;
  /** Target pixels per native pixel. */
  sx: number;
  sy: number;
}

/**
 * Renders the frame's draw list in one of two ways:
 *  - classic: composites into an indexed 320x200 framebuffer exactly like the original VGA pipeline
 *    (palette + remap-table effects), then scales it to the screen (sharp / smooth / CRT);
 *  - remastered: reconstructs every sprite and background at the display resolution (see hd/shaders.ts),
 *    applies shadows and glows with the original remap tables (exact shadow ratios on the background, a
 *    native-resolution remap delta for glows), extends fights for widescreen (mirrored, blurred scene) and
 *    fills the sides of other screens with an ambient glow, interpolates motion, and adds bloom + vignette.
 */
export class GLRenderer {
  readonly gl: WebGL2RenderingContext;
  private spriteProg: Program;
  private resolveProg: Program;
  private presentProg: Program;
  private hdSpriteProg: Program;
  private hdBgCacheProg: Program;
  private hdShadowRatioProg: Program;
  private hdBgProg: Program;
  private hdBrightProg: Program;
  private hdBlurProg: Program;
  private hdPostProg: Program;
  private hdDownProg: Program;
  private deltaProg: Program;
  private hdDeltaProg: Program;
  /** Remap-effect color delta at native resolution (see DELTA_FS). */
  private deltaTarget: RenderTarget | null = null;
  private hdAmbientProg: Program;
  private hdAssetProg: Program;
  private hdBgArtProg: Program;
  private hdVao: WebGLVertexArrayObject;
  private hdVbo: WebGLBuffer;
  private hdData = new ArrayBuffer(MAX_HD_QUADS * 4 * HD_VERTEX_BYTES);
  private hdF32 = new Float32Array(this.hdData);
  private hdI16 = new Int16Array(this.hdData);
  /** HD artwork per draw command of the current frame (null: procedural upscaling). */
  private hdImages: (HdImage | null)[] = [];
  /** Ambient fill targets: 256x192 downsample, then 64x48 blur ping-pong. */
  private ambA: RenderTarget | null = null;
  private ambB: RenderTarget | null = null;
  private ambC: RenderTarget | null = null;
  private atlas: IndexAtlas;
  private paletteTex: WebGLTexture;
  private remapTex: WebGLTexture;
  private dummyFrac: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private ibo: WebGLBuffer;
  private vdata = new ArrayBuffer(MAX_QUADS * 4 * VERTEX_BYTES);
  private vf32 = new Float32Array(this.vdata);
  private vi16 = new Int16Array(this.vdata);
  private quadModes = new Uint8Array(MAX_QUADS);
  private quadCmd: (DrawCmd | null)[] = new Array(MAX_QUADS).fill(null);
  private indexedTarget: RenderTarget | null = null;
  private resolvedTarget: RenderTarget | null = null;
  private hdTarget: RenderTarget | null = null;
  private bloomA: RenderTarget | null = null;
  private bloomB: RenderTarget | null = null;
  /** Wider bloom levels (1/8, 1/16, 1/32 of the HD target). */
  private bloomLevels: RenderTarget[] = [];
  private hdUpProg: Program;
  private hdGlowAddProg: Program;
  private bgCache: RenderTarget | null = null;
  /** Per-level shadow color ratios of the extended background (native resolution). */
  private bgRatio: RenderTarget | null = null;
  /** Screen-space HAR shadow coverage (HD resolution). */
  private shadowTarget: RenderTarget | null = null;
  /** Remastered effects: the post-processed world image, and the robots' coverage (lighting). */
  private worldTarget: RenderTarget | null = null;
  private maskTarget: RenderTarget | null = null;
  private fxPasses: FxPasses;
  /** This frame's remastered effects (set by the host before render()), or null. */
  fx: FxFrame | null = null;
  /** Remastered text: 0 smooth (reconstructed like the sprites), 1 crisp pixel font. */
  textStyle = 0;
  private bgCacheKey = '';
  private emptyVao: WebGLVertexArrayObject;
  private paletteVersion = -1;
  private remapVersion = -1;
  private remapFit: RemapFit | null = null;
  private remapFitHash = -1;
  private paletteRGBA = new Uint8Array(256 * 4);
  private remapData = new Uint8Array(256 * 19);
  private rects: (AtlasRect | null)[] = [];
  private usedIndices = new WeakMap<Surface, { version: number; list: Uint8Array }>();
  options: PresentOptions = { mode: 'remastered', scaleMode: 'sharp', classicWidescreen: false, bloom: true, hdResolution: 'auto' };
  /** Dynamic resolution: maximum screen pixels per native pixel for the remastered renderer. */
  private hdMaxScale = Infinity;
  private timerExt: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  private pendingQuery: WebGLQuery | null = null;
  private gpuSamples: number[] = [];
  /** Average GPU time of the remastered frames measured recently (ms), for diagnostics. */
  gpuFrameMs = 0;
  /** Integrated / mobile / software GPU (by renderer string). */
  readonly isLowEndGpu: boolean;
  tuning: HdTuning = { spriteSigma: 0.09, bgSigma: 0.14, spriteDiff: 3, bgDiff: 3 };

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.spriteProg = new Program(gl, SPRITE_VS, SPRITE_FS, 'sprite');
    this.resolveProg = new Program(gl, FULLSCREEN_VS, RESOLVE_FS, 'resolve');
    this.presentProg = new Program(gl, FULLSCREEN_VS, PRESENT_FS, 'present');
    this.hdSpriteProg = new Program(gl, HD_SPRITE_VS, HD_SPRITE_FS, 'hdSprite');
    this.hdBgCacheProg = new Program(gl, HD_SPRITE_VS, HD_BGCACHE_FS, 'hdBgCache');
    this.hdShadowRatioProg = new Program(gl, HD_SPRITE_VS, HD_SHADOWRATIO_FS, 'hdShadowRatio');
    this.hdBgProg = new Program(gl, FULLSCREEN_VS, HD_BG_FS, 'hdBg');
    this.hdBrightProg = new Program(gl, FULLSCREEN_VS, HD_BRIGHT_FS, 'hdBright');
    this.hdBlurProg = new Program(gl, FULLSCREEN_VS, HD_BLUR_FS, 'hdBlur');
    this.hdPostProg = new Program(gl, FULLSCREEN_VS, HD_POST_FS, 'hdPost');
    this.hdDownProg = new Program(gl, FULLSCREEN_VS, HD_DOWN_FS, 'hdDown');
    this.hdUpProg = new Program(gl, FULLSCREEN_VS, HD_UP_FS, 'hdUp');
    this.hdGlowAddProg = new Program(gl, FULLSCREEN_VS, HD_GLOW_ADD_FS, 'hdGlowAdd');
    this.deltaProg = new Program(gl, FULLSCREEN_VS, DELTA_FS, 'delta');
    this.hdDeltaProg = new Program(gl, FULLSCREEN_VS, HD_DELTA_FS, 'hdDelta');
    this.hdAmbientProg = new Program(gl, FULLSCREEN_VS, HD_AMBIENT_FS, 'hdAmbient');
    this.hdAssetProg = new Program(gl, HD_ASSET_VS, HD_ASSET_FS, 'hdAsset');
    this.hdBgArtProg = new Program(gl, HD_SPRITE_VS, HD_BGART_FS, 'hdBgArt');
    this.atlas = new IndexAtlas(gl, 4096);
    this.fxPasses = new FxPasses(gl);
    this.paletteTex = createTexture(gl, 256, 1, { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE });
    this.remapTex = createTexture(gl, 256, 19, { internalFormat: gl.R8UI, format: gl.RED_INTEGER, type: gl.UNSIGNED_BYTE });
    this.dummyFrac = createTexture(gl, 1, 1, { internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE }, new Uint8Array(1));

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.vdata.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, VERTEX_BYTES, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, VERTEX_BYTES, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribIPointer(2, 4, gl.SHORT, VERTEX_BYTES, 16);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribIPointer(3, 4, gl.SHORT, VERTEX_BYTES, 24);
    const idx = new Uint16Array(MAX_QUADS * 6);
    for (let q = 0; q < MAX_QUADS; q++) idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
    this.ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.emptyVao = gl.createVertexArray()!;

    // HD artwork quads (same index buffer).
    this.hdVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.hdVao);
    this.hdVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.hdVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.hdData.byteLength, gl.DYNAMIC_DRAW);
    for (let a = 0; a < 3; a++) {
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 2, gl.FLOAT, false, HD_VERTEX_BYTES, a * 8);
    }
    for (let a = 0; a < 4; a++) {
      gl.enableVertexAttribArray(3 + a);
      gl.vertexAttribIPointer(3 + a, 4, gl.SHORT, HD_VERTEX_BYTES, 24 + a * 8);
    }
    gl.enableVertexAttribArray(7);
    gl.vertexAttribPointer(7, 4, gl.FLOAT, false, HD_VERTEX_BYTES, 56);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bindVertexArray(null);

    // GPU timing for dynamic resolution (not available everywhere; then only the heuristic below applies).
    this.timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2') as typeof this.timerExt;
    // Start integrated / mobile GPUs at a moderate internal resolution; the timing refines it.
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    this.isLowEndGpu = /intel|mali|adreno|powervr|apple gpu|llvmpipe|swiftshader|basic render/i.test(gpu);
    if (this.isLowEndGpu) this.hdMaxScale = 4;
  }

  /** Reads back finished GPU timings and adapts the remastered render scale (keeps GPU time near 4..9 ms). */
  private updateDynamicResolution(displayScale: number): void {
    const gl = this.gl;
    const ext = this.timerExt;
    if (!ext || !this.pendingQuery) return;
    if (!gl.getQueryParameter(this.pendingQuery, gl.QUERY_RESULT_AVAILABLE)) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    const ns = gl.getQueryParameter(this.pendingQuery, gl.QUERY_RESULT) as number;
    gl.deleteQuery(this.pendingQuery);
    this.pendingQuery = null;
    if (disjoint) return;
    this.gpuSamples.push(ns / 1e6);
    if (this.gpuSamples.length < 30) return;
    const avg = this.gpuSamples.reduce((a, b) => a + b, 0) / this.gpuSamples.length;
    this.gpuSamples.length = 0;
    this.gpuFrameMs = avg;
    if (this.options.hdResolution !== 'auto') return;
    const current = Math.min(this.hdMaxScale, displayScale);
    if (avg > 9) this.hdMaxScale = Math.max(2, current * Math.max(0.6, Math.sqrt(7 / avg)));
    else if (avg < 4 && current < displayScale) this.hdMaxScale = current * 1.15;
    if (this.hdMaxScale >= displayScale) this.hdMaxScale = Infinity;
  }

  /**
   * Remastered effects on the world image: particles, the light buffers and robot mask (lighting), then the world
   * post pass into `worldTarget`, which is returned.
   */
  private renderWorldFx(fx: FxFrame, view: FxView, vp: Viewport, count: number, shakeX: number, shakeY: number): RenderTarget {
    const gl = this.gl;
    const target = this.hdTarget!;
    const w = target.w, h = target.h;
    if (!this.worldTarget || this.worldTarget.w !== w || this.worldTarget.h !== h) {
      this.worldTarget?.dispose();
      this.maskTarget?.dispose();
      this.worldTarget = new RenderTarget(gl, w, h, [{ internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR }]);
      this.maskTarget = new RenderTarget(gl, w, h, [{ internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR }]);
    }
    // Particles belong to the world: lit, distorted and zoomed with it.
    target.bind();
    this.fxPasses.drawParticles(fx, view, w, h);
    let mask: WebGLTexture | null = null;
    if (fx.rim || fx.lights.length > 0) {
      this.fxPasses.renderLights(fx, view, w, h);
      const m = this.maskTarget!;
      m.bind();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.drawSprites(vp, count, shakeX, shakeY, (c) => c.tag !== TAG_HAR || c.mode === BlendMode.SHADOW, 2);
      this.fxPasses.blurMask(m.textures[0], w, h);
      mask = m.textures[0];
    }
    this.fxPasses.worldPost(fx, target, this.worldTarget, view, mask);
    return this.worldTarget;
  }

  /**
   * Adds wide, soft glow to the bloom buffer: downsamples it into smaller levels and adds them back up (tent
   * filtered), so bright lights get a large halo while keeping the tight glow around them.
   */
  private bloomWide(a: RenderTarget): void {
    const gl = this.gl;
    const levels = this.bloomLevels;
    if (levels.length === 0) return;
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.emptyVao);
    const down = this.hdDownProg;
    down.use();
    let src = a;
    for (const t of levels) {
      t.bind();
      this.bindTex(0, src.textures[0], down, 'u_src');
      down.f4('u_srcRect', 0, 0, 1, 1);
      down.f2('u_texel', 0.5 / src.w, 0.5 / src.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = t;
    }
    const up = this.hdUpProg;
    up.use();
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = levels.length - 1; i >= 0; i--) {
      const from = levels[i];
      const to = i > 0 ? levels[i - 1] : a;
      to.bind();
      this.bindTex(0, from.textures[0], up, 'u_src');
      up.f2('u_texel', 1 / from.w, 1 / from.h);
      up.f('u_weight', i > 0 ? 0.8 : 0.42);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);
  }

  /** Called on scene changes so stale surfaces are evicted from the atlas. */
  resetAtlas(): void {
    this.atlas.reset();
  }

  // ---------------------------------------------------------------------------------
  // Shared state

  /** Whether this frame goes through the remastered path. */
  private get remastered(): boolean {
    return this.options.mode === 'remastered' && !(drawList.framebufferOptions & 1);
  }

  private syncPaletteAndRemaps(): void {
    const gl = this.gl;
    // The remastered path uses the palette without whole-screen fades (applied at the end, see vga.undarkened).
    const hd = this.remastered;
    const version = vga.paletteVersion * 2 + (hd ? 1 : 0);
    if (version !== this.paletteVersion) {
      this.paletteVersion = version;
      const c = (hd ? vga.undarkened : vga.current).colors;
      for (let i = 0; i < 256; i++) {
        this.paletteRGBA[i * 4] = c[i * 3];
        this.paletteRGBA[i * 4 + 1] = c[i * 3 + 1];
        this.paletteRGBA[i * 4 + 2] = c[i * 3 + 2];
        this.paletteRGBA[i * 4 + 3] = 255;
      }
      gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.paletteRGBA);
    }
    if (vga.remapVersion !== this.remapVersion) {
      this.remapVersion = vga.remapVersion;
      for (let t = 0; t < 19; t++) this.remapData.set(vga.remaps.tables[t], t * 256);
      gl.bindTexture(gl.TEXTURE_2D, this.remapTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 19, gl.RED_INTEGER, gl.UNSIGNED_BYTE, this.remapData);
      this.remapFitHash = -1;
    }
  }

  /** HD-only: remap-effect fits follow the scene's base palette. */
  private syncHdTables(): void {
    const h = paletteHash(vga.base);
    if (this.remapFitHash !== h) {
      this.remapFitHash = h;
      this.remapFit = fitRemaps(vga.base, vga.remaps);
    }
  }

  /** Makes every surface of this frame resident in the atlas (repacking once if it overflows). */
  private resolveAtlas(count: number, extra: Surface | null): AtlasRect | null {
    this.atlas.beginFrame();
    for (let attempt = 0; attempt < 2; attempt++) {
      let ok = true;
      let extraRect: AtlasRect | null = null;
      if (extra) {
        extraRect = this.atlas.get(extra);
        if (!extraRect) ok = false;
      }
      for (let i = 0; i < count; i++) {
        const r = this.atlas.get(drawList.cmds[i].surf);
        this.rects[i] = r;
        if (!r) ok = false;
      }
      if (ok) return extraRect;
      this.atlas.reset();
    }
    return null;
  }

  private writeQuad(q: number, x: number, y: number, w: number, h: number, r: AtlasRect, flip: number, transparent: number,
    remapOffset: number, remapRounds: number, palOffset: number, palLimit: number, opacity: number, options: number, mode: number): void {
    const f = this.vf32;
    const s = this.vi16;
    const x0 = x, y0 = y, x1 = x + w, y1 = y + h;
    let u0 = r.x, u1 = r.x + r.w, v0 = r.y, v1 = r.y + r.h;
    if (flip & FLIP_HORIZONTAL) [u0, u1] = [u1, u0];
    if (flip & FLIP_VERTICAL) [v0, v1] = [v1, v0];
    const xs = [x0, x1, x1, x0];
    const ys = [y0, y0, y1, y1];
    const us = [u0, u1, u1, u0];
    const vs = [v0, v0, v1, v1];
    for (let k = 0; k < 4; k++) {
      const base = (q * 4 + k) * (VERTEX_BYTES / 4);
      f[base] = xs[k];
      f[base + 1] = ys[k];
      f[base + 2] = us[k];
      f[base + 3] = vs[k];
      const sb = base * 2 + 8;
      s[sb] = transparent;
      s[sb + 1] = remapOffset;
      s[sb + 2] = remapRounds;
      s[sb + 3] = palOffset;
      s[sb + 4] = palLimit;
      s[sb + 5] = opacity;
      s[sb + 6] = options;
      s[sb + 7] = mode;
    }
  }

  private uploadQuads(quads: number): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vf32, 0, quads * 4 * (VERTEX_BYTES / 4));
  }

  // ---------------------------------------------------------------------------------
  // Viewport

  /** Computes where the game image goes on the canvas and how many side pixels are visible. */
  viewport(): Viewport {
    const cw = this.canvas.width, ch = this.canvas.height;
    const wide = this.options.mode === 'remastered' || this.options.classicWidescreen;
    const maxExt = wide ? EXT_MAX : 0;
    // Fit 200 native rows to the canvas height when possible.
    let sy = ch / NATIVE_H;
    let sx = sy * PIXEL_ASPECT;
    if (NATIVE_W * sx > cw) {
      sx = cw / NATIVE_W;
      sy = sx / PIXEL_ASPECT;
    }
    let ext = Math.max(0, Math.min(maxExt, (cw / sx - NATIVE_W) / 2));
    if (!wide) ext = 0;
    const w = Math.round((NATIVE_W + 2 * ext) * sx);
    const h = Math.round(NATIVE_H * sy);
    return { x: Math.floor((cw - w) / 2), y: Math.floor((ch - h) / 2), w, h, ext, sx, sy };
  }

  /** Canvas pixel coordinates to native coordinates (the inverse of the viewport mapping; mouse input). */
  canvasToNative(px: number, py: number): [number, number] {
    const vp = this.viewport();
    return [(px - vp.x) / vp.sx - vp.ext, (py - vp.y) / vp.sy];
  }

  render(): void {
    this.syncPaletteAndRemaps();
    if (this.remastered) this.renderHD();
    else this.renderClassic();
    // Development builds: report GL errors (a failing pass is otherwise silent). Checked now and then only, as
    // getError stalls the GPU pipeline.
    if (import.meta.env.DEV && ++this.frameCount % 60 === 0) {
      const err = this.gl.getError();
      if (err !== this.gl.NO_ERROR && this.glErrorsReported++ < 5) console.warn(`[renderer] GL error 0x${err.toString(16)} (${this.options.mode})`);
    }
  }
  private frameCount = 0;
  private glErrorsReported = 0;

  // ---------------------------------------------------------------------------------
  // Classic path

  private ensureClassicTargets(logicalW: number): void {
    const gl = this.gl;
    const w = logicalW;
    const h = NATIVE_H;
    if (this.indexedTarget && this.indexedTarget.w === w && this.indexedTarget.h === h) return;
    this.indexedTarget?.dispose();
    this.resolvedTarget?.dispose();
    this.indexedTarget = new RenderTarget(gl, w, h, [
      { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE },
      { internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE },
    ]);
    this.resolvedTarget = new RenderTarget(gl, w, h, [{ internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR }]);
  }

  private setBlendMode(mode: BlendMode): void {
    const gl = this.gl;
    switch (mode) {
      case BlendMode.SET:
        gl.colorMask(true, true, true, true);
        gl.disable(gl.BLEND);
        break;
      case BlendMode.ADD:
        gl.colorMask(false, false, false, true);
        gl.disable(gl.BLEND);
        break;
      case BlendMode.REMAP:
        gl.colorMask(false, true, false, false);
        gl.disable(gl.BLEND);
        break;
      case BlendMode.SHADOW:
        gl.colorMask(false, true, false, false);
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.MAX);
        break;
      case BlendMode.DARK_TINT:
        gl.colorMask(false, true, true, true);
        gl.disable(gl.BLEND);
        break;
    }
  }

  private renderClassic(): void {
    const gl = this.gl;
    const vp = this.viewport();
    // Only fights are extended; other screens are pillarboxed in classic mode.
    const ext = drawList.wideStyle === WIDE_AMBIENT ? 0 : Math.round(vp.ext);
    this.ensureClassicTargets(NATIVE_W + ext * 2);
    const count = drawList.count;
    // With widescreen, the scene background is replaced by its extended (mirrored) version.
    let extBg: Surface | null = null;
    let bgIndex = -1;
    if (ext > 0) {
      bgIndex = this.findBackground(count);
      if (bgIndex >= 0) extBg = extendedBackground(drawList.cmds[bgIndex].surf);
    }
    const extRect = this.resolveAtlas(count, extBg);
    let quads = 0;
    if (extBg && extRect) {
      // Draw only the needed part of the extended background.
      const sub: AtlasRect = { x: extRect.x + (EXT_MAX - ext), y: extRect.y, w: NATIVE_W + ext * 2, h: extRect.h };
      this.writeQuad(0, 0, 0, NATIVE_W + ext * 2, NATIVE_H, sub, 0, -1, 0, 0, 0, 255, 255, 0, BlendMode.SET);
      this.quadModes[0] = BlendMode.SET;
      quads = 1;
    }
    const skipBg = (c: DrawCmd) => !!extBg && c === drawList.cmds[bgIndex];
    quads += this.fillVerticesFrom(quads, count, ext, skipBg);

    const it = this.indexedTarget!;
    this.drawIndexed(quads);
    // Resolve
    const rt = this.resolvedTarget!;
    rt.bind();
    const rp = this.resolveProg;
    rp.use();
    this.bindTex(0, it.textures[0], rp, 'u_fb');
    this.bindTex(1, it.textures[1], rp, 'u_frac');
    this.bindTex(2, this.remapTex, rp, 'u_remaps');
    this.bindTex(3, this.paletteTex, rp, 'u_palette');
    rp.u('u_fbOptions', drawList.framebufferOptions);
    rp.i('u_hd', 0);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // Present
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const moveX = drawList.targetMoveX * vp.sx;
    const moveY = drawList.targetMoveY * vp.sy;
    const vw = Math.round((NATIVE_W + ext * 2) * vp.sx);
    const vx = Math.floor((this.canvas.width - vw) / 2);
    gl.viewport(vx + Math.round(moveX), vp.y + Math.round(moveY), vw, vp.h);
    const pp = this.presentProg;
    pp.use();
    this.bindTex(0, rt.textures[0], pp, 'u_image');
    pp.f4('u_srcRect', 0, 0, 1, 1);
    pp.f2('u_texSize', rt.w, rt.h);
    pp.f2('u_pixelScale', vw / rt.w, vp.h / rt.h);
    pp.i('u_mode', this.options.scaleMode === 'crt' ? 2 : this.options.scaleMode === 'smooth' ? 1 : 0);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Draws the prepared quads into the indexed framebuffer (the original VGA compositing). */
  private drawIndexed(quads: number): void {
    const gl = this.gl;
    const it = this.indexedTarget!;
    it.bind();
    gl.colorMask(true, true, true, true);
    gl.disable(gl.BLEND);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    if (quads <= 0) return;
    const sp = this.spriteProg;
    sp.use();
    sp.f2('u_fbSize', it.w, it.h);
    sp.f('u_ditherScale', 1);
    sp.i('u_hd', 0);
    this.bindTex(0, this.atlas.tex, sp, 'u_atlas');
    this.bindTex(1, this.remapTex, sp, 'u_remaps');
    this.bindTex(2, this.dummyFrac, sp, 'u_fracAtlas');
    this.uploadQuads(quads);
    let start = 0;
    while (start < quads) {
      const mode = this.quadModes[start];
      let end = start + 1;
      while (end < quads && this.quadModes[end] === mode) end++;
      this.setBlendMode(mode);
      gl.drawElements(gl.TRIANGLES, (end - start) * 6, gl.UNSIGNED_SHORT, start * 12);
      start = end;
    }
    gl.bindVertexArray(null);
    gl.colorMask(true, true, true, true);
    gl.disable(gl.BLEND);
  }

  /**
   * Remastered: the color change caused by remap effects (glows), computed exactly with the original indexed
   * pipeline at native resolution into `deltaTarget`. Returns false when the frame has no remap effects.
   */
  private renderRemapDelta(count: number, bgIndex: number, extRect: AtlasRect | null, extInt: number, exclude: (c: DrawCmd) => boolean): boolean {
    const gl = this.gl;
    let hasRemap = false;
    for (let i = 0; i < count; i++) if (drawList.cmds[i].mode === BlendMode.REMAP && this.rects[i] && !exclude(drawList.cmds[i])) hasRemap = true;
    if (!hasRemap) return false;
    this.ensureClassicTargets(NATIVE_W + extInt * 2);
    let quads = 0;
    const bgCmd = bgIndex >= 0 ? drawList.cmds[bgIndex] : null;
    if (bgCmd && extRect) {
      const sub: AtlasRect = { x: extRect.x + (EXT_MAX - extInt), y: extRect.y, w: NATIVE_W + extInt * 2, h: extRect.h };
      this.writeQuad(0, 0, 0, NATIVE_W + extInt * 2, NATIVE_H, sub, 0, -1, 0, 0, 0, 255, 255, 0, BlendMode.SET);
      this.quadModes[0] = BlendMode.SET;
      quads = 1;
    }
    // Shadows and dark tints are rendered by the HD path itself.
    quads += this.fillVerticesFrom(quads, count, extInt,
      (c) => (bgCmd !== null && c === bgCmd && extRect !== null) || c.mode === BlendMode.SHADOW || c.mode === BlendMode.DARK_TINT || exclude(c));
    this.drawIndexed(quads);
    const w = NATIVE_W + extInt * 2;
    if (!this.deltaTarget || this.deltaTarget.w !== w) {
      this.deltaTarget?.dispose();
      this.deltaTarget = new RenderTarget(gl, w, NATIVE_H, [{ internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR }]);
    }
    this.deltaTarget.bind();
    const p = this.deltaProg;
    p.use();
    this.bindTex(0, this.indexedTarget!.textures[0], p, 'u_fb');
    this.bindTex(1, this.indexedTarget!.textures[1], p, 'u_frac');
    this.bindTex(2, this.remapTex, p, 'u_remaps');
    this.bindTex(3, this.paletteTex, p, 'u_palette');
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  /** Adds the remap-effect delta onto the HD target (brightening and darkening parts separately). */
  private applyRemapDelta(target: RenderTarget, vp: Viewport, extInt: number, shakeX: number, shakeY: number): void {
    const gl = this.gl;
    const d = this.deltaTarget!;
    target.bind();
    const p = this.hdDeltaProg;
    p.use();
    this.bindTex(0, d.textures[0], p, 'u_delta');
    p.f2('u_deltaSize', d.w, d.h);
    p.f2('u_targetSize', target.w, target.h);
    p.f2('u_scale', vp.sx, vp.sy);
    p.f2('u_offset', vp.ext - extInt + shakeX, shakeY);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this.emptyVao);
    gl.blendEquation(gl.FUNC_ADD);
    p.f('u_sign', 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
    p.f('u_sign', -1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);
  }

  private fillVerticesFrom(q0: number, count: number, ox: number, skip: (c: DrawCmd) => boolean, subpixel = false): number {
    let q = q0;
    for (let i = 0; i < count && q < MAX_QUADS; i++) {
      const c = drawList.cmds[i];
      const r = this.rects[i];
      if (!r || skip(c)) continue;
      const x = subpixel ? c.fx : c.x;
      const y = subpixel ? c.fy : c.y;
      this.writeQuad(q, x + ox, y, c.w, c.h, r, c.flip, c.surf.transparent, c.remapOffset, c.remapRounds, c.palOffset, c.palLimit, c.opacity, c.options, c.mode);
      this.quadModes[q] = c.mode;
      this.quadCmd[q] = c;
      q++;
    }
    return q - q0;
  }

  private findBackground(count: number): number {
    for (let i = 0; i < count; i++) {
      const c = drawList.cmds[i];
      if (c.surf.source?.kind === 'background' && c.x === 0 && c.y === 0 && c.surf.w === NATIVE_W && c.surf.h === NATIVE_H) return i;
    }
    return -1;
  }

  private bindTex(unit: number, tex: WebGLTexture, prog: Program, name: string): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    prog.i(name, unit);
  }

  // ---------------------------------------------------------------------------------
  // Remastered (HD) path

  private ensureHdTargets(w: number, h: number): void {
    const gl = this.gl;
    if (this.hdTarget && this.hdTarget.w === w && this.hdTarget.h === h) return;
    this.hdTarget?.dispose();
    this.bloomA?.dispose();
    this.bloomB?.dispose();
    for (const t of this.bloomLevels) t.dispose();
    this.shadowTarget?.dispose();
    const rgba = { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR };
    this.hdTarget = new RenderTarget(gl, w, h, [rgba]);
    this.shadowTarget = new RenderTarget(gl, w, h, [{ internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE }]);
    const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2);
    this.bloomA = new RenderTarget(gl, bw, bh, [rgba]);
    this.bloomB = new RenderTarget(gl, bw, bh, [rgba]);
    this.bloomLevels = [2, 3, 4].map((k) => new RenderTarget(gl, Math.max(1, bw >> (k - 1)), Math.max(1, bh >> (k - 1)), [rgba]));
  }

  /** Hash of the live palette colors a surface uses (the HD background cache follows palette effects). */
  private usedPaletteHash(surf: Surface): number {
    let used = this.usedIndices.get(surf);
    if (!used || used.version !== surf.version) {
      const seen = new Uint8Array(256);
      const d = surf.data;
      for (let i = 0; i < d.length; i++) seen[d[i]] = 1;
      const list: number[] = [];
      for (let i = 0; i < 256; i++) if (seen[i]) list.push(i);
      used = { version: surf.version, list: Uint8Array.from(list) };
      this.usedIndices.set(surf, used);
    }
    const c = vga.undarkened.colors;
    let h = 0x811c9dc5;
    for (const i of used.list) {
      h = Math.imul(h ^ c[i * 3], 0x01000193);
      h = Math.imul(h ^ c[i * 3 + 1], 0x01000193);
      h = Math.imul(h ^ c[i * 3 + 2], 0x01000193);
    }
    return h >>> 0;
  }

  /**
   * Builds (or reuses) the HD cache of the extended scene background: the HD artwork through the live palette when
   * there is one, else the procedural reconstruction.
   */
  private ensureBgCache(bg: Surface, extRect: AtlasRect, scale: number, art: HdImage | null): void {
    const gl = this.gl;
    const t = this.tuning;
    const artKey = art?.image ? `art${art.wide ? 'W' : ''}` : 'xbr';
    const key = `${bg.id}:${bg.version}:${scale}:${extRect.x},${extRect.y}:${this.usedPaletteHash(bg)}:${t.bgSigma}:${t.bgDiff}:${artKey}`;
    if (this.bgCache && this.bgCacheKey === key) return;
    this.bgCacheKey = key;
    const w = extRect.w * scale;
    const h = extRect.h * scale;
    if (!this.bgCache || this.bgCache.w !== w || this.bgCache.h !== h) {
      this.bgCache?.dispose();
      this.bgCache = new RenderTarget(gl, w, h, [{ internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR }]);
      // Mipmaps: the widescreen extension is drawn progressively blurred.
      gl.bindTexture(gl.TEXTURE_2D, this.bgCache.textures[0]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    }
    this.bgCache.bind();
    gl.disable(gl.BLEND);
    gl.colorMask(true, true, true, true);
    if (art?.image) {
      const p = this.hdBgArtProg;
      p.use();
      p.f2('u_scale', scale, scale);
      p.f2('u_offset', 0, 0);
      p.f2('u_target', w, h);
      const tex = art.wide ?? art.image;
      this.bindTex(0, tex.tex, p, 'u_art');
      this.bindTex(1, this.atlas.tex, p, 'u_atlas');
      this.bindTex(2, this.paletteTex, p, 'u_palette');
      this.bindTex(3, hdAssets.basePalTex!, p, 'u_basePal');
      p.i('u_baseRow', art.entry.palette);
      p.f4('u_rect', extRect.x, extRect.y, extRect.w, extRect.h);
      p.f('u_extNative', EXT_MAX);
      p.i('u_wide', art.wide ? 1 : 0);
    } else {
      const p = this.hdBgCacheProg;
      p.use();
      p.f2('u_scale', scale, scale);
      p.f2('u_offset', 0, 0);
      p.f2('u_target', w, h);
      p.f('u_cacheScale', scale);
      p.f('u_rangeK', 1 / (2 * t.bgSigma * t.bgSigma));
      p.f('u_diffT', t.bgDiff);
      this.bindTex(0, this.atlas.tex, p, 'u_atlas');
      this.bindTex(1, this.remapTex, p, 'u_remaps');
      this.bindTex(2, this.paletteTex, p, 'u_palette');
    }
    this.writeQuad(0, 0, 0, extRect.w, extRect.h, extRect, 0, -1, 0, 0, 0, 255, 255, 0, 0);
    this.uploadQuads(1);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    gl.bindTexture(gl.TEXTURE_2D, this.bgCache.textures[0]);
    gl.generateMipmap(gl.TEXTURE_2D);

    // Shadow ratios (same quad, native resolution).
    if (!this.bgRatio || this.bgRatio.w !== extRect.w || this.bgRatio.h !== extRect.h) {
      this.bgRatio?.dispose();
      const f = { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR };
      this.bgRatio = new RenderTarget(gl, extRect.w, extRect.h, [f, f, f, f]);
    }
    this.bgRatio.bind();
    const rp = this.hdShadowRatioProg;
    rp.use();
    rp.f2('u_scale', 1, 1);
    rp.f2('u_offset', 0, 0);
    rp.f2('u_target', extRect.w, extRect.h);
    this.bindTex(0, this.atlas.tex, rp, 'u_atlas');
    this.bindTex(1, this.remapTex, rp, 'u_remaps');
    this.bindTex(2, this.paletteTex, rp, 'u_palette');
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }

  /**
   * Downsamples a horizontal slice of the target (in target pixels) to 256x192, then 64x48, and blurs it
   * heavily. Returns the target holding the result (`b`).
   */
  private blurredCopy(target: RenderTarget, x: number, w: number): RenderTarget {
    const gl = this.gl;
    if (!this.ambA) {
      const f = { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR };
      this.ambA = new RenderTarget(gl, 256, 192, [f]);
      this.ambB = new RenderTarget(gl, 64, 48, [f]);
      this.ambC = new RenderTarget(gl, 64, 48, [f]);
    }
    const a = this.ambA, b = this.ambB!, c = this.ambC!;
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.emptyVao);
    const down = this.hdDownProg;
    down.use();
    a.bind();
    this.bindTex(0, target.textures[0], down, 'u_src');
    down.f4('u_srcRect', x / target.w, 0, w / target.w, 1);
    down.f2('u_texel', 1 / target.w, 1 / target.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    b.bind();
    this.bindTex(0, a.textures[0], down, 'u_src');
    down.f4('u_srcRect', 0, 0, 1, 1);
    down.f2('u_texel', 1 / a.w, 1 / a.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const blur = this.hdBlurProg;
    blur.use();
    for (let pass = 0; pass < 3; pass++) {
      c.bind();
      this.bindTex(0, b.textures[0], blur, 'u_src');
      blur.f2('u_dir', (1 + pass) / b.w, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      b.bind();
      this.bindTex(0, c.textures[0], blur, 'u_src');
      blur.f2('u_dir', 0, (1 + pass) / b.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    return b;
  }

  /** Fills the widescreen sides with a blurred, zoomed, dimmed copy of the 4:3 frame. */
  private renderAmbient(target: RenderTarget, frameX: number, frameW: number): void {
    const gl = this.gl;
    const b = this.blurredCopy(target, frameX, frameW);
    target.bind();
    const amb = this.hdAmbientProg;
    amb.use();
    this.bindTex(0, b.textures[0], amb, 'u_amb');
    amb.f('u_zoom', target.w / frameW);
    amb.f('u_dim', 0.42);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, frameX, target.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.scissor(frameX + frameW, 0, target.w - frameX - frameW, target.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
  }

  private useHdSpriteProg(vp: Viewport, shakeX: number, shakeY: number, shadowPass: number): void {
    const gl = this.gl;
    const p = this.hdSpriteProg;
    p.use();
    p.f2('u_scale', vp.sx, vp.sy);
    p.f2('u_offset', (vp.ext + shakeX) * vp.sx, shakeY * vp.sy);
    p.f2('u_target', vp.w, vp.h);
    p.f('u_rangeK', 1 / (2 * this.tuning.spriteSigma * this.tuning.spriteSigma));
    p.f('u_diffT', this.tuning.spriteDiff);
    p.i('u_shadowPass', shadowPass);
    p.i('u_textStyle', this.textStyle);
    this.bindTex(0, this.atlas.tex, p, 'u_atlas');
    this.bindTex(1, this.remapTex, p, 'u_remaps');
    this.bindTex(2, this.paletteTex, p, 'u_palette');
    const fit = this.remapFit!;
    gl.uniform1fv(p.loc('u_remapA'), fit.a);
    gl.uniform3fv(p.loc('u_remapB'), fit.b);
  }

  /**
   * Writes an HD artwork quad for draw command `c` (its surface resident at atlas rect `r`). Returns false when
   * nothing of the artwork is visible (e.g. a cut-out region of the transparent margin).
   */
  private writeHdQuad(q: number, c: DrawCmd, r: AtlasRect, img: HdImage): boolean {
    const e = img.entry;
    const page = img.page!;
    const surf = c.surf;
    // The artwork's own image (the parent's, for derived surfaces) and where this surface lies in it.
    const src = img.sub?.surf ?? surf;
    const ox = img.sub?.x ?? 0, oy = img.sub?.y ?? 0;
    const pad = e.pad ?? 0;
    const fw = e.fw!, fh = e.fh!, ew = e.w!, eh = e.h!, tx = e.tx!, ty = e.ty!;
    // Native pixels per HD pixel, and the draw's own scaling (e.g. robots drawn larger or smaller).
    const kx = (src.w + 2 * pad) / fw, ky = (src.h + 2 * pad) / fh;
    const dsx = c.w / surf.w, dsy = c.h / surf.h;
    // Region to draw, in the source's native coordinates: the whole padded image, or the cut-out region.
    const rx0 = img.sub ? ox : -pad, ry0 = img.sub ? oy : -pad;
    const rx1 = img.sub ? ox + surf.w : src.w + pad, ry1 = img.sub ? oy + surf.h : src.h + pad;
    // Stored (trimmed) rectangle of the artwork, in the same coordinates.
    const sx0 = -pad + tx * kx, sy0 = -pad + ty * ky, sx1 = -pad + (tx + ew) * kx, sy1 = -pad + (ty + eh) * ky;
    const ix0 = Math.max(rx0, sx0), iy0 = Math.max(ry0, sy0), ix1 = Math.min(rx1, sx1), iy1 = Math.min(ry1, sy1);
    if (ix1 <= ix0 || iy1 <= iy0) return false;
    // Local coordinates of this surface (the native index lookups use this surface's own pixels).
    const lx0 = ix0 - ox, lx1 = ix1 - ox, ly0 = iy0 - oy, ly1 = iy1 - oy;
    const flipH = (c.flip & FLIP_HORIZONTAL) !== 0, flipV = (c.flip & FLIP_VERTICAL) !== 0;
    const x0 = c.fx + (flipH ? surf.w - lx1 : lx0) * dsx, x1 = c.fx + (flipH ? surf.w - lx0 : lx1) * dsx;
    const y0 = c.fy + (flipV ? surf.h - ly1 : ly0) * dsy, y1 = c.fy + (flipV ? surf.h - ly0 : ly1) * dsy;
    // Drawn part of the page, in texels (the shader keeps its samples inside it).
    const px0 = e.x! + (ix0 - sx0) / kx, px1 = e.x! + (ix1 - sx0) / kx;
    const py0 = e.y! + (iy0 - sy0) / ky, py1 = e.y! + (iy1 - sy0) / ky;
    let hu0 = px0 / page.w, hu1 = px1 / page.w;
    let hv0 = py0 / page.h, hv1 = py1 / page.h;
    let nu0 = lx0, nu1 = lx1, nv0 = ly0, nv1 = ly1;
    if (flipH) {
      [hu0, hu1] = [hu1, hu0];
      [nu0, nu1] = [nu1, nu0];
    }
    if (flipV) {
      [hv0, hv1] = [hv1, hv0];
      [nv0, nv1] = [nv1, nv0];
    }
    // Flags: 1 = draw grey, 2 = transparency keyed from this surface's pixels (its transparent color is not the
    // artwork's, e.g. the robot grid's black cells).
    const flags = (img.sub?.gray ? 1 : 0) | (surf.transparent > 0 ? 2 : 0);
    const xs = [x0, x1, x1, x0], ys = [y0, y0, y1, y1];
    const hus = [hu0, hu1, hu1, hu0], hvs = [hv0, hv0, hv1, hv1];
    const nus = [nu0, nu1, nu1, nu0], nvs = [nv0, nv0, nv1, nv1];
    const f = this.hdF32, sh = this.hdI16;
    for (let k = 0; k < 4; k++) {
      const base = (q * 4 + k) * (HD_VERTEX_BYTES / 4);
      f[base] = xs[k];
      f[base + 1] = ys[k];
      f[base + 2] = hus[k];
      f[base + 3] = hvs[k];
      f[base + 4] = nus[k];
      f[base + 5] = nvs[k];
      const sb = base * 2 + 12;
      sh[sb] = surf.transparent;
      sh[sb + 1] = c.remapOffset;
      sh[sb + 2] = c.remapRounds;
      sh[sb + 3] = c.palOffset;
      sh[sb + 4] = c.palLimit;
      sh[sb + 5] = c.opacity;
      sh[sb + 6] = c.options;
      sh[sb + 7] = c.mode;
      sh[sb + 8] = r.x;
      sh[sb + 9] = r.y;
      sh[sb + 10] = r.w;
      sh[sb + 11] = r.h;
      sh[sb + 12] = e.palette;
      sh[sb + 13] = flags;
      sh[sb + 14] = 0;
      sh[sb + 15] = 0;
      f[base + 14] = px0;
      f[base + 15] = py0;
      f[base + 16] = px1;
      f[base + 17] = py1;
    }
    return true;
  }

  private useHdAssetProg(vp: Viewport, shakeX: number, shakeY: number, shadowPass: number): void {
    const p = this.hdAssetProg;
    p.use();
    p.f2('u_scale', vp.sx, vp.sy);
    p.f2('u_offset', (vp.ext + shakeX) * vp.sx, shakeY * vp.sy);
    p.f2('u_target', vp.w, vp.h);
    p.i('u_shadowPass', shadowPass);
    this.bindTex(1, this.atlas.tex, p, 'u_atlas');
    this.bindTex(2, this.remapTex, p, 'u_remaps');
    this.bindTex(3, this.paletteTex, p, 'u_palette');
    this.bindTex(4, hdAssets.basePalTex!, p, 'u_basePal');
  }

  /**
   * Draws the frame's sprites in draw order, each either with its HD artwork or with the procedural upscaler.
   * `skip` excludes commands; `shadowPass` draws shadow coverage (see the shadow buffer) instead of colors.
   */
  private drawSprites(vp: Viewport, count: number, shakeX: number, shakeY: number, skip: (c: DrawCmd) => boolean, shadowPass: number): void {
    const gl = this.gl;
    type Run = { hd: boolean; start: number; count: number; mode: number; page: WebGLTexture | null; pw: number; ph: number };
    const runs: Run[] = [];
    let nx = 0, nh = 0;
    for (let i = 0; i < count; i++) {
      const c = drawList.cmds[i];
      const r = this.rects[i];
      if (!r || skip(c)) continue;
      const img = this.hdImages[i];
      const last = runs[runs.length - 1];
      // Shadows use the artwork's silhouette in the shadow pass; the fallback fitted-remap shadow stays procedural.
      if (img?.page && nh < MAX_HD_QUADS && (shadowPass || c.mode !== BlendMode.SHADOW)) {
        if (!this.writeHdQuad(nh, c, r, img)) continue;
        if (last && last.hd && last.page === img.page.tex && last.mode === c.mode) last.count++;
        else runs.push({ hd: true, start: nh, count: 1, mode: c.mode, page: img.page.tex, pw: img.page.w, ph: img.page.h });
        nh++;
      } else if (nx < MAX_QUADS) {
        // Font glyphs get the text rendering of the HD sprite shader (flag 0x100).
        const options = c.surf.source?.kind === 'font' ? c.options | 0x100 : c.options;
        this.writeQuad(nx, c.fx, c.fy, c.w, c.h, r, c.flip, c.surf.transparent, c.remapOffset, c.remapRounds, c.palOffset, c.palLimit, c.opacity, options, c.mode);
        if (last && !last.hd && last.mode === c.mode) last.count++;
        else runs.push({ hd: false, start: nx, count: 1, mode: c.mode, page: null, pw: 0, ph: 0 });
        nx++;
      }
    }
    if (runs.length === 0) return;
    if (nx > 0) this.uploadQuads(nx);
    if (nh > 0) {
      gl.bindVertexArray(this.hdVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.hdVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.hdF32, 0, nh * 4 * (HD_VERTEX_BYTES / 4));
    }
    let current: 'hd' | 'xbr' | '' = '';
    for (const run of runs) {
      if (run.hd) {
        if (current !== 'hd') {
          this.useHdAssetProg(vp, shakeX, shakeY, shadowPass);
          gl.bindVertexArray(this.hdVao);
          current = 'hd';
        }
        const p = this.hdAssetProg;
        this.bindTex(0, run.page!, p, 'u_page');
        p.f2('u_hdStep', 5 / run.pw, 6 / run.ph);
        p.f2('u_pageSize', run.pw, run.ph);
      } else if (current !== 'xbr') {
        this.useHdSpriteProg(vp, shakeX, shakeY, shadowPass);
        gl.bindVertexArray(this.vao);
        current = 'xbr';
      }
      if (shadowPass) {
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.MAX);
        gl.blendFunc(gl.ONE, gl.ONE);
      } else {
        this.setHdBlend(run.mode);
      }
      gl.drawElements(gl.TRIANGLES, run.count * 6, gl.UNSIGNED_SHORT, run.start * 12);
    }
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  private setHdBlend(mode: number): void {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    if (mode === BlendMode.SHADOW || mode === BlendMode.REMAP) {
      // src.rgb + dst * src.a   (multiply-add effects)
      gl.blendFunc(gl.ONE, gl.SRC_ALPHA);
    } else {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
  }

  private renderHD(): void {
    const gl = this.gl;
    this.syncHdTables();
    // The final image goes to `out`; everything is rendered at `vp`, which is scaled down when the dynamic
    // resolution caps the render scale (the composite then upscales it smoothly).
    const out = this.viewport();
    this.updateDynamicResolution(out.sy);
    const q = this.options.hdResolution === 'auto' ? Math.min(1, this.hdMaxScale / out.sy) : 1;
    const vp: Viewport = q < 1
      ? { x: 0, y: 0, w: Math.max(1, Math.round(out.w * q)), h: Math.max(1, Math.round(out.h * q)), ext: out.ext, sx: out.sx * q, sy: out.sy * q }
      : out;
    const timing = this.timerExt && !this.pendingQuery ? gl.createQuery() : null;
    if (timing) gl.beginQuery(this.timerExt!.TIME_ELAPSED_EXT, timing);
    this.ensureHdTargets(vp.w, vp.h);
    const count = drawList.count;
    const bgIndex = this.findBackground(count);
    const bgSurf = bgIndex >= 0 ? extendedBackground(drawList.cmds[bgIndex].surf) : null;
    const extRect = this.resolveAtlas(count, bgSurf);
    // HD artwork for this frame's images (null where there is none, or its bundle is still loading).
    hdAssets.beginFrame();
    for (let i = 0; i < count; i++) {
      const c = drawList.cmds[i];
      this.hdImages[i] = c.mode === BlendMode.REMAP || c.mode === BlendMode.ADD ? null : hdAssets.lookupDerived(c.surf);
    }
    const bgArt = bgIndex >= 0 ? this.hdImages[bgIndex] : null;
    // Background cache resolution (bilinear-magnified beyond that).
    const scale = Math.max(2, Math.min(6, Math.ceil(vp.h / NATIVE_H)));
    if (bgSurf && extRect) this.ensureBgCache(bgSurf, extRect, scale, bgArt?.image ? bgArt : null);

    const target = this.hdTarget!;
    const shakeX = drawList.targetMoveX;
    const shakeY = drawList.targetMoveY;
    const haveBg = !!(bgSurf && extRect && this.bgCache && this.bgRatio);
    const isBg = (c: DrawCmd) => bgIndex >= 0 && c === drawList.cmds[bgIndex];
    // Fights with remastered effects: the world (arena, robots, projectiles) is drawn and post-processed first, and
    // the overlay (HUD, announcements, pause menu) is drawn over the result.
    const fx = this.fx && this.fx.active && drawList.wideStyle === WIDE_MIRROR ? this.fx : null;
    const isOverlay = (c: DrawCmd) => fx !== null && c.tag === TAG_HUD;
    // Glows (remap effects) are computed exactly at native resolution and added after the sprites.
    const deltaExt = drawList.wideStyle === WIDE_AMBIENT ? 0 : Math.round(vp.ext);
    const haveDelta = this.renderRemapDelta(count, bgIndex, extRect, deltaExt, isOverlay);

    // HAR shadows go into a coverage buffer; the background pass applies the original remap tables exactly.
    const shadowTarget = this.shadowTarget!;
    shadowTarget.bind();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (haveBg) this.drawSprites(vp, count, shakeX, shakeY, (c) => c.mode !== BlendMode.SHADOW || isBg(c), 1);

    target.bind();
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // Non-arena screens keep their 4:3 composition; the sides get an ambient fill afterwards.
    const ambient = drawList.wideStyle === WIDE_AMBIENT && vp.ext > 0.5;
    const frameX = Math.round(vp.ext * vp.sx);
    const frameW = Math.min(vp.w - frameX, Math.round(NATIVE_W * vp.sx));
    if (ambient) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(frameX, 0, frameW, vp.h);
    }

    // Background (cached reconstruction, exact shadows, widescreen sides darkened).
    if (haveBg) {
      gl.disable(gl.BLEND);
      const p = this.hdBgProg;
      p.use();
      const cache = this.bgCache!;
      const ratio = this.bgRatio!;
      this.bindTex(0, cache.textures[0], p, 'u_cache');
      this.bindTex(1, shadowTarget.textures[0], p, 'u_shadow');
      for (let k = 0; k < 4; k++) this.bindTex(2 + k, ratio.textures[k], p, `u_ratio${k}`);
      p.f2('u_cacheSize', cache.w, cache.h);
      p.f('u_cacheScale', scale);
      const x0 = (EXT_MAX - vp.ext - shakeX) * scale;
      const y0 = -shakeY * scale;
      p.f4('u_region', x0, y0, (NATIVE_W + vp.ext * 2) * scale, NATIVE_H * scale);
      p.f('u_extLeft', EXT_MAX * scale);
      p.f('u_extRight', (EXT_MAX + NATIVE_W) * scale);
      p.f('u_extFade', Math.max(1, vp.ext) * scale * 1.2);
      // Mirrored extension: blurred (about 10 native pixels at the far end), desaturated and darkened. Real
      // widescreen artwork only gets a light touch to keep the focus on the playfield.
      const realWide = !!bgArt?.wide;
      p.f('u_extBlurLod', Math.log2((realWide ? 1.5 : 10) * scale));
      p.f('u_extStrength', realWide ? 0.45 : 1);
      gl.bindVertexArray(this.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Sprites (shadows were applied with the background when there is one).
    this.drawSprites(vp, count, shakeX, shakeY,
      (c) => isBg(c) || isOverlay(c) || (haveBg && c.mode === BlendMode.SHADOW) || (haveDelta && c.mode === BlendMode.REMAP), 0);
    if (haveDelta) this.applyRemapDelta(target, vp, deltaExt, shakeX, shakeY);
    if (ambient) {
      gl.disable(gl.SCISSOR_TEST);
      this.renderAmbient(target, frameX, frameW);
    }
    // Effects: particles, lighting and the world post pass; then light shafts from the finished world.
    let scene = target;
    let shafts: WebGLTexture | null = null;
    if (fx) {
      const view: FxView = { sx: vp.sx, sy: vp.sy, ox: (vp.ext + shakeX) * vp.sx, oy: shakeY * vp.sy };
      scene = this.renderWorldFx(fx, view, vp, count, shakeX, shakeY);
      shafts = this.fxPasses.renderShafts(fx, scene, view);
    }

    // Bloom
    const bloomOn = this.options.bloom;
    if (bloomOn) {
      const a = this.bloomA!, b = this.bloomB!;
      a.bind();
      let p = this.hdBrightProg;
      p.use();
      this.bindTex(0, scene.textures[0], p, 'u_src');
      p.f2('u_texel', 1 / scene.w, 1 / scene.h);
      p.i('u_hasDelta', haveDelta ? 1 : 0);
      if (haveDelta) {
        const d = this.deltaTarget!;
        this.bindTex(1, d.textures[0], p, 'u_delta');
        p.f2('u_deltaSize', d.w, d.h);
        p.f2('u_scale', vp.sx, vp.sy);
        p.f2('u_offset', vp.ext - deltaExt + shakeX, shakeY);
        p.f2('u_targetSize', scene.w, scene.h);
      } else {
        // Every sampler of a program must point at a texture it can sample, even when unused: otherwise the draw
        // fails (e.g. an integer texture left on this unit by the sprite pass) and the bloom is never refreshed.
        this.bindTex(1, this.fxPasses.black, p, 'u_delta');
      }
      gl.bindVertexArray(this.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // Light-emitting particles (sparks, flares, embers) glow too.
      if (fx && fx.particleCount > 0) {
        const k = a.w / scene.w;
        const view: FxView = { sx: vp.sx * k, sy: vp.sy * k, ox: (vp.ext + shakeX) * vp.sx * k, oy: shakeY * vp.sy * k };
        this.fxPasses.drawParticles(fx, view, a.w, a.h, true);
        gl.bindVertexArray(this.emptyVao);
      }
      p = this.hdBlurProg;
      p.use();
      for (let pass = 0; pass < 2; pass++) {
        b.bind();
        this.bindTex(0, a.textures[0], p, 'u_src');
        p.f2('u_dir', (1 + pass) / a.w, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        a.bind();
        this.bindTex(0, b.textures[0], p, 'u_src');
        p.f2('u_dir', 0, (1 + pass) / a.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      this.bloomWide(a);
    }

    // The overlay goes over the finished world, after its glow (no bloom, lighting or distortion on the overlay).
    let bloomStrength = bloomOn ? 0.8 : 0;
    let shaftStrength = shafts ? 1 : 0;
    if (fx) {
      scene.bind();
      if (bloomStrength > 0 || shaftStrength > 0) {
        const g = this.hdGlowAddProg;
        g.use();
        this.bindTex(0, (this.bloomA ?? scene).textures[0], g, 'u_bloom');
        this.bindTex(1, shafts ?? this.fxPasses.black, g, 'u_shafts');
        g.f('u_bloomStrength', bloomStrength);
        g.f('u_shaftStrength', shaftStrength);
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindVertexArray(this.emptyVao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.disable(gl.BLEND);
        bloomStrength = 0;
        shaftStrength = 0;
      }
      // Remap effects of the overlay (the menu shading) are applied exactly like the glows of the world: computed with
      // the original pipeline and added after the overlay's sprites (the delta is zero where later sprites cover them).
      const overlayDelta = this.renderRemapDelta(count, bgIndex, extRect, deltaExt, (c) => !isOverlay(c) && c.mode === BlendMode.REMAP);
      scene.bind();
      this.drawSprites(vp, count, shakeX, shakeY, (c) => !isOverlay(c) || (overlayDelta && c.mode === BlendMode.REMAP), 0);
      if (overlayDelta) this.applyRemapDelta(scene, vp, deltaExt, shakeX, shakeY);
    }

    // Composite to the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(out.x, out.y, out.w, out.h);
    const p = this.hdPostProg;
    p.use();
    this.bindTex(0, scene.textures[0], p, 'u_scene');
    this.bindTex(1, (this.bloomA ?? scene).textures[0], p, 'u_bloom');
    this.bindTex(2, shafts ?? this.fxPasses.black, p, 'u_shafts');
    p.f('u_shaftStrength', shaftStrength);
    p.f('u_bloomStrength', bloomStrength);
    p.f('u_vignette', 0.15);
    p.f('u_fade', vga.fade);
    p.f4('u_srcRect', 0, 0, 1, 1);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (timing) {
      gl.endQuery(this.timerExt!.TIME_ELAPSED_EXT);
      this.pendingQuery = timing;
    }
  }

  /** Current remastered render scale relative to the display (1 = full resolution), for diagnostics. */
  hdRenderScale(): number {
    const out = this.viewport();
    return this.options.hdResolution === 'auto' ? Math.min(1, this.hdMaxScale / out.sy) : 1;
  }
}
