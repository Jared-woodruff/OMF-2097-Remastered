// The robot workshop (EXTRAS > ROBOT WORKSHOP): robots put together from the generated robots' parts. A workshop robot is a
// small description (a "spec", shared as a .omfbot file) from which the game builds a full fighter on the spot, like
// the four new robots: the frame (skeleton, arms, legs, armor) of one of them, the head of another, the special moves
// and finishers of a third, a size, a weight class and three colors.
import { saveAF } from '../formats/af';
import type { GenStats } from './fighter/build';
import { buildFighter, spriteShapes } from './fighter/build';
import { measure } from './fighter/body';
import { MOVE, portraitMoves } from './fighter/moveset';
import { ShapeKind, type Shape, type Vec3 } from './geometry';
import { traceShapes, ROW_H, type TracedSprite } from './raster';
import type { Joint, Part, PlacedShape, RobotModel } from './robot';
import { fighterOf, GEN_ROBOTS, type GenRobot } from './roster';

export interface WorkshopSpec {
  v: 1;
  /** Up to ten letters, digits and spaces. */
  name: string;
  /** The robots (0..3: GLACIER, TEMPEST, HELIX, SPECTRE) the frame, the head and the moves come from. */
  body: number;
  head: number;
  moves: number;
  /** 0 small, 1 normal, 2 big. */
  size: number;
  /** 0 light (fast, less health), 1 medium, 2 heavy (slow, more health). */
  weight: number;
  /** The robot's colors (0..15 each: primary, secondary, tertiary), as a pilot picks them (color 1, 2 and 3). */
  colors: [number, number, number];
}

/** HAR ids of the workshop's robots (their names take the language file's free robot name entries). */
export const WORKSHOP_FIRST_ID = 15;
export const WORKSHOP_SLOTS = 8;

export const PART_NAMES = GEN_ROBOTS.map((r) => r.name);
export const SIZE_NAMES = ['SMALL', 'NORMAL', 'BIG'];
export const WEIGHT_NAMES = ['LIGHT', 'MEDIUM', 'HEAVY'];
const SIZES = [0.92, 1, 1.08];

export function defaultSpec(): WorkshopSpec {
  return { v: 1, name: 'PROTOTYPE', body: 1, head: 1, moves: 1, size: 1, weight: 1, colors: [5, 3, 8] };
}

/** A clean name: capitals, digits and spaces, at most ten. */
export function cleanName(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 10) || 'ROBOT';
}

/** A spec read from a file or storage, checked and completed (null when it is not one). */
export function readSpec(x: unknown): WorkshopSpec | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Partial<WorkshopSpec>;
  const pick = (v: unknown, n: number, d: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < n ? (v as number) : d);
  const d = defaultSpec();
  const colors = Array.isArray(o.colors) && o.colors.length === 3 ? o.colors.map((c, i) => pick(c, 16, d.colors[i])) : d.colors;
  return {
    v: 1,
    name: cleanName(typeof o.name === 'string' ? o.name : d.name),
    body: pick(o.body, GEN_ROBOTS.length, d.body),
    head: pick(o.head, GEN_ROBOTS.length, d.head),
    moves: pick(o.moves, GEN_ROBOTS.length, d.moves),
    size: pick(o.size, SIZES.length, d.size),
    weight: pick(o.weight, WEIGHT_NAMES.length, d.weight),
    colors: colors as [number, number, number],
  };
}

// ---- the model ---------------------------------------------------------------------------------------------------

/** A shape k times bigger (dimensionless fields like tapers, squash and side counts stay). */
export function scaleShape(s: Shape, k: number): Shape {
  const o: Shape = { ...s, a: s.a * k, b: s.b * k, r: s.r * k };
  switch (s.kind) {
    case ShapeKind.RBOX:
    case ShapeKind.ELLIPSOID:
    case ShapeKind.CYLINDER:
    case ShapeKind.TBOX:
      o.c = s.c * k;
      break;
    case ShapeKind.WEDGE:
      o.c = s.c * k;
      o.k = (s.k ?? 0) * k;
      break;
  }
  return o;
}

const scaleV = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];

function scalePart(p: Part, k: number): Part {
  return { ...p, shape: scaleShape(p.shape, k), at: scaleV(p.at, k) };
}

/** The body's frame with the head of another robot, k times the size. */
export function assembleModel(name: string, body: RobotModel, head: RobotModel, k: number): RobotModel {
  const heads = head.joints.find((j) => j.name === 'head')?.parts ?? [];
  const joints: Joint[] = body.joints.map((j) => ({
    ...j,
    offset: scaleV(j.offset, k),
    parts: (j.name === 'head' ? heads : j.parts).map((p) => scalePart(p, k)),
  }));
  return { ...body, name, joints, hipHeight: body.hipHeight * k, ankle: body.ankle * k };
}

/** Stats: the frame robot's, moved toward light (faster, less health) or heavy (slower, more health). */
export function weightStats(base: GenStats, weight: number, size: number): GenStats {
  const w = weight - 1;
  const s = SIZES[size];
  return {
    health: Math.round(base.health * (1 + 0.12 * w) * (0.96 + 0.04 * (s - 0.92) / 0.16)),
    endurance: Math.round(base.endurance * (1 + 0.1 * w)),
    forward: +(base.forward * (1 - 0.12 * w)).toFixed(2),
    reverse: +(base.reverse * (1 - 0.12 * w)).toFixed(2),
    jump: +(base.jump * (1 - 0.05 * w)).toFixed(2),
    fall: +(base.fall * (1 + 0.06 * w)).toFixed(3),
  };
}

/** The robot a spec describes, as HAR `id`. */
export function workshopRobot(spec: WorkshopSpec, id: number): GenRobot {
  const body = GEN_ROBOTS[spec.body], head = GEN_ROBOTS[spec.head], moves = GEN_ROBOTS[spec.moves];
  const model = assembleModel(spec.name, body.model, head.model, SIZES[spec.size]);
  return {
    id,
    name: spec.name,
    model,
    style: body.style,
    stats: weightStats(body.stats, spec.weight, spec.size),
    colors: body.colors,
    sounds: moves.sounds,
    links: moves.links,
    specials: moves.specials,
    finisher: moves.finisher,
    specialNames: moves.specialNames,
  };
}

/** The robot's fighter file (AF), as HAR `id`. */
export function buildWorkshopFighter(spec: WorkshopSpec, id: number): Uint8Array {
  const { af } = buildFighter(fighterOf(workshopRobot(spec, id)));
  af.fighterId = id;
  af.upwardsJumpFrameLimit = 2;
  return saveAF(af);
}

/** The robot's VS screen picture (quick: one picture instead of the whole fighter), for the workshop's preview. */
export function workshopPreview(spec: WorkshopSpec): TracedSprite & { shapes: PlacedShape[]; scale: number } {
  const r = workshopRobot(spec, WORKSHOP_FIRST_ID);
  const b = measure(r.model, r.style);
  const vs = portraitMoves(b).find((m) => m.id === MOVE.PORTRAIT_VS)!;
  const sprite = vs.sprites[0];
  const view = sprite.view!;
  // (the shapes and magnification too: the remastered renderer draws the picture from them, see hdArtwork.ts)
  const shapes = spriteShapes(r.model, sprite);
  return { ...traceShapes(shapes, 1 / view.scale, ROW_H / view.scale), shapes, scale: view.scale };
}
