// Whole-screen fades: `current` keeps the exact palette math, `undarkened` + `fade` feed the remastered renderer.
import { describe, expect, it } from 'vitest';
import { Palette } from '../formats/palette';
import { paletteDarken, paletteMixRange, vga } from '../video/vga';

function testPalette(): Palette {
  const p = new Palette();
  for (let i = 0; i < 768; i++) p.colors[i] = (i * 37) & 0xff;
  return p;
}

describe('vga palette fades', () => {
  it('leaves the fades out of the undarkened palette and records their brightness', () => {
    const base = testPalette();
    vga.setBasePalette(base);
    const tint = (pal: Palette) => paletteMixRange(pal, 7, 10, 60, 100);
    vga.enableTransform(tint);
    vga.enableTransform((pal) => paletteDarken(pal, 128));
    vga.enableTransform((pal) => paletteDarken(pal, 64));
    vga.render();

    const exact = testPalette();
    tint(exact);
    const undarkened = exact.colors.slice();
    paletteDarken(exact, 128);
    paletteDarken(exact, 64);
    expect(Array.from(vga.current.colors)).toEqual(Array.from(exact.colors));
    expect(Array.from(vga.undarkened.colors)).toEqual(Array.from(undarkened));
    expect(vga.fade).toBeCloseTo((127 / 256) * (191 / 256), 6);
  });

  it('has no fade without darkening transforms', () => {
    vga.setBasePalette(testPalette());
    vga.enableTransform((pal) => paletteMixRange(pal, 3, 0, 20, 50));
    vga.render();
    expect(vga.fade).toBe(1);
    expect(Array.from(vga.undarkened.colors)).toEqual(Array.from(vga.current.colors));
    // Darkening outside a palette rebuild applies as usual.
    const p = testPalette();
    paletteDarken(p, 255);
    expect(p.colors.every((c) => c === 0)).toBe(true);
    expect(vga.fade).toBe(1);
  });
});
