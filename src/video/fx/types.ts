// Per-frame description of the remastered effects (particles, lights, post effects), produced by the effects
// director (src/fx/director.ts) and drawn by the remastered renderer. Positions and sizes are in native 320x200
// coordinates, like the draw list.

/** Floats per particle instance: x, y, dx, dy | size, stretch, kind, seed | r, g, b, a. */
export const PARTICLE_FLOATS = 12;
export const MAX_PARTICLES = 3000;

/** Particle shapes (see the particle shader). Kinds below SMOKE are additive light, the others are blended. */
export const enum ParticleKind {
  /** Hot streak oriented along its motion (hit sparks). */
  SPARK = 0,
  /** Soft round glow (impact flashes, crowd camera flashes). */
  GLOW = 1,
  /** Small flickering ember. */
  EMBER = 2,
  /** Thin expanding ring. */
  RING = 3,
  /** Soft billowing puff (alpha blended). */
  SMOKE = 4,
  /** Flat dust cloud (alpha blended). */
  DUST = 5,
  /** Small tumbling metal chunk (alpha blended). */
  DEBRIS = 6,
  /** Faint wisp stretched along its motion (blown sand; alpha blended). */
  WISP = 7,
  /** Star-shaped impact flare (additive). */
  FLARE = 8,
}

export interface FxLight {
  x: number;
  y: number;
  /** Reach in native pixels. */
  radius: number;
  /** Color times intensity (1 = doubles the lit surface's brightness at the center). */
  r: number;
  g: number;
  b: number;
  /** Only lights the robots (for light already painted into the background art). */
  objectsOnly: boolean;
}

export interface FxShockwave {
  x: number;
  y: number;
  radius: number;
  /** Ring width (native pixels). */
  width: number;
  /** Displacement at the ring (native pixels). */
  strength: number;
}

/** Heat haze area (native rectangle), soft edges. */
export interface FxHaze {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Displacement (native pixels). */
  strength: number;
}

/** Light shaft (god ray) source: bright pixels around it are smeared away from it. */
export interface FxShaft {
  x: number;
  y: number;
  strength: number;
}

/** Light hitting the robots' edges from a direction (rim light), and a tint of the robots by the arena's light. */
export interface FxRimLight {
  /** Light position (native); the rim is on the edges facing it. */
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  /** Multiplier applied to the robots' colors (the arena's ambient light). */
  ambR: number;
  ambG: number;
  ambB: number;
}

export interface FxFrame {
  /** Whether this frame gets the effects at all (remastered fights with effects enabled). */
  active: boolean;
  /** Effect time in seconds (animated noise). */
  time: number;
  particles: Float32Array;
  particleCount: number;
  lights: FxLight[];
  rim: FxRimLight | null;
  shockwaves: FxShockwave[];
  haze: FxHaze[];
  shafts: FxShaft[];
  /** White flash over the scene (0..1). */
  flash: number;
  /** Chromatic aberration (native pixels at the screen edges). */
  chroma: number;
  /** Camera zoom factor (1 = none) around (zoomX, zoomY). */
  zoom: number;
  zoomX: number;
  zoomY: number;
  /** Extra camera shake (native pixels, sub-pixel). */
  shakeX: number;
  shakeY: number;
  /** Desaturation of the scene (0..1). */
  desaturate: number;
}

export function emptyFxFrame(): FxFrame {
  return {
    active: false, time: 0, particles: new Float32Array(MAX_PARTICLES * PARTICLE_FLOATS), particleCount: 0, lights: [],
    rim: null, shockwaves: [], haze: [], shafts: [], flash: 0, chroma: 0, zoom: 1, zoomX: 160, zoomY: 100, shakeX: 0,
    shakeY: 0, desaturate: 0,
  };
}
