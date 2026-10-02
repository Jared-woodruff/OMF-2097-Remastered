// CPU particle simulation for the remastered effects: sparks, glows, embers, smoke, dust, debris. Time is measured in
// game ticks (so particles follow the game speed, slow motion and pause); positions in native pixels.
import { MAX_PARTICLES, PARTICLE_FLOATS, type ParticleKind } from '../video/fx/types';

export interface ParticleSpawn {
  kind: ParticleKind;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  /** Acceleration downwards (native px / tick²). */
  gravity?: number;
  /** Velocity kept per tick (1 = no drag). */
  drag?: number;
  /** Lifetime in ticks. */
  life: number;
  /** Size (radius, native px) at birth and at death. */
  size0: number;
  size1?: number;
  /** Streak length per unit of speed (sparks, wisps). */
  stretch?: number;
  /** Color (0..1, alpha last) at birth and at death. */
  c0: readonly [number, number, number, number];
  c1?: readonly [number, number, number, number];
  /** Fraction of the life spent fading in (smoke, dust). */
  fadeIn?: number;
  /** Floor height (native y) the particle bounces on or slides along; Infinity for none. */
  floor?: number;
  /** Bounciness on the floor (0 = slides). */
  bounce?: number;
  /** Sideways swaying (native px per tick). */
  wobble?: number;
}

export class ParticleSystem {
  readonly max: number;
  count = 0;
  private x: Float32Array;
  private y: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private stretch: Float32Array;
  private col: Float32Array; // 8 per particle: c0 rgba, c1 rgba
  private kind: Uint8Array;
  private seed: Float32Array;
  private fadeIn: Float32Array;
  private floor: Float32Array;
  private bounce: Float32Array;
  private wobble: Float32Array;

  constructor(max = MAX_PARTICLES) {
    this.max = max;
    this.x = new Float32Array(max);
    this.y = new Float32Array(max);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.stretch = new Float32Array(max);
    this.col = new Float32Array(max * 8);
    this.kind = new Uint8Array(max);
    this.seed = new Float32Array(max);
    this.fadeIn = new Float32Array(max);
    this.floor = new Float32Array(max);
    this.bounce = new Float32Array(max);
    this.wobble = new Float32Array(max);
  }

  clear(): void {
    this.count = 0;
  }

  spawn(p: ParticleSpawn): void {
    // When full, replace the oldest-looking slot (the first one): new impacts matter more than old embers.
    const i = this.count < this.max ? this.count++ : Math.floor(Math.random() * this.max);
    this.x[i] = p.x;
    this.y[i] = p.y;
    this.vx[i] = p.vx ?? 0;
    this.vy[i] = p.vy ?? 0;
    this.grav[i] = p.gravity ?? 0;
    this.drag[i] = p.drag ?? 1;
    this.age[i] = 0;
    this.life[i] = Math.max(0.5, p.life);
    this.s0[i] = p.size0;
    this.s1[i] = p.size1 ?? p.size0;
    this.stretch[i] = p.stretch ?? 0;
    const c1 = p.c1 ?? [p.c0[0], p.c0[1], p.c0[2], 0];
    this.col.set(p.c0, i * 8);
    this.col.set(c1, i * 8 + 4);
    this.kind[i] = p.kind;
    this.seed[i] = Math.random();
    this.fadeIn[i] = p.fadeIn ?? 0;
    this.floor[i] = p.floor ?? Infinity;
    this.bounce[i] = p.bounce ?? 0;
    this.wobble[i] = p.wobble ?? 0;
  }

  /** Advances the simulation by `dt` ticks. */
  step(dt: number): void {
    if (dt <= 0) return;
    let i = 0;
    while (i < this.count) {
      const age = this.age[i] + dt;
      if (age >= this.life[i]) {
        this.remove(i);
        continue;
      }
      this.age[i] = age;
      const d = this.drag[i] === 1 ? 1 : Math.pow(this.drag[i], dt);
      let vx = this.vx[i] * d;
      let vy = this.vy[i] * d + this.grav[i] * dt;
      let x = this.x[i] + vx * dt;
      let y = this.y[i] + vy * dt;
      const w = this.wobble[i];
      if (w !== 0) x += Math.sin(age * 0.11 + this.seed[i] * 40) * w * dt;
      const fl = this.floor[i];
      if (y > fl && vy > 0) {
        y = fl;
        if (this.bounce[i] > 0) {
          vy = -vy * this.bounce[i];
          vx *= 0.6;
          if (vy > -0.35) vy = 0;
        } else {
          vy = 0;
          vx *= 0.85;
        }
      }
      this.x[i] = x;
      this.y[i] = y;
      this.vx[i] = vx;
      this.vy[i] = vy;
      i++;
    }
  }

  private remove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.x[i] = this.x[last];
    this.y[i] = this.y[last];
    this.vx[i] = this.vx[last];
    this.vy[i] = this.vy[last];
    this.grav[i] = this.grav[last];
    this.drag[i] = this.drag[last];
    this.age[i] = this.age[last];
    this.life[i] = this.life[last];
    this.s0[i] = this.s0[last];
    this.s1[i] = this.s1[last];
    this.stretch[i] = this.stretch[last];
    this.col.copyWithin(i * 8, last * 8, last * 8 + 8);
    this.kind[i] = this.kind[last];
    this.seed[i] = this.seed[last];
    this.fadeIn[i] = this.fadeIn[last];
    this.floor[i] = this.floor[last];
    this.bounce[i] = this.bounce[last];
    this.wobble[i] = this.wobble[last];
  }

  /** Writes the render instances (see PARTICLE_FLOATS) and returns how many were written. */
  pack(out: Float32Array): number {
    const n = Math.min(this.count, Math.floor(out.length / PARTICLE_FLOATS));
    const c = this.col;
    for (let i = 0; i < n; i++) {
      const t = this.age[i] / this.life[i];
      const o = i * PARTICLE_FLOATS;
      const fi = this.fadeIn[i];
      const env = fi > 0 && t < fi ? t / fi : 1;
      const k = i * 8;
      out[o] = this.x[i];
      out[o + 1] = this.y[i];
      out[o + 2] = this.vx[i];
      out[o + 3] = this.vy[i];
      out[o + 4] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      out[o + 5] = this.stretch[i];
      out[o + 6] = this.kind[i];
      out[o + 7] = this.seed[i];
      out[o + 8] = c[k] + (c[k + 4] - c[k]) * t;
      out[o + 9] = c[k + 1] + (c[k + 5] - c[k + 1]) * t;
      out[o + 10] = c[k + 2] + (c[k + 6] - c[k + 2]) * t;
      out[o + 11] = (c[k + 3] + (c[k + 7] - c[k + 3]) * t) * env;
    }
    return n;
  }
}
