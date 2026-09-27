// Emulation of the VGA DAC state: a base palette, per-frame palette transforms and the remap tables.
import { color6to8, Palette, RemapTables } from '../formats/palette';

export type PaletteTransform = (pal: Palette) => void;

// Whole-screen fades (paletteDarken) while `current` is rebuilt: 0 = apply, 1 = apply and record, 2 = leave out.
let darkenMode = 0;
let darkenFactor = 1;

class VgaState {
  base = new Palette();
  current = new Palette();
  /**
   * `current` without the whole-screen fades. The remastered renderer draws with it and applies `fade` as one
   * brightness multiply at the end: HD artwork is mapped through palette color ratios, and a near-black palette
   * would lose its detail (or keep it at full brightness) instead of fading.
   */
  undarkened = new Palette();
  /** Brightness of the whole-screen fades included in `current` (1 = none). */
  fade = 1;
  pushed = new Palette();
  remaps = new RemapTables();
  /** Bumped whenever `current` may have changed; renderers re-upload when it differs. */
  paletteVersion = 1;
  remapVersion = 1;
  private transforms: PaletteTransform[] = [];
  private baseDirty = true;
  private hadTransforms = false;

  pushPalette(): void {
    this.pushed.colors.set(this.base.colors);
  }

  popPalette(): void {
    this.base.colors.set(this.pushed.colors);
    this.baseDirty = true;
  }

  setBasePalette(src: Palette): void {
    this.base.colors.set(src.colors);
    this.baseDirty = true;
  }

  setBasePaletteRange(src: Palette, dstStart: number, srcStart: number, count: number): void {
    this.base.colors.set(src.colors.subarray(srcStart * 3, (srcStart + count) * 3), dstStart * 3);
    this.baseDirty = true;
  }

  setBaseIndex(index: number, r: number, g: number, b: number): void {
    this.base.set(index, r, g, b);
    this.baseDirty = true;
  }

  copyBaseRange(dst: number, src: number, count: number): void {
    this.base.colors.copyWithin(dst * 3, src * 3, (src + count) * 3);
    this.baseDirty = true;
  }

  mulBasePalette(start: number, end: number, mul: number): void {
    const c = this.base.colors;
    for (let i = start * 3; i < end * 3; i++) c[i] = (mul * c[i]) | 0;
    this.baseDirty = true;
  }

  setRemaps(src: RemapTables): void {
    for (let t = 0; t < src.tables.length; t++) this.remaps.tables[t].set(src.tables[t]);
    this.remapVersion++;
  }

  markDirty(): void {
    this.baseDirty = true;
    this.remapVersion++;
  }

  enableTransform(fn: PaletteTransform): void {
    if (this.transforms.length >= 8) return;
    this.transforms.push(fn);
  }

  /** Rebuilds `current` from `base` + registered transforms (called after each game tick). */
  render(): void {
    if (this.baseDirty || this.transforms.length > 0 || this.hadTransforms) {
      this.current.colors.set(this.base.colors);
      darkenMode = 1;
      darkenFactor = 1;
      try {
        for (const t of this.transforms) t(this.current);
        this.fade = darkenFactor;
        this.undarkened.colors.set(this.base.colors);
        if (this.fade < 1) {
          // Transforms only read game state, so running them again gives the same palette without the fades.
          darkenMode = 2;
          for (const t of this.transforms) t(this.undarkened);
        } else {
          this.undarkened.colors.set(this.current.colors);
        }
      } finally {
        darkenMode = 0;
      }
      this.hadTransforms = this.transforms.length > 0;
      this.transforms.length = 0;
      this.baseDirty = false;
      this.paletteVersion++;
    }
  }
}

export const vga = new VgaState();

// ---------------------------------------------------------------------------
// Palette math helpers (exact integer behavior of the reference)

export function paletteTintRange(pal: Palette, refIndex: number, start: number, end: number, step: number): void {
  const c = pal.colors;
  const rr = c[refIndex * 3], rg = c[refIndex * 3 + 1], rb = c[refIndex * 3 + 2];
  for (let i = start; i < end; i++) {
    const r = c[i * 3], g = c[i * 3 + 1], b = c[i * 3 + 2];
    const m = Math.max(r, g, b);
    const u = (step * m) >> 8;
    c[i * 3] = (r + ((u * (rr - r)) >> 8)) & 0xff;
    c[i * 3 + 1] = (g + ((u * (rg - g)) >> 8)) & 0xff;
    c[i * 3 + 2] = (b + ((u * (rb - b)) >> 8)) & 0xff;
  }
}

export function paletteMixRange(pal: Palette, refIndex: number, start: number, end: number, step: number): void {
  const c = pal.colors;
  const rr = c[refIndex * 3], rg = c[refIndex * 3 + 1], rb = c[refIndex * 3 + 2];
  const inv = 255 - step;
  for (let i = start; i < end; i++) {
    c[i * 3] = (c[i * 3] * inv + rr * step) >> 8;
    c[i * 3 + 1] = (c[i * 3 + 1] * inv + rg * step) >> 8;
    c[i * 3 + 2] = (c[i * 3 + 2] * inv + rb * step) >> 8;
  }
}

export function paletteDarken(pal: Palette, step: number): void {
  if (darkenMode === 2) return;
  const c = pal.colors;
  const inv = 255 - step;
  if (darkenMode === 1) darkenFactor *= Math.max(0, inv) / 256;
  for (let i = 0; i < 768; i++) c[i] = (c[i] * inv) >> 8;
}

export function paletteLightRange(pal: Palette, gray: number, start: number, end: number, blend: number): void {
  const c = pal.colors;
  for (let i = start; i < end; i++) {
    const m = Math.max(c[i * 3], c[i * 3 + 1], c[i * 3 + 2]);
    for (let k = 0; k < 3; k++) {
      const v = c[i * 3 + k];
      const n = v + Math.trunc(Math.trunc(Math.trunc(((gray - v) * blend) / 256) * m) / 256);
      c[i * 3 + k] = n < 0 ? 0 : n > 255 ? 255 : n;
    }
  }
}

// Menu colors placed at indices 250..255 by every scene (from the reference engine).
const MENU_COLORS: [number, number, number][] = [
  [0, 0, 42], [0, 0, 60], [0, 0, 22], [0, 63, 0], [0, 30, 0], [20, 63, 20],
];
const PULSE_COLORS: [number, number, number][] = [
  [0, 30, 0], [2, 34, 2], [5, 38, 5], [7, 42, 7], [10, 46, 10], [12, 50, 12], [15, 54, 15], [17, 60, 17], [20, 63, 20],
];

export function setMenuColors(): void {
  MENU_COLORS.forEach(([r, g, b], i) => vga.setBaseIndex(250 + i, color6to8(r), color6to8(g), color6to8(b)));
}

export function pulseMenuColors(tick: number): void {
  let i = tick % 16;
  if (i > 8) i = 16 - i;
  const [r, g, b] = PULSE_COLORS[i];
  vga.setBaseIndex(255, color6to8(r), color6to8(g), color6to8(b));
}
