// Scene base class (port of the reference scene prototype).
import type { Palette } from '../formats/palette';
import { loadAf, loadBk, bkGetInfo, type Af, type Bk } from '../resources/resources';
import { video } from '../video/draw';
import { setMenuColors, vga } from '../video/vga';
import { isArenaScene, RENDER_LAYER_BOTTOM, sceneBk, SceneId } from './constants';
import type { GameState } from './gameState';
import { GameObject } from './object';

type TimerCb = () => void;

/** Tick-countdown callbacks run on dynamic ticks. */
export class TickTimer {
  private units: { cb: TimerCb; ticks: number }[] = [];
  add(ticks: number, cb: TimerCb): void {
    this.units.push({ cb, ticks });
  }
  run(): void {
    for (let i = 0; i < this.units.length; ) {
      const u = this.units[i];
      if (u.ticks <= 0) {
        this.units.splice(i, 1);
        u.cb();
      } else {
        u.ticks--;
        i++;
      }
    }
  }
  clear(): void {
    this.units = [];
  }
}

export class Scene {
  gs: GameState;
  id: SceneId;
  bk: Bk;
  afData: (Af | null)[] = [null, null];
  staticTicksSinceStart = 0;
  tickTimer = new TickTimer();

  constructor(gs: GameState, id: SceneId, bkName?: string) {
    this.gs = gs;
    this.id = id;
    const name = bkName ?? sceneBk(id);
    if (!name) throw new Error(`No BK file for scene ${id}`);
    this.bk = loadBk(name);
    vga.setBasePalette(this.bk.palettes[0]);
    vga.setRemaps(this.bk.remaps[0]);
    setMenuColors();
    vga.setBaseIndex(0, 0, 0, 0);
  }

  loadHar(playerId: number): Af {
    const player = this.gs.getPlayer(playerId);
    const af = loadAf(player.pilot.harId);
    this.afData[playerId] = af;
    return af;
  }

  /** Called once after construction: creates objects for scene animations flagged by `startup`. */
  init(): void {
    for (const [id, info] of this.bk.infos) {
      const [load, repeat] = this.startup(id);
      if (!load) continue;
      const obj = new GameObject(this.gs, info.ani.startX, info.ani.startY);
      obj.soundTranslationTable = this.bk.soundTranslationTable;
      obj.setAnimation(info.ani);
      obj.setRepeat(repeat);
      obj.animationState.spawn = (p, sid, x, y, vx, vy, mp) => this.spawnObject(p, sid, x, y, vx, vy, mp);
      obj.animationState.destroy = (_p, did) => this.gs.delAnimation(did);
      const prio = this.prioOverride(id);
      this.gs.addObject(obj, prio !== -1 ? prio : RENDER_LAYER_BOTTOM, false, false);
    }
    this.tickTimer.clear();
  }

  /** Default child-spawn behavior for scene animations (tags m, mx, my...). */
  spawnObject(parent: GameObject, id: number, x: number, y: number, vx: number, vy: number, mpFlags: number): void {
    const info = bkGetInfo(this.bk, id);
    if (!info) return;
    const obj = new GameObject(parent.gs, x + info.ani.startX, y + info.ani.startY, vx, vy);
    obj.soundTranslationTable = parent.soundTranslationTable;
    obj.setAnimation(info.ani);
    obj.animationState.spawn = (p, sid, sx, sy, svx, svy, smp) => this.spawnObject(p, sid, sx, sy, svx, svy, smp);
    obj.animationState.destroy = (_p, did) => this.gs.delAnimation(did);
    if (info.probability === 1) obj.setRepeat(true);
    if (mpFlags & 0x1) obj.setAnimationEffects(0x10 /* EFFECT_SATURATE */);
    this.gs.addObject(obj, RENDER_LAYER_BOTTOM, false, false);
  }

  isArena(): boolean {
    return isArenaScene(this.id);
  }

  // ---- overridable hooks --------------------------------------------------------
  /** Returns [load, repeat] for scene animation `id` at scene start. */
  startup(_id: number): [boolean, boolean] {
    return [false, false];
  }
  prioOverride(_id: number): number {
    return -1;
  }
  free(): void {}
  staticTick(_paused: boolean): void {}
  dynamicTick(_paused: boolean): void {}
  inputPoll(): void {}
  render(): void {}
  renderOverlay(): void {}
  paletteTransform(): void {}
  /** Mouse input not taken by a GUI frame (native coordinates); returns true when used. */
  pointer(_x: number, _y: number, _kind: import('../controller/mouse').PointerKind): boolean {
    return false;
  }
  /** Raw key events (text input etc). Return true when consumed. */
  keyEvent(_code: string, _e: KeyboardEvent): boolean {
    return false;
  }
  /** The game window lost focus or was hidden (fights pause). */
  focusLost(): void {}

  // ---- driver entry points (not usually overridden) ------------------------------------
  doStaticTick(paused: boolean): void {
    this.staticTicksSinceStart++;
    this.staticTick(paused);
  }

  doDynamicTick(paused: boolean): void {
    if (!paused) this.tickTimer.run();
    this.dynamicTick(paused);
  }

  doInputPoll(): void {
    if (this.staticTicksSinceStart < 25 && !this.isArena()) return;
    if (this.gs.thisId !== this.gs.nextId) return;
    this.inputPoll();
  }

  doRender(): void {
    video.draw(this.bk.background, 0, 0);
    this.render();
  }

  /** Scene palette (palette 0 of the BK). */
  palette(): Palette {
    return this.bk.palettes[0];
  }
}
