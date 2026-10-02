// HD pictures in OMF Studio: the remastered look's artwork of a mod's sprites, arena backgrounds and pilot pictures
// (project.ts HdDoc, the package's hd.json). Templates to paint over (the native picture blown up to the HD size: 5 x 6
// per native pixel, in the colors the pictures are painted against), pictures brought in checked against what they
// stand for and kept as WebP when that is smaller, previews, and pictures following their sprites' edits.
import type { Palette } from '../formats/palette';
import type { Sprite } from '../formats/sprite';
import { spriteHash } from '../mods/package';
import { HD_SCALE, hdShapeProblem } from '../mods/types';
import { imageSize } from '../util/imageSize';
import { decodePng, encodePng } from '../util/png';
import { unzip } from '../util/zip';
import type { HdDoc } from './project';

/** A template: palette indices (w x h, 0 see-through) blown up to the HD size, with `pad` native pixels of margin. */
export function hdTemplate(pixels: Uint8Array, w: number, h: number, pal: Palette, pad: number): Promise<Uint8Array> {
  const W = (w + 2 * pad) * HD_SCALE.x, H = (h + 2 * pad) * HD_SCALE.y;
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const ny = Math.floor(y / HD_SCALE.y) - pad;
    if (ny < 0 || ny >= h) continue;
    for (let x = 0; x < W; x++) {
      const nx = Math.floor(x / HD_SCALE.x) - pad;
      if (nx < 0 || nx >= w) continue;
      const v = pixels[ny * w + nx];
      if (v) rgba.set([pal.r(v), pal.g(v), pal.b(v), 255], (y * W + x) * 4);
    }
  }
  return encodePng(W, H, rgba);
}

/** A true-color picture's template (a pilot's portrait or face): blown up to the HD size. */
export async function pictureTemplate(png: Uint8Array): Promise<Uint8Array> {
  const img = await decodePng(png);
  const W = img.w * HD_SCALE.x, H = img.h * HD_SCALE.y;
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const q = (Math.floor(y / HD_SCALE.y) * img.w + Math.floor(x / HD_SCALE.x)) * 4;
      rgba.set(img.rgba.subarray(q, q + 4), (y * W + x) * 4);
    }
  }
  return encodePng(W, H, rgba);
}

/** What is wrong with a picture as the HD version of nw x nh native pixels, or null. */
export function hdProblem(bytes: Uint8Array, nw: number, nh: number): string | null {
  const size = imageSize(bytes);
  if (!size) return 'it is not a PNG or WebP picture';
  return hdShapeProblem(size.w, size.h, nw, nh);
}

/** A picture as a project keeps it: as WebP (lossy, like the remaster's own artwork) when the browser writes it smaller. */
export async function compactPicture(bytes: Uint8Array): Promise<Uint8Array> {
  if (imageSize(bytes)?.type !== 'png' || typeof OffscreenCanvas === 'undefined') return bytes;
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await c.convertToBlob({ type: 'image/webp', quality: 0.92 });
    if (blob.type !== 'image/webp' || blob.size >= bytes.length) return bytes;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return bytes;
  }
}

/** Pictures from files: PNG and WebP pictures, and zip archives of them, by name (without folders or extension). */
export async function picturesFromFiles(files: File[]): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  const add = (name: string, data: Uint8Array) => {
    const base = name.split('/').pop()!.toLowerCase();
    const m = /^(.+)\.(png|webp)$/.exec(base);
    if (m && imageSize(data)) out.set(m[1], data);
  };
  for (const f of files) {
    const data = new Uint8Array(await f.arrayBuffer());
    if (/\.zip$/i.test(f.name)) {
      for (const [name, entry] of await unzip(data)) add(name, entry);
    } else add(f.name, data);
  }
  return out;
}

const bitmaps = new WeakMap<Uint8Array, Promise<ImageBitmap | null>>();

/** A picture ready to draw (for previews). */
export function hdBitmap(bytes: Uint8Array): Promise<ImageBitmap | null> {
  let b = bitmaps.get(bytes);
  if (!b) bitmaps.set(bytes, (b = createImageBitmap(new Blob([bytes as BlobPart])).catch(() => null)));
  return b;
}

/**
 * A sprite's pixels changed (drawn on, a picture brought in): its HD picture, made for the pixels it had (`before`),
 * goes with the new ones when it still has their shape. Returns what happened, for the player, or null.
 */
export function followEdit(hd: HdDoc | null, before: string, s: Sprite): string | null {
  const pic = hd?.sprites.get(before);
  if (!hd || !pic || s.isEmpty()) return null;
  const after = spriteHash(s);
  if (after === before) return null;
  if (hdProblem(pic, s.width + 2 * hd.pad, s.height + 2 * hd.pad)) {
    return 'The sprite\'s size changed: its HD picture no longer fits it. Bring in one of its new size.';
  }
  hd.sprites.set(after, pic);
  return 'Its HD picture goes with the changed sprite: redo it if the change shows.';
}

/** A sprite's picture file name stem: "m11-a" (a robot's move 11, sprite A) or "a30-b" (an arena's animation). */
export function spriteStem(prefix: 'm' | 'a', anim: number, sprite: number): string {
  return `${prefix}${anim}-${String.fromCharCode(97 + sprite)}`;
}

/** The animation and sprite a picture's name stands for ("m11-a", "a30-b.png"), or null. */
export function parseStem(prefix: 'm' | 'a', name: string): [number, number] | null {
  const m = new RegExp(`^${prefix}(\\d{1,2})-([a-z])$`).exec(name.toLowerCase());
  return m ? [Number(m[1]), m[2].charCodeAt(0) - 97] : null;
}
