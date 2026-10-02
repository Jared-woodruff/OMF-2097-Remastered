// A live backdrop: something the remastered renderer draws in place of a screen's background picture (the main
// menu's parallax scene, video/stage/parallax.ts), under the screen's own sprites and menus.

/** Where native coordinates land in the destination: pixel = native * s + o (top-down), its size, the widescreen sides. */
export interface BackdropView {
  w: number;
  h: number;
  sx: number;
  sy: number;
  ox: number;
  oy: number;
  /** Native columns shown beyond the 320-wide screen on each side. */
  ext: number;
}

export interface Backdrop {
  /** The background picture it stands for (surface key, e.g. 'MAIN.BK/bg'): it is drawn on frames that show it. */
  readonly replaces: string;
  /** Surface keys (prefixes) of the screen's own images it replaces, e.g. an animation of its background. */
  readonly hide: readonly string[];
  /** The native columns it paints (x0, x1); the renderer fills the widescreen sides beyond them itself. */
  readonly covers: readonly [number, number];
  /** Draws into `target` (a framebuffer of view.w x view.h), replacing everything there. */
  draw(gl: WebGL2RenderingContext, view: BackdropView, target: WebGLFramebuffer): void;
}
