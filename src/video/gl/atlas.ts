import type { Surface } from '../surface';

export interface AtlasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Entry extends AtlasRect {
  version: number;
  frame: number;
}

/** Border around each surface: the HD filters read up to two texels outside it, text halos four. */
const PAD = 4;

/**
 * Texture atlas of indexed surfaces (R8UI). Simple shelf packer; when it fills up, it is
 * reset and repacked with whatever the current frame needs.
 */
export class IndexAtlas {
  readonly tex: WebGLTexture;
  private entries = new Map<number, Entry>();
  private shelfX = 0;
  private shelfY = 0;
  private shelfH = 0;
  private frame = 0;

  constructor(private gl: WebGL2RenderingContext, readonly size = 4096) {
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8UI, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Times the atlas started over (a surface placed before one this frame may have been overwritten). */
  resets = 0;

  reset(): void {
    this.entries.clear();
    this.shelfX = 0;
    this.shelfY = 0;
    this.shelfH = 0;
    this.resets++;
  }

  beginFrame(): void {
    this.frame++;
  }

  private alloc(w: number, h: number): AtlasRect | null {
    const pw = w + PAD * 2, ph = h + PAD * 2;
    if (pw > this.size || ph > this.size) return null;
    if (this.shelfX + pw > this.size) {
      this.shelfY += this.shelfH;
      this.shelfX = 0;
      this.shelfH = 0;
    }
    if (this.shelfY + ph > this.size) return null;
    const r = { x: this.shelfX + PAD, y: this.shelfY + PAD, w, h };
    this.shelfX += pw;
    this.shelfH = Math.max(this.shelfH, ph);
    return r;
  }

  /**
   * Uploads the surface together with its padding border: filled with the transparent index, or with
   * replicated edges for opaque surfaces, so filters that read a couple of texels outside the rectangle
   * (HD reconstruction, shadow coverage) see sensible neighbors instead of another surface's pixels.
   */
  private upload(r: AtlasRect, s: Surface): void {
    const gl = this.gl;
    const pw = s.w + PAD * 2, ph = s.h + PAD * 2;
    const buf = new Uint8Array(pw * ph);
    const src = s.data;
    if (s.transparent >= 0) buf.fill(s.transparent);
    for (let y = 0; y < ph; y++) {
      const sy = y - PAD;
      if (s.transparent >= 0) {
        if (sy < 0 || sy >= s.h) continue;
        buf.set(src.subarray(sy * s.w, sy * s.w + s.w), y * pw + PAD);
      } else {
        const row = Math.min(s.h - 1, Math.max(0, sy)) * s.w;
        for (let x = 0; x < pw; x++) buf[y * pw + x] = src[row + Math.min(s.w - 1, Math.max(0, x - PAD))];
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x - PAD, r.y - PAD, pw, ph, gl.RED_INTEGER, gl.UNSIGNED_BYTE, buf);
  }

  /** Ensures the surface is resident; returns its rectangle or null if it cannot fit this frame. */
  get(s: Surface): AtlasRect | null {
    let e = this.entries.get(s.id);
    if (e && e.w === s.w && e.h === s.h) {
      if (e.version !== s.version) {
        this.upload(e, s);
        e.version = s.version;
      }
      e.frame = this.frame;
      return e;
    }
    let r = this.alloc(s.w, s.h);
    if (!r) {
      // Full: drop everything not used this frame by starting over. Callers re-request
      // this frame's surfaces, so only the working set gets re-uploaded.
      this.reset();
      r = this.alloc(s.w, s.h);
      if (!r) return null;
    }
    e = { ...r, version: s.version, frame: this.frame };
    this.entries.set(s.id, e);
    this.upload(e, s);
    return e;
  }
}
