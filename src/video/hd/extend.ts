// Widescreen background extension: widens a 320x200 scene background in index space so the
// same palette effects apply. The sides are mirrored copies of the edge regions; the HD
// compositor darkens/desaturates them progressively so the eye stays on the original playfield.
import { Surface } from '../surface';

/** Extra native pixels built on each side (enough for ~21:9). */
export const EXT_MAX = 128;

const cache = new WeakMap<Surface, { version: number; surf: Surface }>();

/** Uses a ready-made widescreen version of a background (EXT_MAX more columns on each side) instead of mirroring. */
export function setExtendedBackground(bg: Surface, wide: Surface): void {
  if (wide.w !== bg.w + EXT_MAX * 2 || wide.h !== bg.h) return;
  cache.set(bg, { version: bg.version, surf: wide });
}

export function extendedBackground(bg: Surface): Surface {
  const hit = cache.get(bg);
  if (hit && hit.version === bg.version) return hit.surf;
  const w = bg.w;
  const h = bg.h;
  const ew = w + EXT_MAX * 2;
  const out = new Surface(ew, h, undefined, -1);
  const src = bg.data;
  const dst = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < ew; x++) {
      let sx = x - EXT_MAX;
      // Mirror at the edges (reflect without repeating the edge column), wrapping if needed.
      if (sx < 0) sx = -sx - 1;
      if (sx >= w) sx = 2 * w - sx - 1;
      sx = Math.max(0, Math.min(w - 1, sx));
      dst[y * ew + x] = src[y * w + sx];
    }
  }
  out.source = { kind: 'background', key: `${bg.source?.key ?? 'bg'}#ext` };
  cache.set(bg, { version: bg.version, surf: out });
  return out;
}
