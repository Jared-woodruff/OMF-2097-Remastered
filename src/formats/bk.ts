import { BinaryReader } from '../util/reader';
import { AnimationData, resolveMissingSprites } from './animation';
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

export function parseBK(data: Uint8Array): BkFile {
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
    const footerString = r.paddedStr(512);
    const animation = AnimationData.load(r);
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
