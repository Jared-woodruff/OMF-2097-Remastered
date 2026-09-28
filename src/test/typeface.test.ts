// The remastered typeface (video/hd/typeface.ts): which characters it draws, how glyphs are fitted in the original
// cells, the distance field it stores, and the FONT setting it became the default of.
import { describe, expect, it } from 'vitest';
import type { BitmapFont } from '../formats/misc';
import { defaultSettings, loadSettings, settings } from '../game/settings';
import { fonts } from '../resources/resources';
import { distanceField, fitScale, GLYPH_RANGE, GLYPH_TEXELS, inkColumns, typefaceChar } from '../video/hd/typeface';
import { hasGameData, installBrowserShims, loadGameData } from './harness';

/** A font whose glyphs spell their character code in their first row (so every glyph differs), lowercase = capitals if asked. */
function fakeFont(size: number, lowercaseAsCapitals: boolean): BitmapFont {
  const glyphs: Uint8Array[] = [];
  for (let c = 0; c < 224; c++) {
    const g = new Uint8Array(size * size);
    const code = c + 32;
    const src = lowercaseAsCapitals && code >= 97 && code <= 122 ? code - 32 : code;
    for (let b = 0; b < 8; b++) g[(b % size) + Math.floor(b / size) * size] = (src >> b) & 1;
    g[size * size - 1] = 1;
    glyphs.push(g);
  }
  return { size, glyphs };
}

describe('typeface characters', () => {
  it('draws printable ASCII except space and the slider pattern', () => {
    const f = fakeFont(8, false);
    expect(typefaceChar(f, 'A'.charCodeAt(0) - 32)).toBe('A');
    expect(typefaceChar(f, 'z'.charCodeAt(0) - 32)).toBe('z');
    expect(typefaceChar(f, 0)).toBeNull(); // space
    expect(typefaceChar(f, '|'.charCodeAt(0) - 32)).toBeNull();
    expect(typefaceChar(f, 127 - 32)).toBeNull();
    expect(typefaceChar(f, 200)).toBeNull();
  });

  it('a font that repeats its capitals as lowercase gets capitals', () => {
    const f = fakeFont(6, true);
    expect(typefaceChar(f, 'g'.charCodeAt(0) - 32)).toBe('G');
    expect(typefaceChar(f, 'G'.charCodeAt(0) - 32)).toBe('G');
  });

  it('empty glyphs are left alone', () => {
    const f = fakeFont(8, false);
    f.glyphs['#'.charCodeAt(0) - 32] = new Uint8Array(64);
    expect(typefaceChar(f, '#'.charCodeAt(0) - 32)).toBeNull();
  });

  it('ink columns', () => {
    const g = new Uint8Array(36);
    g[1 * 6 + 1] = 1;
    g[4 * 6 + 4] = 1;
    expect(inkColumns(g, 6)).toEqual([1, 5]);
    expect(inkColumns(new Uint8Array(36), 6)).toBeNull();
  });
});

describe('typeface fitting', () => {
  it('squeezes wide glyphs to the original ink (or the usual width) and widens moderately narrow ones a little', () => {
    // W: 11.5 px wide in the typeface, 6 px of ink in the original
    expect(fitScale(11.5, 6, 6)).toBeCloseTo(6 / 11.5);
    // a narrow original never limits below the cell's usual ink width
    expect(fitScale(5.5, 3, 5)).toBeCloseTo(5 / 5.5);
    // 4 px wide for 5 px of ink: widened, at most by a quarter
    expect(fitScale(4, 5, 6)).toBeCloseTo(1.25);
    expect(fitScale(4.5, 5, 6)).toBeCloseTo(5 / 4.5);
    // a bare stem standing for a serifed original is not made heavier
    expect(fitScale(1.8, 4, 6)).toBe(1);
    // narrow originals (i, l, punctuation): at most 1.5 px wider than their ink
    expect(fitScale(4, 2, 6)).toBeCloseTo(3.5 / 4);
  });

  it('the distance field is 128 on the edge, lower inside, higher outside', () => {
    const tile = 8 * GLYPH_TEXELS, w = tile * 2, h = tile;
    const rgba = new Uint8Array(w * h * 4);
    // a filled square in the second tile, 3 native pixels wide
    const x0 = tile + 2 * GLYPH_TEXELS, x1 = x0 + 3 * GLYPH_TEXELS, y0 = 2 * GLYPH_TEXELS, y1 = y0 + 3 * GLYPH_TEXELS;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) rgba[(y * w + x) * 4 + 3] = 255;
    const d = distanceField(rgba, w, h, tile, [[0, 0], [tile, 0]]);
    const at = (x: number, y: number) => d[y * w + x];
    const cy = (y0 + y1) >> 1;
    // the empty tile: everything as far outside as can be stored
    expect(at(tile >> 1, tile >> 1)).toBe(255);
    // inside the square: 1.5 native pixels from the edge at its center
    expect(at((x0 + x1) >> 1, cy)).toBeCloseTo(128 - (1.5 * 127) / GLYPH_RANGE, -1);
    // one native pixel outside its left edge
    expect(at(x0 - GLYPH_TEXELS, cy)).toBeCloseTo(128 + 127 / GLYPH_RANGE, -1);
    // at the edge
    expect(Math.abs(at(x0, cy) - 128)).toBeLessThan(8);
  });
});

describe('FONT setting', () => {
  it('is the typeface by default; the old default (smooth) saved before becomes the typeface, other choices stay', () => {
    installBrowserShims();
    expect(defaultSettings().video.hdFont).toBe('type');
    const save = (revision: number, hdFont: string) => {
      const s = defaultSettings() as unknown as { revision: number; video: { hdFont: string } };
      s.revision = revision;
      s.video.hdFont = hdFont;
      localStorage.setItem('omf2097r.settings', JSON.stringify(s));
    };
    save(2, 'smooth');
    expect(loadSettings().video.hdFont).toBe('type');
    save(2, 'pixel');
    expect(loadSettings().video.hdFont).toBe('pixel');
    save(3, 'smooth');
    expect(loadSettings().video.hdFont).toBe('smooth');
    save(3, 'type');
    loadSettings();
    expect(settings().video.hdFont).toBe('type');
    localStorage.removeItem('omf2097r.settings');
  });
});

describe.skipIf(!hasGameData)('the game fonts', () => {
  it('every printable character with ink but the slider pattern gets a typeface glyph; the small font is all capitals', () => {
    installBrowserShims();
    loadGameData();
    const f = fonts();
    for (const font of [f.small, f.big]) {
      let drawn = 0;
      for (let c = 33; c <= 126; c++) {
        const ch = String.fromCharCode(c);
        const mapped = typefaceChar(font, c - 32);
        if (ch === '|' || !inkColumns(font.glyphs[c - 32], font.size)) expect(mapped).toBeNull();
        else {
          expect(mapped).not.toBeNull();
          drawn++;
        }
      }
      // (the fonts have all the letters, digits and the usual punctuation)
      expect(drawn).toBeGreaterThan(80);
    }
    for (const ch of 'abcxyz') expect(typefaceChar(f.small, ch.charCodeAt(0) - 32)).toBe(ch.toUpperCase());
    for (const ch of 'abcxyz') expect(typefaceChar(f.big, ch.charCodeAt(0) - 32)).toBe(ch);
  });
});
