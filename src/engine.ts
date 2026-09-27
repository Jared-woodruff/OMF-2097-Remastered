// Main loop: fixed-rate static (100 Hz) and dynamic (game-speed) ticks, rendering every animation frame.
import type { GameState } from './game/gameState';
import { drawList } from './video/draw';
import { vga } from './video/vga';
import { STATIC_TICKS } from './game/constants';

const MAX_TICKS_PER_FRAME = 10;
const TICK_EXPIRY_MS = 100;

export interface FrameRenderer {
  render(gs: GameState, alpha: number): void;
}

export class Engine {
  private staticWait = 0;
  private dynamicWait = 0;
  private last = 0;
  private running = false;
  private raf = 0;
  /** Fraction of the next dynamic tick already elapsed (for motion interpolation). */
  alpha = 0;
  paused = false;
  /** Draw objects between game ticks (smooth motion on high refresh rate displays). */
  interpolate = false;
  frames = 0;
  ticks = 0;
  /** Frames that threw (logged, the loop keeps running). */
  errors = 0;

  constructor(public gs: GameState, public renderer: FrameRenderer) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      // Schedule the next frame first: an exception in this one must not stop the game loop.
      this.raf = requestAnimationFrame(loop);
      try {
        this.frame(now);
      } catch (err) {
        this.errors++;
        if (this.errors <= 5) console.error('[engine] frame failed:', err);
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Runs the simulation for `ms` milliseconds of game time (also used by tests / hidden-tab stepping). */
  advance(ms: number): void {
    const gs = this.gs;
    this.staticWait = Math.min(this.staticWait + ms, TICK_EXPIRY_MS);
    this.dynamicWait = Math.min(this.dynamicWait + ms, TICK_EXPIRY_MS);
    let limit = MAX_TICKS_PER_FRAME;
    let hasStatic: boolean;
    let hasDynamic: boolean;
    do {
      const dynMs = gs.msPerDyntick();
      hasStatic = this.staticWait > STATIC_TICKS;
      if (hasStatic) {
        gs.staticTick();
        this.staticWait -= STATIC_TICKS;
      }
      hasDynamic = this.dynamicWait > dynMs;
      if (hasDynamic) {
        gs.dynamicTick();
        this.dynamicWait -= dynMs;
        this.ticks++;
      }
      if (hasStatic || hasDynamic) {
        gs.paletteTransform();
        vga.render();
      }
    } while (limit-- && (hasStatic || hasDynamic));
    this.alpha = Math.max(0, Math.min(1, this.dynamicWait / Math.max(1, gs.msPerDyntick())));
  }

  frame(now: number): void {
    const dt = now - this.last;
    this.last = now;
    if (!this.paused) this.advance(dt);
    drawList.begin();
    drawList.interpAlpha = this.interpolate ? this.alpha : -1;
    this.gs.render();
    this.renderer.render(this.gs, this.alpha);
    this.frames++;
  }
}
