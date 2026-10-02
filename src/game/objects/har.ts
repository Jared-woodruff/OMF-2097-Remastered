// HAR (Human Assisted Robot) fighter logic: input -> moves, physics, hits, blocking, stun, scrap/destruction.
// Faithful port of the reference engine's har module.
import type { Palette } from '../../formats/palette';
import { Animation, RSprite } from '../../resources/animation';
import { afGetMove, bkGetInfo, type Af, type AfMove, type BkInfo } from '../../resources/resources';
import { Tag } from '../../script/tags';
import { globalRandom } from '../../util/random';
import { paletteLightRange, paletteMixRange, paletteTintRange } from '../../video/vga';
import { defaultSoundOpts } from '../../audio/soundOpts';
import type { HarEvent } from '../../controller/controller';
import {
  ACT_DOWN, ACT_KICK, ACT_LEFT, ACT_NONE, ACT_PUNCH, ACT_RIGHT, ACT_STOP, ACT_UP,
  ANIM_BLOCKING_SCRAPE, ANIM_BOLT, ANIM_BURNING_OIL, ANIM_CROUCHING, ANIM_CROUCHING_BLOCK, ANIM_DAMAGE, ANIM_DEFEAT, ANIM_IDLE,
  ANIM_JUMPING, ANIM_SCRAP_METAL, ANIM_SCREW, ANIM_STANDING_BLOCK, ANIM_STANDUP, ANIM_STUNNED, ANIM_VICTORY, ANIM_WALKING,
  ARENA_FLOOR, ARENA_LEFT_WALL, ARENA_RIGHT_WALL, CAT_BK_HAZARD, CAT_CLOSE, CAT_DESTRUCTION, CAT_HIGH, CAT_JUMPING, CAT_LOW,
  CAT_MEDIUM, CAT_PROJECTILE, CAT_SCRAP, EFFECT_HAR_QUIRKS, EFFECT_POSITIONAL_LIGHTING, EFFECT_SHADOW, EFFECT_STASIS, EFFECT_TRAIL,
  ESS_ARM_SPEED, ESS_LEG_SPEED, ESS_NONE, ESS_SPECIAL, ESS_SPECIAL_ARM, ESS_SPECIAL_LEG, GROUP_HAR, GROUP_PROJECTILE, GROUP_SCRAP,
  HarEventType, HarId, HarState, HEIGHT_CROUCHING, KnockDownMode, HEIGHT_STANDING, INPUT_BUFFER_TICKS, LAYER_HAR, LAYER_HAR1, LAYER_HAR2,
  LAYER_HAZARD, LAYER_PROJECTILE, LAYER_SCRAP, OBJECT_FACE_LEFT, OBJECT_FACE_RIGHT, OBJECT_FLAGS_MC, OBJECT_FLAGS_NEXT_ANIM_ON_ENEMY_HIT,
  OBJECT_FLAGS_NEXT_ANIM_ON_OWNER_HIT, PLAY_BACKWARDS, POS_IN_ARENA3, RENDER_LAYER_BOTTOM, RENDER_LAYER_MIDDLE, RENDER_LAYER_TOP,
  STUN_RECOVERY_BLOCKING_CONSTANT, STUN_RECOVERY_CONSTANT,
} from '../constants';
import type { GameState } from '../gameState';
import { emitFx, FxType } from '../fx';
import { intersectHarSpriteHitpoint, intersectSpriteHitpoint, type Point } from '../intersect';
import { GameObject } from '../object';
import { harScreencapsCapture, SCREENCAP_BLOW } from '../harScreencap';
import { isHazardBk } from './hazard';
import {
  projectileClearHit, projectileCreate, projectileDidHit, projectileFinished, projectileGetAfData, projectileGetOwner,
  projectileMarkHit, projectileSetInvincible, projectileSetWallBounce, projectileStopOnGround,
} from './projectile';
import { scrapCreate } from './scrap';

export type HarHook = (event: HarEvent) => void;

export interface Har {
  kind: 'har';
  id: number;
  playerId: number;
  pilotId: number;
  state: HarState;
  executingMove: number;
  close: number;
  afData: Af;
  damageDone: number;
  damageReceived: number;
  airAttacked: number;
  isWallhugging: number;
  isGrabbed: number;
  jumpDelay: number;
  lastDamageValue: number;
  lastStunValue: number;
  punchValid: number;
  kickValid: number;
  jumpSpeed: number;
  superjumpSpeed: number;
  fallSpeed: number;
  fwdSpeed: number;
  backSpeed: number;
  inStasisTicks: number;
  throwDuration: number;
  blockDuration: number;
  cornerpushVelApplied: boolean;
  cornerpushEnabled: boolean;
  lastHitRawDamage: number;
  height: number;
  stride: number;
  stunFactor: number;
  healthMax: number;
  health: number;
  enduranceMax: number;
  endurance: number;
  /** inputs[0] is the most recent numpad-notation input; 10 entries. */
  inputs: string[];
  inputChangeTick: number;
  lastInput: string;
  stunTimer: number;
  pPalRef: number;
  pHarSwitch: number;
  pFadeOutTicks: number;
  pFadeOutTicksLeft: number;
  pFadeInTicks: number;
  pFadeInTicksLeft: number;
  pSustainTicksLeft: number;
  pColorFn: number;
  walkDestination: number;
  walkDoneAnim: number;
  walkDoneTick: number;
  customDefeatAnimation: number;
  rehits: number[];
  rehitCombo: boolean;
  hooks: HarHook[];
  disabledAnimations: Map<number, number>;
  trailCache: Map<number, Animation>;
}

export function harData(obj: GameObject): Har {
  return obj.userdata as Har;
}

export function isHar(obj: GameObject | null): boolean {
  return !!obj && (obj.userdata as { kind?: string } | null)?.kind === 'har';
}

/** Minimal arena interface HAR logic depends on. */
export interface ArenaLike {
  arenaGetState(): number;
  arenaIsOver(): number;
}
export const ARENA_STATE_STARTING = 0;
export const ARENA_STATE_FIGHTING = 1;
export const ARENA_STATE_ENDING = 2;

function arenaOf(gs: GameState): ArenaLike | null {
  const sc = gs.sc as unknown as Partial<ArenaLike>;
  return typeof sc.arenaGetState === 'function' ? (sc as ArenaLike) : null;
}

function enemyOf(obj: GameObject): GameObject {
  const h = harData(obj);
  return obj.gs.findObject(obj.gs.getPlayer(h.playerId ? 0 : 1).harObjId)!;
}

// ---------------------------------------------------------------------------
// Events

function fireHooks(h: Har, gs: GameState, event: HarEvent): void {
  for (const hook of h.hooks) hook(event);
  const ctrl = gs.getPlayer(h.playerId).ctrl;
  const obj = gs.findObject(ctrl.harObjId);
  if (obj && obj.userdata === h) ctrl.harHook(event);
}

function ev(h: Har, gs: GameState, type: HarEventType, extra: Partial<HarEvent> = {}): void {
  fireHooks(h, gs, { type, playerId: h.playerId, ...extra });
}

export function harInstallHook(h: Har, hook: HarHook): void {
  h.hooks.push(hook);
}

// ---------------------------------------------------------------------------
// Animation control

function harStunnedDone(obj: GameObject): void {
  const h = harData(obj);
  if (h.state === HarState.STUNNED) {
    h.endurance = 0;
    h.state = HarState.STANDING;
    harSetAni(obj, ANIM_IDLE, true);
  }
}

export function harSetAni(obj: GameObject, animationId: number, repeat: boolean): void {
  if (obj.curAnimation && obj.curAnimation.id === ANIM_WALKING && animationId === ANIM_WALKING) return;
  const h = harData(obj);
  const move = afGetMove(h.afData, animationId);
  if (!move) return;
  obj.setAnimation(move.ani);
  if (move.category === CAT_JUMPING && h.state < HarState.VICTORY) h.state = HarState.JUMPING;
  if (move.category === CAT_LOW || animationId === ANIM_CROUCHING || animationId === ANIM_CROUCHING_BLOCK) h.height = HEIGHT_CROUCHING;
  else h.height = HEIGHT_STANDING;
  obj.setRepeat(repeat);
  obj.setStride(1);
  obj.dynamicTick();
  obj.startX = obj.posX;
  obj.startY = obj.posY;
  h.damageDone = 0;
  h.damageReceived = 0;
  h.executingMove = 0;
}

export function harIsActive(obj: GameObject): boolean {
  const h = harData(obj);
  if (h.state === HarState.DEFEAT) return true;
  if (h.state === HarState.SCRAP || h.state === HarState.DESTRUCTION || h.state === HarState.VICTORY) return false;
  return !!h.executingMove;
}

export function harWalkTo(obj: GameObject, destination: number): void {
  const h = harData(obj);
  const move = afGetMove(h.afData, 10)!;
  h.walkDoneAnim = obj.curAnimation!.id;
  h.walkDoneTick = obj.playerCurrentTick();
  obj.setVel(h.fwdSpeed * obj.direction, 0);
  obj.setAnimation(move.ani);
  obj.setRepeat(true);
  obj.setStride(1);
  h.walkDestination = destination;
  obj.dynamicTick();
  obj.startX = obj.posX;
  obj.startY = obj.posY;
}

export function harIsWalking(h: Har): boolean {
  return h.state === HarState.WALKTO || h.state === HarState.WALKFROM;
}

function isHarIdleGrounded(obj: GameObject): boolean {
  const id = obj.curAnimation!.id;
  return (id === ANIM_IDLE || id === ANIM_CROUCHING || id === ANIM_WALKING) && obj.gs.harsAreAlive();
}

export function harIsCrouching(h: Har): boolean {
  return h.state === HarState.CROUCHING || h.state === HarState.CROUCHBLOCK;
}

export function flipInput(c: string, direction: number): string {
  if (direction === OBJECT_FACE_LEFT) {
    switch (c) {
      case '7': return '9';
      case '4': return '6';
      case '1': return '3';
      case '9': return '7';
      case '6': return '4';
      case '3': return '1';
    }
  }
  return c;
}

function getLastInput(obj: GameObject): string {
  return flipInput(harData(obj).inputs[0], obj.direction);
}

export function harIsBlocking(obj: GameObject, move: AfMove): boolean {
  const id = obj.curAnimation!.id;
  if (!isHarIdleGrounded(obj) && id !== ANIM_STANDING_BLOCK && id !== ANIM_CROUCHING_BLOCK) return false;
  const h = harData(obj);
  if (h.inStasisTicks) return false;
  let last = h.lastInput;
  if (obj.crossupProtection) {
    if (last === '6') last = '4';
    else if (last === '3') last = '1';
  }
  switch (move.category) {
    case CAT_CLOSE:
      return false;
    case CAT_LOW:
      return last === '1';
    case CAT_JUMPING:
      return last === '4';
    default:
      return last === '1' || last === '4';
  }
}

function isInRange(obj: GameObject, enemy: GameObject, move: AfMove): boolean {
  const h = harData(obj);
  let check = move;
  if (move.nextMove) {
    const next = afGetMove(h.afData, move.nextMove);
    if (next && next.category === CAT_CLOSE) check = next;
  }
  if (check.successorId) {
    const throwRange = obj.gs.matchSettings.throwRange / 100;
    if (obj.distance(enemy) > check.successorId * throwRange) return false;
  }
  return true;
}

function harIsInvincible(obj: GameObject, move: AfMove): boolean {
  if (obj.frameIsSet(Tag.ZZ)) return true;
  const id = obj.curAnimation!.id;
  switch (move.category) {
    case CAT_CLOSE:
      if (obj.frameIsSet(Tag.ZG) || id === ANIM_DAMAGE || id === ANIM_STANDING_BLOCK || id === ANIM_CROUCHING_BLOCK || id === ANIM_STANDUP) return true;
      break;
    case CAT_LOW:
      if (obj.frameIsSet(Tag.ZL)) return true;
      break;
    case CAT_MEDIUM:
      if (obj.frameIsSet(Tag.ZM)) return true;
      break;
    case CAT_HIGH:
      if (obj.frameIsSet(Tag.ZH)) return true;
      break;
    case CAT_JUMPING:
      if (obj.frameIsSet(Tag.ZJ)) return true;
      break;
    case CAT_PROJECTILE:
      if (obj.frameIsSet(Tag.ZP)) return true;
      break;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Spawning

function cbHarDisableAnimation(harObj: GameObject, animationId: number, ticks: number): void {
  harData(harObj).disabledAnimations.set(animationId, ticks);
}

function cbHarSpawnObject(harObj: GameObject, parent: GameObject, id: number, x: number, y: number, vx: number, vy: number, _mp: number, _s: number, g: number): void {
  const h = harData(harObj);
  if (x === 0) x = parent.px();
  if (y === 0) y = parent.py();
  if (id === ANIM_SCRAP_METAL || id === ANIM_BOLT || id === ANIM_SCREW || id === ANIM_BURNING_OIL) {
    harSpawnScrap(parent, x, y, 12);
    return;
  }
  const move = afGetMove(h.afData, id);
  if (!move) return;
  const obj = new GameObject(parent.gs, x, y, vx, vy);
  obj.soundTranslationTable = parent.soundTranslationTable;
  obj.setAnimation(move.ani);
  obj.gravity = g / 100;
  obj.palOffset = parent.palOffset;
  obj.palLimit = parent.palLimit;
  obj.layers = LAYER_PROJECTILE | (h.playerId === 0 ? LAYER_HAR2 : LAYER_HAR1);
  obj.group = GROUP_PROJECTILE;
  obj.setRepeat(false);
  obj.castShadow = false;
  obj.direction = parent.direction;
  obj.animationState.enemyObjId = parent.animationState.enemyObjId;
  projectileCreate(obj, harObj);
  obj.animationState.spawn = (p, sid, sx, sy, svx, svy, smp, ss, sg) => cbHarSpawnObject(harObj, p, sid, sx, sy, svx, svy, smp, ss, sg);
  obj.animationState.disable = (_p, aid, t) => cbHarDisableAnimation(harObj, aid, t);
  if (h.id === HarId.NOVA && id >= 25 && id <= 30) {
    projectileSetWallBounce(obj, true);
    projectileStopOnGround(obj, true);
  }
  if (h.state === HarState.SCRAP || h.state === HarState.DESTRUCTION) projectileSetInvincible(obj);
  obj.playerInitSpawned();
  parent.gs.addObject(obj, RENDER_LAYER_MIDDLE, false, false);
}

function cbHarDestroyObject(harObj: GameObject, parent: GameObject, animationId: number): void {
  const h = harData(harObj);
  for (const p of parent.gs.getProjectiles()) {
    if ((p.userdata as { kind?: string })?.kind !== 'projectile') continue;
    if (projectileGetOwner(p) === h.playerId && p.curAnimation && p.curAnimation.id === animationId) p.setFinished(true);
  }
}

function harFloorLandingEffects(obj: GameObject, playSound: boolean, power = 6): void {
  emitFx(FxType.LANDING, obj.posX, obj.posY, power, 0, harData(obj).playerId, obj.gs.thisId);
  const amount = globalRandom.int(2) + 1;
  const dustInfo = bkGetInfo(obj.gs.sc.bk, 26);
  for (let i = 0; i < amount && dustInfo; i++) {
    const variance = globalRandom.int(20) - 10;
    const dust = new GameObject(obj.gs, Math.trunc(obj.posX + variance + i * 10), Math.trunc(obj.posY));
    dust.soundTranslationTable = obj.soundTranslationTable;
    dust.setAnimation(dustInfo.ani);
    dust.playerInitSpawned();
    obj.gs.addObject(dust, RENDER_LAYER_MIDDLE, false, false);
  }
  if (playSound) {
    const opts = defaultSoundOpts();
    opts.volume = 38;
    opts.panning = clampPan(obj.posX);
    obj.gs.playSound(56, opts);
  }
}

function clampPan(x: number): number {
  return Math.max(-100, Math.min(100, Math.trunc(((x - 160) * 100) / 160)));
}

function disableRehit(h: Har, move: AfMove): void {
  h.rehits.push(move.id);
}

function clearRehits(h: Har): void {
  h.rehits = [];
  h.rehitCombo = false;
}

// ---------------------------------------------------------------------------
// Movement

function harMove(obj: GameObject): void {
  const h = harData(obj);
  if (h.isGrabbed > 0 || h.inStasisTicks > 0) return;
  const lastInput = getLastInput(obj);
  obj.applyControllableVelocity(false, lastInput);
  obj.posX += obj.velX + obj.cvelX;
  obj.posY += obj.velY + obj.cvelY;
  const enemyObj = enemyOf(obj);
  const enemyHar = harData(enemyObj);
  if (h.walkDestination > 0 && h.walkDoneAnim &&
    ((obj.posX >= h.walkDestination && obj.direction === OBJECT_FACE_RIGHT) || (obj.posX <= h.walkDestination && obj.direction === OBJECT_FACE_LEFT))) {
    obj.posX = h.walkDestination;
    // Deviation: the corner walk (see the CF tag in GameObject.playerRunApply) ends facing the enemy; the reference
    // turns the HAR around, which assumed it had walked away from the enemy.
    if (obj.animationState.shadowCornerHack) harFaceEnemy(obj, enemyObj);
    obj.setVel(0, 0);
    // Deviation: the walk is over before the move resumes (the reference clears it afterwards, which also cleared
    // a walk the resumed frame started, leaving the HAR walking with no destination).
    const anim = h.walkDoneAnim, tick = h.walkDoneTick;
    h.walkDestination = -1;
    h.walkDoneAnim = 0;
    h.walkDoneTick = 0;
    harSetAni(obj, anim, false);
    if (h.walkDestination < 0) obj.animationState.reader.seek(tick);
    return;
  }
  if (obj.posX <= ARENA_LEFT_WALL || obj.posX >= ARENA_RIGHT_WALL) {
    h.isWallhugging = 1;
    if (obj.frameIsSet(Tag.CW) && obj.frameIsSet(Tag.D)) obj.animationState.disableD = true;
  } else {
    h.isWallhugging = 0;
  }
  if (obj.posY >= ARENA_FLOOR) {
    obj.posY = ARENA_FLOOR;
    clearRehits(h);
    if (obj.frameIsSet(Tag.CL)) {
      const move = afGetMove(h.afData, obj.curAnimation!.id)!;
      obj.setVel(0, 0);
      harSetAni(obj, move.nextMove, false);
      obj.setStride(1);
    } else if ((h.state === HarState.SCRAP || h.state === HarState.DESTRUCTION) && obj.velY > 0) {
      obj.setVel(0, 0);
      harFinished(obj);
      harFloorLandingEffects(obj, true);
    } else if (h.state === HarState.VICTORY && obj.velY > 0) {
      obj.setVel(0, 0);
      harSetAni(obj, ANIM_IDLE, true);
      obj.setStride(h.stride);
      ev(h, obj.gs, HarEventType.LAND);
      harFloorLandingEffects(obj, true);
    } else if (h.state === HarState.JUMPING && enemyHar.isGrabbed === 0 && !obj.frameIsSet(Tag.CG)) {
      if (lastInput === '6') {
        h.state = HarState.WALKTO;
        harSetAni(obj, ANIM_WALKING, true);
        obj.setVel(0, 0);
        obj.setStride(h.stride);
        ev(h, obj.gs, HarEventType.WALK, { direction: 1 });
      } else if (lastInput === '4') {
        h.state = HarState.WALKFROM;
        harSetAni(obj, ANIM_WALKING, true);
        obj.setVel(0, 0);
        obj.setStride(h.stride);
        ev(h, obj.gs, HarEventType.WALK, { direction: -1 });
      } else {
        obj.setVel(0, 0);
        h.state = HarState.STANDING;
        harSetAni(obj, ANIM_IDLE, true);
        obj.setStride(h.stride);
      }
      h.jumpDelay = 3;
      ev(h, obj.gs, HarEventType.LAND);
      harFloorLandingEffects(obj, true);
    } else if (h.state === HarState.RECOIL) {
      if (obj.velY > 6) {
        harFloorLandingEffects(obj, false, obj.velY * 3);
        obj.velY = -3;
        obj.velX = obj.velX / 2;
        if (h.id !== HarId.NOVA) {
          obj.setCustomString('l20s4sp13zzN3-zzM100');
          obj.gs.screenShakeVertical = 5;
        } else {
          obj.setCustomString('l40s4sp13zzN3-zzM100');
          obj.gs.screenShakeVertical = 15;
        }
      }
      if (obj.velY >= 0 && obj.playerCurrentTick() > 5 && obj.curSpriteId === 12 && !h.isGrabbed) obj.velY = 1;
      if (obj.velY > 0) {
        obj.velY = 0;
        obj.velX = 0;
        ev(h, obj.gs, HarEventType.LAND);
        harFinished(obj);
      }
    }
    if (h.state !== HarState.SCRAP) {
      if (obj.velX > 0) obj.velX = obj.velX <= 1 ? 0 : obj.velX - 1;
      else if (obj.velX < 0) obj.velX = obj.velX >= -1 ? 0 : obj.velX + 1;
    }
    if (h.state === HarState.WALKTO) {
      harFaceEnemy(obj, enemyObj);
      obj.posX += h.fwdSpeed * obj.direction;
    } else if (h.state === HarState.WALKFROM) {
      harFaceEnemy(obj, enemyObj);
      obj.posX -= h.backSpeed * obj.direction;
    }
  } else {
    if (obj.gs.harsAreAlive()) obj.velY += obj.gravity;
    else obj.velY += 230.0 / 256.0;
    if (obj.velY > 13) obj.velY = 13;
  }
}

function applyStunDamage(obj: GameObject, stunAmount: number): void {
  const h = harData(obj);
  if (h.endurance < 0) {
    if (h.state === HarState.STUNNED) h.endurance = 0;
  } else {
    if (h.state === HarState.RECOIL && obj.isAirborne()) stunAmount = Math.trunc(stunAmount / 2);
    stunAmount = (stunAmount * 2 + 12) * 256;
    h.endurance += stunAmount;
  }
}

function harFindLinkedObjects(obj: GameObject): GameObject[] {
  const h = harData(obj);
  const pred = (owner: number, mask: number) => (o: GameObject) =>
    o.group === GROUP_PROJECTILE && (o.userdata as { kind?: string })?.kind === 'projectile' && projectileGetOwner(o) === owner && (o.objectFlags & mask) !== 0;
  return [
    ...obj.gs.findObjects(pred(h.playerId, OBJECT_FLAGS_NEXT_ANIM_ON_OWNER_HIT)),
    ...obj.gs.findObjects(pred(Math.abs(h.playerId - 1), OBJECT_FLAGS_NEXT_ANIM_ON_ENEMY_HIT)),
  ];
}

function calcDamageAndStun(obj: GameObject, move: AfMove): [number, number] {
  const h = harData(obj);
  const pilot = obj.gs.getPlayer(h.playerId).pilot;
  if (move.category === CAT_BK_HAZARD) return [move.damage, move.damage];
  let multiplier = 100;
  if (obj.frameIsSet(Tag.K)) multiplier = obj.frameGet(Tag.K) + 10;
  let damage = Math.trunc((move.damage * multiplier) / 100);
  if (multiplier < 100) damage = damage + 1;
  let stun: number;
  if (!obj.gs.isTournament()) {
    stun = damage;
    damage = Math.trunc((damage * (20 + pilot.power)) / 30) + 1;
  } else {
    stun = Math.trunc((damage * (35 + pilot.power)) / 45);
    damage = Math.trunc((damage * (25 + pilot.power)) / 35) + 1;
    const legPower = Math.fround((pilot.legPower + 3) * 0.192);
    const armPower = Math.fround((pilot.armPower + 3) * 0.192);
    switch (move.extraStringSelector) {
      case ESS_NONE:
        break;
      case ESS_ARM_SPEED:
      case ESS_SPECIAL_ARM:
        damage = Math.trunc(damage * armPower);
        break;
      case ESS_LEG_SPEED:
      case ESS_SPECIAL_LEG:
        damage = Math.trunc(damage * legPower);
        break;
      case ESS_SPECIAL:
        damage = Math.trunc(damage * armPower * legPower);
        break;
    }
  }
  return [damage, stun];
}

function harTakeDamage(obj: GameObject, move: AfMove): void {
  const h = harData(obj);
  const gs = obj.gs;
  const otherPlayer = gs.getPlayer(h.playerId ? 0 : 1);
  const otherHar = gs.findObject(otherPlayer.harObjId)!;
  if (h.state === HarState.VICTORY || h.state === HarState.DONE) return;
  h.inStasisTicks = 1;
  let [damage, stun] = calcDamageAndStun(otherHar, move);
  damage = h.rehitCombo ? Math.trunc(damage / 0.6) : damage;
  h.lastDamageValue = damage;
  h.lastStunValue = stun;
  h.executingMove = 0;
  for (const linked of harFindLinkedObjects(obj)) {
    if (linked.objectFlags & OBJECT_FLAGS_MC && linked.objectFlags & OBJECT_FLAGS_NEXT_ANIM_ON_OWNER_HIT) linked.gravity = otherHar.gravity;
    const laf = projectileGetAfData(linked);
    const lmove = afGetMove(laf, linked.curAnimation!.id);
    const nextAnim = lmove ? lmove.throwDuration : 0;
    if (nextAnim && projectileGetOwner(linked) === h.playerId) {
      const n = afGetMove(laf, nextAnim);
      if (n) linked.setAnimation(n.ani);
    } else {
      projectileFinished(linked);
    }
  }
  const player = gs.getPlayer(h.playerId);
  if (!player.god && !h.throwDuration) {
    if (player.pilot.photo) {
      // int16 -= float: the whole difference is truncated.
      h.health = Math.trunc(h.health - damage / Math.fround(0.25 * (2.5 + player.pilot.armor)));
    } else {
      h.health -= damage;
    }
    applyStunDamage(obj, stun);
  }
  // Training mode: nobody gets knocked out (health refills after combos, see the arena).
  if (gs.training && h.health < 1) h.health = 1;
  if (h.health <= 0) h.health = 0;
  if (h.health === 0) {
    // Take a screencap of enemy har (newsroom photo)
    harScreencapsCapture(otherPlayer.screencaps, otherHar, obj, SCREENCAP_BLOW);
    gs.slowdown(12, gs.speed - 10);
  }
  const str = move.footerString;
  let custom = '';
  if (str.length > 0) {
    h.state = HarState.RECOIL;
    obj.setAnimation(afGetMove(h.afData, ANIM_DAMAGE)!.ani);
    obj.setRepeat(false);
    if (h.health <= 0) ev(h, gs, HarEventType.DEFEAT);
    if (h.throwDuration) {
      obj.setStride(1);
    } else if (otherHar.frameIsSet(Tag.AI) && move.category !== CAT_PROJECTILE) {
      custom = 'A1-s01l50B2-C2-L5-M400';
      obj.velX = -5.0 * obj.direction;
      obj.velY = -9.0;
      obj.setStride(1);
    } else if (obj.isAirborne()) {
      custom = str;
      if (h.endurance >= h.enduranceMax || h.health <= 0) custom += '-L3-M5000';
      else custom += '-L2-M5-L2';
      obj.velY = obj.verticalVelocityModifier * ((((30.0 - move.damage) * 0.133333) + 6.5) * -1.0);
      obj.velX = ((move.damage * 0.16666666) + 2.0) * obj.direction * -1 * obj.horizontalVelocityModifier;
      obj.setStride(1);
    } else if (h.health <= 0 || h.endurance >= h.enduranceMax || h.endurance < 0 || knocksDown(gs, move)) {
      const last = str.lastIndexOf('-');
      custom = str.slice(0, last < 0 ? 0 : last) + '-x-20ox-20L1-ox-20L2-x-20zzs4l25sp13M1-zzM2';
    }
    obj.setCustomString(custom.length > 0 ? custom : str);
    if (!obj.isAirborne()) {
      const hitTicks = obj.playerLenTicks();
      if (hitTicks < 20) {
        let push = ((hitTicks - 3) * 20.0) / 29.0 + 0.5;
        if (push < 7) push = 7;
        obj.velX = push * obj.direction * -1;
      }
    }
    const first = obj.animationState.reader.script?.frame(0);
    if (first && first.has(Tag.K)) {
      obj.velX = -5 * obj.direction;
      obj.velY = -8;
    }
  }
}

function harDebrisRandomVel(harObj: GameObject, destruction: boolean): [number, number] {
  let vx = globalRandom.float() * 4 - 2;
  let vy = globalRandom.float() * 4 - 2;
  if (destruction) {
    let x = globalRandom.int(1);
    if (x === 0) x = -1;
    vx *= x * 10;
    vy *= 10;
  } else {
    let x = globalRandom.int(4);
    x = x === 0 ? -1 : 1;
    vx *= x * harObj.direction * 4;
    vy *= 3;
  }
  return [vx, vy];
}

function harSparksRandomGravity(): number {
  return (globalRandom.int(30) + 40) / 100;
}

function isDestruction(gs: GameState): boolean {
  const a = gs.findObject(gs.getPlayer(0).harObjId);
  const b = gs.findObject(gs.getPlayer(1).harObjId);
  return (!!a && harData(a).state === HarState.DESTRUCTION) || (!!b && harData(b).state === HarState.DESTRUCTION);
}

function harSpawnOil(obj: GameObject, x: number, y: number, amount: number, layer: number): void {
  const h = harData(obj);
  const oil = afGetMove(h.afData, ANIM_BURNING_OIL);
  if (!oil) return;
  for (let i = 0; i < amount; i++) {
    const [vx, vy] = harDebrisRandomVel(obj, isDestruction(obj.gs));
    const scrap = new GameObject(obj.gs, x, y, vx, vy);
    scrap.setAnimation(oil.ani);
    scrap.soundTranslationTable = obj.soundTranslationTable;
    scrap.gravity = harSparksRandomGravity();
    scrap.layers = LAYER_SCRAP;
    scrapCreate(scrap);
    scrap.playerInitSpawned();
    obj.gs.addObject(scrap, layer, false, false);
  }
}

export function harSpawnScrap(obj: GameObject, x: number, y: number, amount: number): void {
  const oilAmount = Math.trunc(amount / 3);
  const h = harData(obj);
  harSpawnOil(obj, x, y, oilAmount, RENDER_LAYER_TOP);
  let scrapAmount = 0;
  if (amount > 11 && amount < 14) scrapAmount = 1;
  else if (amount > 13 && amount < 16) scrapAmount = 2;
  else if (amount > 15) scrapAmount = 3;
  for (let i = 0; i < scrapAmount; i++) {
    const animNo = globalRandom.int(3) + ANIM_SCRAP_METAL;
    const move = afGetMove(h.afData, animNo);
    if (!move) continue;
    const [vx, vy] = harDebrisRandomVel(obj, isDestruction(obj.gs));
    const scrap = new GameObject(obj.gs, x, y, vx, vy);
    scrap.setAnimation(move.ani);
    scrap.soundTranslationTable = obj.soundTranslationTable;
    scrap.gravity = 1.0;
    scrap.palOffset = obj.palOffset;
    scrap.palLimit = obj.palLimit;
    scrap.layers = LAYER_SCRAP;
    scrap.group = GROUP_SCRAP;
    scrap.castShadow = true;
    scrapCreate(scrap);
    scrap.playerInitSpawned();
    obj.gs.addObject(scrap, RENDER_LAYER_TOP, false, false);
  }
}

function harBlock(obj: GameObject, hit: Point, blockStun: number): void {
  const h = harData(obj);
  if (h.lastInput === '1' || h.lastInput === '3') obj.setAnimation(afGetMove(h.afData, ANIM_CROUCHING_BLOCK)!.ani);
  else obj.setAnimation(afGetMove(h.afData, ANIM_STANDING_BLOCK)!.ani);
  obj.setCustomString('A1');
  obj.setRepeat(false);
  obj.dynamicTick();
  h.blockDuration = blockStun;
  h.state = HarState.BLOCKSTUN;
  const scrapeMove = afGetMove(h.afData, ANIM_BLOCKING_SCRAPE);
  if (scrapeMove) {
    const scrape = new GameObject(obj.gs, hit.x, hit.y);
    scrape.setAnimation(scrapeMove.ani);
    scrape.soundTranslationTable = obj.soundTranslationTable;
    scrape.direction = obj.direction;
    scrape.setRepeat(false);
    scrape.gravity = 0;
    scrape.layers = LAYER_SCRAP;
    const opts = defaultSoundOpts();
    opts.volume = 89;
    opts.panning = 50;
    obj.gs.playSound(3, opts);
    scrape.playerInitSpawned();
    obj.gs.addObject(scrape, RENDER_LAYER_MIDDLE, false, false);
  }
  h.damageReceived = 1;
}

/**
 * BLOCK DAMAGE (advanced option, not implemented by the reference engine): a blocked move still inflicts this
 * percentage of its damage. Blocked damage leaves at least 1 point of health (it never ends a round by itself).
 */
function harBlockDamage(obj: GameObject, attacker: GameObject, move: AfMove): void {
  const pct = obj.gs.matchSettings.blockDamage;
  if (pct <= 0 || move.damage <= 0) return;
  const h = harData(obj);
  const player = obj.gs.getPlayer(h.playerId);
  if (player.god || h.health <= 1) return;
  const [damage] = calcDamageAndStun(attacker, move);
  let chip = Math.trunc((damage * pct) / 100);
  if (player.pilot.photo) chip = Math.trunc(chip / Math.fround(0.25 * (2.5 + player.pilot.armor)));
  if (chip > 0) h.health = Math.max(1, h.health - chip);
}

/** KNOCK DOWN (advanced option, not in the reference engine): the selected jumping attacks knock grounded enemies down. */
export function knocksDown(gs: GameState, move: AfMove): boolean {
  const mode = gs.matchSettings.knockDown;
  if (mode === KnockDownMode.NONE || move.category !== CAT_JUMPING) return false;
  const button = move.moveString[0];
  if (button === 'K') return mode === KnockDownMode.KICKS || mode === KnockDownMode.BOTH;
  if (button === 'P') return mode === KnockDownMode.PUNCHES || mode === KnockDownMode.BOTH;
  return false;
}

/** Effect event for an impact of `attacker` (HAR, projectile or hazard) on HAR `victim`. */
function fxImpact(type: FxType, attacker: GameObject, victim: GameObject, hit: Point, power: number): void {
  const known = hit.x !== 0 || hit.y !== 0;
  const x = known ? hit.x : (attacker.posX + victim.posX) / 2;
  const y = known ? hit.y : victim.posY - 50;
  const dir = attacker.direction !== 0 ? attacker.direction : -victim.direction;
  emitFx(type, x, y, power, dir, harData(victim).playerId, victim.gs.thisId);
}

function harCheckCloseness(objA: GameObject, objB: GameObject): void {
  const a = harData(objA);
  const b = harData(objB);
  const softLimit = 45;
  a.close = 0;
  b.close = 0;
  const dist = Math.abs(objA.px() - objB.px());
  if (a.state === HarState.WALKTO && dist < softLimit) {
    if (b.state === HarState.STANDING || b.state === HarState.STUNNED || harIsWalking(b) || harIsCrouching(b)) a.close = 1;
  }
  if (b.state === HarState.WALKTO && dist < softLimit) {
    if (a.state === HarState.STANDING || a.state === HarState.STUNNED || harIsWalking(a) || harIsCrouching(a)) b.close = 1;
  }
}

function harCornerpush(self: GameObject, enemy: GameObject, distance: number): void {
  const h = harData(self);
  if (h.throwDuration || (h.cornerpushEnabled && h.state === HarState.BLOCKSTUN)) {
    enemy.posX += distance;
  } else if (h.cornerpushEnabled && h.state === HarState.RECOIL) {
    if (!self.isAirborne() && !enemy.isAirborne()) {
      enemy.posX += distance / 2.0 + (distance < 0 ? -2 : 2);
    } else if (self.isAirborne() && !enemy.isAirborne() && self.playerCurrentTick() <= 2 && !h.cornerpushVelApplied) {
      let pushvel = (h.lastHitRawDamage + 15) / 3.0;
      if (pushvel > 9) pushvel = 9;
      h.cornerpushVelApplied = true;
      // Note: the reference applies `distance < 0 ? -1 : 1 * pushvel` (operator precedence quirk).
      enemy.velX = distance < 0 ? -1 : 1 * pushvel;
    }
  }
}

function harCollideWithHar(objA: GameObject, objB: GameObject, loop: number): boolean {
  const a = harData(objA);
  const b = harData(objB);
  const gs = objA.gs;
  const move = afGetMove(a.afData, objA.curAnimation!.id);
  if (!move) return false;
  if (a.inStasisTicks) return false;
  if (objA.hitPixelsDisabled) return false;
  const airHit = objB.isAirborne() || objA.frameIsSet(Tag.AI);
  if (!objB.frameIsSet(Tag.UH)) {
    if (b.state === HarState.WALLDAMAGE || b.state >= HarState.VICTORY || b.state === HarState.STANDING_UP) return false;
    if (b.rehitCombo && !b.inStasisTicks) {
      if (!gs.matchSettings.rehit) return false;
      if (b.endurance >= b.enduranceMax) return false;
      if (b.rehits.includes(move.id)) return false;
    }
    if (harIsInvincible(objB, move)) return false;
  }
  if (!isInRange(objA, objB, move)) return false;
  const hit: Point = { x: 0, y: 0 };
  if (objA.canHit) {
    a.damageDone = 0;
    objA.canHit = 0;
  } else if ((objB.curAnimation!.id === ANIM_STANDING_BLOCK || objB.curAnimation!.id === ANIM_CROUCHING_BLOCK) && objA.frameIsSet(Tag.UR)) {
    b.blockDuration = move.blockStun;
  }
  if (a.damageDone === 0 && (intersectHarSpriteHitpoint(objA, objB, hit) || move.category === CAT_CLOSE || (objA.frameIsSet(Tag.UE) && !objB.isAirborne()))) {
    objA.qCounter = objA.qVal;
    objA.shouldHitpause = true;
    b.cornerpushVelApplied = false;
    b.lastHitRawDamage = move.damage;
    b.cornerpushEnabled = !objA.frameIsSet(Tag.UN);
    if (harIsBlocking(objB, move) && !objA.frameIsSet(Tag.BN)) {
      a.damageDone = 1;
      ev(a, gs, HarEventType.ENEMY_BLOCK, { move });
      ev(b, gs, HarEventType.BLOCK, { move });
      harBlock(objB, hit, move.blockStun);
      harBlockDamage(objB, objA, move);
      fxImpact(FxType.BLOCK, objA, objB, hit, move.damage);
      if (objA.frameIsSet(Tag.I) && move.nextMove) harSetAni(objA, move.nextMove, false);
      let blockVal = move.blockStun;
      if (blockVal <= 1) blockVal = 2;
      objB.velX = -1 * objB.direction * (blockVal * (20.0 / 27.0) + 1);
      return false;
    }
    const hit2: Point = { x: 0, y: 0 };
    if (move.category !== CAT_CLOSE && b.damageDone === 0 && loop === 0 && intersectHarSpriteHitpoint(objB, objA, hit2)) {
      if (harCollideWithHar(objB, objA, 1)) return false;
      if (b.state === HarState.RECOIL || b.state === HarState.STANDING_UP || b.state === HarState.WALLDAMAGE || b.health <= 0 || b.state >= HarState.VICTORY) return false;
    }
    if (move.category === CAT_CLOSE) a.close = 0;
    if ((b.state === HarState.STUNNED || b.state === HarState.RECOIL) && objA.direction === objB.direction) objB.direction = objA.direction * -1;
    ev(b, gs, HarEventType.TAKE_HIT, { move });
    ev(a, gs, HarEventType.LAND_HIT, { move });
    if (objA.isAirborne() && objB.isAirborne()) objA.velX *= 0.7;
    b.throwDuration = move.throwDuration;
    objB.direction = -objA.direction;
    const wasAlive = b.health > 0;
    harTakeDamage(objB, move);
    // Throws hit when the thrown HAR lands (see harTick); strikes hit here.
    if (move.category !== CAT_CLOSE) fxImpact(wasAlive && b.health <= 0 ? FxType.KO : FxType.HIT, objA, objB, hit, move.damage);
    if (b.rehitCombo) objB.velY -= 3;
    if ((hit.x !== 0 || hit.y !== 0) && move.damage !== 0) harSpawnScrap(objB, hit.x, hit.y, move.blockStun);
    b.rehitCombo = airHit;
    disableRehit(b, move);
    if (move.nextMove) {
      harSetAni(objA, move.nextMove, false);
      a.executingMove = 1;
      let ret = move.category === CAT_CLOSE;
      if (loop === 0) ret = harCollideWithHar(objA, objB, 1) || ret;
      return ret;
    }
    a.damageDone = 1;
    b.damageReceived = 1;
    return move.category === CAT_CLOSE;
  }
  return false;
}

function harCollideWithProjectile(oHar: GameObject, oPjt: GameObject): void {
  const h = harData(oHar);
  const gs = oHar.gs;
  const ownerAf = projectileGetAfData(oPjt);
  const other = harData(gs.findObject(gs.getPlayer(Math.abs(h.playerId - 1)).harObjId)!);
  if (oPjt.hitPixelsDisabled) return;
  if (h.state === HarState.STANDING_UP || h.state === HarState.WALLDAMAGE || h.state >= HarState.VICTORY) return;
  const airHit = oHar.isAirborne();
  if (h.rehitCombo) {
    if (!gs.matchSettings.rehit) return;
    if (h.rehits.includes(oPjt.curAnimation!.id)) return;
  }
  if (oPjt.canHit) {
    projectileClearHit(oPjt);
    oPjt.canHit = 0;
  }
  const hit: Point = { x: 0, y: 0 };
  if (!intersectHarSpriteHitpoint(oPjt, oHar, hit)) return;
  oPjt.qCounter = oPjt.qVal;
  h.cornerpushVelApplied = false;
  h.cornerpushEnabled = !oPjt.frameIsSet(Tag.UN);
  const move = afGetMove(ownerAf, oPjt.curAnimation!.id);
  if (!move) return;
  h.lastHitRawDamage = move.damage;
  if (harIsBlocking(oHar, move) && !oPjt.frameIsSet(Tag.BN)) {
    projectileMarkHit(oPjt);
    oPjt.setFinished(true);
    if (move.successorId && move.category !== CAT_CLOSE) {
      const next = afGetMove(ownerAf, move.successorId);
      if (next) {
        oPjt.setAnimation(next.ani);
        oPjt.setRepeat(false);
        oPjt.setFinished(false);
      }
    }
    ev(other, gs, HarEventType.ENEMY_BLOCK_PROJECTILE, { move });
    ev(h, gs, HarEventType.BLOCK_PROJECTILE, { move });
    h.damageReceived = 0;
    harBlock(oHar, hit, move.blockStun);
    const owner = gs.findObject(gs.getPlayer(Math.abs(h.playerId - 1)).harObjId);
    if (owner) harBlockDamage(oHar, owner, move);
    fxImpact(FxType.BLOCK, oPjt, oHar, hit, move.damage);
    let blockVal = move.blockStun;
    if (blockVal <= 1) blockVal = 2;
    oHar.velX = -1 * oHar.direction * (blockVal * (20.0 / 27.0) + 1);
    return;
  }
  if (harIsInvincible(oHar, move)) return;
  if (projectileDidHit(oPjt)) return;
  if (!oPjt.animationState.reader.frame()) return;
  if (move.nextMove) {
    const next = afGetMove(ownerAf, move.nextMove);
    if (next) {
      oPjt.setAnimation(next.ani);
      oPjt.setRepeat(false);
    }
    return;
  }
  if (oPjt.frameIsSet(Tag.AF)) {
    h.inStasisTicks = move.damage;
  } else if (move.damage > 0) {
    oHar.direction = -oPjt.direction;
    const wasAlive = h.health > 0;
    harTakeDamage(oHar, move);
    if (airHit) oHar.velY -= 3;
    fxImpact(wasAlive && h.health <= 0 ? FxType.KO : FxType.PROJECTILE_HIT, oPjt, oHar, hit, move.damage);
  } else if (move.category === CAT_CLOSE) {
    h.throwDuration = move.throwDuration;
  }
  projectileMarkHit(oPjt);
  ev(h, gs, HarEventType.TAKE_HIT_PROJECTILE, { move });
  ev(other, gs, HarEventType.LAND_HIT_PROJECTILE, { move });
  harSpawnScrap(oHar, hit.x, hit.y, move.blockStun);
  h.damageReceived = 1;
  h.rehitCombo = airHit;
  disableRehit(h, move);
  if (move.successorId && move.category !== CAT_CLOSE) {
    const next = afGetMove(ownerAf, move.successorId);
    if (next) {
      oPjt.setAnimation(next.ani);
      oPjt.setRepeat(false);
      oPjt.setFinished(false);
      projectileClearHit(oPjt);
    }
  }
}

function harCollideWithHazard(oHar: GameObject, oHzd: GameObject): void {
  const h = harData(oHar);
  const gs = oHar.gs;
  const bk = oHzd.userdata;
  if (!isHazardBk(bk)) return;
  let anim: BkInfo | null = bkGetInfo(bk, oHzd.curAnimation!.id);
  if (!anim) return;
  const airHit = oHar.isAirborne();
  if (h.rehitCombo && !gs.matchSettings.rehit) return;
  if (h.state === HarState.STANDING_UP) return;
  if (h.state === HarState.VICTORY || h.state === HarState.DEFEAT || h.state === HarState.SCRAP || h.state === HarState.DESTRUCTION ||
    h.state === HarState.DONE || h.state === HarState.WALLDAMAGE) return;
  if (oHzd.hitPixelsDisabled) return;
  const hit: Point = { x: 0, y: 0 };
  if (!h.damageReceived && intersectHarSpriteHitpoint(oHzd, oHar, hit)) {
    const move = {
      id: -1, damage: anim.hazardDamage, footerString: anim.footerString, category: CAT_BK_HAZARD,
    } as unknown as AfMove;
    const wasAlive = h.health > 0;
    harTakeDamage(oHar, move);
    fxImpact(wasAlive && h.health <= 0 ? FxType.KO : FxType.HAZARD_HIT, oHzd, oHar, hit, anim.hazardDamage);
    ev(h, gs, HarEventType.HAZARD_HIT, { info: anim });
    const enemyObj = enemyOf(oHar);
    ev(harData(enemyObj), gs, HarEventType.ENEMY_HAZARD_HIT);
    if (anim.chainNoHit) {
      const next = bkGetInfo(bk, anim.chainNoHit);
      if (next) {
        oHzd.setAnimation(next.ani);
        oHzd.setRepeat(false);
      }
    }
    harSpawnScrap(oHar, hit.x, hit.y, 9);
    h.damageReceived = 1;
    h.rehitCombo = airHit;
  } else if (anim.chainHit && intersectSpriteHitpoint(oHar, oHzd, hit)) {
    anim = bkGetInfo(bk, anim.chainHit);
    if (!anim) return;
    oHzd.animationState.enemyObjId = oHar.animationState.enemyObjId;
    oHzd.setAnimation(anim.ani);
    oHzd.setRepeat(false);
    oHzd.setFinished(false);
  }
}

function isHarThrowing(oHar: GameObject): boolean {
  const h = harData(oHar);
  const move = afGetMove(h.afData, oHar.curAnimation!.id);
  if (!move || move.category !== CAT_CLOSE) return false;
  const other = oHar.gs.findObject(oHar.gs.getPlayer(h.playerId ? 0 : 1).harObjId);
  return !!other && harData(other).throwDuration > 0;
}

function harCollide(objA: GameObject, objB: GameObject): void {
  if (isHar(objA) && isHarThrowing(objA)) return;
  if (objA.layers & LAYER_PROJECTILE) {
    if (isHar(objB)) harCollideWithProjectile(objB, objA);
    return;
  }
  if (objB.layers & LAYER_PROJECTILE) {
    harCollideWithProjectile(objA, objB);
    return;
  }
  if (objA.layers & LAYER_HAZARD) {
    if (isHar(objB)) harCollideWithHazard(objB, objA);
    return;
  }
  if (objB.layers & LAYER_HAZARD) {
    harCollideWithHazard(objA, objB);
    return;
  }
  if (!isHar(objB)) return;
  harCheckCloseness(objA, objB);
  if (!harCollideWithHar(objA, objB, 0)) harCollideWithHar(objB, objA, 0);
}

/** Hazards and projectiles collide via their own collide callbacks, which route to the HAR logic. */
export function harCollideCallback(a: GameObject, b: GameObject): void {
  if (isHar(a)) harCollide(a, b);
  else if (isHar(b)) harCollide(b, a);
}

// ---------------------------------------------------------------------------
// Palette effects & stun

function processRange(h: Har, pal: Palette, step: number): void {
  const start = 48 * (h.playerId ^ h.pHarSwitch) + 1;
  const end = start + 47;
  if (h.pColorFn) paletteTintRange(pal, h.pPalRef, start, end, step);
  else paletteMixRange(pal, h.pPalRef, start, end, step);
}

function harPaletteTransform(pal: Palette, obj: GameObject): void {
  const h = harData(obj);
  if (obj.hasEffect(EFFECT_POSITIONAL_LIGHTING)) {
    const mid = 160;
    const xDist = Math.abs(mid - obj.px());
    const yDist = ARENA_FLOOR - obj.py();
    let blend = Math.trunc((mid - xDist - yDist) / 2) - 30;
    blend = Math.max(blend, -41);
    let gray = blend < 1 ? 1 : 53;
    blend = Math.abs(blend);
    gray *= 4;
    blend *= 4;
    const start = 48 * (h.playerId ^ h.pHarSwitch) + 1;
    paletteLightRange(pal, gray, start, start + 47, blend);
  }
  const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.trunc(v)));
  if (h.pFadeInTicksLeft > 0) {
    processRange(h, pal, clamp255((1.0 - h.pFadeInTicksLeft / h.pFadeInTicks) * 255));
  } else if (h.pSustainTicksLeft > 0) {
    processRange(h, pal, 255);
  } else if (h.pFadeOutTicksLeft > 0) {
    processRange(h, pal, clamp255((h.pFadeOutTicksLeft / h.pFadeOutTicks) * 255));
  }
}

function harHandleStun(obj: GameObject): void {
  const h = harData(obj);
  const id = obj.curAnimation!.id;
  if (h.health <= 0) {
    h.endurance = h.enduranceMax - 2;
  } else if (h.endurance < h.enduranceMax) {
    if (h.endurance < 1) {
      if (id === ANIM_STUNNED) h.endurance += Math.trunc(h.stunFactor * 1.4);
    } else {
      const stunfactor = (1.0 * h.stunFactor * h.endurance) / h.enduranceMax;
      if (id === ANIM_IDLE || id === ANIM_CROUCHING || id === ANIM_VICTORY) {
        const hp = (h.healthMax * 5.0 / 9.0 + h.health) / h.healthMax;
        h.endurance = Math.trunc(h.endurance - (hp * stunfactor + STUN_RECOVERY_CONSTANT));
      } else if (id === ANIM_CROUCHING_BLOCK || id === ANIM_STANDING_BLOCK) {
        const hp = (h.healthMax * 25.0 / 27.0 + h.health) / h.healthMax;
        h.endurance = Math.trunc(h.endurance - (hp * stunfactor + STUN_RECOVERY_BLOCKING_CONSTANT));
      } else if (id === ANIM_JUMPING) {
        const hp = (h.healthMax * 25.0 / 81.0 + h.health) / h.healthMax;
        h.endurance = Math.trunc(h.endurance - (hp * stunfactor + STUN_RECOVERY_CONSTANT));
      } else if (id < (ANIM_SCREW | ANIM_JUMPING)) {
        const hp = (h.healthMax * 5.0 / 27.0 + h.health) / h.healthMax;
        h.endurance = Math.trunc(h.endurance - (hp * stunfactor + STUN_RECOVERY_CONSTANT));
      }
      if (h.endurance < 0) h.endurance = 0;
    }
  }
  if (h.state === HarState.STUNNED) {
    h.stunTimer = (h.stunTimer + 1) & 0xff;
    if (h.stunTimer % 10 === 0) harSpawnOil(obj, obj.px(), obj.py() - 60, 5, RENDER_LAYER_BOTTOM);
    if (h.endurance >= 0) harStunnedDone(obj);
  }
}

function harTick(obj: GameObject): void {
  const h = harData(obj);
  const gs = obj.gs;
  if (obj.hasEffect(EFFECT_POSITIONAL_LIGHTING) || h.pFadeInTicksLeft > 0 || h.pFadeOutTicksLeft > 0 || h.pSustainTicksLeft > 0) {
    obj.paletteTransform = harPaletteTransform;
  } else {
    obj.paletteTransform = null;
  }
  if (h.punchValid) h.punchValid--;
  if (h.kickValid) h.kickValid--;
  if (h.pFadeInTicksLeft > 0) h.pFadeInTicksLeft--;
  if (h.pSustainTicksLeft > 0) h.pSustainTicksLeft--;
  if (h.pFadeOutTicksLeft > 0) h.pFadeOutTicksLeft--;
  if (!h.inStasisTicks && !h.throwDuration) harHandleStun(obj);
  if (h.inStasisTicks > 0) {
    h.inStasisTicks--;
    if (h.inStasisTicks) {
      obj.setHalt(1);
      obj.addAnimationEffects(EFFECT_STASIS);
    } else {
      obj.setHalt(0);
      obj.delAnimationEffects(EFFECT_STASIS);
    }
  }
  h.isGrabbed = h.throwDuration > 0 ? 1 : 0;
  if (h.throwDuration > 0) {
    h.throwDuration--;
    if (h.throwDuration === 0) {
      const wasAlive = h.health > 0;
      h.health = Math.trunc(h.health - h.lastDamageValue);
      if (gs.training && h.health < 1) h.health = 1;
      emitFx(wasAlive && h.health <= 0 ? FxType.KO : FxType.LANDING, obj.posX, obj.posY - 20, 20 + h.lastDamageValue, -obj.direction,
        h.playerId, gs.thisId);
      if (h.endurance < 0) h.endurance = 0;
      else applyStunDamage(obj, h.lastStunValue);
      if (h.health <= 0) {
        // Take a screencap of enemy har (newsroom photo)
        const otherPlayer = gs.getPlayer(h.playerId ? 0 : 1);
        const otherHar = gs.findObject(otherPlayer.harObjId);
        if (otherHar) harScreencapsCapture(otherPlayer.screencaps, otherHar, obj, SCREENCAP_BLOW);
        gs.slowdown(12, h.health === 0 ? gs.speed - 10 : gs.speed - 6);
        ev(h, gs, HarEventType.DEFEAT);
      }
    }
  }
  if (obj.frameIsSet(Tag.AA)) h.airAttacked = 0;
  const enemyObj = enemyOf(obj);
  let px = obj.px();
  const py = obj.py();
  if (!obj.frameIsSet(Tag.AB)) {
    const leftBound = ARENA_LEFT_WALL;
    let rightBound = ARENA_RIGHT_WALL;
    if (py !== ARENA_FLOOR) rightBound = ARENA_RIGHT_WALL - 1;
    const wallFlag = obj.frameIsSet(Tag.AW);
    let wall = 0;
    let distance = 0;
    if (px < leftBound) {
      distance = leftBound - px;
      px = leftBound;
      obj.wallCollision = true;
    } else if (px > rightBound) {
      distance = rightBound - px;
      px = rightBound;
      wall = 1;
      obj.wallCollision = true;
    } else if (obj.wallCollision && px > 160) {
      // Deviation: clamped at the right wall by its animation (a thrown or carried HAR, see GameObject.playerRunApply).
      // The reference reports it as the left wall, and the arena's wall slam moved the HAR across the arena to it
      // (Flail's finishers, which drive the enemy into the wall, then continued 240 px away from it).
      wall = 1;
    }
    if (distance !== 0 && (h.state === HarState.BLOCKSTUN || h.state === HarState.RECOIL)) harCornerpush(obj, enemyObj, distance);
    const move = afGetMove(h.afData, obj.curAnimation!.id);
    if (obj.wallCollision) {
      obj.wallCollision = false;
      if (wallFlag && move && move.nextMove) {
        harSetAni(obj, move.nextMove, false);
        h.executingMove = 1;
      } else {
        obj.setPos(px, py);
        ev(h, gs, HarEventType.HIT_WALL, { wall });
      }
    }
  }
  if (obj.frameIsSet(Tag.PTR) || obj.frameIsSet(Tag.PTD) || obj.frameIsSet(Tag.PTP)) {
    h.pPalRef = obj.frameGet(Tag.PD);
    h.pHarSwitch = obj.frameIsSet(Tag.PE) ? 1 : 0;
    h.pFadeOutTicks = h.pFadeOutTicksLeft = obj.frameGet(Tag.PTR);
    h.pFadeInTicks = h.pFadeInTicksLeft = obj.frameGet(Tag.PTD);
    h.pSustainTicksLeft = obj.frameGet(Tag.PTP);
    h.pColorFn = obj.frameIsSet(Tag.PA) ? 1 : 0;
  }
  if (h.state === HarState.WALLDAMAGE && !obj.isAirborne()) h.state = HarState.RECOIL;
  if (!obj.isAirborne() && h.airAttacked) {
    ev(h, gs, HarEventType.AIR_ATTACK_DONE);
    h.airAttacked = 0;
  }
  for (const [k, v] of h.disabledAnimations) {
    if (v <= 1) h.disabledAnimations.delete(k);
    else h.disabledAnimations.set(k, v - 1);
  }
  const curSprite = obj.curAnimation?.getSprite(obj.curSpriteId);
  if (obj.hasEffect(EFFECT_TRAIL) && obj.age % 2 === 0 && curSprite && curSprite.surface) {
    let anim = h.trailCache.get(obj.curSpriteId);
    if (!anim) {
      const nsp = curSprite.copy();
      nsp.surface!.flattenToMask(1);
      anim = Animation.fromSingle(nsp, obj.curAnimation!.startX, obj.curAnimation!.startY);
      h.trailCache.set(obj.curSpriteId, anim);
    }
    const nobj = new GameObject(gs, obj.px(), obj.py());
    nobj.soundTranslationTable = obj.soundTranslationTable;
    nobj.setAnimation(anim);
    nobj.setCustomString('bs100A1-bf0A15');
    nobj.addAnimationEffects(EFFECT_SHADOW);
    nobj.direction = obj.direction;
    nobj.playerInitSpawned();
    gs.addObject(nobj, RENDER_LAYER_BOTTOM, false, false);
  }
}

// ---------------------------------------------------------------------------
// Input handling

function addInputToBuffer(buf: string[], c: string): boolean {
  if (buf[0] === c) return false;
  buf.unshift(c);
  buf.length = 10;
  return true;
}

function addInput(buf: string[], act: number): boolean {
  if (act === ACT_NONE) return false;
  switch (act & ~(ACT_PUNCH | ACT_KICK)) {
    case ACT_NONE: return addInputToBuffer(buf, '5');
    case ACT_UP: return addInputToBuffer(buf, '8');
    case ACT_DOWN: return addInputToBuffer(buf, '2');
    case ACT_LEFT: return addInputToBuffer(buf, '4');
    case ACT_RIGHT: return addInputToBuffer(buf, '6');
    case ACT_UP | ACT_RIGHT: return addInputToBuffer(buf, '9');
    case ACT_UP | ACT_LEFT: return addInputToBuffer(buf, '7');
    case ACT_DOWN | ACT_RIGHT: return addInputToBuffer(buf, '3');
    case ACT_DOWN | ACT_LEFT: return addInputToBuffer(buf, '1');
    case ACT_STOP: return act === ACT_STOP ? addInputToBuffer(buf, '5') : false;
  }
  return false;
}

function isHarIdleAir(obj: GameObject): boolean {
  return obj.curAnimation!.id === ANIM_JUMPING && obj.gs.harsAreAlive();
}

function isMoveChainAllowed(obj: GameObject, move: AfMove): boolean {
  const h = harData(obj);
  const allowedInIdle = !(move.posConstraints & 0x2);
  if (h.disabledAnimations.has(move.id)) return false;
  if (h.isWallhugging !== 1 && move.posConstraints & 0x1) return false;
  let allowed = false;
  if (obj.frameIsSet(Tag.JN) && move.id === obj.frameGet(Tag.JN)) {
    allowed = true;
  } else {
    switch (move.category) {
      case CAT_JUMPING:
        if (obj.frameIsSet(Tag.JZ) || obj.frameIsSet(Tag.JJ) || (isHarIdleAir(obj) && allowedInIdle && !h.airAttacked)) allowed = true;
        break;
      case CAT_CLOSE:
        if (obj.frameIsSet(Tag.JG) || (isHarIdleGrounded(obj) && allowedInIdle)) {
          const enemy = enemyOf(obj);
          if (enemy.posY === ARENA_FLOOR && !harIsInvincible(enemy, move) && isInRange(obj, enemy, move)) allowed = true;
        }
        break;
      case CAT_LOW:
        if (obj.frameIsSet(Tag.JL) || (isHarIdleGrounded(obj) && allowedInIdle)) allowed = true;
        break;
      case CAT_MEDIUM:
        if (obj.frameIsSet(Tag.JM) || (isHarIdleGrounded(obj) && allowedInIdle)) allowed = true;
        break;
      case CAT_HIGH:
        if (obj.frameIsSet(Tag.JH) || (isHarIdleGrounded(obj) && allowedInIdle)) allowed = true;
        break;
      case CAT_SCRAP:
        if (obj.frameIsSet(Tag.JF) && h.state !== HarState.DONE && allowedInIdle) allowed = true;
        break;
      case CAT_DESTRUCTION:
        if (obj.frameIsSet(Tag.JF2) && allowedInIdle) allowed = true;
        break;
    }
  }
  const arena = arenaOf(obj.gs);
  const isOver = arena ? arena.arenaIsOver() !== -1 : false;
  if (move.category === CAT_SCRAP && !isOver) allowed = false;
  return allowed;
}

function matchMovePrefix(obj: GameObject, prefix: string, inputs: string[]): AfMove | null {
  const h = harData(obj);
  const defensiveThrows = obj.gs.matchSettings.defensiveThrows;
  for (let i = ANIM_SCREW + 1; i < 70; i++) {
    const move = afGetMove(h.afData, i);
    if (!move) continue;
    const ms = move.moveString;
    const len = ms.length;
    if (ms[0] !== prefix) continue;
    let ok = len === 1;
    if (!ok) {
      ok = true;
      for (let k = 1; k < len; k++) {
        // DEF. THROWS (advanced option): throws also work from the defensive (back) position.
        const defensive = defensiveThrows && k === 1 && move.category === CAT_CLOSE && ms[1] === '6' && inputs[0] === '4';
        if (inputs[k - 1] !== ms[k] && !defensive) {
          ok = false;
          break;
        }
      }
    }
    if (ok && isMoveChainAllowed(obj, move)) {
      if (len > 1) h.inputs[0] = '\0';
      return move;
    }
  }
  return null;
}

function matchMove(obj: GameObject, inputs: string[]): AfMove | null {
  const h = harData(obj);
  let move: AfMove | null = null;
  if (h.punchValid) move = matchMovePrefix(obj, 'P', inputs);
  if (!move && h.kickValid) move = matchMovePrefix(obj, 'K', inputs);
  if (move) {
    h.punchValid = 0;
    h.kickValid = 0;
  }
  return move;
}

function scrapDestructionCheat(obj: GameObject): AfMove | null {
  const h = harData(obj);
  for (let i = 0; i < 70; i++) {
    const move = afGetMove(h.afData, i);
    if (!move) continue;
    if (move.category === CAT_SCRAP && h.state === HarState.VICTORY && h.kickValid &&
      (obj.frameIsSet(Tag.JF) || (obj.frameIsSet(Tag.JN) && i === obj.frameGet(Tag.JN)))) return move;
    if (move.category === CAT_DESTRUCTION && h.state === HarState.SCRAP && h.punchValid &&
      (obj.frameIsSet(Tag.JF2) || (obj.frameIsSet(Tag.JN) && i === obj.frameGet(Tag.JN)))) return move;
  }
  return null;
}

function maybeHarChangeState(oldState: HarState, canJump: boolean, act: string): HarState {
  let state: HarState = HarState.NONE;
  switch (act) {
    case '1': state = HarState.CROUCHBLOCK; break;
    case '2': state = HarState.CROUCHING; break;
    case '3': state = HarState.CROUCHING; break;
    case '5': state = HarState.STANDING; break;
    case '4': state = HarState.WALKFROM; break;
    case '6': state = HarState.WALKTO; break;
    case '7': case '8': case '9':
      if (canJump) state = HarState.JUMPING;
      break;
    default: state = HarState.STANDING;
  }
  return oldState !== state ? state : HarState.NONE;
}

export function harAct(obj: GameObject, actType: number): number {
  const h = harData(obj);
  const gs = obj.gs;
  const enemyObj = enemyOf(obj);
  const enemyHar = harData(enemyObj);
  if (isHarIdleGrounded(obj) && obj.distance(enemyObj) > 4) harFaceEnemy(obj, enemyObj);
  const direction = obj.direction;
  const inputChanged = addInput(h.inputs, actType);
  const staleness = (gs.tick - h.inputChangeTick) >>> 0;
  if (inputChanged) {
    h.inputChangeTick = gs.tick;
    h.lastInput = flipInput(h.inputs[0], obj.direction);
  }
  if (h.jumpDelay) {
    h.jumpDelay--;
    h.inputChangeTick = gs.tick;
  }
  if (obj.halt) return 0;
  const arena = arenaOf(gs);
  if (arena && arena.arenaGetState() === ARENA_STATE_STARTING) return 0;
  if (actType & ACT_KICK) h.kickValid = INPUT_BUFFER_TICKS;
  else if (actType & ACT_PUNCH) h.punchValid = INPUT_BUFFER_TICKS;
  if (h.endurance < 0) {
    if (h.kickValid || h.punchValid) {
      h.endurance += 512;
      h.kickValid = 0;
      h.punchValid = 0;
    }
    return 0;
  }
  let truncated: string[];
  if (staleness > 9) truncated = [flipInput(h.inputs[0], direction)];
  else truncated = h.inputs.map((c) => flipInput(c, direction));
  let move = matchMove(obj, truncated);
  if (obj.frameIsSet(Tag.JN) && obj.frameIsSet(Tag.CW) && enemyHar.state === HarState.WALLDAMAGE) move = afGetMove(h.afData, obj.frameGet(Tag.JN));
  if (gs.getPlayer(h.playerId).ezDestruct && !move && (h.state === HarState.VICTORY || h.state === HarState.SCRAP)) move = scrapDestructionCheat(obj);
  if (move) {
    clearRehits(h);
    if (h.state === HarState.WALKTO || h.state === HarState.WALKFROM) h.state = HarState.STANDING;
    harSetAni(obj, move.id, false);
    h.executingMove = 1;
    if (move.category === CAT_SCRAP || move.category === CAT_DESTRUCTION) {
      obj.horizontalVelocityModifier = 1;
      obj.verticalVelocityModifier = 1;
      obj.gravity = h.afData.fallSpeed;
      enemyObj.gravity = enemyHar.afData.fallSpeed;
    }
    if (move.category === CAT_SCRAP) {
      h.state = HarState.SCRAP;
      ev(h, gs, HarEventType.SCRAP);
    } else if (move.category === CAT_DESTRUCTION) {
      h.state = HarState.DESTRUCTION;
      ev(h, gs, HarEventType.DESTRUCTION);
    } else {
      ev(h, gs, HarEventType.ATTACK, { move });
    }
    if (h.state === HarState.NONE) {
      if (move.category === CAT_HIGH || move.category === CAT_MEDIUM || move.category === CAT_CLOSE) h.state = HarState.STANDING;
      else if (move.category === CAT_LOW) h.state = HarState.CROUCHING;
    }
    return 1;
  }
  if (h.executingMove) {
    if (obj.posY < ARENA_FLOOR && h.state < HarState.JUMPING) h.state = HarState.JUMPING;
    return 0;
  }
  const lastInput = getLastInput(obj);
  if (obj.isAirborne()) {
    if (h.state === HarState.NONE) h.state = HarState.JUMPING;
    if (lastInput === '4' || lastInput === '6' || lastInput === '1' || lastInput === '3') {
      if (obj.px() > enemyObj.px()) {
        if (direction !== OBJECT_FACE_LEFT) {
          ev(h, gs, HarEventType.AIR_TURN);
          return 1;
        }
      } else if (direction !== OBJECT_FACE_RIGHT) {
        ev(h, gs, HarEventType.AIR_TURN);
        return 1;
      }
    }
    return 0;
  }
  if (!(isHarIdleGrounded(obj) || isHarIdleAir(obj))) return 0;
  const newState = maybeHarChangeState(h.state, !h.jumpDelay, lastInput);
  if (newState) {
    h.state = newState;
    switch (newState) {
      case HarState.CROUCHBLOCK:
      case HarState.CROUCHING:
        harSetAni(obj, ANIM_CROUCHING, true);
        obj.setVel(0, 0);
        break;
      case HarState.STANDING:
        harSetAni(obj, ANIM_IDLE, true);
        obj.setStride(h.stride);
        obj.setVel(0, 0);
        break;
      case HarState.WALKTO:
        harSetAni(obj, ANIM_WALKING, true);
        obj.setStride(h.stride);
        ev(h, gs, HarEventType.WALK, { direction: 1 });
        break;
      case HarState.WALKFROM:
        harSetAni(obj, ANIM_WALKING, true);
        obj.setStride(h.stride);
        ev(h, gs, HarEventType.WALK, { direction: -1 });
        break;
      case HarState.JUMPING: {
        harSetAni(obj, ANIM_JUMPING, false);
        let vx = 0;
        let vy = h.jumpSpeed;
        let jumpDir = 0;
        if (lastInput === '9') {
          vx = h.fwdSpeed * direction;
          obj.setTickPos(110);
          obj.setStride(7);
          jumpDir = 1;
        } else if (lastInput === '7') {
          obj.setPlaybackDirection(PLAY_BACKWARDS);
          obj.setTickPos(-110);
          vx = h.backSpeed * direction * -1;
          obj.setStride(7);
          jumpDir = -1;
        } else if (lastInput === '8') {
          obj.setTickPos(110);
          if (h.id === HarId.GARGOYLE) obj.setStride(7);
        }
        if (staleness <= 6 && (h.inputs[1] === '1' || h.inputs[1] === '2' || h.inputs[1] === '3')) vy = h.superjumpSpeed;
        obj.setVel(vx, vy);
        ev(h, gs, HarEventType.JUMP, { direction: jumpDir });
        break;
      }
    }
    return 1;
  }
  return 0;
}

export function harFaceEnemy(obj: GameObject, enemy: GameObject): void {
  const h = harData(obj);
  if (h.inStasisTicks > 0) return;
  const nf = obj.px() > enemy.px() ? OBJECT_FACE_LEFT : OBJECT_FACE_RIGHT;
  if (obj.direction !== nf) obj.direction = nf;
}

export function harFinished(obj: GameObject): void {
  const h = harData(obj);
  const gs = obj.gs;
  h.executingMove = 0;
  if (h.blockDuration && (h.state === HarState.BLOCKSTUN || h.state === HarState.CROUCHBLOCK)) {
    obj.setCustomString('A1');
    obj.dynamicTick();
    h.blockDuration--;
  } else if (h.state === HarState.SCRAP || h.state === HarState.DESTRUCTION) {
    h.state = HarState.DONE;
    harSetAni(obj, ANIM_VICTORY, false);
    ev(h, gs, HarEventType.DONE);
  } else if (h.state === HarState.VICTORY || h.state === HarState.DONE) {
    obj.setFinished(false);
    if (obj.curAnimation!.id !== ANIM_VICTORY) {
      harSetAni(obj, ANIM_IDLE, true);
      return;
    }
  } else if (h.state === HarState.RECOIL && h.health <= 0) {
    h.state = HarState.DEFEAT;
    harSetAni(obj, h.customDefeatAnimation ? h.customDefeatAnimation : ANIM_DEFEAT, false);
  } else if (h.state === HarState.RECOIL && obj.playerLastFrameLetter() === 'M') {
    ev(h, gs, HarEventType.RECOVER);
    h.state = HarState.STANDING_UP;
    obj.setCustomString('zzO7-bj2zzO2');
  } else if ((h.state === HarState.RECOIL || h.state === HarState.STANDING_UP) && (h.endurance >= h.enduranceMax || h.endurance < 0)) {
    if (h.state === HarState.RECOIL) ev(h, gs, HarEventType.RECOVER);
    if (h.endurance >= h.enduranceMax) h.endurance = Math.trunc(((Math.trunc((h.endurance - h.enduranceMax) / 256) * -2.5) - 60) * 256);
    h.state = HarState.STUNNED;
    harSetAni(obj, ANIM_STUNNED, true);
    ev(h, gs, HarEventType.STUN);
    const enemy = enemyOf(obj);
    ev(harData(enemy), gs, HarEventType.ENEMY_STUN);
  } else if (h.state !== HarState.CROUCHING && h.state !== HarState.CROUCHBLOCK) {
    if (obj.isAirborne() && h.state === HarState.RECOIL) {
      if (h.health <= 0 || h.endurance <= 0) {
        obj.setFinished(false);
      } else {
        h.state = HarState.JUMPING;
        harSetAni(obj, ANIM_JUMPING, false);
      }
    } else if (h.state === HarState.RECOIL) {
      ev(h, gs, HarEventType.RECOVER);
      h.state = HarState.STANDING;
      harSetAni(obj, ANIM_IDLE, true);
      harAct(obj, ACT_NONE);
    } else if (obj.isAirborne()) {
      h.state = HarState.JUMPING;
      harSetAni(obj, ANIM_JUMPING, false);
    } else if (h.health <= 0) {
      h.state = HarState.DEFEAT;
      harSetAni(obj, h.customDefeatAnimation ? h.customDefeatAnimation : ANIM_DEFEAT, false);
    } else {
      h.airAttacked = 0;
      h.state = HarState.NONE;
      harSetAni(obj, ANIM_IDLE, true);
      harAct(obj, ACT_NONE);
    }
  } else {
    h.state = HarState.NONE;
    harSetAni(obj, ANIM_CROUCHING, true);
    harAct(obj, ACT_NONE);
  }
}

// ---------------------------------------------------------------------------
// Creation

export function harCreate(obj: GameObject, afData: Af, dir: number, harId: number, pilotId: number, playerId: number): void {
  const gs = obj.gs;
  const gp = gs.getPlayer(playerId);
  const pilot = gp.pilot;
  let power = gs.matchSettings.power2;
  if (playerId === 1) power = gs.matchSettings.power1;
  let jumpMultiplier = 1.0;
  let vitalityMultiplier = 1.0;
  let powerMultiplier = 1.0;
  let enduranceMax: number;
  let stunFactor: number;
  if (!gs.isTournament()) {
    jumpMultiplier = gs.matchSettings.jumpHeight / 100.0;
    vitalityMultiplier = gs.matchSettings.vitality / 100.0;
    powerMultiplier = 2.25 - 0.25 * power;
    enduranceMax = Math.trunc((afData.endurance * 3.6 * (pilot.endurance + 16)) / 23);
    stunFactor = Math.trunc((1.2 * 256 * (pilot.endurance + 30)) / 40);
  } else {
    enduranceMax = Math.trunc((afData.endurance * 3.6 * (pilot.endurance + 25)) / 37);
    enduranceMax = Math.trunc((enduranceMax * (pilot.stunResistance + 2)) / 3);
    stunFactor = Math.trunc(((pilot.stunResistance + 3.0) * 0.2 * 0.9 * 256.0 * (pilot.endurance + 30)) / 40);
  }
  const health = Math.trunc(Math.trunc((afData.health * (pilot.endurance + 25)) / 35) * 1.1 * powerMultiplier * vitalityMultiplier);
  const agility = pilot.agility;
  obj.horizontalVelocityModifier = Math.fround((agility + 35) / 45);
  obj.verticalVelocityModifier = Math.fround((agility + 20) / 30);
  const local: Har = {
    kind: 'har',
    id: harId,
    playerId,
    pilotId,
    state: HarState.STANDING,
    executingMove: 0,
    close: 0,
    afData,
    damageDone: 0,
    damageReceived: 0,
    airAttacked: 0,
    isWallhugging: 0,
    isGrabbed: 0,
    jumpDelay: 0,
    lastDamageValue: 0,
    lastStunValue: 0,
    punchValid: 0,
    kickValid: 0,
    jumpSpeed: Math.fround((((agility + 35) / 45) * afData.jumpSpeed * jumpMultiplier * 216) / 256),
    superjumpSpeed: Math.fround((((agility + 35) / 45) * afData.jumpSpeed * jumpMultiplier * 266) / 256),
    fallSpeed: Math.fround(((agility + 20) / 30) * afData.fallSpeed),
    fwdSpeed: Math.fround(((agility + 20) / 30) * afData.forwardSpeed),
    backSpeed: Math.fround(((agility + 20) / 30) * afData.reverseSpeed),
    inStasisTicks: 0,
    throwDuration: 0,
    blockDuration: 0,
    cornerpushVelApplied: false,
    cornerpushEnabled: false,
    lastHitRawDamage: 0,
    height: HEIGHT_STANDING,
    stride: Math.trunc((agility + 20) / 30),
    stunFactor,
    healthMax: health,
    health,
    enduranceMax,
    endurance: 0,
    inputs: new Array(10).fill('5'),
    inputChangeTick: 0,
    lastInput: '5',
    stunTimer: 0,
    pPalRef: 0,
    pHarSwitch: 0,
    pFadeOutTicks: 0,
    pFadeOutTicksLeft: 0,
    pFadeInTicks: 0,
    pFadeInTicksLeft: 0,
    pSustainTicksLeft: 0,
    pColorFn: 0,
    walkDestination: -1,
    walkDoneAnim: 0,
    walkDoneTick: 0,
    customDefeatAnimation: 0,
    rehits: [],
    rehitCombo: false,
    hooks: [],
    disabledAnimations: new Map(),
    trailCache: new Map(),
  };
  obj.userdata = local;
  obj.group = GROUP_HAR;
  obj.palOffset = playerId * 48;
  obj.palLimit = (playerId + 1) * 48;
  obj.gravity = local.fallSpeed;
  obj.layers = LAYER_HAR | (playerId === 0 ? LAYER_HAR1 : LAYER_HAR2);
  obj.direction = dir;
  obj.setRepeat(true);
  obj.soundTranslationTable = afData.soundTranslationTable;
  obj.castShadow = true;
  obj.animationState.spawn = (p, id, x, y, vx, vy, mp, s, g) => cbHarSpawnObject(obj, p, id, x, y, vx, vy, mp, s, g);
  obj.animationState.destroy = (p, id) => cbHarDestroyObject(obj, p, id);
  obj.animationState.disable = (_p, id, t) => cbHarDisableAnimation(obj, id, t);
  harSetAni(obj, ANIM_IDLE, true);
  obj.setStride(local.stride);
  obj.onAct = harAct;
  obj.onDynamicTick = harTick;
  obj.onMove = harMove;
  obj.onCollide = harCollideCallback;
  obj.onFinish = harFinished;
  obj.addAnimationEffects(EFFECT_HAR_QUIRKS);

  // Pick animation string variants (hyper mode, enhancements, tournament arm/leg speed).
  const fightMode = gs.matchSettings.fightMode;
  for (let i = 0; i < afData.moves.length; i++) {
    const move = afData.moves[i];
    if (!move) continue;
    let extraIndex = fightMode ? 1 : 0;
    const extraCount = move.ani.extraStrings.length;
    if (extraCount > 0 && move.extraStringSelector !== ESS_ARM_SPEED && move.extraStringSelector !== ESS_LEG_SPEED) {
      const enh = pilot.enhancements[harId] ?? 0;
      if (enh > 0) {
        const es = Math.min(1 + enh, extraCount - 1);
        if (es >= 2) extraIndex = es;
      }
      const s = move.ani.extraStrings[extraIndex];
      if (s && s.length !== 0 && s !== '!') move.ani.animationString = s;
    }
    if (gs.isTournament()) {
      if (move.extraStringSelector === ESS_ARM_SPEED && extraCount > 0) {
        move.ani.animationString = move.ani.extraStrings[Math.min(pilot.armSpeed, extraCount - 1)];
      } else if (move.extraStringSelector === ESS_LEG_SPEED && extraCount > 0) {
        move.ani.animationString = move.ani.extraStrings[Math.min(pilot.legSpeed, extraCount - 1)];
      }
    }
    if (move.ani.animationString === 'A1') move.moveString = '!';
    if (move.posConstraints & POS_IN_ARENA3) move.moveString = '!';
  }
}

export function harReset(obj: GameObject): void {
  const h = harData(obj);
  obj.gravity = h.fallSpeed;
  h.close = 0;
  h.state = HarState.STANDING;
  h.executingMove = 0;
  h.airAttacked = 0;
  h.isWallhugging = 0;
  h.isGrabbed = 0;
  h.jumpDelay = 0;
  h.health = h.healthMax;
  h.endurance = 0;
  h.inStasisTicks = 0;
  h.throwDuration = 0;
  h.walkDestination = -1;
  h.walkDoneAnim = 0;
  harSetAni(obj, ANIM_IDLE, true);
  obj.setStride(h.stride);
}

export function harHealthPercent(h: Har): number {
  return Math.trunc((100 * h.health) / h.healthMax);
}

export { RSprite };
