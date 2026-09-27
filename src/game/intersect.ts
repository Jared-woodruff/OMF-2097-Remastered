// Pixel-accurate hit detection: attack animations carry hit coordinates that are tested
// against the target sprite's opaque pixels (port of the reference intersect module).
import { Tag } from '../script/tags';
import { OBJECT_FACE_LEFT, OBJECT_FACE_RIGHT } from './constants';
import type { GameObject } from './object';

export interface Point {
  x: number;
  y: number;
}

function intersect(obj: GameObject, target: GameObject, point: Point, isHar: boolean): boolean {
  if (obj.curSpriteId < 0 || target.curSpriteId < 0 || !obj.curAnimation || !target.curAnimation) return false;
  if (obj.curAnimation.collisionCoords.length === 0) return false;
  const curSprite = obj.curAnimation.getSprite(obj.curSpriteId);
  const targetSprite = target.curAnimation.getSprite(target.curSpriteId);
  if (!curSprite || !targetSprite || !targetSprite.surface) return false;
  let objectDir = OBJECT_FACE_RIGHT;
  let targetDir = OBJECT_FACE_RIGHT;
  const [sizeAx, sizeAy] = obj.size();
  const [sizeBx, sizeBy] = target.size();
  let posAx = obj.px() + curSprite.posX;
  const posAy = obj.py() + curSprite.posY;
  let posBx = target.px() + targetSprite.posX;
  const posBy = target.py() + targetSprite.posY;
  const objR = obj.frameIsSet(Tag.R);
  if ((obj.direction === OBJECT_FACE_LEFT && !objR) || (obj.direction === OBJECT_FACE_RIGHT && objR)) {
    objectDir = OBJECT_FACE_LEFT;
    posAx = obj.px() + (curSprite.posX * -1 - sizeAx);
  }
  const tgtR = target.frameIsSet(Tag.R);
  if ((target.direction === OBJECT_FACE_LEFT && !tgtR) || (target.direction === OBJECT_FACE_RIGHT && tgtR)) {
    targetDir = OBJECT_FACE_LEFT;
    posBx = target.px() + (targetSprite.posX * -1 - sizeBx);
  }
  const sfc = targetSprite.surface;
  for (const cc of obj.curAnimation.collisionCoords) {
    if (cc.frameIndex !== obj.curSpriteId) continue;
    const t = objectDir === OBJECT_FACE_RIGHT ? posAx + cc.x - curSprite.posX : posAx + (sizeAx - cc.x) + curSprite.posX;
    const xcoord = t - posBx;
    let ycoord = posAy + sizeAy + cc.y - posBy;
    ycoord -= curSprite.posY + sizeAy;
    if (xcoord < 0 || xcoord >= sizeBx) continue;
    if (ycoord < 0 || ycoord >= sizeBy) continue;
    let hitpoint = ycoord * sfc.w + xcoord;
    if (targetDir === OBJECT_FACE_LEFT) hitpoint = ycoord * sfc.w + (sfc.w - xcoord);
    if (hitpoint >= sfc.w * sfc.h) continue;
    const px = sfc.data[hitpoint];
    if (px !== sfc.transparent && (px < 96 || !isHar)) {
      point.x = xcoord + posBx;
      point.y = ycoord + posBy;
      return true;
    }
  }
  return false;
}

export function intersectSpriteHitpoint(obj: GameObject, target: GameObject, point: Point): boolean {
  return intersect(obj, target, point, false);
}

export function intersectHarSpriteHitpoint(obj: GameObject, target: GameObject, point: Point): boolean {
  return intersect(obj, target, point, true);
}

export function intersectObjectPoint(obj: GameObject, x: number, y: number): boolean {
  if (obj.curSpriteId < 0 || !obj.curAnimation) return false;
  const sp = obj.curAnimation.getSprite(obj.curSpriteId);
  if (!sp) return false;
  const [w, h] = obj.size();
  const px = obj.px() + sp.posX;
  const py = obj.py() + sp.posY;
  return x < px + w && y < py + h && x > px && y > py;
}
