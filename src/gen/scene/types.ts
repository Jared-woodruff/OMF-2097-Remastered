// Arena scenes for the generated arenas: shapes (gen/geometry.ts) with colored materials and procedural patterns,
// point lights, fog and a sky, seen through the same camera as the original arenas: the floor where the robots stand
// (z = 0) is at screen row 190 and one world unit wide per native pixel there, rows 1.2 units tall.
import { boundingRadius, euler, type Mat3, type Shape, type Vec3 } from '../geometry';

export type RGB = [number, number, number];

/** Procedural patterns, computed from the hit point in the shape's own frame (so they follow its faces). */
export const enum Pattern {
  NONE = 0,
  /** Square tiles with joints (color2) of width `amount` (fraction of a tile), tiles varying slightly. */
  TILES = 1,
  /** Metal plates: tiles with bevelled edges and rivets. */
  PANELS = 2,
  /** Mottled: color and color2 mixed by noise of cell size `size`, strength `amount`. */
  NOISE = 3,
  /** Stripes of color2, `amount` of each period. */
  STRIPES = 4,
  /** Brick rows (half offset every other row). */
  BRICKS = 5,
  /** Thin lines of color2 on a square grid (glowing with emit2). */
  GRID = 6,
  /** Building windows: cells of color2 (glowing with emit2) lit at random (`amount` = share lit), dark frames. */
  WINDOWS = 7,
}

export interface SceneMaterial {
  color: RGB;
  /** Second color of the pattern (joints, lines, spots). */
  color2?: RGB;
  pattern?: Pattern;
  /** Pattern cell size (world units). */
  size?: number;
  /** Pattern line width (fraction of a cell) or noise strength. */
  amount?: number;
  /** Self illumination of color and of color2. */
  emit?: number;
  emit2?: number;
  /** Specular highlight strength and sharpness. */
  spec?: number;
  gloss?: number;
  /** Mirror reflection (0..1): polished or wet surfaces. */
  mirror?: number;
}

export interface SceneShape {
  shape: Shape;
  /** World to local rotation. */
  inv: Mat3;
  pos: Vec3;
  radius: number;
  mat: SceneMaterial;
  /** Casts shadows from the lights that cast shadows. */
  shadow?: boolean;
}

export interface PointLight {
  pos: Vec3;
  color: RGB;
  /** Distance where the light has faded out. */
  range: number;
  /** Casts soft shadows (from the shapes that do). */
  shadow?: boolean;
}

export interface SceneDef {
  shapes: SceneShape[];
  lights: PointLight[];
  /** Light everything gets. */
  ambient: RGB;
  /** What rays that hit nothing see: a gradient from the horizon up, with stars (density 0..1). */
  skyTop: RGB;
  skyHorizon: RGB;
  stars?: number;
  /** Aurora curtains across the sky (color and strength). */
  aurora?: { color: RGB; strength: number };
  fog?: { color: RGB; density: number };
  /** Brightness before tone mapping. */
  exposure?: number;
}

/** The camera of the original arenas (see the file comment). */
export const CAMERA = {
  /** Focal length in native pixels; the camera stands this far in front of the fight line. */
  f: 320,
  /** Height above the floor. */
  height: 108,
  /** Screen row of the horizon (the optical axis). */
  cy: 100,
} as const;

/** Places a shape: at a point, rotated (degrees x, y, z; Z first, then X, then Y). */
export function place(shape: Shape, at: Vec3, mat: SceneMaterial, rot: Vec3 = [0, 0, 0], shadow = false): SceneShape {
  const r = euler(rot[0], rot[1], rot[2]);
  return { shape, inv: [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]], pos: at, radius: boundingRadius(shape), mat, shadow };
}
