// Game object with its animation-string player (port of the reference object + player modules).
import type { Palette } from '../formats/palette';
import type { Animation } from '../resources/animation';
import type { Surface } from '../video/surface';
import { getScript, ScriptReader, type ScriptFrame } from '../script/script';
import { Tag } from '../script/tags';
import { drawList, FLIP_HORIZONTAL, FLIP_NONE, FLIP_VERTICAL, SPRITE_DARK_TINT, SPRITE_HAR_QUIRKS, SPRITE_INDEX_ADD, SPRITE_REMAP, SPRITE_SHADOW, video } from '../video/draw';
import { paletteMixRange, paletteTintRange } from '../video/vga';
import { color6to8 } from '../formats/palette';
import {
  ANIM_DAMAGE, ANIM_JUMPING, ANIM_STANDING_BLOCK, ANIM_CROUCHING_BLOCK, ANIM_STANDUP, ARENA_FLOOR, ARENA_LEFT_WALL, ARENA_RIGHT_WALL,
  EFFECT_ADD, EFFECT_DARK_TINT, EFFECT_GLOW, EFFECT_HAR_QUIRKS, EFFECT_NONE, EFFECT_SATURATE, EFFECT_SHADOW, EFFECT_STASIS,
  EFFECT_TRAIL, GROUP_HAR, GROUP_UNKNOWN, HarState, JUMP_COORD_ADJUSTMENT, OBJECT_DEFAULT_LAYER, OBJECT_FACE_LEFT, OBJECT_FACE_RIGHT,
  OBJECT_FLAGS_MC, OBJECT_FLAGS_NEXT_ANIM_ON_ENEMY_HIT, OBJECT_FLAGS_NEXT_ANIM_ON_OWNER_HIT, PLAY_BACKWARDS, PLAY_FORWARDS, PSM_ORDER,
} from './constants';
import type { GameState } from './gameState';
import { SOUND_CHANNEL_COUNT, defaultSoundOpts, type SoundOpts } from '../audio/soundOpts';
import { clamp } from '../util/random';
import { harFaceEnemy, harSetAni, harWalkTo, type Har } from './objects/har';

export const enum AnimPhase {
  HOLD = 0,
  RUNNING,
  FINISHED,
}

export type SpawnCb = (parent: GameObject, id: number, x: number, y: number, vx: number, vy: number, mpFlags: number, s: number, g: number) => void;
export type DestroyCb = (parent: GameObject, id: number) => void;
export type DisableCb = (parent: GameObject, id: number, ticks: number) => void;

export class SpriteState {
  flipmode = FLIP_NONE;
  timer = 0;
  duration = 0;
  screenShakeHorizontal = 0;
  screenShakeVertical = 0;
  oCorrectionX = 0;
  oCorrectionY = 0;
  disableGravity = 0;
  blendStart = 0xff;
  blendFinish = 0xff;
  palRefIndex = 0;
  palEntryCount = 0;
  palStartIndex = 0;
  palBegin = 0;
  palEnd = 0;
  palTint = 0;
  palTricksOff = false;
  bdFlag = false;

  clear(): void {
    this.flipmode = FLIP_NONE;
    this.timer = 0;
    this.duration = 0;
    this.screenShakeHorizontal = 0;
    this.screenShakeVertical = 0;
    this.oCorrectionX = 0;
    this.oCorrectionY = 0;
    this.disableGravity = 0;
    this.blendStart = 0xff;
    this.blendFinish = 0xff;
    this.palRefIndex = 0;
    this.palEntryCount = 0;
    this.palStartIndex = 0;
    this.palBegin = 0;
    this.palEnd = 0;
    this.palTint = 0;
    this.palTricksOff = false;
    this.bdFlag = false;
  }
}

export class AnimationState {
  enteredFrame = false;
  reader = new ScriptReader();
  phase = AnimPhase.HOLD;
  repeat = false;
  reverse = false;
  disableD = false;
  shadowCornerHack = false;
  looping = false;
  pendingApply = false;
  fromSpawn = false;
  palCopyEntries = 0;
  palCopyStart = 0;
  palCopyCount = 0;
  enemyObjId = 0;
  spawn: SpawnCb | null = null;
  destroy: DestroyCb | null = null;
  disable: DisableCb | null = null;
}

let nextObjectId = 1;

export class GameObject {
  id = nextObjectId++;
  gs: GameState;
  startX: number;
  startY: number;
  posX: number;
  posY: number;
  /** Position at the start of the current game tick (motion interpolation); NaN when unknown. */
  prevPosX = NaN;
  prevPosY = NaN;
  velX: number;
  velY: number;
  cvelX = 0;
  cvelY = 0;
  verticalVelocityModifier = 1;
  horizontalVelocityModifier = 1;
  direction = OBJECT_FACE_RIGHT;
  group = GROUP_UNKNOWN;
  wallCollision = false;
  hitPixelsDisabled = false;
  crossupProtection = false;
  shouldHitpause = false;
  qCounter = 0;
  qVal = 0;
  canHit = 0;
  orbVal = 0;
  xPercent = 1;
  yPercent = 1;
  gravity = 0;
  frameVideoEffects = 0;
  animationVideoEffects = 0;
  objectFlags = 0;
  layers = OBJECT_DEFAULT_LAYER;
  curAnimation: Animation | null = null;
  curSpriteId = -1;
  soundTranslationTable: Uint8Array | null = null;
  spriteOverride = false;
  attachedToId = 0;
  palOffset = 0;
  palLimit = 255;
  halt = 0;
  haltTicks = 0;
  stride = 1;
  castShadow = false;
  /** Drawn as part of the screen overlay (round tokens, portraits, announcements): no world effects on it. */
  hudLayer = false;
  oShadowCorrection = 0;
  spriteState = new SpriteState();
  animationState = new AnimationState();
  slideVelX = 0;
  slideVelY = 0;
  slideTimer = 0;
  age = 0;
  /** Type-specific data (Har, projectile data, Bk for hazards, ...). */
  userdata: unknown = null;

  // Callbacks
  onFree: ((o: GameObject) => void) | null = null;
  onAct: ((o: GameObject, action: number) => number) | null = null;
  onStaticTick: ((o: GameObject) => void) | null = null;
  onDynamicTick: ((o: GameObject) => void) | null = null;
  onCollide: ((a: GameObject, b: GameObject) => void) | null = null;
  onFinish: ((o: GameObject) => void) | null = null;
  onMove: ((o: GameObject) => void) | null = null;
  paletteTransform: ((pal: Palette, o: GameObject) => void) | null = null;

  constructor(gs: GameState, x: number, y: number, vx = 0, vy = 0) {
    this.gs = gs;
    this.posX = x;
    this.posY = y;
    this.startX = x;
    this.startY = y;
    this.velX = vx;
    this.velY = vy;
  }

  // ---- simple accessors -----------------------------------------------------
  px(): number {
    return Math.trunc(this.posX);
  }
  py(): number {
    return Math.trunc(this.posY);
  }
  setPos(x: number, y: number): void {
    this.posX = Math.trunc(x);
    this.posY = Math.trunc(y);
  }
  setVel(x: number, y: number): void {
    this.velX = x;
    this.velY = y;
  }
  hasEffect(e: number): boolean {
    return (this.animationVideoEffects & e) !== 0 || (this.frameVideoEffects & e) !== 0;
  }
  addAnimationEffects(e: number): void {
    this.animationVideoEffects |= e;
  }
  delAnimationEffects(e: number): void {
    this.animationVideoEffects &= ~e;
  }
  setAnimationEffects(e: number): void {
    this.animationVideoEffects = e;
  }
  setHaltTicks(t: number): void {
    this.halt = t > 0 ? 1 : 0;
    this.haltTicks = t;
  }
  setHalt(h: number): void {
    this.halt = h;
    this.haltTicks = h === 0 ? 0 : this.haltTicks;
  }
  setStride(s: number): void {
    this.stride = s < 1 ? 1 : s;
  }
  setPlaybackDirection(dir: number): void {
    this.animationState.reverse = dir === PLAY_BACKWARDS;
    if (dir !== PLAY_FORWARDS && dir !== PLAY_BACKWARDS) this.animationState.reverse = false;
  }
  setRepeat(r: boolean | number): void {
    this.animationState.repeat = !!r;
  }
  getRepeat(): boolean {
    return this.animationState.repeat;
  }
  isFinished(): boolean {
    return this.animationState.phase === AnimPhase.FINISHED;
  }
  setFinished(f: boolean): void {
    if (f) this.animationState.phase = AnimPhase.FINISHED;
    else if (this.animationState.phase === AnimPhase.FINISHED) this.animationState.phase = AnimPhase.RUNNING;
  }
  disableRewindTag(d: boolean): void {
    this.animationState.disableD = d;
  }
  isRewindTagDisabled(): boolean {
    return this.animationState.disableD;
  }
  setSpriteOverride(o: boolean): void {
    this.spriteOverride = o;
  }
  attachTo(o: GameObject): void {
    this.attachedToId = o.id;
  }
  setShadowCorrectionY(v: number): void {
    this.oShadowCorrection = v;
    if (v === 0) this.castShadow = false;
  }

  /** Width/height of the current sprite. */
  size(): [number, number] {
    const sp = this.curAnimation?.getSprite(this.curSpriteId);
    return sp ? [sp.width(), sp.height()] : [0, 0];
  }

  isAirborne(): boolean {
    return this.posY < ARENA_FLOOR || this.velY < 0 || this.frameIsSet(Tag.UG);
  }

  distance(b: GameObject): number {
    return Math.hypot(this.posX - b.posX, this.posY - b.posY);
  }

  // ---- animation control ----------------------------------------------------
  setAnimation(ani: Animation): void {
    this.curAnimation = ani;
    this.playerReload();
  }

  setCustomString(str: string): void {
    this.playerReloadWithStr(str);
  }

  selectSprite(id: number): void {
    if (this.spriteOverride) return;
    if (id < 0) {
      this.curSpriteId = -1;
    } else if (this.curAnimation?.getSprite(id)) {
      this.curSpriteId = id;
      this.spriteState.flipmode = FLIP_NONE;
    } else {
      this.curSpriteId = -1;
    }
  }

  setTickPos(tick: number): void {
    if (this.curAnimation && this.halt === 0) {
      this.playerJumpToTick(tick < 0 ? this.playerLenTicks() + tick : tick);
    }
  }

  // ---- player (animation string interpreter) ---------------------------------
  private clearFrame(): void {
    this.spriteState.clear();
  }

  playerReloadWithStr(str: string): void {
    this.animationState.reader.load(getScript(str));
    this.playerReset();
    this.animationState.reverse = false;
    this.slideTimer = 0;
    this.slideVelX = 0;
    this.slideVelY = 0;
    this.qCounter = 0;
    this.qVal = 0;
    this.canHit = 0;
  }

  playerReload(): void {
    this.playerReloadWithStr(this.curAnimation!.animationString);
  }

  playerReset(): void {
    this.animationState.reader.reset();
    this.animationState.phase = AnimPhase.HOLD;
    this.animationState.disableD = false;
    this.animationState.pendingApply = false;
  }

  frameIsSet(tag: Tag): boolean {
    return this.animationState.reader.isSet(tag);
  }

  frameGet(tag: Tag): number {
    return this.animationState.reader.get(tag);
  }

  playerJumpToTick(tick: number): void {
    this.animationState.reader.markPrevious();
    this.animationState.reader.seek(tick);
  }

  playerInitSpawned(): void {
    this.animationState.fromSpawn = true;
    this.animationState.reader.reset();
    this.animationState.reader.seek(1);
  }

  playerLenTicks(): number {
    return this.animationState.reader.script?.totalTicks ?? 0;
  }

  playerCurrentTick(): number {
    return this.animationState.reader.tick;
  }

  playerNextFrame(): void {
    const r = this.animationState.reader;
    const s = r.script!;
    const idx = s.frameIndexAt(r.tick);
    r.seek(s.tickPosAtFrame(idx + 1));
    r.markEntered();
  }

  playerGotoFrame(frameId: number): void {
    const r = this.animationState.reader;
    r.seek(r.script!.tickPosAtFrame(frameId));
    r.markEntered();
  }

  playerLastFrameLetter(): string {
    const s = this.animationState.reader.script;
    return String.fromCharCode(65 + (s ? s.lastFrameSprite() : 0));
  }

  playerIsLooping(): boolean {
    return this.animationState.looping;
  }

  playerRun(): void {
    this.playerRunAdvance();
    if (this.animationState.pendingApply) this.playerRunApply();
  }

  playerRunAdvance(): void {
    const state = this.animationState;
    state.pendingApply = false;
    if (state.phase === AnimPhase.FINISHED) return;
    const reader = state.reader;
    const script = reader.script;
    if (state.phase === AnimPhase.HOLD) {
      state.phase = AnimPhase.RUNNING;
      const f = reader.frame();
      if (f) this.selectSprite(f.sprite);
      state.pendingApply = true;
      return;
    }
    let frame = reader.frame();
    reader.markPrevious();
    if (frame && frame.has(Tag.D) && !state.disableD) {
      const tv = frame.get(Tag.D);
      if (tv >= 0) {
        reader.seek(tv + 1);
        state.looping = true;
      } else {
        reader.seek((script?.totalTicks ?? 0) + tv);
      }
    } else {
      reader.advance(state.reverse ? -1 : 1);
    }
    frame = reader.frame();
    if (!frame) {
      if (state.repeat) {
        this.playerReset();
        state.phase = AnimPhase.RUNNING;
        frame = reader.frame();
      } else {
        state.phase = AnimPhase.FINISHED;
        if (this.onFinish) this.onFinish(this);
        if (state.phase === AnimPhase.FINISHED) this.curSpriteId = -1;
        return;
      }
    }
    if (!frame) return;
    if (reader.frameChanged()) this.selectSprite(frame.sprite);
    state.pendingApply = true;
  }

  playerRunApply(): void {
    const state = this.animationState;
    const rstate = this.spriteState;
    const gs = this.gs;
    const enemy = gs.findObject(state.enemyObjId);
    state.pendingApply = false;
    if (state.phase === AnimPhase.FINISHED) return;
    const script = state.reader.script;
    const frame = state.reader.frame();
    if (!frame || !script) return;

    const mp = frame.has(Tag.MP) ? frame.get(Tag.MP) & 0xff : 0;
    if (frame.has(Tag.E) && enemy && !frame.has(Tag.AM)) {
      this.velX = 0;
      this.velY = 0;
      this.posX = enemy.posX;
      this.posY = enemy.posY;
      this.direction = enemy.direction * -1;
    }
    if (enemy) enemy.crossupProtection = frame.has(Tag.AG);
    if (frame.has(Tag.AR)) this.direction *= -1;
    this.wallCollision = false;

    let transX = 0;
    let transY = 0;
    if (frame.has(Tag.Y_MINUS)) transY = -frame.get(Tag.Y_MINUS);
    else if (frame.has(Tag.Y_PLUS)) transY = frame.get(Tag.Y_PLUS);
    if (frame.has(Tag.X_MINUS)) transX = -frame.get(Tag.X_MINUS) * this.direction;
    else if (frame.has(Tag.X_PLUS)) transX = frame.get(Tag.X_PLUS) * this.direction;

    state.enteredFrame = state.reader.frameChanged();
    if (state.enteredFrame) {
      this.clearFrame();
      if (frame.has(Tag.AC)) this.direction = this.posX > 160 ? OBJECT_FACE_LEFT : OBJECT_FACE_RIGHT;
      this.hitPixelsDisabled = frame.has(Tag.N);
      if (frame.has(Tag.BJ)) {
        const newAni = frame.get(Tag.BJ);
        harSetAni(this, newAni, false);
        if (newAni === ANIM_STANDUP && enemy) harFaceEnemy(this, enemy);
        return;
      }
      if (frame.has(Tag.MC)) this.objectFlags |= OBJECT_FLAGS_MC;
      if (frame.has(Tag.UD)) this.objectFlags |= OBJECT_FLAGS_NEXT_ANIM_ON_OWNER_HIT;
      if (frame.has(Tag.UZ)) this.objectFlags |= OBJECT_FLAGS_NEXT_ANIM_ON_ENEMY_HIT;
      if (frame.has(Tag.CP) && this.shouldHitpause) {
        this.shouldHitpause = false;
        gs.hitPause();
      }
      if (frame.has(Tag.MU)) {
        let mm = 0;
        for (const t of frame.tags) {
          if (t.key === Tag.MM) mm = t.value;
          else if (t.key === Tag.MU && mm) {
            if (this.curAnimation!.id === 9) {
              if (enemy) enemy.disableAnimation(mm, t.value);
            } else {
              this.disableAnimation(mm, t.value);
            }
          }
        }
      }
      if (frame.has(Tag.BM) && enemy) {
        let destination = 160;
        if (frame.has(Tag.AM) && frame.has(Tag.E)) {
          destination = enemy.posX - transX;
          this.direction = this.posX > enemy.posX ? OBJECT_FACE_LEFT : OBJECT_FACE_RIGHT;
          destination = Math.max(ARENA_LEFT_WALL, Math.min(ARENA_RIGHT_WALL, destination));
        } else if (frame.has(Tag.CF)) {
          destination = enemy.direction === OBJECT_FACE_RIGHT ? ARENA_RIGHT_WALL : ARENA_LEFT_WALL;
          destination += transX;
          // Deviation: clamped like the branch above. Unclamped (as in the reference) the target can lie past a
          // wall (e.g. both HARs facing right after a wall slam), the HAR never arrives and the arena never ends.
          destination = Math.max(ARENA_LEFT_WALL, Math.min(ARENA_RIGHT_WALL, destination));
          this.direction = enemy.direction;
          this.animationState.shadowCornerHack = true;
        } else {
          destination = -1;
        }
        transX = 0;
        if (frame.get(Tag.BM) === 10 && destination > 0 && Math.abs(this.posX - destination) > 5.0) {
          harWalkTo(this, Math.trunc(destination));
          state.phase = AnimPhase.HOLD;
          return;
        }
      }
    }
    if (frame.has(Tag.H)) {
      this.velX = 0;
      this.velY = 0;
      this.cvelX = 0;
      this.cvelY = 0;
    }
    const abFlag = frame.has(Tag.AB);
    if (frame.has(Tag.G)) {
      this.velY = 0;
      this.posY = ARENA_FLOOR;
    }
    if (frame.has(Tag.AD)) {
      const h = this.userdata as Har;
      let newFacing = this.direction;
      switch (h.inputs[0]) {
        case '4': case '7': case '1':
          newFacing = OBJECT_FACE_LEFT;
          break;
        case '6': case '9': case '3':
          newFacing = OBJECT_FACE_RIGHT;
          break;
      }
      if (this.direction !== newFacing) {
        this.direction = newFacing;
        this.velX *= -1;
        transX *= -1;
      }
    }
    if (frame.has(Tag.AT) && enemy) {
      const h = this.userdata as Har;
      switch (h.inputs[0]) {
        case '6':
          this.posX = ARENA_RIGHT_WALL - gs.rand.int(30);
          break;
        case '4':
          this.posX = ARENA_LEFT_WALL + gs.rand.int(30);
          break;
        default:
          this.posX = this.posX > enemy.posX ? enemy.posX - 40 : enemy.posX + 40;
      }
    }
    if (transX || transY) {
      if (frame.has(Tag.V)) {
        this.velX = transX * (mp & 0x20 ? -1 : 1) * this.horizontalVelocityModifier;
        this.velY = transY * this.horizontalVelocityModifier;
      } else {
        this.posX += transX * (mp & 0x20 ? -1 : 1);
        if (!abFlag) {
          if (this.posX < ARENA_LEFT_WALL && this.group === GROUP_HAR) {
            if (frame.has(Tag.E) && enemy) enemy.posX += ARENA_LEFT_WALL - this.posX;
            this.posX = ARENA_LEFT_WALL;
            this.wallCollision = true;
          } else if (this.posX > ARENA_RIGHT_WALL && this.group === GROUP_HAR) {
            if (frame.has(Tag.E) && enemy) enemy.posX -= this.posX - ARENA_RIGHT_WALL;
            this.posX = ARENA_RIGHT_WALL;
            this.wallCollision = true;
          }
        }
        this.posY += transY;
      }
    }
    if (this.slideTimer > 0) {
      this.posX += this.slideVelX;
      this.posY += this.slideVelY;
      this.slideTimer--;
    }
    if (this.group === GROUP_HAR && enemy && !abFlag) {
      this.posX = clamp(this.posX, ARENA_LEFT_WALL, ARENA_RIGHT_WALL);
    }

    if (state.enteredFrame && this.applyEnteredFrame(frame, script, enemy, rstate)) return;
    if (frame.has(Tag.AS)) {
      const base = (this.orbVal & 7) + 8;
      const d1 = Math.abs(this.orbVal * 4) + gs.tick;
      const d2 = Math.abs(this.orbVal * 2) + gs.tick;
      let t = Math.sin(base * (d1 * 0.003574533) + this.orbVal * 3.0) * 65.0 + 160.0;
      let t2 = Math.cos(base * (d2 * 0.004974533) + this.orbVal * 4.0) * 65.0;
      this.posX = t + t2;
      t = Math.cos(base * (d2 * 0.005874533) + this.orbVal * 6.0) * 30.0 + 60.0;
      t2 = Math.sin(base * (d1 * 0.004174533) + this.orbVal * 3.0) * 30.0;
      this.posY = t + t2;
      this.velX = 0;
      this.velY = 0;
    }
    if (frame.has(Tag.BU)) {
      if (this.velY < 0) {
        this.velX = (160 - this.posX) / (this.velY * -2);
      } else {
        this.posX = 160;
      }
    }
    if (frame.has(Tag.CG)) {
      this.animationState.disableD = this.posY < ARENA_FLOOR;
      if (this.posY >= ARENA_FLOOR) {
        const h = this.userdata as Har;
        this.posY = ARENA_FLOOR;
        this.velY = 0;
        h.state = HarState.STANDING;
      }
    }
    if (!(frame.has(Tag.D) && !state.disableD)) rstate.timer++;
  }

  /**
   * Frame-entry processing (spawns, sounds, palette effects, ...). Split out for readability.
   * Returns true when the rest of the frame update must be skipped (music stop tag).
   */
  private applyEnteredFrame(frame: ScriptFrame, script: NonNullable<ScriptReader['script']>, enemy: GameObject | null, rstate: SpriteState): boolean {
    const state = this.animationState;
    const gs = this.gs;
    if (frame.has(Tag.M) && state.spawn) {
      let mx = 0, my = 0, vx = 0, vy = 0;
      let instances = 1;
      if (frame.has(Tag.MI)) instances = frame.get(Tag.MI);
      if (frame.has(Tag.MX)) mx = this.startX + frame.get(Tag.MX) * this.direction;
      if (frame.has(Tag.MY)) my = this.startY + frame.get(Tag.MY);
      if (frame.has(Tag.MA)) {
        const ma = frame.get(Tag.MA);
        vx = Math.fround(Math.cos(ma));
        vy = Math.fround(Math.sin(ma));
      }
      const ms = frame.has(Tag.MS) ? 1 : 0;
      const mg = frame.has(Tag.MG) ? frame.get(Tag.MG) : 0;
      for (let i = 0; i < instances; i++) {
        if (frame.has(Tag.MRX)) {
          const mrx = frame.get(Tag.MRX);
          const mm = frame.has(Tag.MM) ? frame.get(Tag.MM) : mrx;
          mx = gs.rand.int(320 - 2 * mm) + mrx;
        }
        if (frame.has(Tag.MRY)) {
          const mry = frame.get(Tag.MRY);
          const mm = frame.has(Tag.MM) ? frame.get(Tag.MM) : mry;
          my = gs.rand.int(320 - 2 * mm) + mry;
        }
        state.spawn(this, frame.get(Tag.M), Math.trunc(mx), Math.trunc(my), vx, vy, mp(frame), ms, mg);
      }
    }
    if (frame.has(Tag.MD) && state.destroy) state.destroy(this, frame.get(Tag.MD));
    if (frame.has(Tag.SMO)) {
      const n = frame.get(Tag.SMO);
      if (n === 0) {
        gs.stopMusic();
        return true;
      }
      gs.playMusic(PSM_ORDER[n - 1] ?? PSM_ORDER[0]);
    }
    if (frame.has(Tag.SMF)) gs.stopMusic();
    if (frame.has(Tag.S) && this.soundTranslationTable) {
      const soundId = this.soundTranslationTable[frame.get(Tag.S)] - 1;
      let allow = true;
      if (frame.has(Tag.T)) {
        const ea = enemy?.curAnimation ? enemy.curAnimation.id : -1;
        allow = ea === ANIM_DAMAGE || ea === ANIM_STANDING_BLOCK || ea === ANIM_CROUCHING_BLOCK || gs.hitPauseTicks > 0;
      }
      const opts: SoundOpts = defaultSoundOpts();
      if (frame.has(Tag.L)) opts.volume = clamp(frame.get(Tag.L) * 2, 0, 127);
      if (frame.has(Tag.SB)) opts.panning = clamp(frame.get(Tag.SB), -100, 100);
      else opts.panning = clamp(Math.trunc(((this.posX - 160) * 100) / 160), -100, 100);
      if (frame.has(Tag.SF)) opts.pitch = frame.get(Tag.SF);
      if (frame.has(Tag.SP)) opts.priority = frame.get(Tag.SP);
      if (frame.has(Tag.SC)) {
        const sc = frame.get(Tag.SC);
        if (sc === 0) opts.stopDuplicate = true;
        else opts.channel = clamp(sc - 1, 0, SOUND_CHANNEL_COUNT - 1);
      }
      if (frame.has(Tag.SD)) opts.skipDuplicate = true;
      if (frame.has(Tag.SA) || (soundId >= 0 && soundId < 10)) opts.followObjectId = this.id;
      if (frame.has(Tag.SL)) {
        opts.panningEnd = clamp(frame.get(Tag.SL), -100, 100);
        opts.hasPanningSweep = true;
      } else if (frame.has(Tag.SE)) {
        opts.panningEnd = clamp(frame.get(Tag.SE), -100, 100);
        opts.hasPanningSweep = true;
      }
      if (allow) gs.playSound(soundId, opts);
    }
    if (frame.has(Tag.BB)) rstate.screenShakeVertical = frame.get(Tag.BB);
    if (frame.has(Tag.BF)) rstate.blendFinish = frame.get(Tag.BF);
    if (frame.has(Tag.BL)) rstate.screenShakeHorizontal = frame.get(Tag.BL);
    if (frame.has(Tag.BS)) rstate.blendStart = frame.get(Tag.BS);
    if (frame.has(Tag.BPD)) rstate.palRefIndex = frame.get(Tag.BPD);
    if (frame.has(Tag.BPN)) rstate.palEntryCount = frame.get(Tag.BPN);
    if (frame.has(Tag.BPS)) rstate.palStartIndex = frame.get(Tag.BPS);
    if (frame.has(Tag.BPF)) {
      if (gs.getPlayer(0).harObjId === this.id) {
        rstate.palStartIndex = 1;
        rstate.palEntryCount = 47;
      } else {
        rstate.palStartIndex = 48;
        rstate.palEntryCount = 48;
      }
    }
    if (frame.has(Tag.BPP)) {
      rstate.palEnd = color6to8(frame.get(Tag.BPP));
      rstate.palBegin = color6to8(frame.get(Tag.BPP));
    }
    if (frame.has(Tag.BPB)) rstate.palBegin = color6to8(frame.get(Tag.BPB));
    if (frame.has(Tag.BZ)) rstate.palTint = 1;
    rstate.palTricksOff = frame.has(Tag.BPO);
    rstate.bdFlag = frame.has(Tag.BD);
    if (frame.has(Tag.BA)) {
      state.palCopyCount = frame.get(Tag.BA);
      state.palCopyStart = frame.get(Tag.BI);
      state.palCopyEntries = frame.get(Tag.BC);
    }
    if (frame.has(Tag.BY)) this.castShadow = false;
    if (frame.has(Tag.BW)) this.castShadow = true;
    rstate.oCorrectionX = frame.has(Tag.OX) ? frame.get(Tag.OX) : 0;
    rstate.oCorrectionY = frame.has(Tag.OY) ? frame.get(Tag.OY) : 0;
    if (frame.has(Tag.BO)) this.setShadowCorrectionY(frame.get(Tag.BO));
    if (frame.has(Tag.UA) && enemy) {
      const h = this.userdata as Har;
      const eh = enemy.userdata as Har;
      if (enemy.curAnimation!.id !== ANIM_DAMAGE) {
        enemy.setAnimation(eh.afData.moves[ANIM_DAMAGE]!.ani);
        eh.state = HarState.RECOIL;
      }
      const move = h.afData.moves[this.curAnimation!.id]!;
      enemy.setCustomString(move.footerString);
      enemy.setRepeat(false);
      enemy.setStride(1);
      enemy.animationState.reader.seek(this.animationState.reader.tick);
    }
    if (frame.has(Tag.Y)) this.yPercent = frame.get(Tag.Y) / 100;
    if (frame.has(Tag.X_EQ) || frame.has(Tag.Y_EQ)) {
      this.velX = 0;
      this.velY = 0;
    }
    const tick = state.reader.tick;
    if (frame.has(Tag.X_EQ)) {
      this.posX = this.startX + frame.get(Tag.X_EQ) * this.direction;
      const fid = script.nextFrameWithTag(Tag.X_EQ, tick);
      if (fid >= 0) {
        const mr = script.tickPosAtFrame(fid);
        const r = mr - tick - frame.tickLen;
        const nextX = script.frame(fid)!.get(Tag.X_EQ);
        const slide = this.startX + nextX * this.direction;
        if (slide !== this.posX) {
          this.slideVelX = (slide - this.posX) / (frame.tickLen + r);
          this.slideTimer = frame.tickLen + r;
        }
      }
    }
    if (frame.has(Tag.Y_EQ)) {
      this.posY = this.startY + frame.get(Tag.Y_EQ);
      const fid = script.nextFrameWithTag(Tag.Y_EQ, tick);
      if (fid >= 0) {
        const mr = script.tickPosAtFrame(fid);
        const r = mr - tick - frame.tickLen;
        const nextY = script.frame(fid)!.get(Tag.Y_EQ);
        const slide = nextY + this.startY;
        if (slide !== this.posY) {
          this.slideVelY = (slide - this.posY) / (frame.tickLen + r);
          this.slideTimer = frame.tickLen + r;
        }
      }
    }
    if (frame.has(Tag.Q)) {
      this.qVal = frame.get(Tag.Q);
      if (this.qVal > this.qCounter) this.canHit = 1;
    }
    let effects = EFFECT_NONE;
    if (frame.has(Tag.BT)) effects |= EFFECT_DARK_TINT;
    if (frame.has(Tag.BR)) effects |= EFFECT_GLOW;
    if (frame.has(Tag.UB)) effects |= EFFECT_TRAIL;
    if (frame.has(Tag.BG)) effects |= EFFECT_ADD;
    this.frameVideoEffects = effects;
    this.selectSprite(frame.sprite);
    if (this.curSpriteId >= 0) {
      rstate.duration = frame.tickLen;
      if (frame.has(Tag.R)) rstate.flipmode ^= FLIP_HORIZONTAL;
      if (frame.has(Tag.F)) rstate.flipmode ^= FLIP_VERTICAL;
    }
    return false;
  }

  disableAnimation(animationId: number, ticks: number): void {
    this.animationState.disable?.(this, animationId, ticks);
  }

  // ---- ticking ---------------------------------------------------------------
  dynamicTickAdvance(): void {
    this.age++;
    if (this.attachedToId !== 0) {
      const at = this.gs.findObject(this.attachedToId);
      if (at) {
        this.setPos(at.posX, at.posY);
        this.direction = at.direction;
      }
    }
    if (this.haltTicks > 0) {
      this.haltTicks--;
      this.halt = this.haltTicks > 0 ? 1 : 0;
    }
    if (this.curAnimation && this.halt === 0) this.playerRunAdvance();
  }

  dynamicTickApply(): void {
    if (this.onDynamicTick) this.onDynamicTick(this);
    const ss = this.spriteState;
    if (ss.screenShakeVertical > 0) {
      this.gs.screenShakeVertical = ss.screenShakeVertical * 4;
      ss.screenShakeVertical = 0;
    }
    if (ss.screenShakeHorizontal > 0) {
      this.gs.screenShakeHorizontal = ss.screenShakeHorizontal * 4;
      ss.screenShakeHorizontal = 0;
    }
    if (!this.curAnimation) return;
    const st = this.animationState;
    if (st.phase === AnimPhase.HOLD && this.halt === 0 && !st.fromSpawn) this.playerRunAdvance();
    if (st.pendingApply) {
      this.playerRunApply();
      for (let i = 1; i < this.stride; i++) {
        this.playerRunAdvance();
        if (st.pendingApply) this.playerRunApply();
      }
    }
  }

  dynamicTick(): void {
    this.dynamicTickAdvance();
    this.dynamicTickApply();
  }

  staticTick(): void {
    if (this.onStaticTick) this.onStaticTick(this);
  }

  move(): void {
    if (this.spriteState.disableGravity) this.setVel(0, 0);
    if (this.onMove) this.onMove(this);
  }

  collide(b: GameObject): void {
    if (this.onCollide) this.onCollide(this, b);
  }

  act(action: number): number {
    return this.onAct ? this.onAct(this, action) : 0;
  }

  free(): void {
    if (this.onFree) this.onFree(this);
    this.curAnimation = null;
  }

  applyControllableVelocity(isProjectile: boolean, input: string): void {
    if (this.frameIsSet(Tag.CX)) {
      let cx = this.frameGet(Tag.CX) / 10;
      if (!isProjectile) cx *= this.horizontalVelocityModifier;
      if (input === '4') this.cvelX -= cx;
      else if (input === '6') this.cvelX += cx;
      else if (input === '3' || input === '9') this.cvelX += cx * 0.7;
      else if (input === '1' || input === '7') this.cvelX -= cx * 0.7;
      if (this.frameIsSet(Tag.CY) && isProjectile) {
        const cy = this.frameGet(Tag.CY) / 10;
        if (input === '8') this.cvelY -= cy;
        else if (input === '2') this.cvelY += cy;
        else if (input === '3' || input === '1') this.cvelY += cy * 0.7;
        else if (input === '7' || input === '9') this.cvelY -= cy * 0.7;
      }
    } else {
      this.cvelX = 0;
      this.cvelY = 0;
    }
  }

  // ---- rendering ---------------------------------------------------------------
  private opacity(): number {
    const rs = this.spriteState;
    let opacity = rs.blendFinish;
    if (rs.duration > 0) {
      const moment = rs.timer / rs.duration;
      const d = (rs.blendFinish - rs.blendStart) * moment;
      opacity = clamp(Math.trunc(rs.blendStart + d), 0, 255);
    }
    return opacity;
  }

  /** Called at the start of every game tick: remembers where the object was drawn from. */
  snapshotPosition(): void {
    this.prevPosX = this.posX;
    this.prevPosY = this.posY;
  }

  /**
   * Motion interpolation offset (remastered renderer): draw between the previous and the current tick position.
   * Big jumps (teleports, resets) are not interpolated.
   */
  private setInterpolationOffset(withY: boolean): void {
    const k = drawList.interpAlpha;
    drawList.subX = 0;
    drawList.subY = 0;
    if (k < 0 || Number.isNaN(this.prevPosX)) return;
    const dx = this.posX - this.prevPosX;
    const dy = this.posY - this.prevPosY;
    if (Math.abs(dx) > 40 || Math.abs(dy) > 40) return;
    drawList.subX = -(1 - k) * dx;
    if (withY) drawList.subY = -(1 - k) * dy;
  }

  render(): void {
    if (this.curSpriteId < 0 || !this.curAnimation) return;
    const sp = this.curAnimation.getSprite(this.curSpriteId);
    if (!sp || !sp.surface) return;
    const surf = sp.surface;
    const rs = this.spriteState;
    const w = Math.trunc(surf.renderW * this.xPercent);
    const h = Math.trunc(surf.renderH * this.yPercent);
    let x: number;
    let y: number;
    if (rs.flipmode & FLIP_VERTICAL) {
      y = Math.trunc(this.posY - (sp.posY - rs.oCorrectionY) * this.yPercent - h);
      if (this.curAnimation.id === ANIM_JUMPING) y -= JUMP_COORD_ADJUSTMENT * 2;
    } else {
      y = Math.trunc(this.posY + (sp.posY + rs.oCorrectionY) * this.yPercent);
    }
    let flip = rs.flipmode;
    if (this.direction === OBJECT_FACE_LEFT) flip ^= FLIP_HORIZONTAL;
    if (flip & FLIP_HORIZONTAL) x = Math.trunc(this.posX - (sp.posX + rs.oCorrectionX) * this.xPercent - w);
    else x = Math.trunc(this.posX + (sp.posX + rs.oCorrectionX) * this.xPercent);
    let opacity = this.opacity();
    let remapOffset = 0;
    let remapRounds = 0;
    let options = 0;
    if (this.hasEffect(EFFECT_GLOW)) {
      remapRounds = 1;
      remapOffset = 3;
      if (this.hasEffect(EFFECT_SATURATE)) remapRounds = 10;
    } else if (this.hasEffect(EFFECT_SHADOW)) {
      remapRounds = 1;
      remapOffset = clamp((opacity * 4) >> 8, 0, 3) - 1;
      opacity = 255;
    } else if (this.hasEffect(EFFECT_DARK_TINT | EFFECT_STASIS)) {
      remapRounds = 0;
      remapOffset = 5;
      options |= SPRITE_REMAP | SPRITE_DARK_TINT;
    } else if (this.hasEffect(EFFECT_ADD)) {
      options |= SPRITE_INDEX_ADD;
    }
    if ((options & SPRITE_REMAP) !== 0 && this.hasEffect(EFFECT_HAR_QUIRKS)) options |= SPRITE_HAR_QUIRKS;
    this.setInterpolationOffset(true);
    video.drawFull(surf, x, y, w, h, remapOffset, remapRounds, this.palOffset, this.palLimit, opacity, flip, options);
    drawList.subX = 0;
    drawList.subY = 0;
  }

  /** Where render() draws the current sprite (native, without motion interpolation), for the remastered effects. */
  renderBounds(): { surf: Surface; x: number; y: number; w: number; h: number } | null {
    if (this.curSpriteId < 0 || !this.curAnimation) return null;
    const sp = this.curAnimation.getSprite(this.curSpriteId);
    if (!sp || !sp.surface) return null;
    const surf = sp.surface;
    const rs = this.spriteState;
    const w = Math.trunc(surf.renderW * this.xPercent);
    const h = Math.trunc(surf.renderH * this.yPercent);
    const y = rs.flipmode & FLIP_VERTICAL
      ? this.posY - (sp.posY - rs.oCorrectionY) * this.yPercent - h
      : this.posY + (sp.posY + rs.oCorrectionY) * this.yPercent;
    let flip = rs.flipmode;
    if (this.direction === OBJECT_FACE_LEFT) flip ^= FLIP_HORIZONTAL;
    const x = flip & FLIP_HORIZONTAL
      ? this.posX - (sp.posX + rs.oCorrectionX) * this.xPercent - w
      : this.posX + (sp.posX + rs.oCorrectionX) * this.xPercent;
    return { surf, x, y, w, h };
  }

  /** Draws a surface of the current sprite's size where the sprite is drawn (e.g. its outline, training hitbox view). */
  renderOver(surf: Surface, palOffset: number): void {
    const b = this.renderBounds();
    if (!b) return;
    let flip = this.spriteState.flipmode;
    if (this.direction === OBJECT_FACE_LEFT) flip ^= FLIP_HORIZONTAL;
    this.setInterpolationOffset(true);
    video.drawFull(surf, Math.trunc(b.x), Math.trunc(b.y), b.w, b.h, 0, 0, palOffset, 255, 255, flip, 0);
    drawList.subX = 0;
    drawList.subY = 0;
  }

  /** Draws with this object's motion interpolation (things placed at its position, e.g. its hit points). */
  renderAt(draw: () => void): void {
    this.setInterpolationOffset(true);
    draw();
    drawList.subX = 0;
    drawList.subY = 0;
  }

  renderShadow(): void {
    if (this.curSpriteId < 0 || !this.castShadow || !this.curAnimation) return;
    const sp = this.curAnimation.getSprite(this.curSpriteId);
    if (!sp || !sp.surface) return;
    // Integer/float mixing mirrors the reference (int += float truncates the sum).
    let x = Math.trunc(this.posX);
    let y = ARENA_FLOOR;
    const w = Math.trunc(sp.surface.renderW * this.xPercent);
    const h = Math.trunc((sp.surface.renderH * this.yPercent) / 4);
    let flip = this.spriteState.flipmode;
    if (this.direction === OBJECT_FACE_LEFT) flip ^= FLIP_HORIZONTAL;
    if (flip & FLIP_HORIZONTAL) x = Math.trunc(x + (-((sp.posX + this.spriteState.oCorrectionX) * this.xPercent) - w));
    else x = Math.trunc(x + (sp.posX + this.spriteState.oCorrectionX) * this.xPercent);
    const opacity = this.opacity();
    const corrY = this.spriteState.oCorrectionY + this.oShadowCorrection;
    y = Math.trunc(y + ((sp.posY + corrY) * this.yPercent) / 4);
    this.setInterpolationOffset(false);
    video.drawFull(sp.surface, x, y, w, h, -1, 1, 0, 0, opacity, flip, SPRITE_SHADOW);
    drawList.subX = 0;
    drawList.subY = 0;
  }

  /** Registers palette transforms for this frame (called before the VGA palette is rebuilt). */
  paletteTransformRegister(): void {
    if (this.paletteTransform) {
      const fn = this.paletteTransform;
      this.gs.enablePaletteTransform((pal) => fn(pal, this));
    }
    const ss = this.spriteState;
    if (ss.palTricksOff) {
      this.gs.enablePaletteTransform((pal) => this.paletteCopyTransform(pal));
    } else if (ss.palEntryCount > 0 && ss.duration > 0) {
      this.gs.enablePaletteTransform((pal) => this.scenewidePaletteTransform(pal));
    }
  }

  private scenewidePaletteTransform(pal: Palette): void {
    const s = this.spriteState;
    const step = s.timer / s.duration;
    const bp = clamp(Math.trunc(s.palBegin + (s.palEnd - s.palBegin) * step), 0, 255);
    const start = s.palStartIndex;
    const end = Math.min(256, s.palStartIndex + s.palEntryCount);
    if (s.palTint) paletteTintRange(pal, s.palRefIndex, start, end, bp);
    else paletteMixRange(pal, s.palRefIndex, start, end, bp);
  }

  private paletteCopyTransform(pal: Palette): void {
    const s = this.spriteState;
    const a = this.animationState;
    const srcStart = a.palCopyStart;
    const srcEnd = a.palCopyEntries + srcStart;
    const step = s.duration > 0 ? s.timer / s.duration : 0;
    const chunk = s.palEnd - s.palBegin;
    const bpp = (s.palBegin + chunk * step) / 255.0;
    const bd = s.bdFlag ? [[80, 80, 80], [164, 164, 164], [255, 255, 255]] : [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const c = pal.colors;
    let pos = srcEnd;
    for (let i = 0; i < a.palCopyCount && i < 3; i++) {
      const ref = bd[i];
      for (let w = srcStart; w < srcEnd; w++) {
        if (pos > 255) return;
        for (let k = 0; k < 3; k++) {
          const src = c[w * 3 + k];
          const d = clamp((ref[k] - src) * bpp, 0, 255);
          c[pos * 3 + k] = clamp(Math.trunc(d + src), 0, 255);
        }
        pos++;
      }
    }
  }
}

function mp(frame: ScriptFrame): number {
  return frame.has(Tag.MP) ? frame.get(Tag.MP) & 0xff : 0;
}

export { GROUP_UNKNOWN };
