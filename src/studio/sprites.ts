// Sprites in OMF Studio. A fighter or scene file stores each picture once: a sprite marked "missing" shows the last
// full sprite before it with the same sharing index (animation.ts resolveMissingSprites), so an idle frame used again
// in other moves is stored once. Studio keeps that: a picture edited "everywhere" changes all its copies; edited
// "here only", the sprite becomes a picture of its own (index 0 is never shared) and the copies keep the old one.
import type { AnimationData } from '../formats/animation';
import type { Palette } from '../formats/palette';
import { encodeSprite, Sprite } from '../formats/sprite';
import { decodePng, encodeIndexedPng } from '../util/png';
import { nearestEntry } from './colors';

/** Every sprite of a file's animations, in file order. */
export function allSprites(anims: (AnimationData | null | undefined)[]): Sprite[] {
  const out: Sprite[] = [];
  for (const a of anims) if (a) out.push(...a.sprites);
  return out;
}

/** The sprites showing the same stored picture as `s` (itself included): its source and the copies resolved to it. */
export function sharedGroup(anims: (AnimationData | null | undefined)[], s: Sprite): Sprite[] {
  if (s.index === 0 && !s.missing) return [s];
  const all = allSprites(anims);
  // Walk the file: a full sprite with the index starts a group, missing ones join the current group.
  let group: Sprite[] = [];
  let found: Sprite[] | null = null;
  for (const x of all) {
    if (x.index !== s.index) continue;
    if (!x.missing) group = [x];
    else group.push(x);
    if (x === s) found = group;
  }
  // (the rest of the group comes after `s` in the file)
  return found ?? [s];
}

/** New pixels for a sprite and every copy of it. */
export function setPicture(group: Sprite[], pixels: Uint8Array, w: number, h: number): void {
  const data = encodeSprite(pixels, w, h);
  for (const x of group) x.setData(data, w, h);
}

/**
 * Makes `s` a picture of its own before it is edited alone: when it was the source of copies, the first copy becomes
 * their source (keeping the old picture).
 */
export function detach(anims: (AnimationData | null | undefined)[], s: Sprite): void {
  const group = sharedGroup(anims, s);
  if (group.length > 1 && !s.missing) {
    const next = group.find((x) => x !== s);
    if (next) next.missing = 0;
  }
  s.missing = 0;
  s.index = 0;
}

/** A new empty sprite (1 x 1, see-through) at a position. */
export function blankSprite(posX: number, posY: number, w = 1, h = 1): Sprite {
  const s = new Sprite();
  s.posX = posX;
  s.posY = posY;
  s.width = w;
  s.height = h;
  s.data = encodeSprite(new Uint8Array(w * h), w, h);
  return s;
}

/** A copy of a sprite as a picture of its own. */
export function copySprite(s: Sprite): Sprite {
  const c = new Sprite();
  c.posX = s.posX;
  c.posY = s.posY;
  const px = s.pixels();
  c.width = s.isEmpty() ? 1 : s.width;
  c.height = s.isEmpty() ? 1 : s.height;
  c.data = encodeSprite(s.isEmpty() ? new Uint8Array(1) : px.slice(), c.width, c.height);
  return c;
}

/** Pixels trimmed to the rectangle around what is drawn: [pixels, w, h, dx, dy] (dx, dy: where the trimmed part starts). */
export function trim(pixels: Uint8Array, w: number, h: number): [Uint8Array, number, number, number, number] {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!pixels[y * w + x]) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return [new Uint8Array(1), 1, 1, 0, 0];
  const tw = x1 - x0 + 1, th = y1 - y0 + 1;
  const out = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++) out.set(pixels.subarray((y + y0) * w + x0, (y + y0) * w + x0 + tw), y * tw);
  return [out, tw, th, x0, y0];
}

/** A sprite as an indexed PNG with the palette it is shown in (index 0 see-through): paint programs keep the indices. */
export function spritePng(s: Sprite, pal: Palette): Promise<Uint8Array> {
  const w = s.isEmpty() ? 1 : s.width, h = s.isEmpty() ? 1 : s.height;
  return encodeIndexedPng(w, h, s.isEmpty() ? new Uint8Array(1) : s.pixels(), pal.colors, 0);
}

/**
 * A PNG as sprite pixels: an indexed image keeps its indices when they are ones sprites may use (`entries`), anything
 * else is matched to the nearest of those colors in `pal` (see-through pixels become 0).
 */
export async function pngToPixels(bytes: Uint8Array, pal: Palette, entries: number[]): Promise<{ pixels: Uint8Array; w: number; h: number; exact: boolean }> {
  const img = await decodePng(bytes);
  const allowed = new Set(entries);
  const pixels = new Uint8Array(img.w * img.h);
  if (img.indexed) {
    const idx = img.indexed;
    // Kept as they are when every index used is allowed and the palette agrees with the game's (the file came from Studio).
    const used = new Set<number>();
    for (let i = 0; i < idx.data.length; i++) if (idx.alpha[idx.data[i]] >= 128) used.add(idx.data[i]);
    used.delete(0);
    const same = [...used].every((v) => allowed.has(v) && Math.abs(idx.palette[v * 3] - pal.r(v)) < 8 &&
      Math.abs(idx.palette[v * 3 + 1] - pal.g(v)) < 8 && Math.abs(idx.palette[v * 3 + 2] - pal.b(v)) < 8);
    if (same) {
      for (let i = 0; i < pixels.length; i++) pixels[i] = idx.alpha[idx.data[i]] >= 128 ? idx.data[i] : 0;
      return { pixels, w: img.w, h: img.h, exact: true };
    }
  }
  const cache = new Map<number, number>();
  for (let i = 0; i < pixels.length; i++) {
    const q = i * 4;
    if (img.rgba[q + 3] < 128) continue;
    const key = (img.rgba[q] << 16) | (img.rgba[q + 1] << 8) | img.rgba[q + 2];
    let v = cache.get(key);
    if (v === undefined) cache.set(key, (v = nearestEntry(pal, entries, img.rgba[q], img.rgba[q + 1], img.rgba[q + 2])));
    pixels[i] = v;
  }
  return { pixels, w: img.w, h: img.h, exact: false };
}
