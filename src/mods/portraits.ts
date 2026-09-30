// Mod pilots' portraits in the game's screens. A portrait is a true-color picture (pilot.json's portrait.png); the
// screens that show pilots draw them in their own palette's portrait colors (the originals' faces use the same
// entries), so each screen gets the picture with every pixel the nearest of those colors. OMF Studio shows its
// previews with the same functions (fitPicture, placePicture).
import type { Palette } from '../formats/palette';
import { RSprite, type Animation } from '../resources/animation';
import type { PngImage } from '../util/png';
import { Surface } from '../video/surface';
import { modPilot } from './registry';

/** Palette entries the original portraits use in MELEE.BK and VS.BK (0xF0 and up are the cursors' and menus'). */
export const PORTRAIT_FIRST = 0xa1;
export const PORTRAIT_LAST = 0xef;
export const PORTRAIT_ENTRIES = Array.from({ length: PORTRAIT_LAST - PORTRAIT_FIRST + 1 }, (_, i) => PORTRAIT_FIRST + i);

/** The big portrait of the pilot select and VS screens (the originals are up to 88 x 69), and the grid's face. */
export const PORTRAIT_SIZE = { w: 88, h: 69 };
export const FACE_SIZE = { w: 51, h: 36 };

/** The ending's portraits (END1.BK animation 3, one a pilot): 86 x 61 at (121, 51). */
export const ENDING_PORTRAIT = { x: 121, y: 51, w: 86, h: 61 };

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

/** The nearest of some palette entries to a color (weighted for the eye). */
export function nearestOf(pal: Palette, entries: number[], r: number, g: number, b: number): number {
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

export interface IndexedPicture {
  w: number;
  h: number;
  data: Uint8Array;
}

/**
 * A picture in a palette's entries: `fit` scales it down to fit w x h (never up: small pictures stay pixel for pixel);
 * `cover` fills a w x h cell, cropped around its top middle (the face), on `background`.
 */
export function fitPicture(img: PngImage, pal: Palette, entries: number[], w: number, h: number, mode: 'fit' | 'cover', background = 0): IndexedPicture {
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
      if (v === undefined) cache.set(key, (v = nearestOf(pal, entries, r, g, b)));
      data[y * sw + x] = v;
    }
  }
  return { w: sw, h: sh, data };
}

/** A picture as it is (no scaling), centred in a w x h picture on `background`, in a palette's entries. */
export function placePicture(img: PngImage, pal: Palette, entries: number[], w: number, h: number, background = 0): IndexedPicture {
  const data = new Uint8Array(w * h).fill(background);
  const ox = Math.floor((w - img.w) / 2), oy = Math.floor((h - img.h) / 2);
  const cache = new Map<number, number>();
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const q = (y * img.w + x) * 4;
      if (img.rgba[q + 3] < 128) continue;
      const key = (img.rgba[q] << 16) | (img.rgba[q + 1] << 8) | img.rgba[q + 2];
      let v = cache.get(key);
      if (v === undefined) cache.set(key, (v = nearestOf(pal, entries, img.rgba[q], img.rgba[q + 1], img.rgba[q + 2])));
      const dx = x + ox, dy = y + oy;
      if (dx >= 0 && dy >= 0 && dx < w && dy < h) data[dy * w + dx] = v;
    }
  }
  return { w, h, data };
}

function surface(p: IndexedPicture, key: string): Surface {
  const surf = new Surface(p.w, p.h, p.data, 0);
  surf.source = { kind: 'generated', key };
  return surf;
}

/**
 * What a portrait surface shows of a mod pilot's pictures: its portrait or its face, all of it (`crop` null) or a part
 * (in the picture's pixels). The HD artwork draws the same part of the pilot's HD picture (mods/hdArt.ts).
 */
export interface PortraitPart {
  kind: 'portrait' | 'face';
  crop: { x: number; y: number; w: number; h: number } | null;
}

type PortraitHook = (pilotId: number, surf: Surface, pal: Palette, part: PortraitPart) => void;
let portraitHook: PortraitHook | null = null;

/** Called with every portrait surface made for a mod pilot, in the screen's palette (the remastered look's HD pictures). */
export function setPortraitHook(hook: PortraitHook | null): void {
  portraitHook = hook;
}

/** The part of a picture a `cover` fit of w x h shows (fitPicture), or null when it shows more than the picture. */
function coverPart(img: PngImage, w: number, h: number): PortraitPart['crop'] {
  const k = Math.max(w / img.w, h / img.h);
  if (k > 1) return null;
  const sw = Math.max(1, Math.round(img.w * k));
  const ox = Math.round((sw - w) / 2);
  return { x: ox / k, y: 0, w: w / k, h: h / k };
}

/**
 * A mod pilot's portrait in a screen's colors (fitPicture). `face`: the pilot select grid's face picture when the
 * pilot has one (placed in the cell's middle as it is). Null for a pilot without a portrait.
 */
export function pilotPortrait(pilotId: number, pal: Palette, w: number, h: number, mode: 'fit' | 'cover', background = 0, face = false): Surface | null {
  const p = modPilot(pilotId);
  if (face && p?.face) {
    const surf = surface(placePicture(p.face, pal, PORTRAIT_ENTRIES, w, h, background), `mod-pilot/${pilotId}/face`);
    // (an HD face stands for a face of the cell's size)
    if (p.face.w === w && p.face.h === h) portraitHook?.(pilotId, surf, pal, { kind: 'face', crop: null });
    return surf;
  }
  const img = p?.portrait;
  if (!img) return null;
  const surf = surface(fitPicture(img, pal, PORTRAIT_ENTRIES, w, h, mode, background), `mod-pilot/${pilotId}/${mode}/${w}x${h}`);
  const crop = mode === 'fit' ? null : coverPart(img, w, h);
  if (mode === 'fit' || crop) portraitHook?.(pilotId, surf, pal, { kind: 'portrait', crop });
  return surf;
}

/**
 * Adds a mod pilot's big portrait to a scene's portrait animation (MELEE.BK and VS.BK animation 4, a sprite per pilot
 * id; the originals' stand on y 50), in the scene's colors. Nothing for original pilots.
 */
export function addPilotPortrait(ani: Animation, pilotId: number, pal: Palette): void {
  if (!modPilot(pilotId) || ani.sprites[pilotId]?.surface) return;
  const pic = pilotPortrait(pilotId, pal, PORTRAIT_SIZE.w, PORTRAIT_SIZE.h, 'fit');
  while (ani.sprites.length < pilotId) ani.sprites.push(new RSprite(ani.sprites.length, 0, 0, null));
  ani.sprites[pilotId] = new RSprite(pilotId, 5, 50 - (pic?.h ?? 0), pic);
}

/**
 * The palette entries the ending's portraits use (not 0): a mod pilot's is drawn in those (the rest of that palette
 * is the background's and the ship's).
 */
export function endingEntries(pictures: (Uint8Array | null | undefined)[]): number[] {
  const used = new Set<number>();
  for (const px of pictures) for (const v of px ?? []) used.add(v);
  used.delete(0);
  return [...used].sort((a, b) => a - b);
}

/** A portrait fitted into the ending's frame, in its entries. */
export function endingPicture(img: PngImage, pal: Palette, entries: number[]): IndexedPicture {
  return fitPicture(img, pal, entries, ENDING_PORTRAIT.w, ENDING_PORTRAIT.h, 'fit');
}

/** Adds a mod pilot's portrait to the ending's portrait animation (a sprite by pilot id), centred in the frame. */
export function addEndingPortrait(ani: Animation, pilotId: number, pal: Palette): void {
  const img = modPilot(pilotId)?.portrait;
  if (!img || ani.sprites[pilotId]?.surface) return;
  const pic = endingPicture(img, pal, endingEntries(ani.sprites.map((sp) => sp.surface?.data)));
  const { x, y, w, h } = ENDING_PORTRAIT;
  while (ani.sprites.length < pilotId) ani.sprites.push(new RSprite(ani.sprites.length, 0, 0, null));
  const surf = surface(pic, `mod-pilot/${pilotId}/ending`);
  portraitHook?.(pilotId, surf, pal, { kind: 'portrait', crop: null });
  ani.sprites[pilotId] = new RSprite(pilotId, x + ((w - pic.w) >> 1), y + ((h - pic.h) >> 1), surf);
}
