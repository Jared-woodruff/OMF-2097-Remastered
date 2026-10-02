// Tournament (mechlab) menu: a button sheet with sprite buttons placed at their position hints, navigated spatially
// with the animated "hand of doom" cursor; menus fade out/in (timing only) and can stack submenus. Port of the
// reference gui/trn_menu.c.
import type { Animation } from '../../resources/animation';
import type { PointerKind } from '../../controller/mouse';
import { video } from '../../video/draw';
import type { Surface } from '../../video/surface';
import { ACT_DOWN, ACT_ESC, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_UP, CtrlType } from '../constants';
import type { GameState } from '../gameState';
import { GameObject } from '../object';
import { componentFocus, componentFree, componentIsSelectable, componentSelect, Sizer } from './sizer';
import type { Component } from './widgets';

const f32 = Math.fround;
const OPACITY_STEP = f32(0.03);
const HAND_STEP = f32(0.05);

export type TrnMenuTickCb = (c: TrnMenu) => void;
export type TrnMenuFreeCb = (c: TrnMenu) => void;
export type TrnMenuSubmenuInitCb = (menu: TrnMenu, submenu: TrnMenu) => void;
export type TrnMenuSubmenuDoneCb = (menu: TrnMenu, submenu: TrnMenu) => void;

interface TrnMenuHand {
  obj: GameObject | null;
  pstartX: number;
  pstartY: number;
  pendX: number;
  pendY: number;
  /** interpolation progress (float) */
  moved: number;
  play: number;
  move: number;
}

function centerX(c: Component): number {
  return c.x + Math.trunc(c.w / 2);
}
function centerY(c: Component): number {
  return c.y + Math.trunc(c.h / 2);
}

/** vec2f_dist() (single precision) */
function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = f32(ax - bx);
  const dy = f32(ay - by);
  return f32(Math.sqrt(f32(f32(dx * dx) + f32(dy * dy))));
}

export class TrnMenu extends Sizer {
  selectedIndex = 0;
  buttonSheet: Surface | null;
  sheetX: number;
  sheetY: number;
  returnHand: boolean;
  fade = 1;
  opacityStep = OPACITY_STEP;
  hand: TrnMenuHand = { obj: null, pstartX: 0, pstartY: 0, pendX: 0, pendY: 0, moved: 0, play: 0, move: 0 };
  submenu: TrnMenu | null = null;
  submenuInit: TrnMenuSubmenuInitCb | null = null;
  submenuDone: TrnMenuSubmenuDoneCb | null = null;
  finished = 0;
  userdata: unknown = null;
  freeCb: TrnMenuFreeCb | null = null;
  /** (set by trnmenu_set_tick_cb but never called by the reference either) */
  tickCb: TrnMenuTickCb | null = null;

  /** trnmenu_create(): starts fading in. */
  constructor(buttonSheet: Surface | null, sheetX: number, sheetY: number, returnHand: boolean) {
    super();
    this.buttonSheet = buttonSheet;
    this.sheetX = sheetX;
    this.sheetY = sheetY;
    this.returnHand = returnHand;
  }

  // ---- reference API ----------------------------------------------------------------------------------------
  /** trnmenu_bind_hand(): the hand cursor object (not part of the game state; ticked and drawn by the menu). */
  bindHand(handAni: Animation, gs: GameState): void {
    if (this.hand.obj) this.hand.obj.free();
    const obj = new GameObject(gs, 0, 0);
    obj.setAnimation(handAni);
    obj.onFinish = () => this.handFinished();
    obj.dynamicTick();
    this.hand.obj = obj;
  }

  setUserdata(userdata: unknown): void {
    this.userdata = userdata;
  }
  getUserdata(): unknown {
    return this.userdata;
  }
  setFreeCb(cb: TrnMenuFreeCb | null): void {
    this.freeCb = cb;
  }
  setTickCb(cb: TrnMenuTickCb | null): void {
    this.tickCb = cb;
  }
  setSubmenuInitCb(cb: TrnMenuSubmenuInitCb | null): void {
    this.submenuInit = cb;
  }
  setSubmenuDoneCb(cb: TrnMenuSubmenuDoneCb | null): void {
    this.submenuDone = cb;
  }
  getSubmenu(): TrnMenu | null {
    return this.submenu;
  }
  isFinished(): boolean {
    return this.finished !== 0;
  }
  isFading(): boolean {
    return this.fade !== 0;
  }

  /** trnmenu_finish(): fades out; the menu is finished once faded (unless a submenu is active). */
  finish(): void {
    this.fade = 1;
    this.opacityStep = -OPACITY_STEP;
  }

  /** trnmenu_set_submenu(): replaces the submenu and fades this menu out in favor of it. */
  setSubmenu(submenu: TrnMenu): void {
    if (this.submenu) componentFree(this.submenu);
    this.submenu = submenu;
    submenu.parent = this; // Set correct parent
    submenu.init(this.theme);
    submenu.layout(this.x, this.y, this.w, this.h);
    submenu.submenuInit?.(this, submenu);
    this.opacityStep = -OPACITY_STEP;
    this.fade = 1;
  }

  // ---- hand -----------------------------------------------------------------------------------------------------
  private handFinished(): void {
    const obj = this.hand.obj;
    this.hand.play = 0;
    if (!obj) return;
    obj.playerReset();
    obj.dynamicTick();
  }

  private handDeselect(): number {
    const sel = this.get(this.selectedIndex);
    if (sel === null) return 0;
    componentFocus(sel, false);
    return 1;
  }

  private handSelect(): number {
    const sel = this.get(this.selectedIndex);
    if (sel === null) return 0;
    componentFocus(sel, true);
    this.hand.move = 1;
    this.hand.pstartX = this.hand.obj ? this.hand.obj.px() : 0;
    this.hand.pstartY = this.hand.obj ? this.hand.obj.py() : 0;
    this.hand.pendX = centerX(sel);
    this.hand.pendY = centerY(sel);
    this.hand.moved = 0;
    return 1;
  }

  /** Nearest selectable component in the given direction (find_next_button), or -1. */
  private findNextButton(act: number): number {
    const cur = this.get(this.selectedIndex);
    if (!cur) return -1;
    let bestDist = f32(9999.0);
    let bestIdx = -1;
    this.objs.forEach((t, idx) => {
      if (!componentIsSelectable(t)) return;
      let tdist = -1;
      switch (act) {
        case ACT_LEFT:
          // rcenter(t) to lcenter(cur)
          if (t.x < cur.x) tdist = dist(t.x + t.w, centerY(t), cur.x, centerY(cur));
          break;
        case ACT_RIGHT:
          // lcenter(t) to rcenter(cur)
          if (t.x > cur.x) tdist = dist(t.x, centerY(t), cur.x + cur.w, centerY(cur));
          break;
        case ACT_UP:
          if (t.y < cur.y) tdist = dist(centerX(t), centerY(t), centerX(cur), centerY(cur));
          break;
        case ACT_DOWN:
          if (t.y > cur.y) tdist = dist(centerX(t), centerY(t), centerX(cur), centerY(cur));
          break;
      }
      if (tdist >= 0 && tdist < bestDist) {
        bestDist = tdist;
        bestIdx = idx;
      }
    });
    return bestIdx;
  }

  // ---- component callbacks ----------------------------------------------------------------------------------------
  override layout(x: number, y: number, w: number, h: number): void {
    super.layout(x, y, w, h);
    let firstSelected = false;
    this.objs.forEach((c, i) => {
      // Select first selectable component
      if (componentIsSelectable(c) && !firstSelected) {
        componentSelect(c, true);
        componentFocus(c, true);
        firstSelected = true;
        this.selectedIndex = i;
      }
      // Set component position and size from the component hints (a zero size hides the component)
      const mx = c.xHint < x ? x : c.xHint;
      const my = c.yHint < y ? y : c.yHint;
      const mw = c.wHint < 0 ? 0 : c.wHint;
      const mh = c.hHint < 0 ? 0 : c.hHint;
      c.layout(mx, my, mw, mh);
    });
    // Set initial hand position
    const sel = this.get(this.selectedIndex);
    if (sel !== null && this.hand.obj) this.hand.obj.setPos(centerX(sel), centerY(sel));
  }

  override action(action: number, source: CtrlType): number {
    // If fading, wait until it's done.
    if (this.fade) return 1;
    // If submenu is set, we need to use it
    if (this.submenu !== null && !this.submenu.isFinished()) return this.submenu.action(action, source);
    switch (action) {
      case ACT_LEFT:
      case ACT_RIGHT:
      case ACT_UP:
      case ACT_DOWN: {
        const next = this.findNextButton(action);
        if (next !== -1 && next !== this.selectedIndex) {
          this.handDeselect();
          this.selectedIndex = next;
          this.handSelect();
        }
        break;
      }
      case ACT_ESC:
        this.finish();
        break;
      case ACT_PUNCH:
      case ACT_KICK: {
        const sel = this.get(this.selectedIndex);
        if (sel !== null) {
          this.hand.play = 1;
          return sel.action(action, source);
        }
        break;
      }
    }
    return 0;
  }

  override render(): void {
    // If submenu is set, we need to use it
    if (!this.fade && this.submenu !== null && !this.submenu.isFinished()) {
      this.submenu.render();
      return;
    }
    if (this.buttonSheet) video.draw(this.buttonSheet, this.sheetX, this.sheetY);
    for (const c of this.objs) c.render();
    this.hand.obj?.render();
  }

  protected override sizerTick(): void {
    // If fade is not ongoing, try to handle submenu. If fade IS ongoing, handle it.
    if (!this.fade) {
      if (this.submenu !== null && !this.submenu.isFinished()) {
        this.submenu.tick();
        return;
      }
    } else {
      const opacity = f32(this.getOpacity() + this.opacityStep);
      if (this.opacityStep > 0 && opacity >= 1.0) {
        this.setOpacity(1.0);
        this.fade = 0;
      } else if (this.opacityStep < 0 && opacity <= 0.0) {
        this.setOpacity(0.0);
        this.fade = 0;
        if (this.submenu === null || this.submenu.isFinished()) this.finished = 1;
      } else {
        this.setOpacity(opacity);
      }
    }

    // Run the submenu done callbacks and fade back in once the submenu has faded out
    if (this.submenu !== null && this.submenu.isFinished() && !this.submenu.isFading()) {
      this.fade = 1;
      this.opacityStep = OPACITY_STEP;
      this.setOpacity(0.0);
      const sel = this.get(this.selectedIndex);
      if (sel !== null) componentFocus(sel, true);
      this.submenuDone?.(this, this.submenu);
      const n = this.submenu;
      n.submenuDone?.(this, n);
      componentFree(this.submenu);
      this.submenu = null;
    }

    // Tick hand animation
    if (this.hand.play && this.hand.obj) this.hand.obj.dynamicTick();

    // Move hand
    const obj = this.hand.obj;
    if (this.hand.move && obj) {
      // Stop movement if we're done, otherwise interpolate from start to destination
      if (this.hand.moved >= 1.0) {
        this.hand.move = 0;
        obj.setPos(this.hand.pendX, this.hand.pendY);
        if (this.returnHand && this.selectedIndex !== 0) {
          this.handDeselect();
          this.selectedIndex = 0;
          this.handSelect();
        }
      } else {
        const dx = this.hand.pendX - this.hand.pstartX;
        const dy = this.hand.pendY - this.hand.pstartY;
        // vec2i_create(dist.x * moved, dist.y * moved): float products truncated to int
        const mx = Math.trunc(f32(dx * this.hand.moved));
        const my = Math.trunc(f32(dy * this.hand.moved));
        obj.setPos(this.hand.pstartX + mx, this.hand.pstartY + my);
        this.hand.moved = f32(this.hand.moved + HAND_STEP);
      }
    }
  }

  /** Mouse (not in the original game): hovering a button moves the hand to it, clicking presses it. */
  override pointer(x: number, y: number, kind: PointerKind): boolean {
    if (this.fade) return false;
    if (this.submenu !== null && !this.submenu.isFinished()) return this.submenu.pointer(x, y, kind);
    for (let i = 0; i < this.objs.length; i++) {
      const c = this.objs[i];
      if (!componentIsSelectable(c) || c.w <= 0 || c.h <= 0 || !c.contains(x, y)) continue;
      if (i !== this.selectedIndex) {
        this.handDeselect();
        this.selectedIndex = i;
        this.handSelect();
      }
      if (kind === 'click') this.action(ACT_PUNCH, CtrlType.KEYBOARD);
      return true;
    }
    return false;
  }

  /** trnmenu_event(): raw key events go to the active submenu or the selected component. */
  override keyEvent(code: string, e: KeyboardEvent): boolean {
    if (this.fade) return false;
    if (this.submenu !== null && !this.submenu.isFinished()) return this.submenu.keyEvent(code, e);
    const c = this.get(this.selectedIndex);
    if (c !== null) return c.keyEvent(code, e);
    return false;
  }

  protected override sizerFree(): void {
    this.freeCb?.(this);
    if (this.hand.obj) {
      this.hand.obj.free();
      this.hand.obj = null;
    }
    if (this.submenu) {
      componentFree(this.submenu);
      this.submenu = null;
    }
  }
}
