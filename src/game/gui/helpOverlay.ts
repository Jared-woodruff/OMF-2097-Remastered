// F1 help: the original game's help pages, with the game paused (the help text itself says "while playing the game,
// you can press the F1 key at any time to bring up these instructions"). Shown full screen on the main menu backdrop
// with the main menu's palette (text colors are palette entries, which differ from scene to scene); the scene's
// palette is restored on close. The controls screen (controlsScreen.ts) and the remaster's pages (page.ts: replays,
// records...) are shown the same way. A network game is not paused (the other player is still playing): the keys stay
// the help's until the one that closed it is let go (helpOverlayHeld), and a screen that opens meanwhile gets its own
// palette back (sceneChanged).
import { connectedPads, isDown, readPad } from '../../controller/input';
import type { PointerKind } from '../../controller/mouse';
import type { Palette, RemapTables } from '../../formats/palette';
import { loadBk, type Bk } from '../../resources/resources';
import { drawList, TAG_BACKGROUND, TAG_MENU, video } from '../../video/draw';
import { setMenuColors, vga } from '../../video/vga';
import { ACT_DOWN, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_UP, CtrlType } from '../constants';
import { helpTexts, HelpMenu } from '../scenes/mainmenu/menuHelp';
import { ControlsMenu, setControlsColors } from './controlsScreen';
import { HtmlHelpMenu, htmlHelpWanted } from './helpHtml';
import { Page } from './page';
import { playMenuSound, type Menu } from './widgets';

let openOverlay: HelpOverlay | null = null;
/** The help closed last (the key that closed it may still be down). */
let closedOverlay: HelpOverlay | null = null;
let mainBk: Bk | null = null;

/** Whether the F1 help is on screen (scenes ignore their own key handling meanwhile). */
export function helpOverlayOpen(): boolean {
  return openOverlay !== null;
}

/**
 * Whether the keys are still the help's: it is on screen, or the key or button that closed it is still down. A game that
 * goes on under the help (a network game) must not take them as the player's: ESC would leave the game, ENTER punch.
 */
export function helpOverlayHeld(): boolean {
  return openOverlay !== null || (closedOverlay?.held() ?? false);
}

export class HelpOverlay {
  private menu: Menu | null = null;
  /** The controls screen instead of the help pages. */
  private controls = false;
  /** A page (replays, records...) instead of the help pages. */
  private page: Page | null = null;
  private padKick = false;
  /** Key or pad button that closed the help: the game stays paused until it is released (it must not act in the game). */
  private releaseKey: string | null = null;
  private releasePad = false;
  /** Closed, the game not resumed yet (it is once the closing key is released). */
  private resuming = false;
  private padPrev = { up: false, down: false, left: false, right: false, back: false, punch: false };
  private savedPalette: Palette | null = null;
  private savedRemaps: RemapTables | null = null;

  constructor(private setPaused: (paused: boolean) => void) {}

  isOpen(): boolean {
    return this.menu !== null;
  }

  /** A page covering the whole screen is open (the game under it need not be drawn). */
  coversScreen(): boolean {
    return this.page?.opaque ?? false;
  }

  open(kind: 'help' | 'controls' | Page = 'help'): void {
    if (this.menu) return;
    this.page = kind instanceof Page ? kind : null;
    this.controls = kind === 'controls';
    this.menu = this.page ?? (this.controls ? new ControlsMenu() : htmlHelpWanted() ? new HtmlHelpMenu(helpTexts()) : new HelpMenu());
    openOverlay = this;
    this.savedPalette = vga.base.clone();
    this.savedRemaps = vga.remaps.clone();
    this.setColors();
    this.page?.onOpen();
    this.releaseKey = null;
    this.releasePad = false;
    this.resuming = false;
    this.padPrev = { up: true, down: true, left: true, right: true, back: true, punch: true };
    this.setPaused(true);
    playMenuSound(20);
  }

  /** The help's colors: the main menu's palette, and the controls screen's or the page's own entries. */
  private setColors(): void {
    mainBk ??= loadBk('MAIN.BK');
    vga.setBasePalette(mainBk.palettes[0]);
    vga.setRemaps(mainBk.remaps[0]);
    setMenuColors();
    if (this.controls) setControlsColors();
    // (a page's colors, and the HTML help's: it is drawn as a page)
    if (this.menu instanceof Page) this.menu.setColors();
    vga.setBaseIndex(0, 0, 0, 0);
    vga.render();
  }

  /**
   * A screen opened under the help (a network game goes on: its fight ended, or the game did): its palette, just set up,
   * is the one to come back to, and the help keeps its own meanwhile.
   */
  sceneChanged(): void {
    if (!this.menu) return;
    this.savedPalette = vga.base.clone();
    this.savedRemaps = vga.remaps.clone();
    this.setColors();
  }

  close(releaseKey: string | null, fromPad = false): void {
    if (!this.menu) return;
    this.page?.onClose();
    // (the HTML help goes with it)
    if (this.menu instanceof HtmlHelpMenu) this.menu.free();
    this.menu = null;
    this.page = null;
    openOverlay = null;
    if (this.savedPalette && this.savedRemaps) {
      vga.setBasePalette(this.savedPalette);
      vga.setRemaps(this.savedRemaps);
      vga.render();
    }
    this.releaseKey = releaseKey;
    this.releasePad = fromPad;
    this.resuming = true;
    closedOverlay = this;
    playMenuSound(20);
    this.tryResume();
  }

  /** The key or pad button that closed the help is still down (read as it is now: no frame needs to come first). */
  held(): boolean {
    if (this.releaseKey && isDown(this.releaseKey)) return true;
    if (this.releasePad && this.anyPadButton()) return true;
    this.releaseKey = null;
    this.releasePad = false;
    return false;
  }

  private tryResume(): void {
    if (!this.resuming || this.held()) return;
    this.resuming = false;
    this.setPaused(false);
  }

  private anyPadButton(): boolean {
    for (const i of connectedPads()) {
      const p = readPad(i);
      if (p && (p.back || p.a || p.b || p.x || p.y || p.start || p.up || p.down || p.left || p.right)) return true;
    }
    return false;
  }

  /** Keyboard input while open (returns true when consumed); `e`: the key press (what it types, for a page's names). */
  key(code: string, e?: KeyboardEvent): boolean {
    const m = this.menu;
    if (!m) return false;
    const page = this.page;
    if (page) {
      if (code === 'F1' || code === 'Escape') {
        if (!page.back()) this.close(code);
      } else if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') page.action(ACT_PUNCH, CtrlType.KEYBOARD);
      else if (code === 'ArrowUp' || code === 'Numpad8') page.action(ACT_UP, CtrlType.KEYBOARD);
      else if (code === 'ArrowDown' || code === 'Numpad2') page.action(ACT_DOWN, CtrlType.KEYBOARD);
      else if (code === 'ArrowLeft' || code === 'Numpad4') page.action(ACT_LEFT, CtrlType.KEYBOARD);
      else if (code === 'ArrowRight' || code === 'Numpad6') page.action(ACT_RIGHT, CtrlType.KEYBOARD);
      else if (code === 'ShiftRight') page.action(ACT_KICK, CtrlType.KEYBOARD);
      else page.key(code, e);
      if (page.finished) this.close(code);
      return true;
    }
    if (m instanceof HtmlHelpMenu) {
      // The HTML help: up and down choose the page, left and right scroll it (PAGE UP / PAGE DOWN too).
      if (code === 'F1' || code === 'Escape') this.close(code);
      else if (code === 'ArrowUp' || code === 'Numpad8') m.action(ACT_UP, CtrlType.KEYBOARD);
      else if (code === 'ArrowDown' || code === 'Numpad2') m.action(ACT_DOWN, CtrlType.KEYBOARD);
      else if (code === 'ArrowLeft' || code === 'Numpad4') m.action(ACT_LEFT, CtrlType.KEYBOARD);
      else if (code === 'ArrowRight' || code === 'Numpad6') m.action(ACT_RIGHT, CtrlType.KEYBOARD);
      else m.keyEvent(code, { code } as KeyboardEvent);
      if (m.finished) this.close(code);
      return true;
    }
    if (this.controls) {
      if (code === 'F1' || code === 'Escape') this.close(code);
      else if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') m.action(ACT_PUNCH, CtrlType.KEYBOARD);
      else if (code === 'ArrowLeft' || code === 'Numpad4') m.action(ACT_LEFT, CtrlType.KEYBOARD);
      else if (code === 'ArrowRight' || code === 'Numpad6') m.action(ACT_RIGHT, CtrlType.KEYBOARD);
      return true;
    }
    if (code === 'F1' || code === 'Escape' || code === 'Enter' || code === 'NumpadEnter' || code === 'Space') {
      this.close(code);
    } else if (code === 'ArrowDown' || code === 'PageDown' || code === 'ArrowRight' || code === 'Numpad2') {
      if (m.action(ACT_DOWN, CtrlType.KEYBOARD)) playMenuSound(19);
    } else if (code === 'ArrowUp' || code === 'PageUp' || code === 'ArrowLeft' || code === 'Numpad8') {
      if (m.action(ACT_UP, CtrlType.KEYBOARD)) playMenuSound(19);
    }
    return true;
  }

  /** Mouse: click or wheel down turns the page, wheel up goes back, right click closes. */
  pointer(kind: PointerKind, x = 0, y = 0): void {
    const m = this.menu;
    if (!m) return;
    const page = this.page;
    if (page) {
      if (kind === 'rclick') {
        if (!page.back()) this.close(null);
      } else if (!page.pointer(x, y, kind) && (kind === 'wheelUp' || kind === 'wheelDown')) {
        page.action(kind === 'wheelUp' ? ACT_UP : ACT_DOWN, CtrlType.KEYBOARD);
      }
      if (page.finished) this.close(null);
      return;
    }
    if (this.controls) {
      if (kind === 'rclick') this.close(null);
      else if (kind === 'wheelUp' || kind === 'wheelDown') m.action(kind === 'wheelUp' ? ACT_LEFT : ACT_RIGHT, CtrlType.KEYBOARD);
      else m.pointer(x, y, kind);
      return;
    }
    if (kind === 'rclick') this.close(null);
    else if (kind === 'click' || kind === 'wheelDown') {
      if (m.action(ACT_DOWN, CtrlType.KEYBOARD)) playMenuSound(19);
      else if (kind === 'click') this.close(null);
    } else if (kind === 'wheelUp' && m.action(ACT_UP, CtrlType.KEYBOARD)) playMenuSound(19);
  }

  /**
   * Per frame (and now and then while the window is hidden: nothing is drawn then): gamepad input while open, a page's
   * own update, and resuming the game once the closing key is released.
   */
  update(): void {
    if (!this.menu) {
      this.tryResume();
      return;
    }
    const now = { up: false, down: false, left: false, right: false, back: false, punch: false };
    for (const i of connectedPads()) {
      const p = readPad(i);
      if (!p) continue;
      now.up ||= p.up;
      now.down ||= p.down;
      now.left ||= p.left;
      now.right ||= p.right;
      now.back ||= p.back || p.b;
      now.punch ||= p.a || p.start;
    }
    const pressed = (k: keyof typeof now) => now[k] && !this.padPrev[k];
    const page = this.page;
    if (page) {
      if (pressed('up')) page.action(ACT_UP, CtrlType.GAMEPAD);
      if (pressed('down')) page.action(ACT_DOWN, CtrlType.GAMEPAD);
      if (pressed('left')) page.action(ACT_LEFT, CtrlType.GAMEPAD);
      if (pressed('right')) page.action(ACT_RIGHT, CtrlType.GAMEPAD);
      if (pressed('punch')) page.action(ACT_PUNCH, CtrlType.GAMEPAD);
      const kick = connectedPads().some((i) => { const p = readPad(i); return !!(p && (p.x || p.y)); });
      if (kick && !this.padKick) page.action(ACT_KICK, CtrlType.GAMEPAD);
      this.padKick = kick;
      this.padPrev = now;
      page.update();
      if (pressed('back') && !page.back()) this.close(null, true);
      else if (page.finished) this.close(null, true);
      return;
    }
    if (this.menu instanceof HtmlHelpMenu) {
      const m = this.menu;
      if (pressed('up')) m.action(ACT_UP, CtrlType.GAMEPAD);
      if (pressed('down')) m.action(ACT_DOWN, CtrlType.GAMEPAD);
      if (pressed('left')) m.action(ACT_LEFT, CtrlType.GAMEPAD);
      if (pressed('right')) m.action(ACT_RIGHT, CtrlType.GAMEPAD);
      this.padPrev = now;
      if (pressed('back') || m.finished) this.close(null, true);
      return;
    }
    if (this.controls) {
      // Controls screen: left / right switch pages, A changes the layout, B, View or Menu close.
      if (pressed('left') || pressed('up')) this.menu.action(ACT_LEFT, CtrlType.GAMEPAD);
      if (pressed('right') || pressed('down')) this.menu.action(ACT_RIGHT, CtrlType.GAMEPAD);
      const start = connectedPads().some((i) => readPad(i)?.start);
      if (pressed('punch') && !start) this.menu.action(ACT_PUNCH, CtrlType.GAMEPAD);
      this.padPrev = now;
      if (pressed('back') || (pressed('punch') && start)) this.close(null, true);
      return;
    }
    if (pressed('down') && this.menu.action(ACT_DOWN, CtrlType.GAMEPAD)) playMenuSound(19);
    if (pressed('up') && this.menu.action(ACT_UP, CtrlType.GAMEPAD)) playMenuSound(19);
    this.padPrev = now;
    if (pressed('back') || pressed('punch')) this.close(null, true);
    else if (this.menu.finished) this.close(null);
  }

  /** Replaces the frame's draw list with the help page. */
  render(): void {
    if (!this.menu || !mainBk) return;
    drawList.begin();
    video.setTag(TAG_BACKGROUND);
    video.draw(mainBk.background, 0, 0);
    video.setTag(TAG_MENU);
    this.menu.render();
  }
}
