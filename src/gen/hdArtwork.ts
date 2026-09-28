// Remastered artwork for the generated robots, made on the GPU while the game runs: every sprite of their fighter
// files is rendered again from the same pose at the HD artwork scale (gen/hdRender.ts) and registered by its pixel
// fingerprint, so the remastered renderer draws it like the installed artwork of the original robots (recolored to
// the players' colors, faded, flashed...). Until a sprite's rendering is done, the renderer upscales it as usual.
import type { Palette } from '../formats/palette';
import { altPalettes, fighterFile, hasFighter, loadBk } from '../resources/resources';
import type { HdAssets } from '../video/hd/assets';
import { pixelHash } from '../video/hd/pixelHash';
import { JUMP_PIVOT, spriteShapes } from './fighter/build';
import { MOVE } from './fighter/moveset';
import { HD_SX, HD_SY, HD_UNIT, HdPageSet, RobotHdRenderer } from './hdRender';
import type { PlacedShape } from './robot';
import { fighterOf, genRobot } from './roster';
import { genArenaByFile } from './scene/arenas';
import type { Bk } from '../resources/resources';

/** Native pixels of transparent margin around each rendering (room for the anti-aliased edges). */
const PAD = 2;
/** ALTPALS color ramps the renderings are made in (tertiary, secondary, primary): three clearly different hues. */
const REFERENCE_RAMPS = [4, 1, 0];
/** Robots kept rendered while not wanted, before their pages are freed. */
const KEEP_ROBOTS = 3;
/** Sprites rendered per frame at most. */
const MAX_PER_FRAME = 3;

interface Job {
  hash: string;
  moveId: number;
  shapes: PlacedShape[];
  /** Native sprite rectangle (relative to its anchor) and magnification. */
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
}

interface RobotArt {
  harId: number;
  pages: HdPageSet;
  jobs: Job[];
  hashes: string[];
  /** Moves wanted so far (null: all). */
  moves: Set<number> | null;
  lastWanted: number;
}

/** Moves rendered first (what shows first: select cell and idle, VS picture, walking, jumping, blocking, hits). */
const PRIORITY = [MOVE.PORTRAIT_CELL, 11, MOVE.PORTRAIT_VS, 10, 1, 4, 5, 6, 9];

export class GeneratedArtwork {
  private renderer: RobotHdRenderer | null = null;
  private robots = new Map<number, RobotArt>();
  private palette = -1;
  private frame = 0;
  private failed = false;

  constructor(private gl: WebGL2RenderingContext, private hd: HdAssets) {}

  /** Texels per native pixel follow the installed artwork's resolution setting (half on integrated GPUs). */
  private get texScale(): number {
    return this.hd.textureScale;
  }

  /** The reference palette: the three reference ramps, and the effect colors every arena shares. */
  private referencePalette(): Uint8Array {
    const rgb = new Uint8Array(768);
    const alt: Palette = altPalettes()[0];
    REFERENCE_RAMPS.forEach((src, ramp) => {
      for (let k = ramp === 0 ? 1 : 0; k < 16; k++) {
        const i = ramp * 16 + k, j = src * 16 + k;
        rgb.set([alt.r(j), alt.g(j), alt.b(j)], i * 3);
      }
    });
    const arena = loadBk('ARENA0.BK').palettes[0];
    for (let i = 0x60; i < 0x100; i++) rgb.set([arena.r(i), arena.g(i), arena.b(i)], i * 3);
    return rgb;
  }

  private ensureRenderer(): boolean {
    if (this.renderer) return true;
    if (this.failed) return false;
    try {
      this.renderer = new RobotHdRenderer(this.gl);
      const pal = this.referencePalette();
      this.renderer.setPalette(pal);
      this.palette = this.hd.addBasePalette(pal);
      return true;
    } catch (err) {
      console.warn('[gen] robot artwork disabled:', err);
      this.failed = true;
      return false;
    }
  }

  /**
   * Robots whose artwork is wanted now (HAR ids; others are ignored), optionally only some of their moves (e.g. the
   * select screen's cells and idle animations).
   */
  want(harIds: number[], moves?: number[]): void {
    for (const id of harIds) {
      if (!genRobot(id) || !hasFighter(id)) continue;
      let art = this.robots.get(id);
      if (!art) {
        art = { harId: id, pages: new HdPageSet(this.gl, 2048), jobs: [], hashes: [], moves: new Set(), lastWanted: 0 };
        this.robots.set(id, art);
      }
      art.lastWanted = this.frame;
      if (!moves) {
        if (art.moves) {
          art.moves = null;
          this.plan(art);
        }
      } else if (art.moves) {
        const added = moves.filter((m) => !art!.moves!.has(m));
        for (const m of added) art.moves.add(m);
        if (added.length) this.plan(art, added);
      }
    }
  }

  /** Queues the sprites of a robot's wanted moves that are not rendered yet. */
  private plan(art: RobotArt, moves?: number[]): void {
    const r = genRobot(art.harId)!;
    const af = fighterFile(art.harId);
    const have = new Set([...art.hashes, ...art.jobs.map((j) => j.hash)]);
    const want = moves ? new Set(moves) : null;
    for (const m of fighterOf(r).moves) {
      if (want && !want.has(m.id)) continue;
      const am = af.moves[m.id];
      if (!am) continue;
      m.sprites.forEach((gs, i) => {
        const sp = am.animation.sprites[i];
        if (!sp || sp.isEmpty() || (!gs.pose && !gs.props?.length)) return;
        const hash = pixelHash(sp.width, sp.height, sp.pixels());
        if (have.has(hash)) return;
        have.add(hash);
        art.jobs.push({
          hash,
          moveId: m.id,
          shapes: spriteShapes(r.model, gs),
          x: sp.posX,
          y: sp.posY - (m.id === 1 ? JUMP_PIVOT : 0),
          w: sp.width,
          h: sp.height,
          scale: gs.view?.scale ?? 1,
        });
      });
    }
    const rank = (id: number) => {
      const k = PRIORITY.indexOf(id);
      return k < 0 ? PRIORITY.length + id : k;
    };
    art.jobs.sort((a, b) => rank(a.moveId) - rank(b.moveId));
  }

  private arenas = new Map<string, 'loading' | 'ready' | 'failed'>();

  /**
   * The HD background of a generated arena (images made with the dev tool, see gen/dev/arenaHd.ts): loaded when the
   * arena is about to show, registered against its native background and palette.
   */
  wantArena(bk: Bk): void {
    const a = genArenaByFile(bk.file);
    if (!a || this.arenas.has(a.file)) return;
    this.arenas.set(a.file, 'loading');
    const base = `gen/${a.file.replace(/\.BK$/, '')}`;
    const hash = pixelHash(bk.background.w, bk.background.h, bk.background.data);
    const palette = this.hd.addBasePalette(bk.palettes[0].colors);
    Promise.all([this.hd.loadImage(`${base}-HD.webp`, 1600, 1200), this.hd.loadImage(`${base}-WIDE.webp`, 2880, 1200)])
      .then(([image, wide]) => {
        this.hd.registerBackground(hash, image, wide, palette);
        this.arenas.set(a.file, 'ready');
      })
      .catch((err) => {
        console.warn(`[gen] no HD background for ${a.file}:`, err);
        this.arenas.set(a.file, 'failed');
      });
  }

  /** Development: renders `n` queued sprites and waits for the GPU; returns milliseconds per sprite. */
  benchmark(n: number): number {
    if (!this.ensureRenderer()) return -1;
    const t0 = performance.now();
    let done = 0;
    for (const art of this.robots.values()) {
      while (art.jobs.length && done < n) {
        this.renderJob(art, art.jobs.shift()!);
        done++;
      }
    }
    // Reading a pixel back waits for the GPU (finish() may return early).
    const page = [...this.robots.values()].flatMap((a) => a.pages.pages).pop();
    if (page) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, page.fbo);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    return done ? (performance.now() - t0) / done : 0;
  }

  /** Whether renderings are still queued. */
  get busy(): boolean {
    for (const a of this.robots.values()) if (a.jobs.length) return true;
    return false;
  }

  /** Renders queued sprites for up to `budgetMs` (call between frames). */
  pump(budgetMs: number): void {
    this.frame++;
    this.evict();
    if (!this.busy || !this.ensureRenderer()) return;
    const gl = this.gl;
    const saved = saveState(gl);
    const t0 = performance.now();
    let drawn = 0;
    try {
      for (const art of [...this.robots.values()].sort((a, b) => b.lastWanted - a.lastWanted)) {
        // A few per frame: draw calls return at once, the GPU needs about 3 ms per sprite (RTX class).
        while (art.jobs.length && performance.now() - t0 < budgetMs && drawn < MAX_PER_FRAME) {
          this.renderJob(art, art.jobs.shift()!);
          drawn++;
        }
        art.pages.finish();
      }
    } finally {
      restoreState(gl, saved);
    }
  }

  private renderJob(art: RobotArt, j: Job): void {
    const ts = this.texScale;
    const fw = Math.round((j.w + 2 * PAD) * HD_SX * ts), fh = Math.round((j.h + 2 * PAD) * HD_SY * ts);
    const rect = art.pages.allocate(fw, fh);
    const unit = HD_UNIT / (j.scale * ts);
    this.renderer!.draw(rect, (j.x - PAD) / j.scale, (-(j.y - PAD) * 1.2) / j.scale, j.shapes, unit);
    art.hashes.push(j.hash);
    this.hd.registerSprite(j.hash, { tex: rect.page.tex, w: rect.page.w, h: rect.page.h }, rect.x, rect.y, fw, fh, PAD, this.palette);
  }

  /** Frees the pages of robots nobody wanted for a while, keeping a few. */
  private evict(): void {
    if (this.robots.size <= KEEP_ROBOTS) return;
    const idle = [...this.robots.values()].filter((a) => this.frame - a.lastWanted > 600).sort((a, b) => a.lastWanted - b.lastWanted);
    for (const art of idle) {
      if (this.robots.size <= KEEP_ROBOTS) break;
      for (const h of art.hashes) this.hd.unregister(h);
      art.pages.dispose();
      this.robots.delete(art.harId);
    }
  }
}

interface GlState {
  fbo: WebGLFramebuffer | null;
  viewport: Int32Array;
  program: WebGLProgram | null;
  vao: WebGLVertexArrayObject | null;
  active: number;
  tex0: WebGLTexture | null;
  tex1: WebGLTexture | null;
  blend: boolean;
  scissor: boolean;
  mask: boolean[];
}

function saveState(gl: WebGL2RenderingContext): GlState {
  const active = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
  gl.activeTexture(gl.TEXTURE0);
  const tex0 = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  gl.activeTexture(gl.TEXTURE1);
  const tex1 = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  gl.activeTexture(active);
  return {
    fbo: gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
    viewport: gl.getParameter(gl.VIEWPORT) as Int32Array,
    program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
    vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null,
    active,
    tex0,
    tex1,
    blend: gl.isEnabled(gl.BLEND),
    scissor: gl.isEnabled(gl.SCISSOR_TEST),
    mask: gl.getParameter(gl.COLOR_WRITEMASK) as boolean[],
  };
}

function restoreState(gl: WebGL2RenderingContext, s: GlState): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
  gl.viewport(s.viewport[0], s.viewport[1], s.viewport[2], s.viewport[3]);
  gl.useProgram(s.program);
  gl.bindVertexArray(s.vao);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, s.tex0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, s.tex1);
  gl.activeTexture(s.active);
  if (s.blend) gl.enable(gl.BLEND);
  else gl.disable(gl.BLEND);
  if (s.scissor) gl.enable(gl.SCISSOR_TEST);
  else gl.disable(gl.SCISSOR_TEST);
  gl.colorMask(s.mask[0], s.mask[1], s.mask[2], s.mask[3]);
}
