// Remastered effects director: turns the fight's effect events (src/game/fx.ts) into particles, lights and camera
// effects, adds each arena's ambience, and lights the scene from glowing objects (projectiles, fire, hazards). It only
// reads the game state; everything it produces is cosmetic and drawn by the remastered renderer.
import { GROUP_HAZARD, GROUP_PROJECTILE, GROUP_SCRAP, SceneId } from '../game/constants';
import { FxType, onFx, type FxEvent } from '../game/fx';
import type { GameState } from '../game/gameState';
import { isHar } from '../game/objects/har';
import { settings } from '../game/settings';
import { emptyFxFrame, ParticleKind, type FxFrame, type FxLight } from '../video/fx/types';
import type { Surface } from '../video/surface';
import { vga } from '../video/vga';
import { arenaFx, flicker, FX_FLOOR, type ArenaFx } from './arenas';
import { ParticleSystem } from './particles';

/** Seconds of effect time per game tick (noise animation). */
const SECONDS_PER_TICK = 0.028;
const MAX_OBJECT_LIGHTS = 24;

interface TimedLight {
  light: FxLight;
  /** Intensity at birth (r, g, b are scaled by the envelope). */
  r: number;
  g: number;
  b: number;
  age: number;
  life: number;
}

interface Shock {
  x: number;
  y: number;
  age: number;
  life: number;
  radius: number;
  width: number;
  strength: number;
}

interface Emission {
  r: number;
  g: number;
  b: number;
  /** Sum of the emission weights (roughly the number of glowing pixels). */
  amount: number;
}

type Rgba = readonly [number, number, number, number];
const HOT: Rgba = [1, 0.95, 0.72, 1];
const HOT_END: Rgba = [1, 0.3, 0.06, 0];
const COLD: Rgba = [0.82, 0.92, 1, 1];
const COLD_END: Rgba = [0.25, 0.45, 1, 0];

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class FxDirector {
  readonly frame: FxFrame = emptyFxFrame();
  private readonly ps = new ParticleSystem();
  private events: FxEvent[] = [];
  private timed: TimedLight[] = [];
  private shocks: Shock[] = [];
  private emission = new WeakMap<Surface, Emission>();
  private clock = NaN;
  /** Effect time in ticks. */
  private t = 0;
  private sceneId = -1;
  private cfg: ArenaFx | null = null;
  private flash = 0;
  private chroma = 0;
  private desat = 0;
  private shake = 0;
  private zoom: { x: number; y: number; age: number } | null = null;
  private dispose: () => void;

  constructor() {
    this.dispose = onFx((e) => {
      if (this.events.length < 64) this.events.push(e);
    });
  }

  destroy(): void {
    this.dispose();
  }

  /**
   * Advances the effects to game time `clockTicks` (dynamic ticks, fractional) and builds this frame's description.
   * `enabled`: remastered graphics are on.
   */
  update(gs: GameState, clockTicks: number, enabled: boolean): void {
    const f = this.frame;
    const v = settings().video;
    const arena = gs.sc.isArena() ? gs.thisId - SceneId.ARENA0 : -1;
    const any = v.fxParticles || v.fxLighting || v.fxImpact || v.fxAtmosphere;
    let dt = Number.isNaN(this.clock) ? 0 : clamp(clockTicks - this.clock, 0, 6);
    this.clock = clockTicks;
    if (!enabled || arena < 0 || !any) {
      this.reset();
      f.active = false;
      return;
    }
    if (gs.thisId !== this.sceneId) {
      this.reset();
      this.sceneId = gs.thisId;
      this.cfg = arenaFx(arena);
    }
    const cfg = this.cfg!;
    if (gs.paused) dt = 0;
    this.t += dt;
    f.active = true;
    f.time = this.t * SECONDS_PER_TICK;

    for (const e of this.events) if (e.sceneId === gs.thisId) this.onEvent(e, cfg, gs);
    this.events.length = 0;

    if (v.fxAtmosphere && dt > 0) cfg.ambient(this.ps, dt, this.t);
    if (!v.fxParticles && !v.fxAtmosphere) this.ps.clear();
    this.ps.step(dt);
    f.particleCount = this.ps.pack(f.particles);

    // Lights: impacts (timed), the arena's light on the robots, glowing objects.
    f.lights.length = 0;
    this.timed = this.timed.filter((l) => (l.age += dt) < l.life);
    if (v.fxLighting) {
      for (const l of this.timed) {
        const k = Math.pow(1 - l.age / l.life, 1.6);
        l.light.r = l.r * k;
        l.light.g = l.g * k;
        l.light.b = l.b * k;
        f.lights.push(l.light);
      }
      cfg.envLights(this.t, f.lights);
      this.objectLights(gs, f.lights);
      f.rim = cfg.rim;
    } else {
      f.rim = null;
    }

    // Camera and screen effects.
    const decay = (x: number, ticks: number) => x * Math.exp(-dt / ticks);
    this.flash = decay(this.flash, 3);
    this.chroma = decay(this.chroma, 7);
    this.desat = decay(this.desat, 20);
    this.shake = decay(this.shake, 5);
    this.shocks = this.shocks.filter((s) => (s.age += dt) < s.life);
    f.shockwaves.length = 0;
    f.flash = 0;
    f.chroma = 0;
    f.desaturate = 0;
    f.shakeX = 0;
    f.shakeY = 0;
    f.zoom = 1;
    if (v.fxImpact) {
      for (const s of this.shocks) {
        const k = s.age / s.life;
        f.shockwaves.push({ x: s.x, y: s.y, radius: s.radius * (1 - (1 - k) * (1 - k)), width: s.width * (0.6 + k), strength: s.strength * (1 - k) });
      }
      f.flash = this.flash;
      f.chroma = this.chroma;
      f.desaturate = this.desat;
      if (this.shake > 0.02) {
        f.shakeX = this.shake * Math.sin(this.t * 2.9 + 1.3) * 0.9;
        f.shakeY = this.shake * Math.sin(this.t * 3.7) * 0.6;
      }
      if (this.zoom) {
        this.zoom.age += dt;
        const a = this.zoom.age;
        // Ease in over 8 ticks, hold through the slow motion, ease out.
        const k = a < 8 ? 1 - Math.pow(1 - a / 8, 3) : a < 40 ? 1 : a < 75 ? 1 - smooth((a - 40) / 35) : 0;
        if (a >= 75) this.zoom = null;
        else {
          f.zoom = 1 + 0.075 * k;
          f.zoomX = this.zoom.x;
          f.zoomY = this.zoom.y;
        }
      }
    } else {
      this.zoom = null;
    }
    f.haze = v.fxAtmosphere ? cfg.haze : [];
    f.shafts = v.fxAtmosphere ? cfg.shafts : [];
  }

  private reset(): void {
    this.ps.clear();
    this.events.length = 0;
    this.timed = [];
    this.shocks = [];
    this.flash = this.chroma = this.desat = this.shake = 0;
    this.zoom = null;
    this.sceneId = -1;
    this.cfg = null;
    this.frame.particleCount = 0;
    this.frame.lights.length = 0;
    this.frame.shockwaves.length = 0;
  }

  // ---- events ---------------------------------------------------------------------

  private onEvent(e: FxEvent, cfg: ArenaFx, gs: GameState): void {
    const p = clamp(e.power, 0, 70);
    switch (e.type) {
      case FxType.HIT:
      case FxType.PROJECTILE_HIT:
      case FxType.HAZARD_HIT:
        this.impact(e.x, e.y, e.dir, p, HOT, HOT_END, e.type !== FxType.HIT);
        if (e.type === FxType.HAZARD_HIT && cfg.electricWalls) this.electric(e.x, e.y, p);
        break;
      case FxType.BLOCK:
        this.block(e.x, e.y, e.dir, p);
        break;
      case FxType.KO:
        this.knockout(e.x, e.y, e.dir, p);
        break;
      case FxType.WALL_SLAM:
        this.wallSlam(e.x, e.y, e.dir, p, cfg, gs.matchSettings.hazards && !!cfg.electricWalls);
        break;
      case FxType.LANDING:
        this.landing(e.x, e.y, p, cfg);
        break;
    }
  }

  private sparks(x: number, y: number, dir: number, n: number, speed: number, spread: number, c0: Rgba, c1: Rgba): void {
    const base = dir < 0 ? Math.PI : dir > 0 ? 0 : -Math.PI / 2;
    for (let i = 0; i < n; i++) {
      const a = base + (Math.random() - 0.5) * spread;
      const s = speed * rnd(0.35, 1.15);
      this.ps.spawn({
        kind: ParticleKind.SPARK, x: x + rnd(-2, 2), y: y + rnd(-2, 2), vx: Math.cos(a) * s, vy: Math.sin(a) * s - rnd(0.3, 1.8),
        gravity: 0.2, drag: 0.91, life: rnd(9, 22), size0: rnd(1.05, 1.6), size1: 0.45, stretch: 1.9, c0, c1,
        floor: FX_FLOOR, bounce: 0.35,
      });
    }
  }

  private glow(x: number, y: number, size: number, life: number, c0: Rgba, c1: Rgba): void {
    this.ps.spawn({ kind: ParticleKind.GLOW, x, y, life, size0: size, size1: size * 1.35, c0, c1 });
  }

  private flare(x: number, y: number, size: number, life: number, c0: Rgba, c1: Rgba): void {
    this.ps.spawn({ kind: ParticleKind.FLARE, x, y, life, size0: size, size1: size * 1.25, c0, c1 });
  }

  private dust(x: number, y: number, n: number, spreadX: number, cfg: ArenaFx, strength: number): void {
    const [r, g, b] = cfg.dust;
    for (let i = 0; i < n; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const s0 = rnd(2.5, 4.5) * (0.7 + strength * 0.5);
      this.ps.spawn({
        kind: ParticleKind.DUST, x: x + side * rnd(0, spreadX), y: y - rnd(0, 4), vx: side * rnd(0.3, 1.6) * (0.6 + strength),
        vy: -rnd(0.1, 0.5), gravity: -0.004, drag: 0.93, life: rnd(22, 42), size0: s0, size1: s0 * rnd(2, 2.8), fadeIn: 0.12,
        c0: [r, g, b, 0.42 * Math.min(1, 0.5 + strength)], c1: [r, g, b, 0],
      });
    }
  }

  private light(x: number, y: number, radius: number, r: number, g: number, b: number, life: number): void {
    if (this.timed.length > 24) this.timed.shift();
    this.timed.push({ light: { x, y, radius, r, g, b, objectsOnly: false }, r, g, b, age: 0, life });
  }

  private shock(x: number, y: number, radius: number, strength: number, life: number): void {
    if (this.shocks.length >= 4) this.shocks.shift();
    this.shocks.push({ x, y, age: 0, life, radius, width: 7, strength });
  }

  private impact(x: number, y: number, dir: number, p: number, c0: Rgba, c1: Rgba, fiery: boolean): void {
    const v = settings().video;
    const k = p / 30;
    if (v.fxParticles) {
      this.sparks(x, y, dir, Math.round(clamp(8 + p * 0.5, 8, 32)), 3 + p * 0.07, 2.2, c0, c1);
      this.flare(x, y, 5 + p * 0.22, 5, [1, 0.92, 0.75, 0.65], [1, 0.5, 0.2, 0]);
      if (fiery) {
        for (let i = 0; i < 3; i++) {
          const s = rnd(3, 5);
          this.ps.spawn({
            kind: ParticleKind.SMOKE, x: x + rnd(-4, 4), y: y + rnd(-4, 4), vx: rnd(-0.3, 0.3), vy: rnd(-0.6, -0.2), drag: 0.96,
            life: rnd(28, 45), size0: s, size1: s * 2.6, fadeIn: 0.1, c0: [0.28, 0.27, 0.27, 0.5], c1: [0.2, 0.2, 0.2, 0],
          });
        }
      }
    }
    const li = 0.22 + 0.28 * Math.min(k, 1.5);
    this.light(x, y, 34 + p * 0.7, li, li * 0.8, li * 0.55, 6);
    if (p >= 24) {
      this.shock(x, y, 30 + p, 0.8 + p * 0.02, 11);
      this.shake = Math.max(this.shake, 0.6 + p * 0.03);
      this.chroma = Math.max(this.chroma, 0.35);
    }
  }

  private block(x: number, y: number, dir: number, p: number): void {
    if (settings().video.fxParticles) {
      this.sparks(x, y, -dir, Math.round(clamp(6 + p * 0.25, 6, 16)), 2.4 + p * 0.03, 1.6, COLD, COLD_END);
      this.flare(x, y, 5 + p * 0.15, 4, [0.75, 0.88, 1, 0.6], [0.3, 0.5, 1, 0]);
    }
    this.light(x, y, 30 + p * 0.5, 0.18, 0.26, 0.45, 5);
  }

  private electric(x: number, y: number, p: number): void {
    if (settings().video.fxParticles) {
      for (let i = 0; i < 18 + p * 0.3; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = rnd(1.5, 4.5);
        this.ps.spawn({
          kind: ParticleKind.SPARK, x, y: y + rnd(-25, 25), vx: Math.cos(a) * s, vy: Math.sin(a) * s, gravity: 0.08, drag: 0.86,
          life: rnd(5, 12), size0: 0.8, size1: 0.3, stretch: 1.2, c0: COLD, c1: COLD_END,
        });
      }
      this.flare(x, y, 16, 6, [0.7, 0.85, 1, 0.8], [0.3, 0.45, 1, 0]);
    }
    this.light(x, y, 100, 0.3, 0.45, 0.9, 9);
  }

  private knockout(x: number, y: number, dir: number, p: number): void {
    const v = settings().video;
    if (v.fxParticles) {
      this.sparks(x, y, dir, 44, 4.5 + p * 0.05, 3.2, HOT, HOT_END);
      this.sparks(x, y, -dir, 14, 3, 2.4, HOT, HOT_END);
      this.flare(x, y, 22, 9, [1, 0.92, 0.75, 0.9], [1, 0.4, 0.1, 0]);
      this.ps.spawn({ kind: ParticleKind.RING, x, y, life: 14, size0: 4, size1: 70, c0: [1, 0.85, 0.6, 0.7], c1: [1, 0.5, 0.2, 0] });
    }
    this.light(x, y, 130, 0.9, 0.72, 0.5, 16);
    this.shock(x, y, 110, 2.2, 18);
    this.flash = 0.3;
    this.chroma = 1.4;
    this.desat = 0.3;
    this.shake = 2.2;
    this.zoom = { x: clamp(x, 70, 250), y: clamp(y, 70, 150), age: 0 };
  }

  private wallSlam(x: number, y: number, dir: number, p: number, cfg: ArenaFx, electric: boolean): void {
    const v = settings().video;
    if (v.fxParticles) {
      const [r, g, b] = cfg.dust;
      for (let i = 0; i < 12; i++) {
        const s0 = rnd(3, 5);
        this.ps.spawn({
          kind: ParticleKind.DUST, x: x + rnd(-3, 3), y: y + rnd(-40, 40), vx: -dir * rnd(0.3, 1.8), vy: rnd(-0.5, 0.5), gravity: 0.004,
          drag: 0.93, life: rnd(24, 44), size0: s0, size1: s0 * 2.4, fadeIn: 0.1, c0: [r, g, b, 0.45], c1: [r, g, b, 0],
        });
      }
    }
    this.shock(x, y, 50, 1.4, 12);
    this.shake = Math.max(this.shake, 1.2);
    if (electric) this.electric(x, y, p);
  }

  private landing(x: number, y: number, p: number, cfg: ArenaFx): void {
    if (!settings().video.fxParticles) return;
    if (p < 10) {
      this.dust(x, FX_FLOOR - 1, 3, 10, cfg, 0.2);
      return;
    }
    const k = clamp((p - 10) / 30, 0, 1);
    this.dust(x, FX_FLOOR - 1, Math.round(6 + k * 10), 16 + k * 14, cfg, k);
    if (p >= 30) {
      this.shock(x, FX_FLOOR - 4, 34, 0.9, 10);
      this.shake = Math.max(this.shake, 0.8);
    }
  }

  // ---- light from glowing objects -------------------------------------------------------

  private objectLights(gs: GameState, out: FxLight[]): void {
    let n = 0;
    for (const r of gs.objects) {
      const o = r.obj;
      if (o.hudLayer || isHar(o) || n >= MAX_OBJECT_LIGHTS) continue;
      const b = o.renderBounds();
      if (!b || b.w <= 0 || b.h <= 0) continue;
      const e = this.emissionOf(b.surf);
      if (e.amount < 20) continue;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      if (cx < -80 || cx > 400 || cy < -40 || cy > 240) continue;
      // Fire flickers (reddish light); energy is steady.
      const fire = e.r > e.b * 1.6;
      const f = fire ? 0.8 + 0.4 * flicker(this.t * 1.7, o.id * 0.37) : 1;
      const gain = Math.min(1, 0.3 + Math.sqrt(e.amount) / 36) * f;
      const radius = Math.min(120, 20 + Math.sqrt(e.amount) * 2.4);
      if (o.group & (GROUP_PROJECTILE | GROUP_HAZARD | GROUP_SCRAP)) {
        // Projectiles, hazards and burning debris light up everything around them.
        out.push({ x: cx, y: cy, radius, r: e.r * gain, g: e.g * gain, b: e.b * gain, objectsOnly: false });
      } else {
        // Scenery (torches...): their light is painted into the background already; it flickers on the walls a
        // little and reaches the robots fully.
        const k = 0.28;
        out.push({ x: cx, y: cy, radius, r: e.r * gain * k, g: e.g * gain * k, b: e.b * gain * k, objectsOnly: false });
        out.push({ x: cx, y: cy, radius: radius * 1.25, r: e.r * gain, g: e.g * gain, b: e.b * gain, objectsOnly: true });
      }
      n++;
    }
  }

  /** Glowing color of a sprite: its bright, saturated pixels (computed once per image with the palette of the time). */
  private emissionOf(surf: Surface): Emission {
    let e = this.emission.get(surf);
    if (e) return e;
    const pal = vga.undarkened.colors;
    const d = surf.data;
    let r = 0, g = 0, b = 0, amount = 0;
    const n = surf.w * surf.h;
    for (let i = 0; i < n; i++) {
      const idx = d[i];
      if (idx === surf.transparent) continue;
      const cr = pal[idx * 3] / 255, cg = pal[idx * 3 + 1] / 255, cb = pal[idx * 3 + 2] / 255;
      const mx = Math.max(cr, cg, cb);
      if (mx < 0.55) continue;
      const mn = Math.min(cr, cg, cb);
      const sat = (mx - mn) / mx;
      const t = Math.min(1, (mx - 0.55) / 0.4);
      const w = t * t * (3 - 2 * t) * (0.25 + 0.75 * sat);
      r += cr * w;
      g += cg * w;
      b += cb * w;
      amount += w;
    }
    const norm = amount > 0 ? 1 / amount : 0;
    e = { r: r * norm, g: g * norm, b: b * norm, amount };
    this.emission.set(surf, e);
    return e;
  }
}

function smooth(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}
