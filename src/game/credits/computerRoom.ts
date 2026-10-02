// The credits' fights on an old computer: a picture of a 1990s PC in the game's colors (tools/blender/credits_computer.py,
// made into public/credits/computer by tools/blender/credits_computer_web.py) behind the game, the game's own picture on
// its monitor (the canvas moved onto the screen's glass, cut to its shape), and the place on the tower's front where the
// credits land. The picture is fitted to the window so that the monitor and the tower stay in view; a window too small
// for the tower's credit to be read keeps the fights full screen (place() returns null).

const DIR = 'credits/computer/';
/** The picture's size (px). */
const PIC_W = 3840;
const PIC_H = 2160;
/** Places in the picture (fractions of it, from the top left: credits_computer_web.py prints them). */
const SCREEN = { x: 0.18055, y: 0.16881, w: 0.3189, h: 0.42518 };
const CREDIT = { x: 0.71689, y: 0.27334, w: 0.18628, h: 0.43321 };
/** The monitor's top (its bezel's), where the wall over it ends. */
export const MONITOR_TOP = 0.12;
/** The part that stays in view: the monitor to the tower, the top of the keyboard. */
const KEEP = { x0: 0.15, x1: 0.925, y0: 0.085, y1: 0.8 };
/** The tower's credit is this wide at least (css px), or the fights stay full screen. */
const MIN_CREDIT_W = 170;
/** The game's picture is drawn this much sharper than the screen shows it (the winners' pictures for the end titles
 * are taken from it), up to the window's own height. */
const SUPERSAMPLE = 1.5;
const MIN_ROWS = 600;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoomLayout {
  /** The picture in the window, the screen's 4:3 picture and the tower's credit (css px). */
  pic: Box;
  screen: Box;
  credit: Box;
}

export const ROOM_CSS = `
.omfcr { position: fixed; inset: 0; z-index: 1; overflow: hidden; pointer-events: none; background: #060607; display: none; }
.omfcr img { position: absolute; display: block; max-width: none; user-select: none; }
.omfcr-fill { left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; opacity: .55; }
.omfcr-off { animation: omfcr-dim .85s cubic-bezier(.5,0,.9,.5) forwards; }
@keyframes omfcr-dim { to { opacity: 0; } }
`;

/** A box's style in css px. */
function setBox(el: HTMLElement, b: Box): void {
  el.style.left = `${b.x}px`;
  el.style.top = `${b.y}px`;
  el.style.width = `${b.w}px`;
  el.style.height = `${b.h}px`;
}

const CANVAS_PROPS = ['position', 'left', 'top', 'width', 'height', 'z-index', 'mask-image', 'mask-size', 'mask-repeat',
  '-webkit-mask-image', '-webkit-mask-size', '-webkit-mask-repeat'];

export class ComputerRoom {
  /** Behind the game's picture (the page's own layer, under the canvas). */
  readonly el: HTMLElement;
  private readonly pic: HTMLImageElement;
  private hiRes = false;
  private onScreen = false;
  layout: RoomLayout | null = null;

  constructor(private readonly canvas: HTMLCanvasElement | null) {
    this.el = document.createElement('div');
    this.el.className = 'omfcr';
    this.el.innerHTML = `<img class="omfcr-fill" alt="" src="${DIR}fill.webp" draggable="false"><img class="omfcr-pic" alt="" draggable="false">`;
    this.pic = this.el.querySelector('.omfcr-pic')!;
    document.body.appendChild(this.el);
  }

  /** The layout for the window now (null: the fights stay full screen), the game's picture moved to match. */
  place(): RoomLayout | null {
    const W = window.innerWidth, H = window.innerHeight;
    // As large as fills the window, unless that would cut into the part that stays in view.
    const cover = Math.max(W / PIC_W, H / PIC_H);
    const s = Math.min(cover, W / ((KEEP.x1 - KEEP.x0) * PIC_W), H / ((KEEP.y1 - KEEP.y0) * PIC_H));
    const dw = PIC_W * s, dh = PIC_H * s;
    // (centred on the part that stays in view, without uncovering the window where the picture is larger)
    const fit = (win: number, size: number, mid: number) =>
      size <= win ? (win - size) / 2 : Math.max(win - size, Math.min(0, win / 2 - mid * size));
    const px = fit(W, dw, (KEEP.x0 + KEEP.x1) / 2), py = fit(H, dh, (KEEP.y0 + KEEP.y1) / 2);
    const at = (f: { x: number; y: number; w: number; h: number }): Box => ({ x: px + f.x * dw, y: py + f.y * dh, w: f.w * dw, h: f.h * dh });
    const layout: RoomLayout = { pic: { x: px, y: py, w: dw, h: dh }, screen: at(SCREEN), credit: at(CREDIT) };
    this.layout = layout.credit.w >= MIN_CREDIT_W && W > H ? layout : null;
    if (!this.layout) {
      this.restore();
      return null;
    }
    const dpr = window.devicePixelRatio || 1;
    if (!this.hiRes && dw * dpr > PIC_W * 0.6) this.hiRes = true;
    const src = `${DIR}${this.hiRes ? 'room.webp' : 'room-1920.webp'}`;
    if (this.pic.getAttribute('src') !== src) this.pic.src = src;
    setBox(this.pic, layout.pic);
    const c = this.canvas;
    if (c) {
      const st = c.style;
      st.position = 'fixed';
      st.zIndex = '2';
      setBox(c, layout.screen);
      for (const p of ['mask', '-webkit-mask']) {
        st.setProperty(`${p}-image`, `url(${DIR}screen-mask.png)`);
        st.setProperty(`${p}-size`, '100% 100%');
        st.setProperty(`${p}-repeat`, 'no-repeat');
      }
      // (the game's picture 4:3, so that the renderer draws the classic screen: the HUD in it)
      const rows = Math.round(Math.min(H * dpr, Math.max(MIN_ROWS, layout.screen.h * dpr * SUPERSAMPLE)));
      const cols = Math.round((rows * 4) / 3);
      if (c.width !== cols || c.height !== rows) {
        c.width = cols;
        c.height = rows;
      }
      this.onScreen = true;
    }
    return this.layout;
  }

  /** Shown (the fights) or not (the title and the end titles cover it). */
  show(on: boolean): void {
    const d = on && this.layout ? 'block' : 'none';
    if (this.el.style.display !== d) this.el.style.display = d;
  }

  /** Leaving: the room goes dark (as the screen switches off). */
  leave(): void {
    this.el.classList.add('omfcr-off');
  }

  /** The game's picture back to the whole window. */
  restore(): void {
    const c = this.canvas;
    if (!c || !this.onScreen) return;
    this.onScreen = false;
    for (const p of CANVAS_PROPS) c.style.removeProperty(p);
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(c.clientWidth * dpr));
    c.height = Math.max(1, Math.round(c.clientHeight * dpr));
  }

  dispose(): void {
    this.restore();
    this.el.remove();
  }
}
