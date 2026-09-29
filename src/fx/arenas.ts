// Per-arena tuning of the remastered effects: the arena's light on the robots (rim light and tint), light painted into
// the background that should also reach the robots, heat haze, light shafts, ambient particles and floor dust color.
// Positions are native coordinates (the widescreen extension reaches about x = -55 .. 375 at 16:9).
import { ParticleKind, type FxHaze, type FxLight, type FxRimLight, type FxShaft } from '../video/fx/types';
import type { ParticleSystem } from './particles';

/** What an arena's weather may do besides spawning particles. */
export interface ArenaCtx {
  ps: ParticleSystem;
  /** White flash over the scene (0..1, fades quickly). */
  flash(v: number): void;
  /** A light fading out over `life` ticks. */
  light(x: number, y: number, radius: number, r: number, g: number, b: number, life: number): void;
}

export interface ArenaFx {
  /** Floor dust color (landings, slams). */
  dust: readonly [number, number, number];
  /** Color of the energy curtains at the fighting area's edges (see FxBarrier), in the arena's light. */
  barrier: readonly [number, number, number];
  /** Gravity of sparks and debris (1 = normal; the orbital station floats them). */
  gravity?: number;
  /** Weather events (lightning...) for `dt` ticks at time `t`. */
  weather?(ctx: ArenaCtx, dt: number, t: number): void;
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
  barrier: [0.62, 0.84, 1],
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
  barrier: [0.72, 0.56, 1],
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
  barrier: [0.42, 0.72, 1],
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
  barrier: [1, 0.5, 0.18],
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
  barrier: [1, 0.7, 0.34],
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

// ---- The remaster's arenas ---------------------------------------------------------------------------------------
// Their backgrounds are paintings (public/gen/ARENAn-WIDE.webp): what twinkles, blinks and glows sits on what the
// painting shows there (positions measured on the paintings: native x = painting x / 5 - 128, y = painting y / 6).

/** Stars of the Orbital's painting, in the window above the Earth. */
const ORBITAL_STARS: readonly (readonly [number, number])[] = [
  [57, 85], [189, 67], [57, 73], [98, 63], [53, 78], [47, 84], [39, 62], [179, 78], [113, 85], [276, 73], [215, 82],
  [136, 82], [122, 62], [175, 74], [247, 78], [106, 79], [109, 81], [81, 71], [255, 77], [58, 64], [98, 66], [241, 84],
  [144, 88], [243, 81], [79, 63], [256, 68], [145, 64], [193, 74], [76, 81], [248, 67], [181, 62], [67, 98], [140, 68],
  [195, 81], [47, 60], [212, 64], [209, 64], [103, 88], [241, 87], [169, 90], [281, 68], [165, 85], [50, 65], [213, 90],
  [128, 70], [132, 77], [242, 70], [136, 88], [204, 75], [220, 61], [149, 60], [176, 67], [113, 91], [257, 60],
  [220, 79], [41, 89],
];

// ---- Orbital: a station's hangar deck, the Earth in the window; sparks and debris float in the low gravity.
const ORBITAL: ArenaFx = {
  dust: [0.55, 0.6, 0.7],
  barrier: [0.38, 0.86, 1],
  gravity: 0.35,
  rim: { x: 170, y: 70, r: 0.35, g: 0.55, b: 0.95, ambR: 0.95, ambG: 0.97, ambB: 1.03 },
  envLights(t, out) {
    // Earthlight from the window on the robots, and the side panels' slow cyan pulse.
    out.push({ x: 175, y: 125, radius: 240, r: 0.1, g: 0.16, b: 0.3, objectsOnly: true });
    const p = 0.6 + 0.4 * Math.sin(t * 0.05);
    for (const x of [-54, 374]) out.push({ x, y: 74, radius: 150, r: 0.05 * p, g: 0.28 * p, b: 0.34 * p, objectsOnly: false });
  },
  haze: [],
  shafts: [{ x: 200, y: 160, strength: 0.16 }],
  ambient(ps, dt) {
    // Dust glinting in the station light, drifting without falling...
    emit(0.35, dt, () => {
      const s = rnd(0.35, 0.7);
      ps.spawn({
        kind: ParticleKind.GLOW, x: rnd(-50, 370), y: rnd(10, 190), vx: rnd(-0.06, 0.06), vy: rnd(-0.04, 0.04), wobble: 0.01,
        life: rnd(200, 420), size0: s, size1: s, fadeIn: 0.3, c0: [0.7, 0.8, 1, 0.55], c1: [0.6, 0.7, 1, 0],
      });
    });
    // ... and the painting's stars twinkling through the window.
    emit(0.1, dt, () => {
      const [x, y] = ORBITAL_STARS[Math.floor(Math.random() * ORBITAL_STARS.length)];
      const s = rnd(1, 2);
      ps.spawn({ kind: ParticleKind.FLARE, x, y, life: rnd(10, 22), size0: s, size1: s * 0.4, c0: [0.85, 0.9, 1, 0.9], c1: [0.6, 0.7, 1, 0] });
    });
  },
};

// ---- Ice Cave: snow blowing in through the cave mouth, frost mist on the ice, crystals sparkling, the aurora's glow.
/** The painting's glowing ice pillars: x, top, bottom. */
const CRYSTALS: readonly (readonly [number, number, number])[] = [[87, 50, 148], [139, 114, 148], [237, 66, 148]];
const ICE_CAVE: ArenaFx = {
  dust: [0.82, 0.9, 0.97],
  barrier: [0.5, 1, 0.82],
  rim: { x: 160, y: -60, r: 0.3, g: 0.75, b: 0.62, ambR: 0.95, ambG: 1, ambB: 1.06 },
  envLights(t, out) {
    // The aurora's shimmer on the robots.
    const a = 0.75 + 0.25 * Math.sin(t * 0.021) * Math.sin(t * 0.013 + 1);
    out.push({ x: 160, y: -30, radius: 300, r: 0.05 * a, g: 0.2 * a, b: 0.14 * a, objectsOnly: true });
    // The pillars' glow, breathing slowly.
    CRYSTALS.forEach(([x, top, bottom], i) => {
      const k = 0.7 + 0.3 * Math.sin(t * 0.04 + i * 1.9);
      out.push({ x, y: (top + bottom) / 2, radius: 30 + (bottom - top) * 0.6, r: 0.04 * k, g: 0.2 * k, b: 0.28 * k, objectsOnly: false });
    });
  },
  haze: [],
  shafts: [{ x: 160, y: 20, strength: 0.12 }],
  ambient(ps, dt) {
    // Snowflakes swirling down.
    emit(0.9, dt, () => {
      const s = rnd(0.45, 1.05);
      ps.spawn({
        kind: ParticleKind.GLOW, x: rnd(-60, 380), y: rnd(-10, 30), vx: rnd(-0.25, 0.1), vy: rnd(0.25, 0.6), wobble: 0.06,
        life: rnd(260, 420), size0: s, size1: s, fadeIn: 0.1, c0: [0.92, 0.97, 1, 0.8], c1: [0.85, 0.92, 1, 0], floor: 196, bounce: 0,
      });
    });
    // Frost mist creeping over the ice.
    emit(0.12, dt, () => {
      ps.spawn({
        kind: ParticleKind.SMOKE, x: rnd(-60, 380), y: rnd(178, 198), vx: rnd(-0.18, 0.18), vy: rnd(-0.02, 0.01), drag: 0.998,
        life: rnd(160, 260), size0: rnd(8, 14), size1: rnd(18, 28), fadeIn: 0.35, c0: [0.75, 0.88, 1, 0.12], c1: [0.7, 0.85, 1, 0],
      });
    });
    // Sparkles running over the pillars.
    emit(0.16, dt, () => {
      const [x, top, bottom] = CRYSTALS[Math.floor(Math.random() * CRYSTALS.length)];
      const s = rnd(1.5, 2.6);
      ps.spawn({ kind: ParticleKind.FLARE, x: x + rnd(-3, 3), y: rnd(top + 2, bottom - 2), life: rnd(8, 14), size0: s, size1: 0.3, c0: [0.8, 1, 1, 1], c1: [0.4, 0.8, 1, 0] });
    });
  },
};

// ---- Rooftop: rain and its splashes on the wet roof, the neon sign flickering, lightning over the city.
/** The painting's red beacons on the towers and the antenna mast. */
const BEACONS: readonly (readonly [number, number])[] = [
  [184, 3], [238, 32], [359, 38], [338, 38], [332, 40], [314, 42], [303, 46], [68, 47], [236, 56], [191, 76],
];
/** A beacon's blink: its period in ticks and how far into it (0..1) it is at time `t`. */
function beaconPhase(t: number, i: number): { period: number; ph: number } {
  const period = 64 + (i % 4) * 7;
  return { period, ph: ((t + i * 37) % period) / period };
}
const ROOFTOP: ArenaFx = {
  dust: [0.45, 0.5, 0.62],
  barrier: [1, 0.36, 0.82],
  rim: { x: 330, y: 90, r: 0.9, g: 0.25, b: 0.75, ambR: 0.93, ambG: 0.92, ambB: 1.04 },
  envLights(t, out) {
    // The sign's magenta, with the odd dropout of an old neon tube.
    const f = flicker(t * 3.1, 2.7);
    const on = f > 0.22 ? 1 : 0.15;
    out.push({ x: 317, y: 91, radius: 170, r: 0.5 * on, g: 0.1 * on, b: 0.4 * on, objectsOnly: true });
    out.push({ x: 317, y: 91, radius: 90, r: 0.2 * on, g: 0.03 * on, b: 0.16 * on, objectsOnly: false });
    // A cyan lamp over the roof on the left.
    out.push({ x: 12, y: 57, radius: 190, r: 0.05, g: 0.22, b: 0.28, objectsOnly: true });
    // The beacons blinking, each tower on its own beat.
    BEACONS.forEach(([x, y], i) => {
      const { ph } = beaconPhase(t, i);
      const k = ph < 0.3 ? Math.sin((ph / 0.3) * Math.PI) : 0;
      if (k > 0.02) out.push({ x, y, radius: 10, r: 0.85 * k, g: 0.1 * k, b: 0.08 * k, objectsOnly: false });
    });
  },
  haze: [],
  shafts: [],
  ambient(ps, dt, t) {
    // A glint as each beacon flashes.
    BEACONS.forEach(([x, y], i) => {
      const { period, ph } = beaconPhase(t, i);
      if (ph * period < dt) {
        ps.spawn({ kind: ParticleKind.FLARE, x, y, life: 14, size0: 1.6, size1: 0.6, c0: [1, 0.35, 0.3, 0.95], c1: [1, 0.1, 0.05, 0] });
      }
    });
    // Rain streaks...
    emit(5, dt, () => {
      const vx = rnd(1.1, 1.6), vy = rnd(7.5, 9.5);
      ps.spawn({
        kind: ParticleKind.WISP, x: rnd(-80, 380), y: rnd(-30, 150), vx, vy, life: rnd(8, 22), size0: rnd(0.35, 0.55), stretch: 1.3,
        c0: [0.7, 0.75, 0.9, 0.35], c1: [0.7, 0.75, 0.9, 0.2], floor: 199, bounce: 0,
      });
    });
    // ... splashing on the roof.
    emit(2.2, dt, () => {
      const x = rnd(-60, 380), y = rnd(184, 199);
      ps.spawn({ kind: ParticleKind.RING, x, y, life: rnd(6, 10), size0: 0.4, size1: rnd(2, 3.5), c0: [0.7, 0.75, 0.95, 0.35], c1: [0.7, 0.75, 0.95, 0] });
      if (Math.random() < 0.5) {
        ps.spawn({
          kind: ParticleKind.GLOW, x, y: y - 1, vx: rnd(-0.4, 0.4), vy: rnd(-1.2, -0.5), gravity: 0.18, life: rnd(5, 9), size0: 0.45, size1: 0.3,
          c0: [0.8, 0.85, 1, 0.6], c1: [0.8, 0.85, 1, 0],
        });
      }
    });
  },
  weather(ctx, dt) {
    // Lightning every few seconds: a flash, the sky lighting up and a jagged bolt over the city.
    if (Math.random() > dt / 700) return;
    ctx.flash(0.28);
    ctx.light(160, -20, 420, 0.9, 0.9, 1.1, 14);
    let x = rnd(20, 300), y = -10;
    while (y < 80) {
      const nx = x + rnd(-9, 9), ny = y + rnd(4, 9);
      for (let k = 0; k < 3; k++) {
        const t = k / 3;
        ctx.ps.spawn({ kind: ParticleKind.GLOW, x: x + (nx - x) * t, y: y + (ny - y) * t, life: rnd(4, 7), size0: 1.4, size1: 0.6, c0: [0.85, 0.9, 1, 1], c1: [0.5, 0.6, 1, 0] });
      }
      x = nx;
      y = ny;
    }
  },
};

// ---- Abyss: bubbles rising, marine snow, caustics dancing over the floor, the water's gentle distortion.
/** The painting's lamps on the dome's ribs and at their feet. */
const LAMPS: readonly (readonly [number, number])[] = [
  [-12, 4], [42, 25], [-65, 58], [13, 74], [1, 140], [88, 133], [232, 133], [-97, 170], [281, 25], [307, 74], [318, 139],
  [336, 4], [385, 58], [417, 168],
];
const ABYSS: ArenaFx = {
  dust: [0.32, 0.46, 0.5],
  barrier: [0.26, 0.9, 1],
  rim: { x: 160, y: -80, r: 0.25, g: 0.7, b: 0.8, ambR: 0.9, ambG: 1, ambB: 1.06 },
  envLights(t, out) {
    // Caustics: bright patches drifting over the floor and the robots.
    for (let i = 0; i < 5; i++) {
      const x = 160 + 150 * Math.sin(t * 0.011 * (1 + i * 0.37) + i * 1.7);
      const y = 178 + 16 * Math.sin(t * 0.017 * (1 + i * 0.23) + i * 2.3);
      const k = 0.6 + 0.4 * Math.sin(t * 0.09 + i * 2.1);
      out.push({ x, y, radius: 55, r: 0.05 * k, g: 0.2 * k, b: 0.2 * k, objectsOnly: false });
    }
    out.push({ x: 160, y: -60, radius: 300, r: 0.03, g: 0.12, b: 0.15, objectsOnly: true });
    // The dome's lamps, their glow shimmering with the water; an old one stutters now and then.
    LAMPS.forEach(([x, y], i) => {
      let k = 0.85 + 0.15 * Math.sin(t * 0.05 + i * 2.3);
      if (i === 9 && flicker(t * 0.7, 5.1) > 0.78) k *= flicker(t * 6.1, 1.3) > 0.5 ? 1 : 0.2;
      out.push({ x, y, radius: 12, r: 0.3 * k, g: 0.24 * k, b: 0.1 * k, objectsOnly: false });
    });
  },
  haze: [{ x0: -80, y0: 0, x1: 400, y1: 200, strength: 0.28 }],
  shafts: [{ x: 160, y: 8, strength: 0.3 }],
  ambient(ps, dt) {
    // Bubbles wobbling up.
    emit(0.4, dt, () => {
      const s = rnd(0.8, 2.2);
      ps.spawn({
        kind: ParticleKind.BUBBLE, x: rnd(-50, 370), y: rnd(185, 205), vx: 0, vy: -rnd(0.5, 1.1) * (0.6 + s * 0.3), wobble: 0.12,
        life: rnd(120, 260), size0: s, size1: s * 1.2, fadeIn: 0.05, c0: [0.7, 0.95, 1, 0.75], c1: [0.7, 0.95, 1, 0],
      });
    });
    // Marine snow sinking.
    emit(0.3, dt, () => {
      const s = rnd(0.35, 0.6);
      ps.spawn({
        kind: ParticleKind.GLOW, x: rnd(-50, 370), y: rnd(-10, 120), vx: rnd(-0.03, 0.03), vy: rnd(0.05, 0.14), wobble: 0.02,
        life: rnd(300, 500), size0: s, size1: s, fadeIn: 0.2, c0: [0.7, 0.85, 0.85, 0.45], c1: [0.7, 0.85, 0.85, 0],
      });
    });
  },
};

/** Effects configuration of an arena (0..8). */
export function arenaFx(arena: number): ArenaFx {
  return [STADIUM, DANGER_ROOM, POWER_PLANT, FIRE_PIT, DESERT, ORBITAL, ICE_CAVE, ROOFTOP, ABYSS][arena] ?? STADIUM;
}

export { FLOOR as FX_FLOOR };
