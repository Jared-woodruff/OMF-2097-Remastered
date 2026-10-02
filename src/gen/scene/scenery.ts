// The new arenas' moving scenery: set pieces modeled and rendered in Blender (tools/blender/setpiece.py; their HD
// pictures are in src/gen/scene/scenery/), played as animations of the arena's own that loop from the start of the fight
// (the arena's `loops`: no collision, behind the robots). Their classic sprites are those pictures scaled down to the
// native pixels and indexed in the arena's own colors. The new arenas' mod gets them from src/gen/dev/extras.test.ts.
//
// Pieces that pass behind parts of the painting (a window's bars, a dome's ribs, the rocks around a cave's mouth) have a
// cut-out over them: those parts of the painting (tools/scenery-cutout.py) as a sprite of the arena's own drawn after
// them, its native pixels the arena's own background's where its picture covers it (so it matches in both looks).
import { AnimationData } from '../../formats/animation';
import type { BkAnimData } from '../../formats/bk';
import type { Palette } from '../../formats/palette';
import { encodeSprite, Sprite } from '../../formats/sprite';
import { WIDE_EXTRA } from './build';
import { OWN_COUNT, OWN_FIRST } from './palette';

/** Native pixels of margin the pictures cover around their sprites (the mods' default, hd.json's pad). */
export const SCENERY_PAD = 4;

export interface SceneryPiece {
  /** The arena's scene file, and the animation slot (a free one: not 6-11, 20-22 or 24-27; a cut-out's after the
   * pieces that pass behind it, which are drawn first). */
  arena: string;
  slot: number;
  /** Its frames' HD pictures, in src/gen/scene/scenery/ (the sprite and its margin, 5 x 6 HD pixels per native pixel
   * or a multiple): sprites A, B... in this order. A cut-out's is a lossless WebP (its pixels are the painting's), its
   * native pixels the PNG of the same name (w x h, opaque where it is cut out). */
  frames: string[];
  /** The sprite's native size (without the margin), and the native point its middle starts at (a cut-out's top left
   * corner). */
  w: number;
  h: number;
  x: number;
  y: number;
  /** The animation string. */
  string: string;
  /** How much of a native pixel its pictures must cover for the classic sprite to draw it (default half; less for
   * thin, glowing things). */
  cover?: number;
  /** A cut-out of the painting (see above). */
  cutout?: boolean;
}

type Point = [number, number];

/**
 * A trip across the arena: hidden for `wait` ticks, then from `from` to `to` (native, from the start point) while its
 * sprites cycle through `cycle` (sprite letter and ticks) `times` times; hidden at the end.
 */
function trip(wait: number, from: Point, to: Point, cycle: [string, number][], times: number): string {
  const steps: string[] = [];
  for (let i = 0; i < times; i++) for (const [s, t] of cycle) steps.push(`${s}${t}`);
  const at = (p: Point) => `x=${p[0]}${from[1] || to[1] ? `y=${p[1]}` : ''}`;
  return `Z${wait}-${at(from)}${steps.join('-')}-${at(to)}Z1`;
}

/** A cut-out's animation: its one sprite, all the time. */
const STILL = 'A1000';

export const SCENERY: SceneryPiece[] = [
  // ROOFTOP: a hover-car cruising across the night sky from right to left, about every forty seconds (at the default
  // speed a tick is about 30 ms: 25 s hidden, 12 s crossing).
  {
    arena: 'ARENA7.BK', slot: 30, frames: ['rooftop-car-A.png', 'rooftop-car-B.png'], w: 40, h: 14, x: 0, y: 34,
    string: trip(830, [480, 0], [-160, 0], [['A', 10], ['B', 10]], 20),
  },
  // ORBITAL: a shuttle passing outside the hangar's window from left to right, behind its bars, its strobe flashing
  // (30 s hidden, 12 s crossing: from behind the wall left of the window to behind the scaffold on its right).
  {
    arena: 'ARENA5.BK', slot: 30, frames: ['orbital-shuttle-A.png', 'orbital-shuttle-B.png'], w: 40, h: 14, x: 0, y: 75,
    string: trip(1000, [6, 0], [312, 0], [['A', 3], ['B', 30]], 12),
  },
  // (tools/scenery-cutout.py orbital --rect -20,54,360,46 --near 55: the bars, the frame, the walls and the scaffold)
  { arena: 'ARENA5.BK', slot: 31, frames: ['orbital-cutout.webp'], w: 360, h: 46, x: -20, y: 54, string: STILL, cutout: true },
  // ICE CAVE: shooting stars over the mountains, between the rocks (out from behind the left ones; one into the right
  // ones, two burning out in the sky), every 15 to 30 seconds.
  {
    arena: 'ARENA6.BK', slot: 30, frames: ['ice-cave-meteor-A.png', 'ice-cave-meteor-B.png'], w: 32, h: 12, x: 0, y: 0, cover: 0.2,
    string: [
      trip(500, [96, 8], [226, 53], [['A', 2], ['B', 2]], 8),
      trip(900, [130, 2], [200, 26], [['A', 2], ['B', 2]], 5),
      trip(700, [110, 18], [195, 47], [['A', 2], ['B', 2]], 6),
    ].join('-'),
  },
  // (tools/scenery-cutout.py ice-cave --rect 60,0,196,64 --near 30: the rocks, the icicles and the crystals)
  { arena: 'ARENA6.BK', slot: 31, frames: ['ice-cave-cutout.webp'], w: 196, h: 64, x: 60, y: 0, string: STILL, cutout: true },
  // ABYSS: a research submersible gliding past the dome from right to left, behind its ribs, its lamps lighting the
  // water ahead (35 s hidden, 22 s crossing, from beyond one end of the painting to beyond the other).
  {
    arena: 'ARENA8.BK', slot: 30, frames: ['abyss-sub-A.png', 'abyss-sub-B.png'], w: 64, h: 22, x: 0, y: 40,
    string: trip(1100, [486, 0], [-166, 0], [['A', 4], ['B', 36]], 18),
  },
  // (tools/scenery-cutout.py abyss --rect -128,25,576,31 --near 45: the dome's ribs, its ring and their lamps)
  { arena: 'ARENA8.BK', slot: 31, frames: ['abyss-cutout.webp'], w: 576, h: 31, x: -128, y: 25, string: STILL, cutout: true },
];

/** A picture (decoded RGBA). */
export interface SceneryPicture {
  w: number;
  h: number;
  rgba: Uint8Array;
}

/**
 * A piece's animation in an arena whose own colors are `pal`'s (OWN_FIRST..), from its pictures; a cut-out's from its
 * native pixels (`pictures`: the PNG of its picture's name) and the arena's widescreen background (`wide`: 576 x 200
 * indices, native x -128..448).
 */
export function sceneryAnim(p: SceneryPiece, pictures: SceneryPicture[], pal: Palette, wide?: Uint8Array): BkAnimData {
  const a = new AnimationData();
  a.startX = p.x;
  a.startY = p.y;
  a.animString = p.string;
  a.sprites = pictures.map((pic) => {
    const s = new Sprite();
    s.posX = p.cutout ? 0 : -Math.floor(p.w / 2);
    s.posY = p.cutout ? 0 : -Math.floor(p.h / 2);
    let pixels: Uint8Array;
    if (p.cutout) {
      if (!wide) throw new Error(`${p.arena}: a cut-out needs the arena's widescreen background`);
      pixels = cutoutPixels(pic, p, wide);
    } else {
      pixels = nativePixels(pic, p.w, p.h, pal, p.cover ?? 0.5);
    }
    s.setData(encodeSprite(pixels, p.w, p.h), p.w, p.h);
    return s;
  });
  return { nullValue: 0, chainHit: 0, chainNoHit: 0, repeat: 0, probability: 1, hazardDamage: 0, footerString: '', animation: a };
}

/** Each native pixel's share of the picture's coverage and its color (alpha-weighted), over the sprite's area. */
function cells(pic: SceneryPicture, w: number, h: number, each: (x: number, y: number, cover: number, r: number, g: number, b: number) => void): void {
  const kx = pic.w / (w + 2 * SCENERY_PAD), ky = pic.h / (h + 2 * SCENERY_PAD);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, cover = 0, n = 0;
      for (let sy = Math.floor((y + SCENERY_PAD) * ky); sy < Math.floor((y + SCENERY_PAD + 1) * ky); sy++) {
        for (let sx = Math.floor((x + SCENERY_PAD) * kx); sx < Math.floor((x + SCENERY_PAD + 1) * kx); sx++) {
          const i = (sy * pic.w + sx) * 4;
          const al = pic.rgba[i + 3] / 255;
          r += pic.rgba[i] * al;
          g += pic.rgba[i + 1] * al;
          b += pic.rgba[i + 2] * al;
          cover += al;
          n++;
        }
      }
      if (n > 0) each(x, y, cover / n, r / Math.max(cover, 1e-6), g / Math.max(cover, 1e-6), b / Math.max(cover, 1e-6));
    }
  }
}

/** A picture's sprite area scaled down to w x h native pixels (averaged by coverage), in the arena's own colors (0:
 * transparent where it is covered less than `least`). */
function nativePixels(pic: SceneryPicture, w: number, h: number, pal: Palette, least: number): Uint8Array {
  const out = new Uint8Array(w * h);
  cells(pic, w, h, (x, y, cover, r, g, b) => {
    if (cover < least) return;
    let best = OWN_FIRST, bestD = Infinity;
    for (let c = OWN_FIRST; c < OWN_FIRST + OWN_COUNT; c++) {
      const d = (pal.r(c) - r) ** 2 + (pal.g(c) - g) ** 2 + (pal.b(c) - b) ** 2;
      if (d < bestD) (bestD = d), (best = c);
    }
    out[y * w + x] = best;
  });
  return out;
}

/** A cut-out's native pixels: the arena's background's where its mask (w x h) is opaque. */
function cutoutPixels(mask: SceneryPicture, p: SceneryPiece, wide: Uint8Array): Uint8Array {
  if (mask.w !== p.w || mask.h !== p.h) throw new Error(`${p.arena}: the cut-out's mask is ${mask.w} x ${mask.h}, not ${p.w} x ${p.h}`);
  const ww = 320 + 2 * WIDE_EXTRA;
  const out = new Uint8Array(p.w * p.h);
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const wx = p.x + x + WIDE_EXTRA, wy = p.y + y;
      if (mask.rgba[(y * p.w + x) * 4 + 3] >= 128 && wx >= 0 && wx < ww && wy >= 0 && wy < 200) out[y * p.w + x] = wide[wy * ww + wx];
    }
  }
  return out;
}
