// Remastered artwork: loads the HD asset bundles produced by the importer (tools/hd-pack/intake.py) and maps the
// game's indexed surfaces to their HD images by pixel fingerprint. Bundles (one per scene / robot, plus shared
// effects, arena graphics and portraits) load on demand; until a bundle is ready, the renderer keeps using its
// procedural upscaler for those images. Optional: without public/hd/index.json the game simply has no HD artwork.
import type { Surface } from '../surface';
import { pixelHash } from './pixelHash';

export interface HdEntry {
  hash: string;
  bundle: string;
  kind: string;
  /** Atlas page (sprites) or -1. */
  page?: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Trim offset of the stored rectangle inside the full (padded) HD image. */
  tx?: number;
  ty?: number;
  /** Full HD size of the padded native image. */
  fw?: number;
  fh?: number;
  /** Native transparent margin the HD image covers on each side. */
  pad?: number;
  /** Row of the base-palette texture: the palette the artwork was made against. */
  palette: number;
  files: string[];
  recolor?: string;
  /** Backgrounds: image index in the bundle, and the widescreen canvas. */
  image?: number;
  wide?: number;
}

interface IndexFile {
  format: string;
  version: number;
  scale: { x: number; y: number };
  palettes: string[];
  bundles: Record<string, { pages: { file: string; w: number; h: number }[]; images: { file: string; w: number; h: number }[]; bytes: number; pixels: number }>;
  entries: HdEntry[];
}

export interface HdTexture {
  tex: WebGLTexture;
  /** Logical size (as stored in the bundle; texture coordinates are relative to it). */
  w: number;
  h: number;
}

interface BundleState {
  name: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  pages: HdTexture[];
  images: HdTexture[];
  bytes: number;
  lastUsed: number;
}

/** A resolved HD image for a draw. */
export interface HdImage {
  entry: HdEntry;
  /** Atlas page texture (sprites) — undefined for backgrounds. */
  page?: HdTexture;
  /** Background image and widescreen canvas. */
  image?: HdTexture;
  wide?: HdTexture;
  /** Drawing a region of another surface's artwork (see Surface.hdSource). */
  sub?: { surf: Surface; x: number; y: number; gray: boolean };
}

export const HAR_BUNDLES = ['JAGUAR', 'SHADOW', 'THORN', 'PYROS', 'ELECTRA', 'KATANA', 'SHREDDER', 'FLAIL', 'GARGOYLE', 'CHRONOS', 'NOVA'];

/** GPU memory the loaded bundles may use before unused ones are released. */
const BUDGET_BYTES = 1200 * 1024 * 1024;

export class HdAssets {
  /** Turned off by the player (VIDEO > HD ARTWORK) or when no artwork is installed. */
  enabled = true;
  /**
   * Resolution the artwork is loaded at (1 = full, 0.5 = half: a quarter of the GPU memory, for integrated GPUs).
   * Changing it only affects bundles loaded afterwards.
   */
  textureScale = 1;
  ready = false;
  /** Base palettes (256 x N RGBA texture), one row per palette the artwork was made against. */
  basePalTex: WebGLTexture | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private baseUrl = 'hd/';
  private index: IndexFile | null = null;
  private byHash = new Map<string, HdEntry[]>();
  private bundles = new Map<string, BundleState>();
  private surfHash = new WeakMap<Surface, { version: number; hash: string }>();
  private frame = 0;
  private loadingCount = 0;

  /** Loads the index (if HD artwork is installed). Never rejects. */
  async init(gl: WebGL2RenderingContext, baseUrl = 'hd/'): Promise<void> {
    this.gl = gl;
    this.baseUrl = baseUrl;
    try {
      const res = await fetch(`${baseUrl}index.json`);
      if (!res.ok) return;
      const index = (await res.json()) as IndexFile;
      if (index.format !== 'omf2097-hd-assets') return;
      this.index = index;
      for (const e of index.entries) {
        const list = this.byHash.get(e.hash);
        if (list) list.push(e);
        else this.byHash.set(e.hash, [e]);
      }
      // Base palettes texture.
      const rows = index.palettes.length;
      const data = new Uint8Array(256 * rows * 4);
      index.palettes.forEach((hex, r) => {
        for (let i = 0; i < 256; i++) {
          data[(r * 256 + i) * 4] = parseInt(hex.substr(i * 6, 2), 16);
          data[(r * 256 + i) * 4 + 1] = parseInt(hex.substr(i * 6 + 2, 2), 16);
          data[(r * 256 + i) * 4 + 2] = parseInt(hex.substr(i * 6 + 4, 2), 16);
          data[(r * 256 + i) * 4 + 3] = 255;
        }
      });
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.basePalTex = tex;
      for (const name of Object.keys(index.bundles)) {
        this.bundles.set(name, { name, status: 'idle', pages: [], images: [], bytes: 0, lastUsed: 0 });
      }
      this.ready = true;
    } catch (err) {
      console.warn('[hd] no HD artwork available:', err);
    }
  }

  /** True when HD artwork is installed and turned on. */
  get active(): boolean {
    return this.ready && this.enabled;
  }

  /** Number of bundles currently loading (for diagnostics / loading screens). */
  get pending(): number {
    return this.loadingCount;
  }

  beginFrame(): void {
    this.frame++;
  }

  /** The HD image for a surface, or null (not remastered, or its bundle is still loading — then it starts loading). */
  lookup(surf: Surface): HdImage | null {
    if (!this.active) return null;
    let h = this.surfHash.get(surf);
    if (!h || h.version !== surf.version) {
      h = { version: surf.version, hash: pixelHash(surf.w, surf.h, surf.data.subarray(0, surf.w * surf.h)) };
      this.surfHash.set(surf, h);
    }
    const list = this.byHash.get(h.hash);
    if (!list) return null;
    let entry = list[0];
    if (list.length > 1) {
      // Identical pixels drawn with different palettes: prefer the image made for this surface's file.
      const file = surf.source?.key.split('/')[0] ?? '';
      entry = list.find((e) => e.files.includes(file)) ?? entry;
    }
    const b = this.bundles.get(entry.bundle);
    if (!b) return null;
    b.lastUsed = this.frame;
    if (b.status !== 'ready') {
      if (b.status === 'idle') void this.load(b);
      return null;
    }
    if (entry.page !== undefined && entry.page >= 0) return { entry, page: b.pages[entry.page] };
    if (entry.image !== undefined) {
      return { entry, image: b.images[entry.image], wide: entry.wide !== undefined ? b.images[entry.wide] : undefined };
    }
    return null;
  }

  /** Like lookup(), falling back to the artwork of the image a derived surface was made from. */
  lookupDerived(surf: Surface): HdImage | null {
    const img = this.lookup(surf);
    if (img || !surf.hdSource) return img;
    const parent = this.lookup(surf.hdSource.surf);
    return parent?.page ? { ...parent, sub: surf.hdSource } : null;
  }

  /** Starts loading bundles that will be needed soon (e.g. both robots while the VS screen shows). */
  preload(names: string[]): void {
    if (!this.active) return;
    for (const n of names) {
      const b = this.bundles.get(n);
      if (!b) continue;
      b.lastUsed = this.frame;
      if (b.status === 'idle') void this.load(b);
    }
  }

  /** Resolves once the named bundles are loaded (or failed), or after `timeoutMs`. */
  async whenReady(names: string[], timeoutMs: number): Promise<void> {
    if (!this.active) return;
    this.preload(names);
    const end = performance.now() + timeoutMs;
    const busy = () => names.some((n) => this.bundles.get(n)?.status === 'loading');
    while (busy() && performance.now() < end) await new Promise((r) => setTimeout(r, 30));
  }

  private async load(b: BundleState): Promise<void> {
    const gl = this.gl!;
    const info = this.index!.bundles[b.name];
    b.status = 'loading';
    this.loadingCount++;
    try {
      const scale = this.textureScale;
      const fetchTex = async (file: string, w: number, h: number, mips: boolean): Promise<HdTexture> => {
        const res = await fetch(`${this.baseUrl}${b.name}/${file}`);
        if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
        const opts: ImageBitmapOptions = { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' };
        if (scale < 1) {
          opts.resizeWidth = Math.max(1, Math.round(w * scale));
          opts.resizeHeight = Math.max(1, Math.round(h * scale));
          opts.resizeQuality = 'high';
        }
        const bmp = await createImageBitmap(await res.blob(), opts);
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (mips) {
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        } else {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        }
        b.bytes += bmp.width * bmp.height * 4 * (mips ? 1.34 : 1);
        bmp.close();
        return { tex, w, h };
      };
      const pages = await Promise.all(info.pages.map((p) => fetchTex(p.file, p.w, p.h, true)));
      const images = await Promise.all(info.images.map((p) => fetchTex(p.file, p.w, p.h, true)));
      b.pages = pages;
      b.images = images;
      b.status = 'ready';
      this.evict(b);
    } catch (err) {
      console.warn(`[hd] bundle ${b.name} failed to load:`, err);
      b.status = 'error';
    } finally {
      this.loadingCount--;
    }
  }

  /** Releases least recently used bundles while over the memory budget (never the one just loaded). */
  private evict(keep: BundleState): void {
    const gl = this.gl!;
    let total = 0;
    for (const b of this.bundles.values()) if (b.status === 'ready') total += b.bytes;
    if (total <= BUDGET_BYTES) return;
    const candidates = [...this.bundles.values()]
      .filter((b) => b.status === 'ready' && b !== keep && this.frame - b.lastUsed > 120)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const b of candidates) {
      if (total <= BUDGET_BYTES) break;
      for (const t of [...b.pages, ...b.images]) gl.deleteTexture(t.tex);
      total -= b.bytes;
      b.pages = [];
      b.images = [];
      b.bytes = 0;
      b.status = 'idle';
    }
  }

  /** Bundle names for a scene file (e.g. 'ARENA0.BK') and the robots taking part. */
  static bundlesFor(bkFile: string | null, harIds: number[], fight: boolean): string[] {
    const out: string[] = ['portraits'];
    if (bkFile) out.push(`scene-${bkFile.replace(/\.BK$/i, '')}`);
    if (fight) out.push('arenas-shared', 'effects');
    for (const id of harIds) if (HAR_BUNDLES[id]) out.push(`fighter-${HAR_BUNDLES[id]}`);
    return out;
  }
}

export const hdAssets = new HdAssets();
