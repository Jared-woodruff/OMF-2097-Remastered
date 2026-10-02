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
  /** Air bubble: a thin bright rim with a highlight (alpha blended). */
  BUBBLE = 9,
  /** Ice shard: a bright sliver along its motion (additive). */
  SHARD = 10,
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
  /** On the scenery (an arena's lamp), not at the robots' depth: what lights the background by its shape uses it. */
  onSurface?: boolean;
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

/** A glow on the fighting area's edge: a robot held against it, or a slam (with a ripple spreading from it). */
export interface FxBarrierSpot {
  /** -1: the left edge, 1: the right edge. */
  side: number;
  /** Center height (native y) and vertical reach (native pixels). */
  y: number;
  h: number;
  /** Intensity (about 1 for a hard slam). */
  glow: number;
  /** The ripple spreading along the edge: 0..1 as it grows, -1 for none. */
  ripple: number;
}

/**
 * The fighting area's edges, where the robots are held (the classic screen's edges). The remastered widescreen view
 * shows the arena's painting past them, so they are drawn as faint energy curtains that light up where a robot is
 * held against them and ripple when one is slammed into them.
 */
export interface FxBarrier {
  /** Native x of the left and right curtains. */
  left: number;
  right: number;
  /** Idle visibility (0: hidden). */
  level: number;
  /** Color (added light). */
  r: number;
  g: number;
  b: number;
  spots: FxBarrierSpot[];
}

export interface FxFrame {
  /** Whether this frame gets the effects at all (remastered fights with effects enabled). */
  active: boolean;
  barrier: FxBarrier;
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
    active: false, barrier: { left: 0, right: 320, level: 0, r: 0, g: 0, b: 0, spots: [] },
    time: 0, particles: new Float32Array(MAX_PARTICLES * PARTICLE_FLOATS), particleCount: 0, lights: [],
    rim: null, shockwaves: [], haze: [], shafts: [], flash: 0, chroma: 0, zoom: 1, zoomX: 160, zoomY: 100, shakeX: 0,
    shakeY: 0, desaturate: 0,
  };
}
