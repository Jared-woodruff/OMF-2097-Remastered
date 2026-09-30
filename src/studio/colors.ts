// Colors as the game shows them, for OMF Studio's pictures. Robots are drawn with a fight's palette: the pilot's three
// color ramps in entries 1-47 (from ALTPALS.DAT, like the game's color choices) and the effect colors every arena
// shares (0xA0-0xF9, from ARENA0.BK); arenas with their own colors (0x60-0x9F) over the shared ones.
import type { BkFile } from '../formats/bk';
import { parseBK } from '../formats/bk';
import { Palette } from '../formats/palette';
import { getFile } from '../resources/files';
import { altPalettes } from '../resources/resources';

let arena0: BkFile | null = null;

/** The first original arena (its palette has the colors every arena shares). */
export function referenceArena(): BkFile {
  if (!arena0) arena0 = parseBK(getFile('ARENA0.BK'));
  return arena0;
}

/** A color choice's swatch (the bright middle of its ramp). */
export function rampColor(c: number): string {
  const ramps = altPalettes()[0];
  const i = c * 16 + 11;
  return `rgb(${ramps.r(i)},${ramps.g(i)},${ramps.b(i)})`;
}

/**
 * A fight's palette with a pilot's colors (0-15 each: primary, secondary, tertiary; the game's pilot color choices):
 * entries 0-47 their ramps, the rest the first original arena's.
 */
export function robotPalette(colors: [number, number, number]): Palette {
  const pal = referenceArena().palettes[0].clone();
  const ramps = altPalettes()[0];
  // TERTIARY 0, SECONDARY 1, PRIMARY 2 (pilotColors.ts): color3 fills ramp 0, color2 ramp 1, color1 ramp 2.
  const order = [colors[2], colors[1], colors[0]];
  order.forEach((c, slot) => pal.copyFrom(ramps, c * 16, slot * 16, 16));
  pal.set(0, 0, 0, 0);
  return pal;
}

/** An arena's palette as the game builds it: its own colors (0x60-0x9F) over the shared ones. */
export function arenaPalette(bk: BkFile, index = 0): Palette {
  const pal = referenceArena().palettes[0].clone();
  const own = bk.palettes[index] ?? bk.palettes[0];
  if (own) pal.copyRange(own, 0x60, 0x40);
  return pal;
}

/** RGBA of indexed pixels (index 0 see-through unless `opaque0`). */
export function toRgba(pixels: Uint8Array, pal: Palette, opaque0 = false): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(pixels.length * 4);
  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i];
    if (v === 0 && !opaque0) continue;
    out[i * 4] = pal.r(v);
    out[i * 4 + 1] = pal.g(v);
    out[i * 4 + 2] = pal.b(v);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** A canvas with indexed pixels drawn in a palette (1:1). */
export function indexedCanvas(pixels: Uint8Array, w: number, h: number, pal: Palette, opaque0 = false): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  if (w > 0 && h > 0) c.getContext('2d')!.putImageData(new ImageData(toRgba(pixels, pal, opaque0), w, h), 0, 0);
  return c;
}

/** CSS color of a palette entry. */
export function cssColor(pal: Palette, i: number): string {
  return `rgb(${pal.r(i)},${pal.g(i)},${pal.b(i)})`;
}

/** The nearest palette entry among `entries` to a color. */
export function nearestEntry(pal: Palette, entries: number[], r: number, g: number, b: number): number {
  let best = entries[0], bestD = Infinity;
  for (const i of entries) {
    const dr = pal.r(i) - r, dg = pal.g(i) - g, db = pal.b(i) - b;
    const d = 3 * dr * dr + 4 * dg * dg + 2 * db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** The entries a robot's sprites use: its three ramps (1-47) and the shared effect colors (0xA0-0xF9). */
export const ROBOT_ENTRIES = [...Array.from({ length: 47 }, (_, i) => i + 1), ...Array.from({ length: 0xfa - 0xa0 }, (_, i) => 0xa0 + i)];
/** The entries of a robot's own colors (its three ramps). */
export const RAMP_ENTRIES = Array.from({ length: 47 }, (_, i) => i + 1);
