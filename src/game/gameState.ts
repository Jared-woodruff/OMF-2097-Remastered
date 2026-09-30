// Central game state: object list, scene switching, ticking, rendering (port of the reference game_state).
import { audio } from '../audio/audio';
import { announce } from '../audio/announcer';
import type { SoundOpts } from '../audio/soundOpts';
import { Controller, type CtrlEvent } from '../controller/controller';
import { KeyboardController, GamepadController, menuPoll, type MenuPollOptions } from '../controller/keyboard';
import type { Palette } from '../formats/palette';
import { Pilot } from '../formats/pilot';
import { drawList, FBUFOPT_CREDITS, TAG_BACKGROUND, TAG_HAR, TAG_HUD, TAG_NONE, video, WIDE_MIRROR } from '../video/draw';
import { paletteDarken, vga } from '../video/vga';
import { globalRandom, Random } from '../util/random';
import { createAiController } from '../controller/ai';
import { langGet } from '../resources/resources';
import { setPilotColors } from './pilotColors';
import {
  CtrlType, FRAME_WAIT_TICKS, GROUP_HAR, GROUP_UNKNOWN, isArenaScene, KnockDownMode, LAYER_PROJECTILE, MS_PER_OMF_TICK_SLOWEST,
  PILOT_INFO, RENDER_LAYER_BOTTOM, RENDER_LAYER_MIDDLE, RENDER_LAYER_TOP, SceneId, STATIC_TICKS,
} from './constants';
import type { GameObject } from './object';
import type { Scene } from './scene';
import { settings } from './settings';
import { randomHarPool } from './roster';
import { ChrScore } from './score';
import type { ChrFile } from './tournament/chr';
import type { ReplaySession } from './replay/playback';
import { HarScreencaps } from './harScreencap';

export interface MatchSettings {
  throwRange: number;
  hitPause: number;
  blockDamage: number;
  vitality: number;
  jumpHeight: number;
  knockDown: KnockDownMode;
  rehit: boolean;
  defensiveThrows: boolean;
  power1: number;
  power2: number;
  hazards: boolean;
  rounds: number;
  fightMode: number;
  sim: boolean;
}

/** The finished fight as the victory screen sums it up (the winner's numbers). */
export interface VictoryStats {
  /** Rounds won by the winner and by the loser. */
  rounds: [number, number];
  hits: number;
  /** Hits per attack, percent. */
  accuracy: number;
  bestCombo: number;
  seconds: number;
  perfect: boolean;
  /** FINISH_NONE, FINISH_SCRAP or FINISH_DESTRUCTION. */
  finish: number;
}

export interface FightStats {
  winner: number;
  plugText: number;
  sold: string;
  winnings: number;
  bonuses: number;
  repairCost: number;
  profit: number;
  hp: number;
  maxHp: number;
  finish: number; // 0 none, 1 scrap, 2 destruction
  challenger: Pilot | null;
  hitsLanded: [number, number];
  averageDamage: [number, number];
  totalAttacks: [number, number];
  hitMissRatio: [number, number];
  /** The arena fought in (single player moves on to the next one before the news report names it). */
  arena: number;
}

// fight_stats.h: fight finishers and the Plug report texts (language id PLUG_TEXT_START + plug_text).
export const FINISH_NONE = 0;
export const FINISH_SCRAP = 1;
export const FINISH_DESTRUCTION = 2;
export const PLUG_TEXT_START = 587;
export const PLUG_ENHANCEMENT = 0;
export const PLUG_FORFEIT = 1;
export const PLUG_LOSE = 2;
export const PLUG_WIN = 7;
export const PLUG_WIN_OK = 10;
export const PLUG_WIN_BIG = 13;
export const PLUG_WARNING = 16;
export const PLUG_KICK_OUT = 17;
export const PLUG_SOLD_UPGRADE = 18;

export function emptyFightStats(): FightStats {
  return {
    winner: 0, plugText: 0, sold: '', winnings: 0, bonuses: 0, repairCost: 0, profit: 0, hp: 0, maxHp: 0, finish: 0,
    challenger: null, hitsLanded: [0, 0], averageDamage: [0, 0], totalAttacks: [0, 0], hitMissRatio: [0, 0], arena: 0,
  };
}

export class GamePlayer {
  harObjId = 0;
  ctrl: Controller;
  pilot = new Pilot();
  chr: ChrFile | null = null;
  selectable = false;
  score = new ChrScore();
  god = false;
  ezDestruct = false;
  spWins = 0;
  /** Newsroom pictures taken during the last fight (reference game_player.screencaps). */
  screencaps = new HarScreencaps();

  constructor(ctrl: Controller) {
    this.ctrl = ctrl;
  }

  setCtrl(c: Controller): void {
    this.ctrl?.free();
    this.ctrl = c;
  }
}

/**
 * `player->pilot` as the reference sees it. The reference sets it to NULL in tournament mode (player 2 between
 * fights, which also selects the Plug report on the VS screen; player 1 after backing out of the mechlab's LOAD
 * menu without a loaded character). `GamePlayer.pilot` is typed non-null, so read it through this helper wherever
 * it may have been cleared.
 */
export function gamePlayerGetPilot(p: GamePlayer): Pilot | null {
  return (p.pilot as Pilot | null | undefined) ?? null;
}

/** `player->pilot = pilot` (null clears it, see gamePlayerGetPilot). */
export function gamePlayerSetPilot(p: GamePlayer, pilot: Pilot | null): void {
  (p as { pilot: Pilot | null }).pilot = pilot;
}

interface RenderObj {
  obj: GameObject;
  layer: number;
  singleton: boolean;
  persistent: boolean;
}

export type SceneFactory = (gs: GameState) => Scene;
const sceneFactories = new Map<number, SceneFactory>();

export function registerScene(id: SceneId, f: SceneFactory): void {
  sceneFactories.set(id, f);
}

export function hasScene(id: SceneId): boolean {
  return sceneFactories.has(id);
}

export class GameState {
  run = true;
  paused = false;
  thisId: SceneId = SceneId.NONE;
  nextId: SceneId = SceneId.NONE;
  nextNextId: SceneId = SceneId.MENU;
  tick = 0;
  intTick = 0;
  speed: number;
  matchSettings!: MatchSettings;
  screenShakeHorizontal = 0;
  screenShakeVertical = 0;
  arena = 0;
  speedSlowdownPrevious = 0;
  speedSlowdownTime = -1;
  hitPauseTicks = 0;
  nextWaitTicks = 0;
  thisWaitTicks = 0;
  hideUi = false;
  warpSpeed = false;
  /** Training mode: no knockouts, health refills, a dummy opponent (see the arena and the TRAINING menu). */
  training = false;
  /** Watching a saved fight (see replay/playback.ts). */
  replay: ReplaySession | null = null;
  /** The game mode's name in the replay list, for modes the players' controllers do not tell apart (e.g. SURVIVAL). */
  modeLabel: string | null = null;
  /** Sound effects are not played (a replay jumping to a moment runs the fight silently). */
  silent = false;
  /** The main menu opens this submenu when it comes back (e.g. EXTRAS after watching a replay). */
  menuReturn: 'extras' | 'modes' | null = null;
  /** Where the victory screen goes on to (scenes/victory.ts), and the fight it sums up. */
  victoryNext: SceneId | null = null;
  victoryStats: VictoryStats | null = null;
  /** Arcade, survival or time attack under way (see modes/run.ts). */
  modeRun: import('./modes/run').ModeRun | null = null;
  /** The credits' fights under way (EXTRAS > CREDITS, see credits/creditsRun.ts). */
  credits: import('./credits/creditsRun').CreditsHooks | null = null;
  sc!: Scene;
  objects: RenderObj[] = [];
  players: [GamePlayer, GamePlayer];
  fightStats: FightStats = emptyFightStats();
  rand = new Random(Date.now() >>> 0);
  menuCtrl: Controller;
  private paletteTransforms: ((pal: Palette) => void)[] = [];
  private tracker: TrackedSound[] = [];
  /** Hook so the host (e.g. renderer) can react to scene changes. */
  onSceneChange: ((id: SceneId) => void) | null = null;
  /** Hook called when the game wants to exit (quit from menu). */
  onQuit: (() => void) | null = null;

  constructor(startScene: SceneId) {
    this.speed = settings().gameplay.speed + 5;
    this.matchSettingsReset();
    this.menuCtrl = new Controller(this);
    this.players = [new GamePlayer(new Controller(this)), new GamePlayer(new Controller(this))];
    this.reconfigureControllers();
    this.thisId = startScene;
    this.nextId = startScene;
    this.createScene(startScene);
  }

  matchSettingsReset(): void {
    const s = settings();
    this.matchSettings = {
      throwRange: s.advanced.throwRange,
      hitPause: s.advanced.hitPause,
      blockDamage: s.advanced.blockDamage,
      vitality: s.advanced.vitality,
      jumpHeight: s.advanced.jumpHeight,
      knockDown: s.advanced.knockDown,
      rehit: s.advanced.rehitMode,
      defensiveThrows: s.advanced.defensiveThrows,
      power1: s.gameplay.power1,
      power2: s.gameplay.power2,
      hazards: s.gameplay.hazards,
      rounds: s.gameplay.rounds,
      fightMode: s.gameplay.fightMode,
      sim: false,
    };
  }

  matchSettingsDefaults(): void {
    this.matchSettings = {
      throwRange: 100, hitPause: 4, blockDamage: 0, vitality: 100, jumpHeight: 100, knockDown: KnockDownMode.NONE,
      rehit: false, defensiveThrows: false, power1: 5, power2: 5, hazards: true, rounds: 1, fightMode: 0, sim: false,
    };
  }

  // ---- controllers --------------------------------------------------------------
  setupKeyboard(playerId: number, controlId: number): void {
    const k = settings().keys;
    const ctrl = new KeyboardController(this, controlId === 0 ? k.p1 : k.p2);
    // A free gamepad plays along (player 1 the first, player 2 the second); pads chosen in the input menu are taken.
    ctrl.padSlot = k.autoPads ? playerId : -1;
    ctrl.reservedPads = () => {
      const s = settings().keys;
      const out: number[] = [];
      if (s.ctrlType1 === CtrlType.GAMEPAD && s.gamepad1 >= 0) out.push(s.gamepad1);
      if (s.ctrlType2 === CtrlType.GAMEPAD && s.gamepad2 >= 0) out.push(s.gamepad2);
      return out;
    };
    const p = this.players[playerId];
    p.setCtrl(ctrl);
    p.selectable = true;
  }

  setupGamepad(playerId: number, padIndex: number): void {
    const ctrl = new GamepadController(this, padIndex);
    const p = this.players[playerId];
    p.setCtrl(ctrl);
    p.selectable = true;
  }

  /** Makes a player CPU-controlled (difficulty from settings unless given). */
  setupAi(playerId: number, difficulty = settings().gameplay.difficulty): void {
    const p = this.players[playerId];
    p.setCtrl(createAiController(this, difficulty, p.pilot, p.pilot.pilotId));
    p.selectable = false;
  }

  /** Demo mode: both players CPU with random pilots/HARs (reference game_state_init_demo). */
  initDemo(): void {
    for (let i = 0; i < 2; i++) {
      const p = this.players[i];
      // As in the reference, the AI is created for the previous pilot id, then pilot and HAR are re-rolled.
      p.setCtrl(createAiController(this, 4, p.pilot, p.pilot.pilotId));
      p.selectable = false;
      p.pilot.pilotId = globalRandomInt(10);
      // Any robot (the reference's int(11)), the remaster's too when they are on.
      const pool = randomHarPool(true);
      p.pilot.harId = pool[globalRandomInt(pool.length)];
      p.score.reset(true);
      const info = PILOT_INFO[p.pilot.pilotId];
      p.pilot.power = info.power;
      p.pilot.agility = info.agility;
      p.pilot.endurance = info.endurance;
      setPilotColors(p.pilot, info.color1, info.color2, info.color3);
      p.pilot.name = langGet(p.pilot.pilotId + 20);
    }
  }

  reconfigureControllers(): void {
    const k = settings().keys;
    if (k.ctrlType1 === CtrlType.GAMEPAD && k.gamepad1 >= 0) this.setupGamepad(0, k.gamepad1);
    else this.setupKeyboard(0, 0);
    if (k.ctrlType2 === CtrlType.GAMEPAD && k.gamepad2 >= 0) this.setupGamepad(1, k.gamepad2);
    else this.setupKeyboard(1, 1);
  }

  getPlayer(i: number): GamePlayer {
    return this.players[i];
  }

  isSingleplayer(): boolean {
    return this.players[1].ctrl.type === CtrlType.AI;
  }
  isTournament(): boolean {
    // A replayed tournament fight follows the tournament rules (damage, robot stats) without the character.
    return this.players[0].chr !== null || this.replay?.tournament === true;
  }
  isDemoplay(): boolean {
    return this.players[0].ctrl.type === CtrlType.AI && this.players[1].ctrl.type === CtrlType.AI;
  }
  isNetplay(): boolean {
    return false;
  }
  isTwoplayer(): boolean {
    return !this.isDemoplay() && !this.isSingleplayer();
  }

  // ---- objects ------------------------------------------------------------------
  addObject(obj: GameObject, layer: number, singleton: boolean, persistent: boolean): boolean {
    if (singleton) {
      const id = obj.curAnimation?.id;
      for (const r of this.objects) {
        if (r.singleton && r.obj.curAnimation && r.obj.curAnimation.id === id) return false;
      }
    }
    this.objects.push({ obj, layer, singleton, persistent });
    return true;
  }

  findObject(id: number): GameObject | null {
    if (!id) return null;
    for (const r of this.objects) if (r.obj.id === id) return r.obj;
    return null;
  }

  findObjects(pred: (o: GameObject) => boolean): GameObject[] {
    const out: GameObject[] = [];
    for (const r of this.objects) if (pred(r.obj)) out.push(r.obj);
    return out;
  }

  delAnimation(animId: number): void {
    const i = this.objects.findIndex((r) => r.obj.curAnimation && r.obj.curAnimation.id === animId);
    if (i >= 0) {
      this.objects[i].obj.free();
      this.objects.splice(i, 1);
    }
  }

  delObject(obj: GameObject): void {
    const i = this.objects.findIndex((r) => r.obj === obj);
    if (i >= 0) {
      obj.free();
      this.objects.splice(i, 1);
    }
  }

  getProjectiles(): GameObject[] {
    return this.objects.filter((r) => r.obj.layers & LAYER_PROJECTILE).map((r) => r.obj);
  }

  clearObjects(mask: number): void {
    this.objects = this.objects.filter((r) => {
      if (r.obj.group & mask) {
        r.obj.free();
        return false;
      }
      return true;
    });
  }

  harsAreAlive(): boolean {
    const a = this.findObject(this.players[0].harObjId);
    const b = this.findObject(this.players[1].harObjId);
    if (!a || !b) return false;
    return (a.userdata as { health: number }).health > 0 && (b.userdata as { health: number }).health > 0;
  }

  // ---- scene management -------------------------------------------------------
  setNext(id: SceneId): void {
    if (this.nextWaitTicks <= 0) {
      this.nextWaitTicks = FRAME_WAIT_TICKS;
      this.nextNextId = SceneId.MENU;
      this.nextId = id;
    }
  }

  private createScene(id: SceneId): void {
    const f = sceneFactories.get(id);
    if (!f) throw new Error(`Scene ${SceneId[id]} is not implemented`);
    this.sc = f(this);
    this.sc.init();
    this.onSceneChange?.(id);
  }

  swapScene(id: SceneId): void {
    this.sc?.free();
    this.objects = this.objects.filter((r) => {
      if (!r.persistent) {
        r.obj.free();
        return false;
      }
      return true;
    });
    this.thisId = id;
    this.nextId = id;
    this.createScene(id);
    this.tick = 0;
  }

  // ---- ticking --------------------------------------------------------------------
  msPerDyntick(): number {
    if (isArenaScene(this.thisId)) {
      if (this.warpSpeed) return 1;
      const ms = Math.trunc(8 + MS_PER_OMF_TICK_SLOWEST - (this.speed / 15) * MS_PER_OMF_TICK_SLOWEST);
      return this.replay ? this.replay.scaleTickMs(ms) : ms;
    }
    return STATIC_TICKS;
  }

  slowdown(ticks: number, rate: number): void {
    if (this.speedSlowdownTime < 0) {
      this.speedSlowdownPrevious = this.speed;
      this.speedSlowdownTime = ticks;
      this.speed = Math.max(rate, 0);
    }
  }

  hitPause(): void {
    this.hitPauseTicks = this.matchSettings.hitPause;
  }

  setSpeed(s: number): void {
    this.speed = Math.max(s, 0);
  }

  private tickControllers(): void {
    const ev: CtrlEvent[] = [];
    this.menuCtrl.tick(this.tick, ev);
    for (const p of this.players) p.ctrl.tick(this.tick, ev);
  }

  staticTick(): void {
    if (this.thisWaitTicks > 0) this.thisWaitTicks--;
    if (this.nextWaitTicks > 0) this.nextWaitTicks--;
    const crossfadeOut = settings().video.crossfade && !this.sc.isArena();
    if (this.thisId !== this.nextId && (this.nextWaitTicks <= 1 || !crossfadeOut)) {
      if (this.nextId === SceneId.NONE) {
        if (this.run) {
          this.run = false;
          // The fade-out is over: let the quit handler schedule another scene (setNext waits for this).
          this.nextWaitTicks = 0;
          this.onQuit?.();
          // The quit handler may pick another scene instead (the web build returns to the menu).
          if (this.nextId !== SceneId.NONE) this.run = true;
        }
        return;
      }
      this.swapScene(this.nextId);
      const crossfadeIn = settings().video.crossfade && !this.sc.isArena();
      this.thisWaitTicks = crossfadeIn ? FRAME_WAIT_TICKS : 0;
      this.nextWaitTicks = 0;
    }
    this.tickControllers();
    this.sc.doStaticTick(this.paused);
    for (const r of this.objects.slice()) r.obj.staticTick();
  }

  dynamicTick(): void {
    for (const r of this.objects) r.obj.snapshotPosition();
    if (this.hitPauseTicks > 0) {
      this.hitPauseTicks--;
      this.intTick++;
      return;
    }
    if (this.screenShakeHorizontal > 0 && !this.paused) this.screenShakeHorizontal--;
    if (this.screenShakeVertical > 0 && !this.paused) this.screenShakeVertical--;
    if ((this.screenShakeHorizontal > 0 || this.screenShakeVertical > 0) && settings().video.screenShake) {
      const sx = Math.sin(this.screenShakeHorizontal) * 5 * (this.screenShakeHorizontal / 15);
      const sy = Math.sin(this.screenShakeVertical) * 5 * (this.screenShakeVertical / 15);
      video.moveTarget(Math.trunc(sx), Math.trunc(sy));
      const mag = Math.max(this.screenShakeHorizontal, this.screenShakeVertical);
      if (settings().keys.rumble) for (const p of this.players) p.ctrl.rumble(mag / 12, mag * this.msPerDyntick());
    } else {
      video.moveTarget(0, 0);
    }
    const ev: CtrlEvent[] = [];
    for (const p of this.players) p.ctrl.dyntick(this.tick, ev);
    this.sc.doDynamicTick(this.paused);
    this.sc.doInputPoll();
    if (!this.paused) {
      this.cleanup();
      for (const r of this.objects.slice()) r.obj.dynamicTickAdvance();
      for (const r of this.objects.slice()) r.obj.move();
      this.callCollide();
      for (const r of this.objects.slice()) r.obj.dynamicTickApply();
      this.trackerTick(this.msPerDyntick());
      this.tick++;
    }
    if (this.speedSlowdownTime === 0) this.speed = this.speedSlowdownPrevious;
    if (this.speedSlowdownTime >= 0) this.speedSlowdownTime--;
    this.intTick++;
  }

  private cleanup(): void {
    this.objects = this.objects.filter((r) => {
      if (r.obj.isFinished()) {
        r.obj.free();
        return false;
      }
      return true;
    });
  }

  private callCollide(): void {
    const objs = this.objects;
    const size = objs.length;
    for (let i = 0; i < size; i++) {
      const a = objs[i]?.obj;
      if (!a) continue;
      for (let k = i + 1; k < size; k++) {
        const b = objs[k]?.obj;
        if (!b) continue;
        if (a.group !== b.group || a.group === GROUP_UNKNOWN || b.group === GROUP_UNKNOWN || (a.group === GROUP_HAR && b.group === GROUP_HAR)) {
          if (a.layers & b.layers) a.collide(b);
        }
      }
    }
  }

  // ---- palette ----------------------------------------------------------------------
  enablePaletteTransform(fn: (pal: Palette) => void): void {
    vga.enableTransform(fn);
  }

  paletteTransform(): void {
    for (const r of this.objects) r.obj.paletteTransformRegister();
    if (this.nextWaitTicks > 0 || this.thisWaitTicks > 0) {
      vga.enableTransform((pal) => {
        let darkness = 0;
        if (this.thisWaitTicks > 0) darkness = Math.trunc((this.thisWaitTicks * 255) / FRAME_WAIT_TICKS);
        if (this.nextWaitTicks > 0) darkness = 255 - Math.trunc((this.nextWaitTicks * 255) / FRAME_WAIT_TICKS);
        paletteDarken(pal, darkness);
      });
    }
    this.sc.paletteTransform();
  }

  // ---- rendering ------------------------------------------------------------------
  render(): void {
    // Fights extend the arena for widescreen; other screens get an ambient fill.
    if (this.sc.isArena()) video.setWideStyle(WIDE_MIRROR);
    video.setTag(TAG_BACKGROUND);
    this.sc.doRender();
    const har0 = this.findObject(this.players[0].harObjId);
    const har1 = this.findObject(this.players[1].harObjId);
    const isHar = (o: GameObject) => o === har0 || o === har1;
    // Objects drawn as part of the screen overlay are tagged like the HUD (the remastered effects skip them).
    const renderObj = (o: GameObject) => {
      video.setTag(o.hudLayer ? TAG_HUD : TAG_NONE);
      o.render();
    };
    video.setTag(TAG_NONE);
    for (const r of this.objects) if (r.layer === RENDER_LAYER_BOTTOM && !isHar(r.obj)) renderObj(r.obj);
    video.setTag(TAG_NONE);
    for (const r of this.objects) r.obj.renderShadow();
    video.setTag(TAG_HAR);
    for (const h of [har0, har1]) if (h && !harIsActive(h)) h.render();
    for (const r of this.objects) if (r.layer === RENDER_LAYER_MIDDLE && !isHar(r.obj)) renderObj(r.obj);
    video.setTag(TAG_HAR);
    for (const h of [har0, har1]) if (h && harIsActive(h)) h.render();
    for (const r of this.objects) if (r.layer === RENDER_LAYER_TOP && !isHar(r.obj)) renderObj(r.obj);
    video.setTag(TAG_HUD);
    this.sc.renderOverlay();
    video.setTag(TAG_NONE);
    if (this.thisId === SceneId.CREDITS) video.setFramebufferOptions(FBUFOPT_CREDITS);
  }

  // ---- audio ----------------------------------------------------------------------
  /** The announcer says a line (see audio/announcer.ts), unless the game runs silently. */
  announce(line: string): void {
    if (!this.silent) announce(line);
  }

  playSound(soundId: number, opts: SoundOpts): void {
    if (soundId < 0 || soundId > 299 || this.silent) return;
    const handle = audio.playSound(soundId, opts);
    if (!handle) return;
    const durationMs = audio.soundDurationMs(soundId, opts.pitch);
    this.tracker.push({
      handle, soundId, duration: durationMs, total: durationMs, panning: opts.panning, panStart: opts.panning,
      panEnd: opts.panningEnd, hasSweep: opts.hasPanningSweep, follow: opts.followObjectId,
    });
  }

  private trackerTick(ms: number): void {
    this.tracker = this.tracker.filter((s) => (s.duration -= ms) > 0);
    for (const s of this.tracker) {
      let pan: number;
      if (s.follow) {
        const o = this.findObject(s.follow);
        if (!o) continue;
        pan = Math.trunc(((o.px() - 160) * 100) / 160);
      } else if (s.hasSweep && s.total > 0) {
        const elapsed = s.total - s.duration;
        pan = s.panStart + Math.trunc((elapsed * (s.panEnd - s.panStart)) / s.total);
      } else {
        continue;
      }
      pan = Math.max(-100, Math.min(100, pan));
      if (pan !== s.panning) {
        s.panning = pan;
        audio.setPan(s.handle, pan);
      }
    }
  }

  playMusic(name: string): void {
    audio.playMusic(name);
  }

  stopMusic(): void {
    audio.stopMusic();
  }

  menuPoll(ev: CtrlEvent[], opts?: MenuPollOptions): void {
    this.menuCtrl.last = this.menuCtrl.current;
    this.menuCtrl.current = 0;
    menuPoll(this.menuCtrl, ev, opts);
  }
}

function globalRandomInt(n: number): number {
  return globalRandom.int(n);
}

interface TrackedSound {
  handle: number;
  soundId: number;
  duration: number;
  total: number;
  panning: number;
  panStart: number;
  panEnd: number;
  hasSweep: boolean;
  follow: number;
}

// Imported lazily to avoid a module cycle at evaluation time.
import { harIsActive } from './objects/har';
