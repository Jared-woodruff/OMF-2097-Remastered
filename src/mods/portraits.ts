// Mod pilots' portraits in the game's screens. A portrait is a true-color picture (pilot.json's portrait.png); the
// screens that show pilots draw them in their own palette's portrait colors (the originals' faces use the same
// entries), so each screen gets the picture with every pixel the nearest of those colors.
import type { Palette } from '../formats/palette';
import { RSprite, type Animation } from '../resources/animation';
import type { PngImage } from '../util/png';
import { Surface } from '../video/surface';
import { modPilot } from './registry';

/** Palette entries the original portraits use in MELEE.BK and VS.BK (0xF0 and up are the cursors' and menus'). */
export const PORTRAIT_FIRST = 0xa1;
export const PORTRAIT_LAST = 0xef;

/** Box-filtered RGBA of the image scaled by `k` (<= 1), and its size. */
function scaled(img: PngImage, k: number): { w: number; h: number; rgba: Float32Array } {
  const w = Math.max(1, Math.round(img.w * k)), h = Math.max(1, Math.round(img.h * k));
  const out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * img.h) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.h) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * img.w) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.w) / w));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const q = (sy * img.w + sx) * 4, al = img.rgba[q + 3];
          r += img.rgba[q] * al;
          g += img.rgba[q + 1] * al;
          b += img.rgba[q + 2] * al;
          a += al;
          n++;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = a / n;
    }
  }
  return { w, h, rgba: out };
}

/** The nearest of the palette's entries [first, last] to a color (weighted for the eye). */
export function nearestColor(pal: Palette, first: number, last: number, r: number, g: number, b: number): number {
  let best = first, bestD = Infinity;
  for (let i = first; i <= last; i++) {
    const dr = pal.r(i) - r, dg = pal.g(i) - g, db = pal.b(i) - b;
    const d = 3 * dr * dr + 4 * dg * dg + 2 * db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * A mod pilot's portrait in a screen's colors: `fit` scales it down to fit w x h (never up: small pictures stay pixel
 * for pixel); `cover` fills a w x h cell, cropped around its top middle (the face), on `background`. `face`: the pilot
 * select grid's face picture when the pilot has one (placed in the cell's middle as it is). Null for a pilot without a
 * portrait.
 */
export function pilotPortrait(pilotId: number, pal: Palette, w: number, h: number, mode: 'fit' | 'cover', background = 0, face = false): Surface | null {
  const p = modPilot(pilotId);
  if (face && p?.face) return placed(p.face, pal, w, h, background, pilotId);
  const img = p?.portrait;
  if (!img) return null;
  const k = mode === 'fit' ? Math.min(1, w / img.w, h / img.h) : Math.max(w / img.w, h / img.h);
  const s = scaled(img, Math.min(1, k));
  const sw = mode === 'fit' ? s.w : w, sh = mode === 'fit' ? s.h : h;
  const ox = mode === 'fit' ? 0 : Math.round((s.w - w) / 2), oy = 0;
  const data = new Uint8Array(sw * sh).fill(background);
  const cache = new Map<number, number>();
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const sx = x + ox, sy = y + oy;
      if (sx < 0 || sy < 0 || sx >= s.w || sy >= s.h) continue;
      const q = (sy * s.w + sx) * 4;
      if (s.rgba[q + 3] < 128) continue;
      const r = Math.round(s.rgba[q]), g = Math.round(s.rgba[q + 1]), b = Math.round(s.rgba[q + 2]);
      const key = (r << 16) | (g << 8) | b;
      let v = cache.get(key);
      if (v === undefined) cache.set(key, (v = nearestColor(pal, PORTRAIT_FIRST, PORTRAIT_LAST, r, g, b)));
      data[y * sw + x] = v;
    }
  }
  const surf = new Surface(sw, sh, data, 0);
  surf.source = { kind: 'generated', key: `mod-pilot/${pilotId}/${mode}/${w}x${h}` };
  return surf;
}

/** A picture as it is (no scaling), centred in a w x h surface on `background`, in the palette's portrait colors. */
function placed(img: PngImage, pal: Palette, w: number, h: number, background: number, pilotId: number): Surface {
  const data = new Uint8Array(w * h).fill(background);
  const ox = Math.floor((w - img.w) / 2), oy = Math.floor((h - img.h) / 2);
  const cache = new Map<number, number>();
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const q = (y * img.w + x) * 4;
      if (img.rgba[q + 3] < 128) continue;
      const key = (img.rgba[q] << 16) | (img.rgba[q + 1] << 8) | img.rgba[q + 2];
      let v = cache.get(key);
      if (v === undefined) cache.set(key, (v = nearestColor(pal, PORTRAIT_FIRST, PORTRAIT_LAST, img.rgba[q], img.rgba[q + 1], img.rgba[q + 2])));
      const dx = x + ox, dy = y + oy;
      if (dx >= 0 && dy >= 0 && dx < w && dy < h) data[dy * w + dx] = v;
    }
  }
  const surf = new Surface(w, h, data, 0);
  surf.source = { kind: 'generated', key: `mod-pilot/${pilotId}/face` };
  return surf;
}

/**
 * Adds a mod pilot's big portrait to a scene's portrait animation (MELEE.BK and VS.BK animation 4, a sprite per pilot
 * id; the originals' stand on y 50), in the scene's colors. Nothing for original pilots.
 */
export function addPilotPortrait(ani: Animation, pilotId: number, pal: Palette): void {
  if (!modPilot(pilotId) || ani.sprites[pilotId]?.surface) return;
  const pic = pilotPortrait(pilotId, pal, 88, 69, 'fit');
  while (ani.sprites.length < pilotId) ani.sprites.push(new RSprite(ani.sprites.length, 0, 0, null));
  ani.sprites[pilotId] = new RSprite(pilotId, 5, 50 - (pic?.h ?? 0), pic);
}
