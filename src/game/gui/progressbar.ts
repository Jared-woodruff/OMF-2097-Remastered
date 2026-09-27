// Health / endurance bars (port of the reference progress bar widget).
import { video } from '../../video/draw';
import { Surface } from '../../video/surface';

export interface ProgressBarTheme {
  borderTopLeft: number;
  borderBottomRight: number;
  bg: number;
  bgAlt: number;
  intTopLeft: number;
  intBottomRight: number;
  intBg: number;
}

export const THEME_HEALTH: ProgressBarTheme = {
  borderTopLeft: 0xb9, borderBottomRight: 0xbe, bg: 0xf9, bgAlt: 0xf9, intTopLeft: 0xb7, intBottomRight: 0xb4, intBg: 0xf6,
};
export const THEME_ENDURANCE: ProgressBarTheme = {
  borderTopLeft: 0xb9, borderBottomRight: 0xbe, bg: 0xf9, bgAlt: 0xbe, intTopLeft: 0xe2, intBottomRight: 0xe0, intBg: 0xf8,
};
export const THEME_MELEE: ProgressBarTheme = {
  borderTopLeft: 0xa2, borderBottomRight: 0xa2, bg: 0, bgAlt: 0, intTopLeft: 0xa7, intBottomRight: 0xa3, intBg: 0xa5,
};

export const PROGRESSBAR_LEFT = 0;
export const PROGRESSBAR_RIGHT = 1;

function bevelBox(w: number, h: number, fill: number, tl: number, br: number): Surface {
  const s = new Surface(w, h, undefined, 0);
  s.clear(fill);
  s.rectBevel(0, 0, w - 1, h - 1, tl, br, br, tl);
  s.source = { kind: 'generated', key: 'bar' };
  return s;
}

export class ProgressBar {
  x = 0;
  y = 0;
  w = 0;
  h = 0;
  private background: Surface | null = null;
  private backgroundAlt: Surface | null = null;
  private block: Surface | null = null;
  percentage: number;
  displayPercentage: number;
  private flashing = 0;
  private rate = 0;
  private state = 0;
  private tickCount = 0;
  private refresh = true;
  highlight = false;

  constructor(public theme: ProgressBarTheme, public orientation: number, percentage: number) {
    this.percentage = Math.max(0, Math.min(100, percentage));
    this.displayPercentage = this.percentage;
  }

  layout(x: number, y: number, w: number, h: number): void {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.background = bevelBox(w, h, this.theme.bg, this.theme.borderTopLeft, this.theme.borderBottomRight);
    this.backgroundAlt = bevelBox(w, h, this.theme.bgAlt, this.theme.borderTopLeft, this.theme.borderBottomRight);
    this.block = null;
    this.refresh = true;
  }

  setProgress(percentage: number, animate: boolean): void {
    const tmp = Math.max(0, Math.min(100, Math.trunc(percentage)));
    if (!this.refresh) this.refresh = tmp !== this.percentage;
    this.percentage = tmp;
    if (!animate || this.percentage > this.displayPercentage) this.displayPercentage = this.percentage;
  }

  setFlashing(flashing: boolean, rate: number): void {
    const f = flashing ? 1 : 0;
    if (f !== this.flashing) {
      this.tickCount = 0;
      this.state = 0;
    }
    this.flashing = f;
    this.rate = rate < 0 ? 0 : rate;
  }

  tick(): void {
    if (this.flashing) {
      if (this.tickCount > this.rate) {
        this.tickCount = 0;
        this.state = this.state ? 0 : 1;
      }
      this.tickCount++;
    }
  }

  render(): void {
    if (this.refresh || this.displayPercentage > this.percentage) {
      this.refresh = false;
      if (this.displayPercentage > this.percentage) this.displayPercentage--;
      const w = Math.trunc(this.w * (this.displayPercentage / 100));
      const h = this.h;
      if (w > 1 && h > 1) {
        this.block = bevelBox(w, h, this.theme.intBg, this.theme.intTopLeft, this.theme.intBottomRight);
        this.block.transparent = -1;
      } else {
        this.block = null;
      }
    }
    const bg = this.state ? this.backgroundAlt : this.background;
    if (bg) video.draw(bg, this.x, this.y);
    if (this.block) {
      const bx = this.x + (this.orientation === PROGRESSBAR_LEFT ? 0 : this.w - this.block.w);
      video.drawOffset(this.block, bx, this.y, this.highlight ? 1 : 0, 255);
    }
  }

  /** Fraction currently displayed (for HD HUD rendering). */
  displayFraction(): number {
    return this.displayPercentage / 100;
  }

  isFlashingOn(): boolean {
    return this.state === 1;
  }
}
