import { BinaryReader, BinaryWriter } from '../util/reader';
import { AnimationData, LENIENT_STRING_MAX, resolveMissingSprites } from './animation';
import { Palette, RemapTables } from './palette';

export const MAX_BK_ANIMS = 50;

/** A scene animation (background element, hazard, menu graphic, ...). */
export interface BkAnimData {
  nullValue: number;
  chainHit: number;
  chainNoHit: number;
  repeat: number;
  probability: number;
  hazardDamage: number;
  footerString: string;
  animation: AnimationData;
}

/** Scene file (arena, menu, cutscene): *.BK */
export interface BkFile {
  fileId: number;
  unknownA: number;
  width: number;
  height: number;
  anims: (BkAnimData | null)[];
  /** width*height palette indices */
  background: Uint8Array;
  palettes: Palette[];
  remaps: RemapTables[];
  soundTable: Uint8Array;
}

/** Reads a BK file; `lenient`: past the format's string and hit point limits too (see AnimationData.load). */
export function parseBK(data: Uint8Array, lenient = false): BkFile {
  const r = new BinaryReader(data);
  const fileId = r.u32();
  const unknownA = r.u8();
  const width = r.u16();
  const height = r.u16();
  const anims = new Array<BkAnimData | null>(MAX_BK_ANIMS).fill(null);
  while (r.ok()) {
    r.skip(4); // offset of next animation
    const animNo = r.u8();
    if (animNo >= MAX_BK_ANIMS) break;
    const nullValue = r.u8();
    const chainHit = r.u8();
    const chainNoHit = r.u8();
    const repeat = r.u8();
    const probability = r.u16();
    const hazardDamage = r.u8();
    const footerString = r.paddedStr(lenient ? LENIENT_STRING_MAX : 512);
    const animation = AnimationData.load(r, lenient);
    anims[animNo] = { nullValue, chainHit, chainNoHit, repeat, probability, hazardDamage, footerString, animation };
  }
  const background = r.bytes(width * height).slice();
  const paletteCount = r.u8();
  const palettes: Palette[] = [];
  const remaps: RemapTables[] = [];
  for (let i = 0; i < paletteCount; i++) {
    palettes.push(Palette.load(r));
    remaps.push(RemapTables.load(r));
  }
  const soundTable = r.bytes(30).slice();
  resolveMissingSprites(anims.filter((a): a is BkAnimData => a !== null).map((a) => a.animation));
  return { fileId, unknownA, width, height, anims, background, palettes, remaps, soundTable };
}

/** Writes a BK file (the inverse of parseBK; used for the generated arenas). */
export function saveBK(bk: BkFile): Uint8Array {
  const w = new BinaryWriter(bk.width * bk.height + (1 << 16));
  w.u32(bk.fileId);
  w.u8(bk.unknownA);
  w.u16(bk.width);
  w.u16(bk.height);
  bk.anims.forEach((a, id) => {
    if (!a) return;
    const rec = new BinaryWriter(4096);
    rec.u8(id);
    rec.u8(a.nullValue);
    rec.u8(a.chainHit);
    rec.u8(a.chainNoHit);
    rec.u8(a.repeat);
    rec.u16(a.probability);
    rec.u8(a.hazardDamage);
    // (refused rather than written past what parseBK reads back)
    if (a.footerString.length >= 511) throw new Error(`animation ${id}: a reaction string of ${a.footerString.length} characters (510 at most)`);
    rec.paddedStr(a.footerString);
    try {
      a.animation.save(rec);
    } catch (err) {
      throw new Error(`animation ${id}: ${(err as Error).message}`);
    }
    const bytes = rec.toBytes();
    // Offset of the next animation record (read past by the parser, kept for the original engine's layout).
    w.u32(w.pos + 4 + bytes.length);
    w.bytes(bytes);
  });
  w.u32(w.pos + 4);
  w.u8(250);
  w.bytes(bk.background);
  w.u8(bk.palettes.length);
  bk.palettes.forEach((p, i) => {
    p.saveRange(w, 0, 256);
    for (const t of bk.remaps[i].tables) w.bytes(t);
  });
  w.bytes(bk.soundTable);
  return w.toBytes();
}
