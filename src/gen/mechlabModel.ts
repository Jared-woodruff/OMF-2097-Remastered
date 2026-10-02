// The mechlab's turning robot for the generated robots (the originals' are animations of MECHLAB.BK): the robot in
// its presentation pose, rendered from twenty angles like the originals' turntable renders, and a select button
// (a close-up of the robot in a kick, drawn like the originals' buttons).
import type { Palette } from '../formats/palette';
import { Animation, RSprite } from '../resources/animation';
import { fighterFile, hasFighter } from '../resources/resources';
import { hdAssets } from '../video/hd/assets';
import { pixelHash } from '../video/hd/pixelHash';
import { Surface } from '../video/surface';
import { boundingRadius } from './geometry';
import { measure } from './fighter/body';
import * as P from './fighter/poses';
import { traceShapes, ROW_H } from './raster';
import { jointTransforms, placeShapes, type Pose, type RobotModel } from './robot';
import { genRobot, type GenRobot } from './roster';
import { generatedArtwork, type GenPicture } from './hdArtwork';
import { modMech } from '../mods/registry';

const FRAMES = 20;
/** Where the originals' turntable robots stand (their feet), and how tall they are drawn. */
const CENTER_X = 156;
const FLOOR_Y = 92;
const HEIGHT = 86;

const cache = new Map<number, Animation>();
const pictures = new Map<number, GenPicture[]>();

/**
 * The turning robot of a generated robot: its presentation pose, the model turned for each of the twenty frames, and
 * the magnification to the originals' size (from the robot's height at rest). The frames are drawn from these
 * (traceShapes at 1 / scale), here and by the Blender export (tools/blender), whose renderings a mod can bring.
 */
export function turntable(r: GenRobot): { pose: Pose; models: RobotModel[]; scale: number } {
  const b = measure(r.model, r.style);
  const pose = P.present(b);
  const probe = traceShapes(placeShapes(r.model, pose, boundingRadius), 1, ROW_H);
  const scale = HEIGHT / Math.max(1, probe.h);
  const models = Array.from({ length: FRAMES }, (_, k) => ({ ...r.model, turn: -90 + (k * 360) / FRAMES }));
  return { pose, models, scale };
}

export function mechAnimation(harId: number): Animation | null {
  const cached = cache.get(harId);
  if (cached) {
    mechArtwork(harId);
    return cached;
  }
  const r = genRobot(harId);
  if (!r) return null;
  const tt = turntable(r);
  const { pose, scale } = tt;
  const ani = new Animation(15 + harId);
  const letters: string[] = [];
  const pics: GenPicture[] = [];
  for (let k = 0; k < FRAMES; k++) {
    const shapes = placeShapes(tt.models[k], pose, boundingRadius);
    const t = traceShapes(shapes, 1 / scale, ROW_H / scale);
    const surf = new Surface(t.w, t.h, t.data, 0);
    surf.source = { kind: 'generated', key: `mech/${harId}/${k}` };
    ani.sprites.push(new RSprite(k, CENTER_X + t.x, FLOOR_Y + t.y, surf));
    letters.push(`${String.fromCharCode(65 + k)}4`);
    pics.push({ pixels: t.data, w: t.w, h: t.h, shapes, x: t.x, y: t.y, scale });
  }
  ani.animationString = letters.join('-');
  cache.set(harId, ani);
  pictures.set(harId, pics);
  mechArtwork(harId);
  return ani;
}

/**
 * Remastered artwork of the turning robot: rendered from the same shapes, unless the robot's mod brings pictures of
 * every frame (mods/hdArt.ts registers them for the mechlab).
 */
function mechArtwork(harId: number): void {
  const pics = pictures.get(harId);
  if (!pics) return;
  const brought = new Set(modMech(harId).map((e) => e.hash));
  if (brought.size && pics.every((p) => brought.has(pixelHash(p.w, p.h, p.pixels)))) return;
  generatedArtwork()?.renderPictures(`mech/${harId}`, pics);
}

/** MECHLAB.BK's select buttons: the robot in seven grays (white .. 0x5A) on 0x5B, in a beveled frame two pixels wide. */
const BUTTON_W = 55;
const BUTTON_H = 41;
const BUTTON_WHITE = 0x54;
const BUTTON_GRAYS = 7;
const BUTTON_BACK = 0x5b;
const FRAME = 2;
/** The close-up: how tall the robot would be standing, its turn toward the viewer and where its chest goes. */
const BUTTON_ROBOT_H = 58;
const BUTTON_TURN = -40;
const BUTTON_CHEST: [number, number] = [22, 19];
/** Texels per native pixel of the buttons' remastered artwork, and its grays (dimmer than white: no bloom). */
const BUTTON_HD = 4;
const HD_DARK = 120;
const HD_LIGHT = 224;

/** The close-up rendered `k` times finer than native: its shading per pixel (0 dark .. 1 bright; -1 not the robot). */
function buttonShading(harId: number, k: number): Float32Array | null {
  const r = genRobot(harId);
  if (!r) return null;
  const b = measure(r.model, r.style);
  const model = { ...r.model, turn: BUTTON_TURN };
  const standing = opaqueBox(traceShapes(placeShapes(model, P.present(b), boundingRadius), 1, ROW_H));
  const scale = (BUTTON_ROBOT_H / standing.h) * k;
  const pose = P.roundhouse(b, 1);
  const t = traceShapes(placeShapes(model, pose, boundingRadius), 1 / scale, ROW_H / scale);
  const chest = jointTransforms(model, pose).get('chest')!.pos;
  const ox = Math.round(BUTTON_CHEST[0] * k - (chest[0] * scale - t.x));
  const oy = Math.round(BUTTON_CHEST[1] * k - ((-chest[1] * scale) / ROW_H - t.y));
  const w = BUTTON_W * k, h = BUTTON_H * k;
  // Smoothed within each part: the originals' renders have no dithering.
  const shadeOf = (v: number) => (v < 0x10 ? (v - 1) / 14 : (v & 0x0f) / 15);
  const out = new Float32Array(w * h).fill(-1);
  for (let y = 0; y < t.h; y++) {
    for (let x = 0; x < t.w; x++) {
      const i = y * t.w + x, bx = x + ox, by = y + oy;
      if (!t.data[i] || !inside(bx, by, k)) continue;
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy, j = yy * t.w + xx;
          if (xx < 0 || yy < 0 || xx >= t.w || yy >= t.h || !t.data[j] || t.owner[j] !== t.owner[i]) continue;
          sum += shadeOf(t.data[j]);
          n++;
        }
      }
      out[by * w + bx] = sum / n;
    }
  }
  return out;
}

function inside(x: number, y: number, k: number): boolean {
  return x >= FRAME * k && y >= FRAME * k && x < (BUTTON_W - FRAME) * k && y < (BUTTON_H - FRAME) * k;
}

/** A shade's rank among a rendering's shades (0 darkest .. 1 brightest). */
function rankOf(shading: Float32Array): (v: number) => number {
  const sorted = Array.from(shading).filter((v) => v >= 0).sort((a, b) => a - b);
  return (v) => {
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo / Math.max(1, sorted.length);
  };
}

const buttons = new Map<number, Surface>();
let buttonPaletteRow = -1;

/**
 * A generated robot's select button like MECHLAB.BK's (55 x 41): a close-up of the robot in a roundhouse kick, cut
 * off by the frame of an original button (`template`) as theirs are, in the originals' grays; or null. Given the
 * mechlab's palette, remastered artwork of it is made too.
 */
export function mechButton(harId: number, template: Surface | null, palette: Palette | null = null): Surface | null {
  let surf = buttons.get(harId) ?? null;
  if (!surf) {
    const shading = buttonShading(harId, 1);
    if (!shading) return null;
    const data = new Uint8Array(BUTTON_W * BUTTON_H).fill(BUTTON_BACK);
    if (template && template.w === BUTTON_W && template.h === BUTTON_H) {
      for (let y = 0; y < BUTTON_H; y++) {
        for (let x = 0; x < BUTTON_W; x++) if (!inside(x, y, 1)) data[y * BUTTON_W + x] = template.data[y * BUTTON_W + x];
      }
    }
    // The shades spread evenly over the grays, as the originals'.
    const rank = rankOf(shading);
    shading.forEach((v, i) => {
      if (v >= 0) data[i] = BUTTON_WHITE + BUTTON_GRAYS - 1 - Math.min(BUTTON_GRAYS - 1, Math.floor(rank(v) * BUTTON_GRAYS));
    });
    surf = new Surface(BUTTON_W, BUTTON_H, data, 0);
    surf.source = { kind: 'generated', key: `mech/button/${harId}` };
    buttons.set(harId, surf);
  }
  if (palette) buttonArt(harId, surf, palette);
  return surf;
}

/**
 * The button's remastered artwork: the close-up rendered finer in smooth grays, the frame and background from the
 * native button, against the mechlab's palette (the colors stay as they are; fades follow).
 */
function buttonArt(harId: number, surf: Surface, palette: Palette): void {
  const gl = hdAssets.context;
  const hash = pixelHash(surf.w, surf.h, surf.data);
  if (!gl || hdAssets.hasRuntime(hash)) return;
  const k = BUTTON_HD;
  const shading = buttonShading(harId, k);
  if (!shading) return;
  const rank = rankOf(shading);
  const w = BUTTON_W * k, h = BUTTON_H * k;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, v = shading[i];
      if (v >= 0) {
        const g = Math.round(HD_DARK + (HD_LIGHT - HD_DARK) * rank(v));
        rgba.set([g, g, g, 255], i * 4);
      } else {
        const n = surf.data[Math.floor(y / k) * BUTTON_W + Math.floor(x / k)];
        rgba.set([palette.colors[n * 3], palette.colors[n * 3 + 1], palette.colors[n * 3 + 2], 255], i * 4);
      }
    }
  }
  if (buttonPaletteRow < 0) buttonPaletteRow = hdAssets.addBasePalette(palette.colors);
  const bound = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindTexture(gl.TEXTURE_2D, bound);
  hdAssets.registerSprite(hash, { tex, w, h }, 0, 0, w, h, 0, buttonPaletteRow);
}

/** The box around a sprite's drawn pixels. */
function opaqueBox(s: { w: number; h: number; data: Uint8Array }): { x: number; y: number; w: number; h: number } {
  let x0 = s.w, y0 = s.h, x1 = -1, y1 = -1;
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if (!s.data[y * s.w + x]) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  return x1 < 0 ? { x: 0, y: 0, w: 1, h: 1 } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** The customize menu's robot silhouettes (MECHLAB.BK animation 5): about this tall, centred here, standing here. */
const ICON_HEIGHT = 34, ICON_CENTER_X = 139, ICON_FLOOR_Y = 181;
/** Their shades, darkest to brightest. */
const ICON_SHADES = [0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x5b, 0x5c, 0x5d, 0x5e, 0x5f];

/**
 * Adds a robot's silhouette to the customize menu's pictures when MECHLAB.BK has none for it (it has the original
 * robots'; the remaster's, the workshop's and mods' robots get one made from their idle animation's first frame, in the
 * originals' shades).
 */
export function ensureMechIcon(ani: Animation, harId: number): void {
  if (ani.sprites[harId]?.surface) return;
  if (!hasFighter(harId)) return;
  const idle = fighterFile(harId).moves[11]?.animation.sprites.find((s) => !s.isEmpty() && s.width < 1000);
  if (!idle) return;
  const px = idle.pixels(), w = idle.width, h = idle.height;
  let top = 0, bottom = h - 1;
  while (top < bottom && !px.subarray(top * w, (top + 1) * w).some((v) => v)) top++;
  while (bottom > top && !px.subarray(bottom * w, (bottom + 1) * w).some((v) => v)) bottom--;
  const k = ICON_HEIGHT / (bottom - top + 1);
  const sw = Math.max(1, Math.round(w * k)), sh = ICON_HEIGHT;
  const data = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const sy = top + Math.min(bottom - top, Math.floor(y / k));
    for (let x = 0; x < sw; x++) {
      const v = px[sy * w + Math.min(w - 1, Math.floor(x / k))];
      if (!v) continue;
      // (the robots' own colors are ramps of 16 shades; effect colors show mid-grey)
      const shade = v < 48 ? (v & 15) / 15 : 0.5;
      data[y * sw + x] = ICON_SHADES[Math.round(shade * (ICON_SHADES.length - 1))];
    }
  }
  const surf = new Surface(sw, sh, data, 0);
  surf.source = { kind: 'generated', key: `mech/icon/${harId}` };
  while (ani.sprites.length < harId) ani.sprites.push(new RSprite(ani.sprites.length, 0, 0, null));
  ani.sprites[harId] = new RSprite(harId, ICON_CENTER_X - (sw >> 1), ICON_FLOOR_Y - sh, surf);
}
