import type { Sprite } from '../formats/sprite';

let nextSurfaceId = 1;

/** A surface's origin in another image (see Surface.hdSource). */
export interface HdSource {
  surf: Surface;
  x: number;
  y: number;
  gray: boolean;
  /** The right half is the left half mirrored (backgrounds). */
  mirror?: boolean;
}

/**
 * An 8-bit indexed image. `transparent` is the palette index treated as transparent
 * (0 for sprites, -1 for opaque images like backgrounds).
 * Surfaces are immutable once handed to the renderer, except via `touch()` which
 * bumps the version so GPU caches re-upload.
 */
export class Surface {
  readonly id = nextSurfaceId++;
  version = 0;
  w: number;
  h: number;
  /** Size used when drawing (can differ from w/h for scaled portraits). */
  renderW: number;
  renderH: number;
  transparent: number;
  data: Uint8Array;
  /** Where this surface came from, used by the HD renderer to find upscaled variants. */
  source: SurfaceSource | null = null;
  /**
   * For surfaces derived at run time from another image (a region cut out of it, optionally turned grey; or a
   * background whose right half is its left half mirrored, as the VS screen makes it): the HD renderer draws that part
   * of the original's artwork.
   */
  hdSource: HdSource | null = null;
  /**
   * Remastered artwork shows only where this surface's pixels are in a robot's own colors (indices below 0x30): the VS
   * screen's robots carry pieces of the background around them, which the HD background already has.
   */
  hdOwnColors = false;

  constructor(w: number, h: number, data?: Uint8Array, transparent = 0) {
    this.w = w;
    this.h = h;
    this.renderW = w;
    this.renderH = h;
    this.transparent = transparent;
    this.data = data ?? new Uint8Array(w * h);
    if (this.data.length < w * h) {
      const d = new Uint8Array(w * h);
      d.set(this.data);
      this.data = d;
    }
  }

  static fromSprite(s: Sprite): Surface {
    if (s.isEmpty()) return new Surface(1, 1, undefined, 0);
    return new Surface(s.width, s.height, s.pixels(), 0);
  }

  touch(): void {
    this.version++;
  }

  clone(): Surface {
    const s = new Surface(this.w, this.h, this.data.slice(), this.transparent);
    s.renderW = this.renderW;
    s.renderH = this.renderH;
    s.source = this.source;
    return s;
  }

  setPixel(x: number, y: number, c: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[y * this.w + x] = c;
    this.version++;
  }

  getPixel(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[y * this.w + x];
  }

  clear(c = 0): void {
    this.data.fill(c);
    this.version++;
  }

  fillRect(x: number, y: number, w: number, h: number, c: number): void {
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    const x1 = Math.min(this.w, x + w), y1 = Math.min(this.h, y + h);
    for (let yy = y0; yy < y1; yy++) this.data.fill(c, yy * this.w + x0, yy * this.w + x1);
    this.version++;
  }

  /** Bresenham line, clamped to bounds (matches image_line). */
  line(x0: number, y0: number, x1: number, y1: number, c: number): void {
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = ((dx > dy ? dx : -dy) / 2) | 0;
    for (;;) {
      const px = Math.min(Math.max(x0, 0), this.w - 1);
      const py = Math.min(Math.max(y0, 0), this.h - 1);
      this.data[py * this.w + px] = c;
      if (x0 === x1 && y0 === y1) break;
      const e2 = err;
      if (e2 > -dx) { err -= dy; x0 += sx; }
      if (e2 < dy) { err += dx; y0 += sy; }
    }
    this.version++;
  }

  rect(x: number, y: number, w: number, h: number, c: number): void {
    this.line(x, y, x + w, y, c);
    this.line(x, y + h, x + w, y + h, c);
    this.line(x + w, y, x + w, y + h, c);
    this.line(x, y, x, y + h, c);
  }

  rectBevel(x: number, y: number, w: number, h: number, top: number, right: number, bottom: number, left: number): void {
    this.line(x, y, x + w, y, top);
    this.line(x, y + h, x + w, y + h, bottom);
    this.line(x + w, y, x + w, y + h, right);
    this.line(x, y, x, y + h, left);
  }

  /** Copies a region of src into this surface. */
  blit(src: Surface, dx: number, dy: number, sx = 0, sy = 0, w = src.w, h = src.h, mirror = false): void {
    for (let y = 0; y < h; y++) {
      const ty = dy + y, fy = sy + y;
      if (ty < 0 || ty >= this.h || fy < 0 || fy >= src.h) continue;
      for (let x = 0; x < w; x++) {
        const tx = dx + (mirror ? w - x - 1 : x), fx = sx + x;
        if (tx < 0 || tx >= this.w || fx < 0 || fx >= src.w) continue;
        this.data[ty * this.w + tx] = src.data[fy * src.w + fx];
      }
    }
    this.version++;
  }

  /** Every non-transparent pixel becomes `value`. */
  flattenToMask(value: number): void {
    for (let i = 0; i < this.data.length; i++) if (this.data[i] !== this.transparent) this.data[i] = value;
    this.version++;
  }

  convertHarToGrayscale(brightness: number): void {
    for (let i = 0; i < this.data.length; i++) {
      const idx = this.data[i];
      if (idx !== this.transparent && idx < 0x60) this.data[i] = 0xd0 + ((brightness * (idx % 0x10)) / 0x0f | 0);
    }
    this.version++;
  }

  compressIndexBlocks(rangeStart: number, rangeEnd: number, blockSize: number, amount: number): void {
    for (let i = 0; i < this.data.length; i++) {
      const idx = this.data[i];
      if (idx >= rangeStart && idx < rangeEnd) {
        const old = (idx - rangeStart) % blockSize;
        this.data[i] = idx - old + Math.max(0, old - amount);
      }
    }
    this.version++;
  }

  compressRemap(rangeStart: number, rangeEnd: number, remapTo: number, amount: number): void {
    for (let i = 0; i < this.data.length; i++) {
      const idx = this.data[i];
      if (idx >= rangeStart && idx < rangeEnd) {
        const realStart = idx - rangeStart;
        if (realStart - amount < rangeStart) this.data[i] = remapTo - Math.abs(realStart - amount);
      }
    }
    this.version++;
  }

  multiplyDecal(decal: Surface, dstX: number, dstY: number): void {
    for (let y = 0; y < decal.h; y++) {
      if (dstY + y >= this.h) continue;
      for (let x = 0; x < decal.w; x++) {
        if (dstX + x >= this.w) continue;
        const so = dstX + x + (dstY + y) * this.w;
        const d = decal.data[x + y * decal.w];
        if (this.data[so] === 0 || d === 0) continue;
        const color = this.data[so] & 0xf0;
        const value = Math.min(15, ((this.data[so] & 0x0f) * d) >> 4);
        this.data[so] = color | value;
      }
    }
    this.version++;
  }
}

/** Provenance used to match a surface with its HD counterpart. */
export interface SurfaceSource {
  kind: 'sprite' | 'background' | 'font' | 'photo' | 'generated';
  /** Stable key, e.g. "FIGHTR0.AF/12/3" or "ARENA0.BK/bg". */
  key: string;
}
