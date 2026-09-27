// Frame draw list. Game code issues draws in native 320x200 coordinates; renderers consume the list.
import type { Surface } from './surface';

export const NATIVE_W = 320;
export const NATIVE_H = 200;

/** Sprite draw options (bit flags). */
export const SPRITE_REMAP = 0x01;
export const SPRITE_SHADOW = 0x02;
export const SPRITE_INDEX_ADD = 0x04;
export const SPRITE_HAR_QUIRKS = 0x08;
export const SPRITE_DARK_TINT = 0x10;

export const FLIP_NONE = 0;
export const FLIP_HORIZONTAL = 0x1;
export const FLIP_VERTICAL = 0x2;

/** Blend modes of the indexed framebuffer (see the resolve shader for channel meanings). */
export const enum BlendMode {
  SET = 0,
  REMAP = 1,
  SHADOW = 2,
  ADD = 3,
  DARK_TINT = 4,
}

/** Framebuffer options. */
export const FBUFOPT_CREDITS = 0x01;

export interface DrawCmd {
  surf: Surface;
  x: number;
  y: number;
  w: number;
  h: number;
  remapOffset: number;
  remapRounds: number;
  palOffset: number;
  palLimit: number;
  opacity: number;
  flip: number;
  options: number;
  mode: BlendMode;
  /** Layer tag for the HD renderer (e.g. 'bg', 'har', 'hud'); informational. */
  tag: number;
  /** Unrounded position including motion interpolation (remastered renderer). */
  fx: number;
  fy: number;
}

function modeFor(options: number, remapRounds: number): BlendMode {
  if (options & SPRITE_DARK_TINT) return BlendMode.DARK_TINT;
  if (options & SPRITE_SHADOW) return BlendMode.SHADOW;
  if (remapRounds > 0) return BlendMode.REMAP;
  if (options & SPRITE_INDEX_ADD) return BlendMode.ADD;
  return BlendMode.SET;
}

export const TAG_NONE = 0;
export const TAG_BACKGROUND = 1;
export const TAG_HAR = 2;
export const TAG_HUD = 3;
export const TAG_MENU = 4;

/** How the remastered renderer fills widescreen sides: blurred "ambient" copy of the frame, or the extended scene. */
export const WIDE_AMBIENT = 0;
export const WIDE_MIRROR = 1;

class DrawList {
  cmds: DrawCmd[] = [];
  count = 0;
  framebufferOptions = 0;
  /** Screen translation (screen shake), in native pixels. */
  targetMoveX = 0;
  targetMoveY = 0;
  currentTag = TAG_NONE;
  wideStyle = WIDE_AMBIENT;
  /**
   * Motion interpolation: fraction of the next game tick already elapsed (0..1), or -1 when disabled.
   * Objects offset their draws by `subX/subY` (render position minus simulated position) while drawing.
   */
  interpAlpha = -1;
  subX = 0;
  subY = 0;

  begin(): void {
    this.count = 0;
    this.framebufferOptions = 0;
    this.wideStyle = WIDE_AMBIENT;
    this.interpAlpha = -1;
    this.subX = 0;
    this.subY = 0;
  }

  push(
    surf: Surface, x: number, y: number, w: number, h: number,
    remapOffset: number, remapRounds: number, palOffset: number, palLimit: number,
    opacity: number, flip: number, options: number,
  ): void {
    if (w <= 0 || h <= 0) return;
    let c = this.cmds[this.count];
    if (!c) {
      c = {
        surf, x, y, w, h, remapOffset, remapRounds, palOffset, palLimit, opacity, flip, options,
        mode: BlendMode.SET, tag: 0, fx: x, fy: y,
      };
      this.cmds[this.count] = c;
    }
    c.surf = surf;
    c.x = x | 0;
    c.y = y | 0;
    c.fx = c.x + this.subX;
    c.fy = c.y + this.subY;
    c.w = w | 0;
    c.h = h | 0;
    c.remapOffset = remapOffset;
    c.remapRounds = remapRounds;
    c.palOffset = palOffset;
    c.palLimit = palLimit;
    c.opacity = opacity;
    c.flip = flip;
    c.options = options;
    c.mode = modeFor(options, remapRounds);
    c.tag = this.currentTag;
    this.count++;
  }
}

export const drawList = new DrawList();

// Convenience wrappers mirroring the reference video_* API.
export const video = {
  draw(s: Surface, x: number, y: number): void {
    drawList.push(s, x, y, s.renderW, s.renderH, 0, 0, 0, 255, 255, 0, 0);
  },
  drawOffset(s: Surface, x: number, y: number, offset: number, limit: number): void {
    drawList.push(s, x, y, s.renderW, s.renderH, 0, 0, offset, limit, 255, 0, 0);
  },
  drawSize(s: Surface, x: number, y: number, w: number, h: number): void {
    drawList.push(s, x, y, w, h, 0, 0, 0, 255, 255, 0, 0);
  },
  drawRemap(s: Surface, x: number, y: number, remapOffset: number, remapRounds: number, options: number): void {
    drawList.push(s, x, y, s.renderW, s.renderH, remapOffset, remapRounds, 0, 255, 255, 0, options);
  },
  drawFull(
    s: Surface, x: number, y: number, w: number, h: number, remapOffset: number, remapRounds: number,
    palOffset: number, palLimit: number, opacity: number, flip: number, options: number,
  ): void {
    drawList.push(s, x, y, w, h, remapOffset, remapRounds, palOffset, palLimit, opacity, flip, options);
  },
  moveTarget(x: number, y: number): void {
    drawList.targetMoveX = x;
    drawList.targetMoveY = y;
  },
  setFramebufferOptions(o: number): void {
    drawList.framebufferOptions = o;
  },
  setTag(tag: number): void {
    drawList.currentTag = tag;
  },
  setWideStyle(style: number): void {
    drawList.wideStyle = style;
  },
};
