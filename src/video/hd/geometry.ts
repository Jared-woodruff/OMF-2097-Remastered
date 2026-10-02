// The arenas' geometry maps (public/hd/geometry, made by tools/arena-geo.py): each HD arena painting's surface direction
// and depth, so the remastered renderer can give the background parallax (the camera's shake and zooms move near
// things more than far ones) and light it by its shape (a hit's flash on the floor and the walls facing it). Found by
// the painting's pixel hash, like the artwork itself; loaded when an arena with one is first drawn.

/**
 * A loaded geometry map. It covers the widescreen frame of the paintings, native x -128..448, y 0..200; or, for an
 * arena without a widescreen picture (a mod's), the classic screen's x 0..320, mirrored beyond it like its painting.
 */
export interface ArenaGeometry {
  /** RGBA: the surface normal (OpenGL convention: x right, y up, z towards the viewer; encoded 0..1) and the depth as
   * normalized disparity (1 near .. 0 far). Not premultiplied. */
  tex: WebGLTexture;
  /** Disparity of the floor the robots stand on: the fighting plane. */
  floor: number;
  /** Disparity offset of the farthest painted parts (0 = at infinity, like a sky). */
  far: number;
  /** How much of the parallax the camera's moves get (1 = all; less where thin near things stand in front of far ones). */
  parallax: number;
  /** It covers the widescreen frame (else the classic screen, mirrored beyond it). */
  wide: boolean;
  /** Disparity at a native point (from a small copy kept for lights placed on the scenery). */
  disparityAt(x: number, y: number): number;
}

interface GeometryInfo {
  /** Where the map's file is (the installed ones), or its bytes (a mod's). */
  url?: string;
  data?: Uint8Array;
  floor: number;
  far: number;
  parallax: number;
}

/** The geometry maps' frame (native). */
export const GEOMETRY_X0 = -128;
export const GEOMETRY_W = 576;
export const GEOMETRY_H = 200;
/** The small CPU copy's size. */
const COPY_W = 144;
const COPY_H = 50;

export class GeometryStore {
  private gl: WebGL2RenderingContext | null = null;
  private info = new Map<string, GeometryInfo>();
  private maps = new Map<string, ArenaGeometry | 'loading' | 'failed'>();

  /** Reads the index of the installed maps (none is fine). */
  async init(gl: WebGL2RenderingContext, baseUrl = 'hd/'): Promise<void> {
    this.gl = gl;
    try {
      const res = await fetch(`${baseUrl}geometry/index.json`);
      if (!res.ok) return;
      const index = (await res.json()) as Record<string, { file: string; floor: number; far: number; parallax?: number }>;
      for (const [hash, e] of Object.entries(index)) {
        this.info.set(hash, { url: `${baseUrl}geometry/${e.file}`, floor: e.floor, far: e.far, parallax: e.parallax ?? 1 });
      }
    } catch {
      // (no maps: the arenas are drawn flat)
    }
  }

  /**
   * Adds a map at run time (a mod's arena), from its file's bytes; the same bytes again (the arena's pictures wanted
   * once more) change nothing, a new map frees the old one's texture.
   */
  registerData(hash: string, data: Uint8Array, floor: number, far: number, parallax = 1): void {
    const had = this.info.get(hash);
    if (had && had.data === data && had.floor === floor && had.far === far && had.parallax === parallax) return;
    this.info.set(hash, { data, floor, far, parallax });
    const m = this.maps.get(hash);
    if (m && typeof m === 'object') this.gl?.deleteTexture(m.tex);
    this.maps.delete(hash);
  }

  /** The map of the painting with this hash, or null (none, or still loading: it starts loading on the first call). */
  get(hash: string): ArenaGeometry | null {
    const m = this.maps.get(hash);
    if (m && m !== 'loading' && m !== 'failed') return m;
    if (m) return null;
    const info = this.info.get(hash);
    if (!info || !this.gl) return null;
    this.maps.set(hash, 'loading');
    this.load(info).then(
      (g) => this.maps.set(hash, g),
      (err) => {
        console.warn('Arena geometry map failed to load:', info.url ?? hash, err);
        this.maps.set(hash, 'failed');
      },
    );
    return null;
  }

  private async load(info: GeometryInfo): Promise<ArenaGeometry> {
    const gl = this.gl!;
    let blob: Blob;
    if (info.data) {
      blob = new Blob([info.data as BlobPart]);
    } else {
      const res = await fetch(info.url!);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      blob = await res.blob();
    }
    // (raw values: the alpha channel is the depth, not coverage)
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const small = await createImageBitmap(blob, {
      premultiplyAlpha: 'none', colorSpaceConversion: 'none', resizeWidth: COPY_W, resizeHeight: COPY_H, resizeQuality: 'medium',
    });
    const disparity = readAlpha(small);
    const wide = bmp.width / bmp.height > 2;
    bmp.close();
    small.close();
    return {
      tex,
      floor: info.floor,
      far: info.far,
      parallax: info.parallax,
      wide,
      disparityAt(x, y) {
        const u = wide ? (x - GEOMETRY_X0) / GEOMETRY_W : mirrored(x) / 320;
        const gx = Math.max(0, Math.min(COPY_W - 1, Math.floor(u * COPY_W)));
        const gy = Math.max(0, Math.min(COPY_H - 1, Math.floor((y / GEOMETRY_H) * COPY_H)));
        return disparity[gy * COPY_W + gx] / 255;
      },
    };
  }
}

/** A native x on the classic screen's map: mirrored at its edges, like a classic painting's widescreen sides. */
function mirrored(x: number): number {
  const m = x < 0 ? -x : x > 320 ? 640 - x : x;
  return Math.max(0, Math.min(320, m));
}

/** A picture's alpha channel (its depth here), through a 2D canvas (which keeps alpha as it is). */
function readAlpha(bmp: ImageBitmap): Uint8Array {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0);
  const rgba = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  const out = new Uint8Array(bmp.width * bmp.height);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4 + 3];
  return out;
}

export const arenaGeometry = new GeometryStore();
