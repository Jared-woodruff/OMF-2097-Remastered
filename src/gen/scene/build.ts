// Builds a generated arena's scene file (BK, the format of the original arenas) and its native widescreen background:
// the scene rendered 576 columns wide (the classic screen is its middle 320), indexed with the arena's own 64 colors.
// Only the arena's own content is stored; the game adds the parts every arena shares when it loads the file
// (resources.ts: the shared palette entries, the robots' remap rows, the round and fight announcements, sounds).
import type { BkFile } from '../../formats/bk';
import { MAX_BK_ANIMS } from '../../formats/bk';
import { Palette, RemapTables } from '../../formats/palette';
import { encodeSprite } from '../../formats/sprite';
import { BinaryWriter } from '../../util/reader';
import type { GenArena } from './arenas';
import { buildRemaps, choosePalette, indexImage, OWN_COUNT, OWN_FIRST } from './palette';
import { renderScene, type RenderedImage } from './render';

/** Extra native columns on each side of the widescreen background (the classic renderer's EXT_MAX). */
export const WIDE_EXTRA = 128;

export interface BuiltArena {
  bk: BkFile;
  /** The widescreen background (576 x 200 indices). */
  wide: Uint8Array;
  /** The full-color render (for previews). */
  image: RenderedImage;
}

/** Renders, quantizes and assembles an arena; `ref` is the reference arena (ARENA0) for the shared colors and tables. */
export function buildArena(a: GenArena, ref: BkFile, ss = 2): BuiltArena {
  const image = renderScene(a.scene(), -WIDE_EXTRA, 320 + 2 * WIDE_EXTRA, 200, ss);
  const pal = choosePalette([image], ref.palettes[0]);
  const wide = indexImage(image, pal);
  const background = new Uint8Array(320 * 200);
  for (let y = 0; y < 200; y++) background.set(wide.subarray(y * image.w + WIDE_EXTRA, y * image.w + WIDE_EXTRA + 320), y * 320);
  const remaps = buildRemaps(pal, ref.palettes[0], ref.remaps[0]);
  // Only the arena's own entries and rows are stored.
  const own = new Palette();
  own.copyRange(pal, OWN_FIRST, OWN_COUNT);
  const ownRemaps = new RemapTables();
  for (const t of ownRemaps.tables) t.fill(0);
  remaps.tables.forEach((t, k) => ownRemaps.tables[k].set(t.subarray(OWN_FIRST), OWN_FIRST));
  const bk: BkFile = {
    fileId: a.fileId,
    unknownA: 0,
    width: 320,
    height: 200,
    anims: new Array(MAX_BK_ANIMS).fill(null),
    background,
    palettes: [own],
    remaps: [ownRemaps],
    soundTable: new Uint8Array(30),
  };
  return { bk, wide, image };
}

/** The widescreen background file: width, height, then the indices (RLE like sprites; indices are never 0). */
export function saveWide(wide: Uint8Array, w: number, h: number): Uint8Array {
  const out = new BinaryWriter(w * h);
  out.u16(w);
  out.u16(h);
  out.bytes(encodeSprite(wide, w, h));
  return out.toBytes();
}
