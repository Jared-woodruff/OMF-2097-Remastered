// Builds a fighter file (AF, the format of the original robots) for a generated robot: every sprite is rendered from a
// pose, identical sprites are stored once (the format's "missing" sprites), and hit points come from the pixels of the
// striking limbs, so moves hit where they look like they hit.
import type { AfFile, AfMoveData } from '../../formats/af';
import { MAX_AF_MOVES } from '../../formats/af';
import { AnimationData, type CollisionCoord } from '../../formats/animation';
import { encodeSprite, Sprite } from '../../formats/sprite';
import { boundingRadius } from '../geometry';
import { traceShapes, ROW_H, type TracedSprite } from '../raster';
import { placeShapes, type PlacedShape, type Pose, type RobotModel } from '../robot';

/** Stored jump sprites are relative to a pivot this far above the feet (the engine subtracts it when loading). */
export const JUMP_PIVOT = 60;
/** Most hit points per sprite (the originals use up to about 40). */
const MAX_HIT_POINTS = 24;

export interface GenSprite {
  /** The robot's pose; null for props only (projectiles, effects) or an invisible frame (no props either). */
  pose: Pose | null;
  /** Extra shapes drawn with the robot (energy, projectiles). */
  props?: PlacedShape[];
  /** Joints (or 'props') whose pixels become hit points while this sprite shows in an attack. */
  hit?: string[];
  /** Pictures other than fight sprites (menu portraits): another view of the model, magnified, cut to a frame. */
  view?: SpriteView;
}

export interface SpriteView {
  /** The model seen from another angle (e.g. turned to face the viewer). */
  model?: RobotModel;
  /** Magnification (1 = fight sprites' size). */
  scale: number;
  /** The frame (in magnified pixels, relative to the anchor): x, y, width, height; the rest of the picture is cut. */
  rect?: [number, number, number, number];
  /** Palette index filling the frame where the robot is not. */
  background?: number;
}

export interface GenMove {
  id: number;
  category: number;
  moveString: string;
  anim: string;
  footer?: string;
  extras?: string[];
  sprites: GenSprite[];
  damage?: number;
  blockStun?: number;
  blockDamage?: number;
  successorId?: number;
  playIfHit?: number;
  throwDuration?: number;
  points?: number;
  posConstraint?: number;
  extraStringSelector?: number;
  aiFlags?: number;
}

export interface GenStats {
  health: number;
  endurance: number;
  forward: number;
  reverse: number;
  jump: number;
  fall: number;
}

export interface GenFighter {
  model: RobotModel;
  stats: GenStats;
  /** Sound table (30 entries): which sound each 's' tag number plays. */
  sounds: number[];
  moves: GenMove[];
}

/** The standard sound table every robot shares ([0..9] and [25..29]), with robot-specific entries on top. */
export function soundTable(specific: Record<number, number> = {}): number[] {
  const t = new Array<number>(30).fill(0);
  [0, 1, 2, 3, 6, 5, 4, 0, 0, 19].forEach((v, i) => (t[i] = v));
  [70, 71, 72, 69, 68].forEach((v, i) => (t[25 + i] = v));
  for (const [k, v] of Object.entries(specific)) t[Number(k)] = v;
  return t;
}

/** Everything placed for a sprite (robot and props). */
export function spriteShapes(model: RobotModel, s: GenSprite): PlacedShape[] {
  const out = s.pose ? placeShapes(s.view?.model ?? model, s.pose, boundingRadius) : [];
  if (s.props) out.push(...s.props);
  return out;
}

/** Renders a sprite's picture view: magnified, then cut to its frame (filled with the background index). */
function renderView(placed: PlacedShape[], v: SpriteView, render: (shapes: PlacedShape[], sx: number, sy: number) => TracedSprite): TracedSprite {
  const t = render(placed, 1 / v.scale, ROW_H / v.scale);
  if (!v.rect) return t;
  const [x, y, w, h] = v.rect;
  const data = new Uint8Array(w * h).fill(v.background ?? 0);
  const owner = new Int16Array(w * h).fill(-1);
  for (let r = 0; r < t.h; r++) {
    const ty = t.y + r - y;
    if (ty < 0 || ty >= h) continue;
    for (let c = 0; c < t.w; c++) {
      const tx = t.x + c - x;
      const v2 = t.data[r * t.w + c];
      if (tx < 0 || tx >= w || !v2) continue;
      data[ty * w + tx] = v2;
      owner[ty * w + tx] = t.owner[r * t.w + c];
    }
  }
  return { w, h, data, x, y, owner };
}

/** Hit points from the pixels of the given joints (or 'props'): the outline, spread evenly. */
export function hitPoints(model: RobotModel, t: TracedSprite, hit: string[], frameId: number, dy = 0): CollisionCoord[] {
  const ids = new Set(hit.map((h) => (h === 'props' ? -1 : model.joints.findIndex((j) => j.name === h))));
  const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < t.w && r < t.h && t.data[r * t.w + c] !== 0 && ids.has(t.owner[r * t.w + c]);
  const pts: [number, number][] = [];
  for (let r = 0; r < t.h; r++) {
    for (let c = 0; c < t.w; c++) {
      if (!inside(c, r)) continue;
      const edge = !inside(c - 1, r) || !inside(c + 1, r) || !inside(c, r - 1) || !inside(c, r + 1);
      if (edge) pts.push([t.x + c, t.y + r]);
    }
  }
  if (pts.length === 0) return [];
  // Spread evenly along the outline order: sort by angle around the centroid, then take every n-th point.
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  pts.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  const step = Math.max(1, pts.length / MAX_HIT_POINTS);
  const out: CollisionCoord[] = [];
  for (let i = 0; i < pts.length && out.length < MAX_HIT_POINTS; i += step) {
    const p = pts[Math.floor(i)];
    out.push({ x: p[0], y: p[1] + dy, nullValue: 0, frameId });
  }
  return out;
}

function spriteKey(model: RobotModel, s: GenSprite): string {
  return JSON.stringify([s.pose, s.props?.map((p) => [p.shape, p.inv, p.pos, p.mat]), s.view && { ...s.view, model: s.view.model?.turn }]);
}

function pixelKey(t: TracedSprite): string {
  let h = 2166136261;
  for (let i = 0; i < t.data.length; i++) h = Math.imul(h ^ t.data[i], 16777619);
  return `${t.w}x${t.h}:${h >>> 0}`;
}

export interface BuildResult {
  af: AfFile;
  /** Per move id, per sprite: the shapes each sprite was rendered from (for the HD renderings). */
  shapes: Map<number, PlacedShape[][]>;
}

/** Renders and assembles the fighter. */
export function buildFighter(f: GenFighter, render: (shapes: PlacedShape[], sx: number, sy: number) => TracedSprite = traceShapes): BuildResult {
  const cache = new Map<string, TracedSprite>();
  const shared = new Map<string, number>();
  let nextIndex = 1;
  const moves = new Array<AfMoveData | null>(MAX_AF_MOVES).fill(null);
  const shapes = new Map<number, PlacedShape[][]>();
  for (const m of [...f.moves].sort((a, b) => a.id - b.id)) {
    const anim = new AnimationData();
    anim.animString = m.anim;
    anim.extraStrings = m.extras ?? [];
    const dy = m.id === 1 ? JUMP_PIVOT : 0;
    const moveShapes: PlacedShape[][] = [];
    m.sprites.forEach((gs, i) => {
      const placed = spriteShapes(f.model, gs);
      moveShapes.push(placed);
      const key = spriteKey(f.model, gs);
      let t = cache.get(key);
      if (!t) {
        if (!placed.length) t = { w: 1, h: 1, data: new Uint8Array(1), x: 0, y: 0, owner: new Int16Array([-1]) };
        else t = gs.view ? renderView(placed, gs.view, render) : render(placed, 1, ROW_H);
        cache.set(key, t);
      }
      const sp = new Sprite();
      sp.posX = t.x;
      sp.posY = t.y + dy;
      sp.width = t.w;
      sp.height = t.h;
      const pk = pixelKey(t);
      const idx = shared.get(pk);
      if (idx !== undefined) {
        sp.index = idx;
        sp.missing = 1;
      } else {
        sp.data = encodeSprite(t.data, t.w, t.h);
        // Every distinct image gets an index (while they last) so later moves can reuse it.
        if (nextIndex < 256) {
          sp.index = nextIndex++;
          shared.set(pk, sp.index);
        }
      }
      anim.sprites.push(sp);
      if (gs.hit?.length) anim.coords.push(...hitPoints(f.model, t, gs.hit, i, dy));
    });
    shapes.set(m.id, moveShapes);
    moves[m.id] = {
      animation: anim,
      aiFlags: m.aiFlags ?? 0,
      posConstraint: m.posConstraint ?? 0,
      unknown: [0, 0, 0, 0, 0, 0, 0, 0],
      playIfHit: m.playIfHit ?? 0,
      category: m.category,
      blockDamage: m.blockDamage ?? 0,
      blockStun: m.blockStun ?? 0,
      successorId: m.successorId ?? 0,
      damageAmount: m.damage ?? 0,
      throwDuration: m.throwDuration ?? 0,
      extraStringSelector: m.extraStringSelector ?? 0,
      points: m.points ?? 0,
      moveString: m.moveString,
      footerString: m.footer ?? '',
    };
  }
  const af: AfFile = {
    fighterId: 0,
    execWindow: 10,
    endurance: f.stats.endurance,
    upwardsJumpFrameLimit: 0,
    health: f.stats.health,
    forwardSpeed: f.stats.forward,
    reverseSpeed: f.stats.reverse,
    jumpSpeed: f.stats.jump,
    fallSpeed: f.stats.fall,
    version1: 50,
    aiProjectileYThreshold: 20,
    moves,
    soundTable: Uint8Array.from(f.sounds),
  };
  return { af, shapes };
}
