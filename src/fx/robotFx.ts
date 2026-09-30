// Effects of the remaster's robots' special moves: frost and ice shards (GLACIER), wind (TEMPEST), drill sparks and
// shavings (HELIX), laser glow and phase shimmer (SPECTRE). Read each frame from what their HARs and projectiles are
// doing; cosmetic only, like everything the effects director makes. Robots built from the workshop's parts (the
// workshop's, and mods' like the new robots' own) have the effects of the robot whose moves they have.
import { GROUP_PROJECTILE, HarId } from '../game/constants';
import type { GameState } from '../game/gameState';
import type { GameObject } from '../game/object';
import { harData, isHar } from '../game/objects/har';
import { projectileGetAfData } from '../game/objects/projectile';
import { MOVE } from '../gen/fighter/moveset';
import { genRobot } from '../gen/roster';
import { ParticleKind } from '../video/fx/types';
import type { ParticleSystem } from './particles';

type Rgba = readonly [number, number, number, number];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Spawns `rate * dt` on average. */
function emit(rate: number, dt: number, fn: () => void): void {
  let n = rate * dt;
  while (n >= 1) {
    fn();
    n--;
  }
  if (Math.random() < n) fn();
}

const ICE: Rgba = [0.75, 0.95, 1, 1];
const ICE_END: Rgba = [0.3, 0.7, 1, 0];
const FROST: Rgba = [0.8, 0.92, 1, 0.22];
const FROST_END: Rgba = [0.75, 0.9, 1, 0];
const WIND: Rgba = [0.85, 0.9, 0.95, 0.3];
const WIND_END: Rgba = [0.8, 0.85, 0.9, 0];
const HOT: Rgba = [1, 0.9, 0.55, 1];
const HOT_END: Rgba = [1, 0.35, 0.05, 0];
const STEEL: Rgba = [0.75, 0.78, 0.82, 1];
const STEEL_END: Rgba = [0.5, 0.52, 0.55, 0];
const LASER: Rgba = [0.95, 0.6, 1, 0.9];
const LASER_END: Rgba = [0.6, 0.2, 1, 0];

/** The remaster's robot (GLACIER .. SPECTRE) whose special moves' effects a HAR has, or -1. */
export function effectsOf(harId: number): number {
  const r = genRobot(harId);
  return r ? r.movesOf ?? r.id : -1;
}

/** The remaster's robot whose frame a HAR has (its fists' effects), or -1. */
export function frameOf(harId: number): number {
  const r = genRobot(harId);
  return r ? r.bodyOf ?? r.id : -1;
}

/** Adds a timed light (the director's). */
export type LightFn = (x: number, y: number, radius: number, r: number, g: number, b: number, life: number) => void;

export class RobotFx {
  /** Objects whose one-off burst was made (object id and animation). */
  private burst = new Set<string>();

  reset(): void {
    this.burst.clear();
  }

  private once(o: GameObject, fn: () => void): void {
    const key = `${o.id}:${o.curAnimation?.id ?? -1}`;
    if (this.burst.has(key)) return;
    this.burst.add(key);
    fn();
  }

  update(gs: GameState, ps: ParticleSystem, dt: number, light: LightFn): void {
    if (dt <= 0) return;
    for (const r of gs.objects) {
      const o = r.obj;
      const b = o.renderBounds();
      if (!b || !o.curAnimation) continue;
      const anim = o.curAnimation.id;
      if (isHar(o)) {
        const id = effectsOf(harData(o).id);
        if (id >= 0) this.har(o, id, anim, b, ps, dt, light);
      } else if (o.group & GROUP_PROJECTILE) {
        const id = effectsOf(projectileGetAfData(o)?.id ?? -1);
        if (id >= 0) this.projectile(o, id, anim, b, ps, dt, light);
      }
    }
  }

  private har(o: GameObject, id: number, anim: number, b: { x: number; y: number; w: number; h: number }, ps: ParticleSystem, dt: number, light: LightFn): void {
    const dir = o.direction;
    const front = dir > 0 ? b.x + b.w : b.x;
    const cx = b.x + b.w / 2;
    const sprite = o.curSpriteId;
    switch (id) {
      case HarId.GLACIER:
        if (anim === MOVE.SPECIAL1 && sprite >= 1 && sprite <= 2) {
          // Frost gathering in the palms.
          emit(1.2, dt, () => ps.spawn({
            kind: ParticleKind.SMOKE, x: front - dir * rnd(4, 14), y: b.y + b.h * rnd(0.25, 0.45), vx: dir * rnd(0.1, 0.5), vy: rnd(-0.3, 0.1),
            drag: 0.96, life: rnd(20, 34), size0: rnd(2, 3.5), size1: rnd(6, 9), fadeIn: 0.2, c0: FROST, c1: FROST_END,
          }));
        } else if (anim === MOVE.SPECIAL2 && sprite >= 2) {
          // Ice spraying from the feet while sliding.
          emit(2.4, dt, () => ps.spawn({
            kind: ParticleKind.SHARD, x: cx - dir * rnd(0, 18), y: b.y + b.h - rnd(0, 4), vx: -dir * rnd(0.8, 2.6), vy: -rnd(0.4, 2), gravity: 0.15,
            drag: 0.95, life: rnd(10, 20), size0: rnd(0.7, 1.2), size1: 0.3, stretch: 1.4, c0: ICE, c1: ICE_END, floor: 193, bounce: 0.3,
          }));
          emit(0.7, dt, () => ps.spawn({
            kind: ParticleKind.SMOKE, x: cx - dir * rnd(10, 30), y: b.y + b.h - rnd(2, 8), vx: -dir * rnd(0.1, 0.4), vy: rnd(-0.1, 0), drag: 0.97,
            life: rnd(30, 50), size0: 4, size1: 12, fadeIn: 0.15, c0: FROST, c1: FROST_END,
          }));
        } else if (anim === MOVE.DESTRUCTION && sprite === 2) {
          this.once(o, () => {
            for (let i = 0; i < 40; i++) {
              const a = rnd(-Math.PI, 0);
              const s = rnd(1.5, 5);
              ps.spawn({
                kind: ParticleKind.SHARD, x: front, y: b.y + b.h - 6, vx: Math.cos(a) * s, vy: Math.sin(a) * s, gravity: 0.18, drag: 0.94,
                life: rnd(16, 32), size0: rnd(0.9, 1.6), size1: 0.4, stretch: 1.3, c0: ICE, c1: ICE_END, floor: 193, bounce: 0.3,
              });
            }
            light(front, b.y + b.h - 10, 160, 0.3, 0.55, 0.75, 16);
          });
        }
        break;
      case HarId.TEMPEST:
        if (anim === MOVE.SPECIAL2 || (anim === MOVE.SPECIAL1 && sprite >= 1 && sprite <= 2) || anim === MOVE.AIR1) {
          // A vortex around the body (cyclone kick), gusts off the hands (gale blast), a slipstream (sky dive).
          const spin = anim === MOVE.SPECIAL2;
          emit(spin ? 3 : 1.5, dt, () => {
            const a = Math.random() * Math.PI * 2;
            const rx = b.w * 0.55, ry = b.h * 0.45;
            const x = cx + Math.cos(a) * rx, y = b.y + b.h * 0.5 + Math.sin(a) * ry * 0.35;
            const tangential = spin ? 2.2 : 0.6;
            ps.spawn({
              kind: ParticleKind.WISP, x, y, vx: -Math.sin(a) * tangential + (spin ? 0 : dir * 1.4), vy: Math.cos(a) * tangential * 0.25 - (spin ? 0.6 : 0),
              life: rnd(8, 16), size0: rnd(0.6, 1), stretch: 3, fadeIn: 0.2, c0: WIND, c1: WIND_END,
            });
          });
        }
        break;
      case HarId.HELIX:
        if ((anim === MOVE.SPECIAL1 && sprite >= 2 && sprite <= 4) || (anim === MOVE.SPECIAL2 && sprite >= 2 && sprite <= 4)) {
          // Sparks and shavings flying off the spinning drill.
          const rising = anim === MOVE.SPECIAL2;
          const tx = rising ? cx + dir * b.w * 0.15 : front - dir * 3;
          const ty = rising ? b.y + 4 : b.y + b.h * 0.3;
          emit(3.5, dt, () => {
            const a = (rising ? -Math.PI / 2 : dir > 0 ? 0 : Math.PI) + rnd(-1.4, 1.4);
            const s = rnd(1.5, 4);
            ps.spawn({
              kind: ParticleKind.SPARK, x: tx, y: ty, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.6, gravity: 0.2, drag: 0.92, life: rnd(7, 15),
              size0: rnd(0.8, 1.2), size1: 0.35, stretch: 1.7, c0: HOT, c1: HOT_END, floor: 193, bounce: 0.35,
            });
          });
          emit(0.8, dt, () => ps.spawn({
            kind: ParticleKind.DEBRIS, x: tx, y: ty, vx: rnd(-1.5, 1.5), vy: rnd(-2.5, -0.5), gravity: 0.2, drag: 0.97, life: rnd(20, 36),
            size0: rnd(0.6, 1), size1: 0.6, c0: STEEL, c1: STEEL_END, floor: 193, bounce: 0.4,
          }));
          emit(0.5, dt, () => light(tx, ty, 40, 0.3, 0.2, 0.08, 3));
        }
        break;
      case HarId.SPECTRE:
        if (anim === MOVE.SPECIAL1 && sprite >= 1 && sprite <= 2) {
          // The emitter charging.
          emit(1.5, dt, () => {
            const a = Math.random() * Math.PI * 2, d = rnd(6, 12);
            const x = front - dir * 6, y = b.y + b.h * 0.35;
            ps.spawn({
              kind: ParticleKind.GLOW, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: -Math.cos(a) * d * 0.12, vy: -Math.sin(a) * d * 0.12,
              life: 8, size0: 1, size1: 0.3, c0: LASER, c1: LASER_END,
            });
          });
        } else if (anim === MOVE.SPECIAL2) {
          // Phasing out and in: a shimmer rising off the body.
          emit(2.5, dt, () => ps.spawn({
            kind: ParticleKind.GLOW, x: b.x + rnd(0, b.w), y: b.y + rnd(0, b.h), vx: rnd(-0.1, 0.1), vy: -rnd(0.3, 0.9), life: rnd(10, 22),
            size0: rnd(0.8, 1.5), size1: 0.2, c0: LASER, c1: LASER_END,
          }));
          this.once(o, () => ps.spawn({ kind: ParticleKind.RING, x: cx, y: b.y + b.h * 0.5, life: 16, size0: 6, size1: 50, c0: [0.85, 0.5, 1, 0.6], c1: [0.5, 0.2, 1, 0] }));
        } else if (anim === MOVE.SPECIAL3 && sprite >= 2) {
          // Afterimages of the dash.
          emit(2, dt, () => ps.spawn({
            kind: ParticleKind.WISP, x: cx - dir * rnd(0, 20), y: b.y + rnd(0.2, 0.8) * b.h, vx: -dir * rnd(0.5, 1.5), vy: 0, life: rnd(8, 14),
            size0: rnd(0.8, 1.4), stretch: 4, fadeIn: 0.1, c0: [0.8, 0.5, 1, 0.3], c1: [0.5, 0.2, 1, 0],
          }));
        }
        break;
    }
  }

  private projectile(o: GameObject, id: number, anim: number, b: { x: number; y: number; w: number; h: number }, ps: ParticleSystem, dt: number, light: LightFn): void {
    const dir = o.direction;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const tail = dir > 0 ? b.x : b.x + b.w;
    switch (id) {
      case HarId.GLACIER:
        if (anim === MOVE.FX1) {
          // The lance leaves frost and glittering ice behind.
          emit(1.6, dt, () => ps.spawn({
            kind: ParticleKind.SMOKE, x: tail + rnd(-4, 4), y: cy + rnd(-3, 3), vx: -dir * rnd(0, 0.3), vy: rnd(-0.15, 0.15), drag: 0.97,
            life: rnd(18, 30), size0: 2.5, size1: 8, fadeIn: 0.1, c0: FROST, c1: FROST_END,
          }));
          emit(1.2, dt, () => ps.spawn({
            kind: ParticleKind.SHARD, x: tail + rnd(0, b.w * 0.5) * dir, y: cy + rnd(-4, 4), vx: -dir * rnd(0.2, 1), vy: rnd(-0.5, 0.5), gravity: 0.05,
            life: rnd(8, 16), size0: 0.8, size1: 0.2, stretch: 1, c0: ICE, c1: ICE_END,
          }));
        } else if (anim === MOVE.FX2) {
          // The lance shattering.
          this.once(o, () => {
            for (let i = 0; i < 22; i++) {
              const a = Math.random() * Math.PI * 2;
              const s = rnd(1.2, 3.5);
              ps.spawn({
                kind: ParticleKind.SHARD, x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, gravity: 0.16, drag: 0.94,
                life: rnd(14, 28), size0: rnd(0.9, 1.5), size1: 0.3, stretch: 1.3, c0: ICE, c1: ICE_END, floor: 193, bounce: 0.3,
              });
            }
            for (let i = 0; i < 4; i++) {
              ps.spawn({
                kind: ParticleKind.SMOKE, x: cx + rnd(-8, 8), y: cy + rnd(-5, 5), vx: rnd(-0.4, 0.4), vy: rnd(-0.4, 0),
                drag: 0.96, life: rnd(30, 50), size0: 4, size1: 12, fadeIn: 0.1, c0: [0.8, 0.92, 1, 0.2], c1: FROST_END,
              });
            }
            light(cx, cy, 90, 0.25, 0.45, 0.6, 12);
          });
        } else if (anim === MOVE.FX3) {
          // Spikes bursting from the floor: ice chips thrown up from their base and frost mist spreading low along
          // the floor, so the spikes themselves stay in view (a fog on them washed them out on bright floors).
          this.once(o, () => {
            const base = b.y + b.h - 2;
            for (let i = 0; i < 26; i++) {
              const a = rnd(-Math.PI * 0.95, -Math.PI * 0.05);
              const s = rnd(1.2, 4.2);
              ps.spawn({
                kind: ParticleKind.SHARD, x: cx + rnd(-b.w * 0.4, b.w * 0.4), y: base - 1, vx: Math.cos(a) * s, vy: Math.sin(a) * s, gravity: 0.16,
                drag: 0.94, life: rnd(14, 28), size0: rnd(0.9, 1.5), size1: 0.3, stretch: 1.3, c0: ICE, c1: ICE_END, floor: 193, bounce: 0.3,
              });
            }
            for (let i = 0; i < 6; i++) {
              const side = i % 2 ? 1 : -1;
              ps.spawn({
                kind: ParticleKind.SMOKE, x: cx + side * rnd(b.w * 0.2, b.w * 0.55), y: base + rnd(-1, 1), vx: side * rnd(0.25, 0.6), vy: rnd(-0.06, 0),
                drag: 0.97, life: rnd(34, 56), size0: 3, size1: rnd(9, 13), fadeIn: 0.2, c0: [0.82, 0.93, 1, 0.14], c1: FROST_END,
              });
            }
            light(cx, base - 10, 70, 0.12, 0.24, 0.32, 10);
          });
        }
        break;
      case HarId.TEMPEST:
        if (anim === MOVE.FX1) {
          // A whirlwind: gusts spiraling around the flight path.
          emit(3, dt, () => {
            const a = Math.random() * Math.PI * 2;
            const r = rnd(4, 11);
            ps.spawn({
              kind: ParticleKind.WISP, x: cx - dir * rnd(0, 12), y: cy + Math.sin(a) * r, vx: -dir * rnd(0.5, 1.5), vy: Math.cos(a) * 1.4, life: rnd(8, 14),
              size0: rnd(0.6, 1.1), stretch: 3, fadeIn: 0.1, c0: WIND, c1: WIND_END,
            });
          });
        } else if (anim === MOVE.FX2) {
          this.once(o, () => ps.spawn({ kind: ParticleKind.RING, x: cx, y: cy, life: 12, size0: 4, size1: 40, c0: [0.9, 0.95, 1, 0.45], c1: [0.8, 0.9, 1, 0] }));
        }
        break;
      case HarId.HELIX:
        if (anim === MOVE.FX1) {
          emit(2.5, dt, () => ps.spawn({
            kind: ParticleKind.SPARK, x: tail, y: cy + rnd(-3, 3), vx: -dir * rnd(1, 3), vy: rnd(-1.2, 0.6), gravity: 0.18, drag: 0.92, life: rnd(6, 12),
            size0: 0.9, size1: 0.3, stretch: 1.6, c0: HOT, c1: HOT_END, floor: 193, bounce: 0.35,
          }));
        }
        break;
      case HarId.SPECTRE:
        if (anim === MOVE.FX1) {
          emit(2.5, dt, () => ps.spawn({
            kind: ParticleKind.GLOW, x: tail + dir * rnd(0, b.w), y: cy + rnd(-1.5, 1.5), vx: -dir * rnd(0.1, 0.4), vy: rnd(-0.1, 0.1), life: rnd(6, 12),
            size0: rnd(1, 1.8), size1: 0.3, c0: LASER, c1: LASER_END,
          }));
        } else if (anim === MOVE.FX2) {
          this.once(o, () => {
            ps.spawn({ kind: ParticleKind.FLARE, x: cx, y: cy, life: 8, size0: 14, size1: 18, c0: [1, 0.8, 1, 0.9], c1: [0.6, 0.2, 1, 0] });
            light(cx, cy, 110, 0.55, 0.25, 0.85, 10);
          });
        }
        break;
    }
  }
}
