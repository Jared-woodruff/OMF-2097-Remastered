// HAR color customization: each HAR uses 3 16-shade color ramps selected from ALTPALS palette 0.
import type { Palette } from '../formats/palette';
import type { Pilot } from '../formats/pilot';
import { altPalettes, loadPic } from '../resources/resources';
import { vga } from '../video/vga';

export const TERTIARY = 0;
export const SECONDARY = 1;
export const PRIMARY = 2;

/** Copies a 16-shade ramp from ALTPALS into `dst` at ramp slot `dstColor` of player `player` (index 0 preserved). */
export function loadAltpalPlayerColor(dst: Palette, player: number, srcColor: number, dstColor: number): void {
  const dstIndex = dstColor * 16 + player * 48;
  const srcIndex = srcColor * 16;
  const r0 = dst.colors[0], g0 = dst.colors[1], b0 = dst.colors[2];
  dst.copyFrom(altPalettes()[0], srcIndex, dstIndex, 16);
  dst.colors[0] = r0;
  dst.colors[1] = g0;
  dst.colors[2] = b0;
}

export function setPilotColor(pilot: Pilot, index: number, color: number): void {
  if (index === TERTIARY) pilot.color3 = color;
  else if (index === SECONDARY) pilot.color2 = color;
  else pilot.color1 = color;
  if (color < 16) {
    loadAltpalPlayerColor(pilot.palette, 0, color, index);
  } else if (color === 16) {
    const photo = loadPic('PLAYERS.PIC')[pilot.photoId];
    if (photo) pilot.palette.copyFrom(photo.palette, index * 16, index * 16, 16);
  }
}

export function setPilotColors(pilot: Pilot, c1: number, c2: number, c3: number): void {
  setPilotColor(pilot, PRIMARY, c1);
  setPilotColor(pilot, SECONDARY, c2);
  setPilotColor(pilot, TERTIARY, c3);
}

/** Loads a pilot's 47 HAR colors into the live VGA palette for the given player slot. */
export function paletteLoadPlayerColors(src: Palette, player: number): void {
  vga.setBasePaletteRange(src, player * 48 + 1, 1, 47);
}

/** Directly sets one color ramp for a player in the live palette (used by menus). */
export function paletteSetPlayerColor(player: number, srcColor: number, dstColor: number): void {
  const dstIndex = dstColor * 16 + player * 48;
  vga.setBasePaletteRange(altPalettes()[0], dstIndex, srcColor * 16, 16);
}
