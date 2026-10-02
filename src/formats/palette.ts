import type { BinaryReader, BinaryWriter } from '../util/reader';

/** Number of 256-byte color remap tables stored alongside each BK palette. */
export const REMAP_COUNT = 19;

/** Converts a 6-bit VGA DAC value to 8 bits exactly like the reference engine. */
export function color6to8(c: number): number {
  return ((c << 2) | ((c & 0x30) >> 4)) & 0xff;
}

export function color8to6(c: number): number {
  return (c >> 2) & 0x3f;
}

/** 256-color palette stored as 8-bit RGB triplets. */
export class Palette {
  readonly colors: Uint8Array;

  constructor(colors?: Uint8Array) {
    this.colors = colors ? colors.slice() : new Uint8Array(768);
  }

  clone(): Palette {
    return new Palette(this.colors);
  }

  copyRange(src: Palette, start: number, count: number): void {
    this.colors.set(src.colors.subarray(start * 3, (start + count) * 3), start * 3);
  }

  /** Copies `count` colors from src[srcStart..] to this[dstStart..]. */
  copyFrom(src: Palette, srcStart: number, dstStart: number, count: number): void {
    this.colors.set(src.colors.subarray(srcStart * 3, (srcStart + count) * 3), dstStart * 3);
  }

  set(index: number, r: number, g: number, b: number): void {
    this.colors[index * 3] = r;
    this.colors[index * 3 + 1] = g;
    this.colors[index * 3 + 2] = b;
  }

  r(i: number): number {
    return this.colors[i * 3];
  }
  g(i: number): number {
    return this.colors[i * 3 + 1];
  }
  b(i: number): number {
    return this.colors[i * 3 + 2];
  }

  /** Reads `count` 6-bit RGB entries into [start, start+count). */
  loadRange(r: BinaryReader, start: number, count: number): void {
    for (let i = start; i < start + count; i++) {
      this.colors[i * 3] = color6to8(r.u8());
      this.colors[i * 3 + 1] = color6to8(r.u8());
      this.colors[i * 3 + 2] = color6to8(r.u8());
    }
  }

  saveRange(w: BinaryWriter, start: number, count: number): void {
    for (let i = start; i < start + count; i++) {
      w.u8(color8to6(this.colors[i * 3]));
      w.u8(color8to6(this.colors[i * 3 + 1]));
      w.u8(color8to6(this.colors[i * 3 + 2]));
    }
  }

  static load(r: BinaryReader): Palette {
    const p = new Palette();
    p.loadRange(r, 0, 256);
    return p;
  }

  /** Index of the exact color, or 0. */
  resolve(r: number, g: number, b: number): number {
    for (let i = 0; i < 256; i++) {
      if (this.colors[i * 3] === r && this.colors[i * 3 + 1] === g && this.colors[i * 3 + 2] === b) return i;
    }
    return 0;
  }

  /** Closest color index in [start, end] by squared RGB distance. */
  resolveClosest(start: number, end: number, r: number, g: number, b: number): number {
    let best = start;
    let bestDist = 255 * 255 * 3 + 1;
    for (let i = start; i <= end; i++) {
      const dr = this.colors[i * 3] - r;
      const dg = this.colors[i * 3 + 1] - g;
      const db = this.colors[i * 3 + 2] - b;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) {
        bestDist = d;
        best = i;
        if (d === 0) break;
      }
    }
    return best;
  }
}

/** The 19 remap tables (index -> index) used for shadows, glows and tints. */
export class RemapTables {
  readonly tables: Uint8Array[];

  constructor() {
    this.tables = [];
    for (let t = 0; t < REMAP_COUNT; t++) {
      const tb = new Uint8Array(256);
      for (let i = 0; i < 256; i++) tb[i] = i;
      this.tables.push(tb);
    }
  }

  static load(r: BinaryReader): RemapTables {
    const rt = new RemapTables();
    for (let t = 0; t < REMAP_COUNT; t++) rt.tables[t].set(r.bytes(256));
    return rt;
  }

  clone(): RemapTables {
    const rt = new RemapTables();
    for (let t = 0; t < REMAP_COUNT; t++) rt.tables[t].set(this.tables[t]);
    return rt;
  }
}
