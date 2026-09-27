import { bkGetInfo, type Bk } from '../../resources/resources';
import { GROUP_PROJECTILE, LAYER_HAR, LAYER_HAZARD, RENDER_LAYER_BOTTOM } from '../constants';
import { GameObject } from '../object';

/** Arena hazards (fire pit orbs, power plant electricity, desert jets, ...). */
function hazardTick(obj: GameObject): void {
  if (obj.isFinished()) {
    const bk = obj.gs.sc.bk;
    const anim = bkGetInfo(bk, obj.curAnimation!.id);
    if (anim && anim.chainNoHit) {
      const next = bkGetInfo(bk, anim.chainNoHit);
      if (next) {
        obj.setAnimation(next.ani);
        obj.setRepeat(false);
        obj.setFinished(false);
      }
    }
  }
}

function hazardSpawn(parent: GameObject, id: number, x: number, y: number): void {
  const sc = parent.gs.sc;
  const info = bkGetInfo(sc.bk, id);
  if (!info) return;
  const obj = new GameObject(parent.gs, x + info.ani.startX, y + info.ani.startY);
  obj.soundTranslationTable = parent.soundTranslationTable;
  obj.setAnimation(info.ani);
  if (info.probability === 1) obj.setRepeat(true);
  obj.layers = LAYER_HAZARD | LAYER_HAR;
  obj.group = GROUP_PROJECTILE;
  obj.userdata = parent.userdata;
  hazardCreate(obj);
  if (sc.bk.fileId === 128 && id === 14) {
    obj.posX = parent.posX;
    obj.posY = parent.posY;
  }
  obj.playerInitSpawned();
  parent.gs.addObject(obj, RENDER_LAYER_BOTTOM, false, false);
}

export function hazardCreate(obj: GameObject): void {
  obj.animationState.spawn = (p, id, x, y) => hazardSpawn(p, id, x, y);
  obj.animationState.destroy = (p, id) => p.gs.delAnimation(id);
  obj.onDynamicTick = hazardTick;
}

export function isHazardBk(u: unknown): u is Bk {
  return !!u && typeof u === 'object' && 'infos' in (u as object) && 'background' in (u as object);
}
