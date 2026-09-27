// HAR "photos" shown in the newsroom: captured during the fight (port of the reference har_screencap module).
//
// The reference renders the whole game state (without HUD) into its indexed framebuffer and reads back the
// palette-index channel of an area around the HAR(s). We do the same on the CPU: the frame is rendered into the
// draw list and the draw commands are rasterized into an indexed Surface. Only BlendMode.SET writes the index
// channel of the framebuffer (remap/shadow/add/tint draws write other channels), so only those are composited,
// which is exactly what the reference's GL_RED readback sees.
import type { Palette } from '../formats/palette';
import { clamp } from '../util/random';
import { BlendMode, drawList, FLIP_HORIZONTAL, FLIP_VERTICAL, NATIVE_H, NATIVE_W, type DrawCmd } from '../video/draw';
import { Surface } from '../video/surface';
import { vga } from '../video/vga';
import { HarState } from './constants';
import type { GameState } from './gameState';
import type { GameObject } from './object';

export const SCREENCAP_W = 140;
export const SCREENCAP_H = 100;
export const SCREENCAP_BLOW = 0;
export const SCREENCAP_POSE = 1;

export class HarScreencaps {
  /** Captured indexed pixels (before grayscale compression). */
  raw: (Surface | null)[] = [null, null];
  /** Grayscale-compressed captures shown in the newsroom. */
  cap: (Surface | null)[] = [null, null];
  ok: boolean[] = [false, false];
}

export function harScreencapsCreate(): HarScreencaps {
  return new HarScreencaps();
}

export function harScreencapsFree(caps: HarScreencaps): void {
  for (let i = 0; i < 2; i++) {
    if (caps.ok[i]) {
      caps.raw[i] = null;
      caps.cap[i] = null;
      caps.ok[i] = false;
    }
  }
}

export function harScreencapsReset(caps: HarScreencaps): void {
  harScreencapsFree(caps);
}

export function harScreencapsClone(src: HarScreencaps, dst: HarScreencaps): void {
  for (let i = 0; i < 2; i++) {
    if (src.ok[i]) {
      if (src.raw[i]) dst.raw[i] = src.raw[i]!.clone();
      if (src.cap[i]) dst.cap[i] = src.cap[i]!.clone();
    }
  }
}

/**
 * Capture area origin for an object, in the reference's OpenGL window coordinates (origin bottom-left).
 * NOTE: the reference adds the vertical margin in GL space, so the window ends up shifted up by (100 - h) pixels
 * instead of centered on the sprite. Kept as-is for fidelity.
 */
function cameraPositionFor(obj: GameObject): [number, number] {
  const [sw, sh] = obj.size();
  const px = obj.px();
  const py = obj.py();
  const xMargin = Math.trunc((SCREENCAP_W - sw) / 2);
  const yMargin = Math.trunc((SCREENCAP_H - sh) / 2);
  const xCenter = px - Math.trunc(sw / 2);
  const yCenter = NATIVE_H - py;
  return [clamp(xCenter - xMargin, 0, NATIVE_W - SCREENCAP_W), clamp(yCenter + yMargin, 0, NATIVE_H)];
}

/** Takes a picture around `obj` (and `obj2`, widening the area to include both) into slot `id`. */
export function harScreencapsCapture(caps: HarScreencaps, obj: GameObject, obj2: GameObject | null, id: number): void {
  const gs = obj.gs;
  if (caps.ok[id]) {
    caps.raw[id] = null;
    caps.cap[id] = null;
    caps.ok[id] = false;
  }
  let [x, y] = cameraPositionFor(obj);
  let w = SCREENCAP_W;
  let h = SCREENCAP_H;
  if (obj2) {
    const [x2] = cameraPositionFor(obj2);
    w = Math.abs(x - x2) + w;
    h = Math.trunc((SCREENCAP_H * w) / SCREENCAP_W);
    x = Math.min(x, x2);
    y -= Math.trunc((h - SCREENCAP_H) / 2);
  }
  w = Math.min(w, NATIVE_W);
  h = Math.min(h, NATIVE_H);
  x = clamp(x, 0, NATIVE_W - w);
  y = clamp(y, 0, NATIVE_H - h);
  // glReadPixels(x, y, w, h) + vertical flip == screen rows [NATIVE_H - y - h, NATIVE_H - y).
  gs.hideUi = true;
  caps.raw[id] = renderArea(gs, x, NATIVE_H - y - h, w, h);
  gs.hideUi = false;
  caps.ok[id] = true;
}

/** Converts a capture to the newsroom's grayscale ramp (0xD0..0xDF); HAR colors (< 0x60) are kept. */
export function harScreencapsCompress(caps: HarScreencaps, pal: Palette, id: number): void {
  const raw = caps.raw[id];
  if (caps.ok[id] && raw) {
    caps.cap[id] = surfaceToGrayscale(raw, pal, 0xd0, 0xdf, 0x60);
    caps.raw[id] = null;
  }
}

/**
 * Victory pose picture for the newsroom (reference arena_screengrab_winner).
 * Deviation: when player 1 is not the winner, the reference centers the picture on player 1's (defeated) HAR —
 * it looks up player 0's object twice — so the newsroom showed a mostly empty arena. Here it frames the winner.
 */
export function arenaScreengrabWinner(gs: GameState): void {
  const o1 = gs.findObject(gs.getPlayer(0).harObjId);
  if (!o1) return;
  const h1 = o1.userdata as { state: HarState };
  if (h1.state === HarState.VICTORY || h1.state === HarState.DONE) {
    harScreencapsCapture(gs.getPlayer(0).screencaps, o1, null, SCREENCAP_POSE);
  } else {
    const o2 = gs.findObject(gs.getPlayer(1).harObjId);
    if (o2) harScreencapsCapture(gs.getPlayer(1).screencaps, o2, null, SCREENCAP_POSE);
  }
}

// ---------------------------------------------------------------------------
// Grayscale conversion (reference surface_to_grayscale / find_closest_gray)

function findClosestGray(pal: Palette, rangeStart: number, rangeEnd: number, ref: number): number {
  let closest = 0;
  let closestDist = 256;
  for (let i = rangeStart; i <= rangeEnd; i++) {
    const current = pal.colors[i * 3];
    let dist = current - ref;
    if (dist < 0) dist = -dist;
    if (dist > closestDist) break;
    if (dist < closestDist) {
      closestDist = dist;
      closest = i;
    }
  }
  return closest;
}

export function surfaceToGrayscale(src: Surface, pal: Palette, rangeStart: number, rangeEnd: number, ignoreBelow: number): Surface {
  const mapping = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    if (i < ignoreBelow) {
      mapping[i] = i;
      continue;
    }
    // float r = c.r * 0.3 (double math stored to float), then float sums truncated to int.
    const r = Math.fround(pal.colors[i * 3] * 0.3);
    const g = Math.fround(pal.colors[i * 3 + 1] * 0.59);
    const b = Math.fround(pal.colors[i * 3 + 2] * 0.11);
    mapping[i] = findClosestGray(pal, rangeStart, rangeEnd, Math.trunc(Math.fround(Math.fround(r + g) + b)));
  }
  const dst = new Surface(src.w, src.h, undefined, -1);
  for (let i = 0; i < src.w * src.h; i++) dst.data[i] = mapping[src.data[i]];
  dst.source = { kind: 'generated', key: 'screencap' };
  return dst;
}

// ---------------------------------------------------------------------------
// CPU rendering of a screen area (index channel of the indexed framebuffer)

const PHI = 1.61803398874989484820459;

/** Ordered-dither threshold of the sprite shader (same formula; GPU float precision differs slightly). */
function ditherNoise(x: number, y: number): number {
  const v = Math.tan(10.0 * PHI * y) + (107.0 * x) / 256.0;
  return v - Math.floor(v);
}

/** Rasterizes one draw command's index channel into `dst`, whose top-left is screen position (ax, ay). */
function rasterizeCmd(c: DrawCmd, dst: Surface, ax: number, ay: number): void {
  if (c.mode !== BlendMode.SET) return;
  const s = c.surf;
  const x0 = Math.max(c.x, ax);
  const y0 = Math.max(c.y, ay);
  const x1 = Math.min(c.x + c.w, ax + dst.w);
  const y1 = Math.min(c.y + c.h, ay + dst.h);
  if (x0 >= x1 || y0 >= y1) return;
  const flipH = (c.flip & FLIP_HORIZONTAL) !== 0;
  const flipV = (c.flip & FLIP_VERTICAL) !== 0;
  const limit = c.opacity / 255;
  const remap = c.options & 1 ? vga.remaps.tables[c.remapOffset] : null;
  const harQuirks = (c.options & 8) !== 0;
  for (let py = y0; py < y1; py++) {
    // Texture coordinate at the pixel center, like the GPU's interpolated UVs.
    const fy = ((py + 0.5 - c.y) * s.h) / c.h;
    let ty = Math.floor(flipV ? s.h - fy : fy);
    ty = clamp(ty, 0, s.h - 1);
    for (let px = x0; px < x1; px++) {
      const fx = ((px + 0.5 - c.x) * s.w) / c.w;
      let tx = Math.floor(flipH ? s.w - fx : fx);
      tx = clamp(tx, 0, s.w - 1);
      let index = s.data[ty * s.w + tx];
      if (index === s.transparent) continue;
      if (c.opacity < 255 && ditherNoise(px + 0.5, NATIVE_H - py - 0.5) > limit) continue;
      if (index <= c.palLimit) index = clamp(index + c.palOffset, 0, c.palLimit);
      if (remap && !(harQuirks && index > 0x30)) index = remap[index];
      dst.data[(py - ay) * dst.w + (px - ax)] = index;
    }
  }
}

/** Renders the current game state (as the engine would) and returns the index channel of the given screen area. */
function renderArea(gs: GameState, ax: number, ay: number, aw: number, ah: number): Surface {
  const out = new Surface(aw, ah, undefined, -1);
  const savedCount = drawList.count;
  const savedTag = drawList.currentTag;
  const savedOptions = drawList.framebufferOptions;
  try {
    gs.render();
    for (let i = savedCount; i < drawList.count; i++) rasterizeCmd(drawList.cmds[i], out, ax, ay);
  } finally {
    // Drop the capture's commands: the current frame's draw list is left exactly as it was.
    drawList.count = savedCount;
    drawList.currentTag = savedTag;
    drawList.framebufferOptions = savedOptions;
  }
  out.source = { kind: 'generated', key: 'screencap-raw' };
  return out;
}
