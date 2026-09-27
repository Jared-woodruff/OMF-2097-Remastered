// Per-arena tuning of the remastered effects: the arena's light on the robots (rim light and tint), light painted into
// the background that should also reach the robots, heat haze, light shafts, ambient particles and floor dust color.
// Positions are native coordinates (the widescreen extension reaches about x = -55 .. 375 at 16:9).
import { ParticleKind, type FxHaze, type FxLight, type FxRimLight, type FxShaft } from '../video/fx/types';
import type { ParticleSystem } from './particles';

export interface ArenaFx {
  /** Floor dust color (landings, slams). */
  dust: readonly [number, number, number];
  rim: FxRimLight;
  /** Light from the background art that should reach the robots (animated by the time in ticks). */
  envLights(t: number, out: FxLight[]): void;
  haze: FxHaze[];
  shafts: FxShaft[];
  /** Ambient particles for `dt` ticks at time `t`. */
  ambient(ps: ParticleSystem, dt: number, t: number): void;
  /** Wall slams electrify (Power Plant fences, with hazards on). */
  electricWalls?: boolean;
}

const FLOOR = 192;

/** Spawns `rate * dt` particles on average (fractional rates spawn probabilistically). */
function emit(rate: number, dt: number, fn: () => void): void {
  let n = rate * dt;
  while (n >= 1) {
    fn();
    n--;
  }
  if (Math.random() < n) fn();
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Smooth pseudo-random flicker in 0..1 (sum of incommensurate sines). */
export function flicker(t: number, seed: number): number {
  return 0.5 + 0.25 * Math.sin(t * 0.37 + seed * 7.1) + 0.15 * Math.sin(t * 0.91 + seed * 3.3) + 0.1 * Math.sin(t * 2.3 + seed * 1.7);
}

// ---- Stadium: floodlights over a steel cage, glossy blue floor, a crowd behind the mesh.
const STADIUM: ArenaFx = {
  dust: [0.55, 0.6, 0.75],
  rim: { x: 160, y: -140, r: 0.5, g: 0.58, b: 0.72, ambR: 1, ambG: 1, ambB: 1 },
  envLights() {},
  haze: [],
  shafts: [{ x: 67, y: 44, strength: 0.34 }, { x: 259, y: 44, strength: 0.34 }],
  ambient(ps, dt) {
    // Camera flashes in the crowd.
    emit(0.3, dt, () => {
      const s = rnd(1.4, 3);
      ps.spawn({
        kind: ParticleKind.FLARE, x: rnd(-50, 370), y: rnd(6, 68), life: rnd(3, 6), size0: s, size1: s * 0.6,
        c0: [1, 1, 1, 1], c1: [0.75, 0.85, 1, 0],
      });
    });
  },
};

// ---- Danger Room: a dark brick corridor under a night sky.
const DANGER_ROOM: ArenaFx = {
  dust: [0.5, 0.46, 0.42],
  rim: { x: 170, y: -80, r: 0.34, g: 0.45, b: 0.78, ambR: 0.9, ambG: 0.92, ambB: 1 },
  envLights() {},
  haze: [],
  shafts: [],
  ambient(ps, dt) {
    // Dust motes drifting in the dark.
    emit(0.22, dt, () => {
      const s = rnd(0.45, 0.8);
      ps.spawn({
        kind: ParticleKind.GLOW, x: rnd(-50, 370), y: rnd(20, 188), vx: rnd(-0.05, 0.05), vy: rnd(-0.04, 0.03), wobble: 0.025,
        life: rnd(180, 360), size0: s, size1: s, fadeIn: 0.3, c0: [0.55, 0.6, 0.7, 0.7], c1: [0.45, 0.5, 0.6, 0],
      });
    });
  },
};

// ---- Power Plant: blue steel structures and electric fences under a night sky.
const POWER_PLANT: ArenaFx = {
  dust: [0.68, 0.7, 0.76],
  rim: { x: 160, y: -100, r: 0.4, g: 0.55, b: 0.85, ambR: 0.95, ambG: 0.97, ambB: 1 },
  envLights() {},
  haze: [],
  shafts: [],
  ambient() {},
  electricWalls: true,
};

// ---- Fire Pit: torches and a glowing lava grate.
const TORCHES: readonly (readonly [number, number])[] = [[41, 58], [113, 74], [203, 74], [276, 58]];
const FIRE_PIT: ArenaFx = {
  dust: [0.36, 0.3, 0.27],
  rim: { x: 160, y: 260, r: 0.95, g: 0.45, b: 0.15, ambR: 1, ambG: 0.95, ambB: 0.9 },
  envLights(t, out) {
    const f = 0.85 + 0.3 * (flicker(t, 0.3) - 0.5);
    out.push({ x: 160, y: 228, radius: 150, r: 0.55 * f, g: 0.22 * f, b: 0.06 * f, objectsOnly: true });
  },
  haze: [
    { x0: -60, y0: 150, x1: 380, y1: 200, strength: 0.65 },
    ...TORCHES.map(([x, y]) => ({ x0: x - 9, y0: y - 34, x1: x + 9, y1: y + 2, strength: 0.7 })),
  ],
  shafts: [],
  ambient(ps, dt) {
    // Embers rising from the grate...
    emit(1.1, dt, () => {
      const s = rnd(0.8, 1.4);
      ps.spawn({
        kind: ParticleKind.EMBER, x: rnd(-40, 360), y: rnd(172, 198), vx: rnd(-0.12, 0.12), vy: rnd(-1.1, -0.35), gravity: -0.004,
        drag: 0.995, wobble: 0.1, life: rnd(60, 140), size0: s, size1: s * 0.6, c0: [1, 0.72, 0.28, 1], c1: [1, 0.22, 0.04, 0],
      });
    });
    // ... and sparks from the torches.
    for (const [x, y] of TORCHES) {
      emit(0.06, dt, () => {
        ps.spawn({
          kind: ParticleKind.EMBER, x: x + rnd(-3, 3), y: y - rnd(10, 22), vx: rnd(-0.15, 0.15), vy: rnd(-0.8, -0.3), gravity: -0.002,
          wobble: 0.06, life: rnd(25, 55), size0: 0.8, size1: 0.45, c0: [1, 0.8, 0.35, 1], c1: [1, 0.3, 0.05, 0],
        });
      });
    }
  },
};

// ---- Desert: sunset over the dunes.
const DESERT: ArenaFx = {
  dust: [0.86, 0.72, 0.5],
  rim: { x: 157, y: 91, r: 1.35, g: 0.78, b: 0.36, ambR: 1.03, ambG: 0.96, ambB: 0.88 },
  envLights() {},
  haze: [
    { x0: -60, y0: 82, x1: 380, y1: 106, strength: 0.45 },
    { x0: -60, y0: 150, x1: 380, y1: 200, strength: 0.22 },
  ],
  shafts: [{ x: 157, y: 91, strength: 0.28 }],
  ambient(ps, dt) {
    // Sand blown over the dunes.
    emit(0.45, dt, () => {
      ps.spawn({
        kind: ParticleKind.WISP, x: rnd(-60, 300), y: rnd(135, 198), vx: rnd(1.4, 3), vy: rnd(-0.08, 0.05), wobble: 0.05,
        life: rnd(45, 90), size0: rnd(0.7, 1.3), stretch: 3, fadeIn: 0.25, c0: [0.95, 0.8, 0.55, 0.22], c1: [0.95, 0.8, 0.55, 0],
      });
    });
  },
};

/** Effects configuration of an arena (0..4). */
export function arenaFx(arena: number): ArenaFx {
  return [STADIUM, DANGER_ROOM, POWER_PLANT, FIRE_PIT, DESERT][arena] ?? STADIUM;
}

export { FLOOR as FX_FLOOR };
