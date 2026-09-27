// Segmented stat gauge of the mechlab dashboards (port of the reference gui/gauge.c).
import { video } from '../../video/draw';
import { Surface } from '../../video/surface';
import { Component } from './widgets';

export const enum GaugeType {
  SMALL,
  BIG,
}

// Palette indices: 0xA7..0xA0 are greens from bright to dark.
const SMALL_OFF = { w: 3, h: 3, data: [0xa3, 0xa2, 0xa1, 0xa2, 0xa1, 0xa0, 0xa1, 0xa0, 0xa0] };
const SMALL_ON = { w: 3, h: 3, data: [0xa7, 0xa6, 0xa5, 0xa5, 0xa4, 0xa3, 0xa3, 0xa2, 0xa1] };
const BIG_ON = {
  w: 8, h: 3,
  data: [
    0xa7, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa5,
    0xa5, 0xa4, 0xa4, 0xa4, 0xa4, 0xa4, 0xa4, 0xa3,
    0xa3, 0xa2, 0xa2, 0xa2, 0xa2, 0xa2, 0xa2, 0xa1,
  ],
};
const BIG_OFF = {
  w: 8, h: 3,
  data: [
    0xa3, 0xa2, 0xa2, 0xa2, 0xa2, 0xa2, 0xa2, 0xa1,
    0xa2, 0xa1, 0xa1, 0xa1, 0xa1, 0xa1, 0xa1, 0xa0,
    0xa1, 0xa1, 0xa1, 0xa1, 0xa1, 0xa1, 0xa1, 0xa0,
  ],
};

// The segment images never change: one surface of each is shared by all gauges.
const surfaces = new Map<object, Surface>();
function surfaceFromPixImg(pix: { w: number; h: number; data: number[] }, key: string): Surface {
  let s = surfaces.get(pix);
  if (!s) {
    s = new Surface(pix.w, pix.h, Uint8Array.from(pix.data), 0);
    s.source = { kind: 'generated', key: `gauge/${key}` };
    surfaces.set(pix, s);
  }
  return s;
}

export class Gauge extends Component {
  size: number;
  lit: number;
  type: GaugeType;
  on: Surface;
  off: Surface;

  /** gauge_create() */
  constructor(type: GaugeType, size: number, lit: number) {
    super();
    this.supportsDisable = false;
    this.supportsSelect = false;
    this.size = size;
    this.type = type;
    this.lit = Math.max(0, Math.min(size, lit));
    if (type === GaugeType.SMALL) {
      this.on = surfaceFromPixImg(SMALL_ON, 'small-on');
      this.off = surfaceFromPixImg(SMALL_OFF, 'small-off');
      this.setSizeHints(SMALL_ON.w * size, SMALL_ON.h);
    } else {
      this.on = surfaceFromPixImg(BIG_ON, 'big-on');
      this.off = surfaceFromPixImg(BIG_OFF, 'big-off');
      this.setSizeHints(BIG_ON.w * size, BIG_ON.h);
    }
  }

  override render(): void {
    let k = 0;
    let x = this.x;
    for (; k < this.lit; k++) {
      video.draw(this.on, x, this.y);
      x += this.on.w;
    }
    for (; k < this.size; k++) {
      video.draw(this.off, x, this.y);
      x += this.on.w;
    }
  }

  /** gauge_set_lit() (not clamped, like the reference) */
  setLit(lit: number): void {
    if (lit !== this.lit) this.lit = lit;
  }

  getLit(): number {
    return this.lit;
  }

  getSize(): number {
    return this.size;
  }

  /** gauge_set_size(): also clamps the lit count. */
  setSize(size: number): void {
    if (size !== this.size) {
      this.size = size;
      if (this.lit > this.size) this.lit = this.size;
    }
  }
}
