// Health / endurance bars (port of the reference progress bar widget). The remastered renderer can draw them as
// vector graphics from a description in the draw list (see HudBar), with a trail showing recent damage.
import { drawList, video, type HudBar } from '../../video/draw';
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

/**
 * Recent-damage trail of the remastered bars (fights run about 36 ticks per second at the default speed): it holds
 * for a moment after the last hit, then drains, large gaps faster.
 */
const TRAIL_HOLD_TICKS = 20;
const TRAIL_DRAIN_MIN = 0.8;
const TRAIL_DRAIN_RATE = 0.1;
/** Remastered low-health warning pulse: below this percentage, one pulse per this many ticks. */
const LOW_PULSE_TICKS = 40;

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
  /** Remastered bars (health): show the damage just taken as a trail, and pulse the fill below `warnBelow` percent. */
  damageTrail = false;
  warnBelow = 0;
  /** Percentage shown by the remastered trail (recent damage), and its hold time. Cosmetic only. */
  private trail: number;
  private trailHold = 0;
  /** Tick counter, and the ticks at which the warnings started (their pulses start from zero). */
  private ticks = 0;
  private flashStart = 0;
  private lowStart = 0;

  constructor(public theme: ProgressBarTheme, public orientation: number, percentage: number) {
    this.percentage = Math.max(0, Math.min(100, percentage));
    this.displayPercentage = this.percentage;
    this.trail = this.percentage;
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
    if (tmp < this.percentage) this.trailHold = TRAIL_HOLD_TICKS;
    if (tmp < this.warnBelow && this.percentage >= this.warnBelow) this.lowStart = this.ticks;
    this.percentage = tmp;
    if (!animate || this.percentage > this.displayPercentage) this.displayPercentage = this.percentage;
    if (!animate || !this.damageTrail || this.percentage > this.trail) this.trail = this.percentage;
  }

  setFlashing(flashing: boolean, rate: number): void {
    const f = flashing ? 1 : 0;
    if (f !== this.flashing) {
      this.tickCount = 0;
      this.state = 0;
      this.flashStart = this.ticks;
    }
    this.flashing = f;
    this.rate = rate < 0 ? 0 : rate;
  }

  tick(): void {
    this.ticks++;
    if (this.trail > this.percentage) {
      if (this.trailHold > 0) this.trailHold--;
      else {
        const gap = this.trail - this.percentage;
        this.trail -= Math.min(gap, Math.max(TRAIL_DRAIN_MIN, gap * TRAIL_DRAIN_RATE));
      }
    }
    if (this.flashing) {
      if (this.tickCount > this.rate) {
        this.tickCount = 0;
        this.state = this.state ? 0 : 1;
      }
      this.tickCount++;
    }
  }

  render(): void {
    const first = drawList.count;
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
    if (drawList.count > first) this.describe(drawList.pushBar(first));
  }

  /** The remastered renderer's description of this bar. */
  private describe(b: HudBar): void {
    const t = this.theme;
    b.x = this.x;
    b.y = this.y;
    b.w = this.w;
    b.h = this.h;
    b.value = this.percentage / 100;
    b.trail = Math.max(this.percentage, this.trail) / 100;
    b.dir = this.orientation === PROGRESSBAR_LEFT ? 0 : 1;
    const c = b.colors;
    c[0] = t.borderTopLeft;
    c[1] = t.borderBottomRight;
    c[2] = t.bg;
    c[3] = t.bgAlt;
    c[4] = t.intTopLeft;
    c[5] = t.intBottomRight;
    c[6] = t.intBg;
    b.palOffset = this.highlight ? 1 : 0;
    // The bar surfaces' transparent color is index 0.
    b.clearTrack = t.bg === 0;
    // Smooth versions of the original warnings, following the game clock (and its interpolation).
    const time = this.ticks + Math.max(0, drawList.interpAlpha);
    b.flash = this.flashing ? 0.5 - 0.5 * Math.cos((Math.PI * (time - this.flashStart)) / (this.rate + 1)) : 0;
    const low = this.percentage > 0 && this.percentage < this.warnBelow;
    b.low = low ? 0.5 - 0.5 * Math.cos((2 * Math.PI * (time - this.lowStart)) / LOW_PULSE_TICKS) : 0;
  }
}
