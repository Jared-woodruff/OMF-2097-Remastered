// F1 help: the original game's help pages, with the game paused (the help text itself says "while playing the game,
// you can press the F1 key at any time to bring up these instructions"). Shown full screen on the main menu backdrop
// with the main menu's palette (text colors are palette entries, which differ from scene to scene); the scene's
// palette is restored on close.
import { connectedPads, isDown, readPad } from '../../controller/input';
import type { PointerKind } from '../../controller/mouse';
import type { Palette, RemapTables } from '../../formats/palette';
import { loadBk, type Bk } from '../../resources/resources';
import { drawList, TAG_BACKGROUND, TAG_MENU, video } from '../../video/draw';
import { setMenuColors, vga } from '../../video/vga';
import { ACT_DOWN, ACT_UP, CtrlType } from '../constants';
import { HelpMenu } from '../scenes/mainmenu/menuHelp';
import { playMenuSound } from './widgets';

let openOverlay: HelpOverlay | null = null;
let mainBk: Bk | null = null;

/** Whether the F1 help is on screen (scenes ignore their own key handling meanwhile). */
export function helpOverlayOpen(): boolean {
  return openOverlay !== null;
}

export class HelpOverlay {
  private menu: HelpMenu | null = null;
  /** Key or pad button that closed the help: the game stays paused until it is released (it must not act in the game). */
  private releaseKey: string | null = null;
  private releasePad = false;
  private padPrev = { up: false, down: false, back: false, punch: false };
  private savedPalette: Palette | null = null;
  private savedRemaps: RemapTables | null = null;

  constructor(private setPaused: (paused: boolean) => void) {}

  isOpen(): boolean {
    return this.menu !== null;
  }

  open(): void {
    if (this.menu) return;
    this.menu = new HelpMenu();
    openOverlay = this;
    mainBk ??= loadBk('MAIN.BK');
    this.savedPalette = vga.base.clone();
    this.savedRemaps = vga.remaps.clone();
    vga.setBasePalette(mainBk.palettes[0]);
    vga.setRemaps(mainBk.remaps[0]);
    setMenuColors();
    vga.setBaseIndex(0, 0, 0, 0);
    vga.render();
    this.releaseKey = null;
    this.releasePad = false;
    this.padPrev = { up: true, down: true, back: true, punch: true };
    this.setPaused(true);
    playMenuSound(20);
  }

  close(releaseKey: string | null, fromPad = false): void {
    if (!this.menu) return;
    this.menu = null;
    openOverlay = null;
    if (this.savedPalette && this.savedRemaps) {
      vga.setBasePalette(this.savedPalette);
      vga.setRemaps(this.savedRemaps);
      vga.render();
    }
    this.releaseKey = releaseKey;
    this.releasePad = fromPad;
    playMenuSound(20);
    this.tryResume();
  }

  private tryResume(): void {
    if (this.releaseKey && isDown(this.releaseKey)) return;
    if (this.releasePad && this.anyPadButton()) return;
    this.releaseKey = null;
    this.releasePad = false;
    this.setPaused(false);
  }

  private anyPadButton(): boolean {
    for (const i of connectedPads()) {
      const p = readPad(i);
      if (p && (p.back || p.punch || p.kick || p.start || p.up || p.down)) return true;
    }
    return false;
  }

  /** Keyboard input while open (returns true when consumed). */
  key(code: string): boolean {
    const m = this.menu;
    if (!m) return false;
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
  pointer(kind: PointerKind): void {
    const m = this.menu;
    if (!m) return;
    if (kind === 'rclick') this.close(null);
    else if (kind === 'click' || kind === 'wheelDown') {
      if (m.action(ACT_DOWN, CtrlType.KEYBOARD)) playMenuSound(19);
      else if (kind === 'click') this.close(null);
    } else if (kind === 'wheelUp' && m.action(ACT_UP, CtrlType.KEYBOARD)) playMenuSound(19);
  }

  /** Per frame: gamepad input while open, and resuming the game once the closing key is released. */
  update(): void {
    if (!this.menu) {
      if (this.releaseKey || this.releasePad) this.tryResume();
      return;
    }
    const now = { up: false, down: false, back: false, punch: false };
    for (const i of connectedPads()) {
      const p = readPad(i);
      if (!p) continue;
      now.up ||= p.up;
      now.down ||= p.down;
      now.back ||= p.back || p.kick;
      now.punch ||= p.punch || p.start;
    }
    const pressed = (k: keyof typeof now) => now[k] && !this.padPrev[k];
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
