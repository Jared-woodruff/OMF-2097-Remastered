import { Tag } from '../../script/tags';
import type { Af } from '../../resources/resources';
import { ARENA_FLOOR, ARENA_LEFT_WALL, ARENA_RIGHT_WALL, OBJECT_FLAGS_NEXT_ANIM_ON_ENEMY_HIT } from '../constants';
import type { GameObject } from '../object';
import type { Har } from './har';

export interface ProjectileData {
  kind: 'projectile';
  playerId: number;
  afData: Af;
  wallBounce: boolean;
  groundFreeze: boolean;
  invincible: boolean;
  hasHit: boolean;
  parentId: number;
}

const isZero = (n: number) => n < 0.1 && n > -0.1;

function data(obj: GameObject): ProjectileData {
  return obj.userdata as ProjectileData;
}

export function projectileFinished(obj: GameObject): void {
  const local = data(obj);
  if (obj.objectFlags & OBJECT_FLAGS_NEXT_ANIM_ON_ENEMY_HIT) {
    const linked = obj.gs.findObject(obj.animationState.enemyObjId);
    if (linked) linked.animationState.disableD = true;
  }
  const move = local.afData.moves[obj.curAnimation!.id];
  if (move && move.successorId) {
    const next = local.afData.moves[move.successorId];
    if (next) {
      obj.setAnimation(next.ani);
      obj.setRepeat(false);
      obj.setVel(0, 0);
      obj.setFinished(false);
    }
  }
}

function projectileMove(obj: GameObject): void {
  const local = data(obj);
  const gs = obj.gs;
  const harObj = gs.findObject(gs.getPlayer(local.playerId).harObjId);
  obj.posX += obj.velX + obj.cvelX;
  obj.velY += obj.gravity;
  obj.posY += obj.velY + obj.cvelY;
  const dampen = 0.7;
  if (local.wallBounce) {
    if (obj.posX < ARENA_LEFT_WALL) {
      obj.posX = ARENA_LEFT_WALL;
      obj.velX = -obj.velX * dampen;
    }
    if (obj.posX > ARENA_RIGHT_WALL) {
      obj.posX = ARENA_RIGHT_WALL;
      obj.velX = -obj.velX * dampen;
    }
  } else if (!local.invincible && !obj.frameIsSet(Tag.BH) && !isZero(obj.velX)) {
    if (obj.posX < ARENA_LEFT_WALL) {
      obj.posX = ARENA_LEFT_WALL;
      obj.setFinished(true);
      projectileFinished(obj);
    }
    if (obj.posX > ARENA_RIGHT_WALL) {
      obj.posX = ARENA_RIGHT_WALL;
      obj.setFinished(true);
      projectileFinished(obj);
    }
  }
  if (obj.posY > ARENA_FLOOR && local.wallBounce) {
    obj.posY = ARENA_FLOOR;
    obj.velY = -obj.velY * dampen;
    obj.velX = obj.velX * dampen;
  } else if (obj.posY > ARENA_FLOOR) {
    obj.posY = ARENA_FLOOR;
    obj.setFinished(true);
    projectileFinished(obj);
  }
  if (obj.posY >= ARENA_FLOOR - 5 && isZero(obj.velX) && obj.velY < obj.gravity * 1.1 && obj.velY > obj.gravity * -1.1 && local.groundFreeze) {
    obj.disableRewindTag(true);
  }
  if (harObj) {
    const h = harObj.userdata as Har;
    obj.applyControllableVelocity(true, h.inputs[0]);
  }
}

export function projectileCreate(obj: GameObject, parent: GameObject): void {
  const har = parent.userdata as Har;
  const local: ProjectileData = {
    kind: 'projectile',
    playerId: har.playerId,
    afData: har.afData,
    wallBounce: false,
    groundFreeze: false,
    invincible: false,
    hasHit: false,
    parentId: parent.id,
  };
  obj.userdata = local;
  obj.onMove = projectileMove;
  obj.onFinish = projectileFinished;
}

export function projectileGetAfData(obj: GameObject): Af {
  return data(obj).afData;
}
export function projectileGetOwner(obj: GameObject): number {
  return data(obj).playerId;
}
export function projectileSetWallBounce(obj: GameObject, b: boolean): void {
  data(obj).wallBounce = b;
}
export function projectileSetInvincible(obj: GameObject): void {
  data(obj).invincible = true;
}
export function projectileStopOnGround(obj: GameObject, s: boolean): void {
  data(obj).groundFreeze = s;
}
export function projectileMarkHit(obj: GameObject): void {
  data(obj).hasHit = true;
}
export function projectileDidHit(obj: GameObject): boolean {
  return data(obj).hasHit;
}
export function projectileClearHit(obj: GameObject): void {
  data(obj).hasHit = false;
}
export function isProjectile(obj: GameObject): boolean {
  return (obj.userdata as { kind?: string } | null)?.kind === 'projectile';
}
