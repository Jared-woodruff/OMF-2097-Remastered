// Building blocks for a robot's fighter file in OMF Studio: new moves, the pictures the game shows of it, and the
// sprites a frame shows.
import type { AfFile, AfMoveData } from '../../formats/af';
import { AnimationData } from '../../formats/animation';
import { encodeSprite, Sprite } from '../../formats/sprite';
import { PICTURE_MOVES } from '../../mods/types';

/** A new move: one frame of `sprites[0]`, unless an animation string is given. */
export function newMove(category: number, moveString: string, sprites: Sprite[], animString = 'A1'): AfMoveData {
  const animation = new AnimationData();
  animation.animString = animString;
  animation.sprites = sprites;
  return {
    animation, aiFlags: 0, posConstraint: 0, unknown: [0, 0, 0, 0, 0, 0, 0, 0], playIfHit: 0, category, blockDamage: 0, blockStun: 0,
    successorId: 0, damageAmount: 0, throwDuration: 0, extraStringSelector: 0, points: 0, moveString, footerString: '',
  };
}

/** A copy of a move (its sprites pictures of their own). */
export function copyMove(m: AfMoveData): AfMoveData {
  const animation = new AnimationData();
  animation.startX = m.animation.startX;
  animation.startY = m.animation.startY;
  animation.animString = m.animation.animString;
  animation.coords = m.animation.coords.map((c) => ({ ...c }));
  animation.extraStrings = m.animation.extraStrings.slice();
  animation.sprites = m.animation.sprites.map((s) => {
    const c = new Sprite();
    c.posX = s.posX;
    c.posY = s.posY;
    const empty = s.isEmpty();
    c.width = empty ? s.width : s.width;
    c.height = empty ? s.height : s.height;
    c.data = s.data ? s.data.slice() : null;
    return c;
  });
  return { ...m, animation, unknown: m.unknown.slice() };
}

/** The select screen cell's size and background color (see gen/fighter/moveset.ts). */
export const CELL_W = 51, CELL_H = 36, CELL_BACKGROUND = 0xd0;
/** About the height of the original robots' VS images. */
const VS_HEIGHT = 130;

/** The first frame of the robot's idle animation (its pixels), or null. */
function idleFrame(af: AfFile): Sprite | null {
  return af.moves[11]?.animation.sprites.find((s) => !s.isEmpty() && s.width < 1000) ?? null;
}

/**
 * A picture made from the idle animation's first frame (like the game makes one when a robot brings none): the select
 * screen's cell (head and shoulders on the cell's color) or the VS screen's (the whole robot at the originals' size).
 */
export function pictureFromIdle(af: AfFile, which: 'cell' | 'vs'): Sprite | null {
  const idle = idleFrame(af);
  if (!idle) return null;
  const px = idle.pixels(), w = idle.width, h = idle.height;
  let top = 0;
  while (top < h - 1 && !px.subarray(top * w, (top + 1) * w).some((v) => v)) top++;
  const s = new Sprite();
  if (which === 'cell') {
    let sum = 0, n = 0;
    for (let y = top; y < Math.min(h, top + CELL_H); y++) for (let x = 0; x < w; x++) if (px[y * w + x]) (sum += x), n++;
    const cx = n ? Math.round(sum / n) : w >> 1;
    const data = new Uint8Array(CELL_W * CELL_H).fill(CELL_BACKGROUND);
    for (let y = 0; y < CELL_H; y++) {
      for (let x = 0; x < CELL_W; x++) {
        const sx = cx - (CELL_W >> 1) + x, sy = top - 3 + y;
        const v = sx >= 0 && sx < w && sy >= 0 && sy < h ? px[sy * w + sx] : 0;
        if (v) data[y * CELL_W + x] = v;
      }
    }
    s.setData(encodeSprite(data, CELL_W, CELL_H), CELL_W, CELL_H);
    return s;
  }
  const scale = Math.max(1, Math.min(3, VS_HEIGHT / Math.max(1, h - top)));
  const sw = Math.round(w * scale), sh = Math.round((h - top) * scale);
  const data = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const sy = top + Math.min(h - top - 1, Math.floor(y / scale));
    for (let x = 0; x < sw; x++) data[y * sw + x] = px[sy * w + Math.min(w - 1, Math.floor(x / scale))];
  }
  s.setData(encodeSprite(data, sw, sh), sw, sh);
  s.posX = -(sw + 12);
  s.posY = 152 - sh;
  return s;
}

/** Sets the select screen's or the VS screen's picture (a one-frame move 60 / 61). */
export function setPicture(af: AfFile, which: 'cell' | 'vs', sprite: Sprite): void {
  const id = which === 'cell' ? PICTURE_MOVES.cell : PICTURE_MOVES.vs;
  af.moves[id] = newMove(0, '!', [sprite]);
}
