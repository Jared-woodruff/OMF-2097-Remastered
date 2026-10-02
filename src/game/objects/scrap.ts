import { ARENA_FLOOR, ARENA_LEFT_WALL, ARENA_RIGHT_WALL } from '../constants';
import type { GameObject } from '../object';
import { globalRandom } from '../../util/random';

const isZero = (n: number) => n < 0.1 && n > -0.1;

/** Bouncing debris (scrap metal, bolts, burning oil). */
function scrapMove(obj: GameObject): void {
  if (obj.isRewindTagDisabled()) return;
  let vx = obj.velX;
  let vy = obj.velY;
  let px = obj.px();
  let py = obj.py();
  px += vx;
  vy += obj.gravity;
  py += vy;
  const dampen = 0.4;
  if (px < ARENA_LEFT_WALL) {
    px = ARENA_LEFT_WALL;
    vx = -vx * dampen;
  }
  if (px > ARENA_RIGHT_WALL) {
    px = ARENA_RIGHT_WALL;
    vx = -vx * dampen;
  }
  if (py > ARENA_FLOOR) {
    py = ARENA_FLOOR;
    vy = -vy * dampen;
    vx = vx * dampen + (globalRandom.float() - 0.5) * 3.0;
  }
  if (isZero(vx)) vx = 0;
  obj.setPos(px, py);
  obj.setVel(vx, vy);
  if (py >= ARENA_FLOOR - 5 && isZero(vx) && vy < obj.gravity * 1.1 && vy > obj.gravity * -1.1) {
    obj.disableRewindTag(true);
  }
}

export function scrapCreate(obj: GameObject): void {
  obj.onMove = scrapMove;
}
