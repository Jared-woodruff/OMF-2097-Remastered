// Smaller data files: SOUNDS.DAT, ENGLISH.DAT, fonts, ALTPALS.DAT, PIC files.
import { BinaryReader, xorDecode, cstr } from '../util/reader';
import { Palette } from './palette';
import { Sprite } from './sprite';

// ---------------------------------------------------------------------------
// SOUNDS.DAT — unsigned 8-bit mono PCM (8 kHz nominal)

export interface SoundEntry {
  /** Unsigned 8-bit samples (128 = silence). Empty if the slot is unused. */
  data: Uint8Array;
  freqKey: number;
}

export function parseSounds(data: Uint8Array): SoundEntry[] {
  const r = new BinaryReader(data);
  if (r.u32() !== 0) throw new Error('SOUNDS.DAT: bad header');
  const headerSize = r.u32();
  const blocks = headerSize / 4 - 2;
  for (let i = 0; i < blocks; i++) r.u32();
  const sounds: SoundEntry[] = [];
  for (let i = 0; i <= blocks; i++) {
    const len = r.u16();
    if (len > 0) {
      const freqKey = r.u8();
      sounds.push({ data: r.bytes(len).slice(), freqKey });
    } else {
      sounds.push({ data: new Uint8Array(0), freqKey: 0 });
    }
  }
  return sounds;
}

// ---------------------------------------------------------------------------
// ENGLISH.DAT / GERMAN.DAT — XOR-obfuscated string table

export interface LangString {
  description: string;
  text: string;
}

export function parseLanguage(data: Uint8Array): LangString[] {
  const r = new BinaryReader(data);
  const size = data.length;
  const offsets: number[] = [];
  const descs: string[] = [];
  while (r.remaining >= 36) {
    const off = r.u32();
    if (off >= size) break;
    offsets.push(off);
    descs.push(r.fixedStr(32));
  }
  offsets.push(size);
  const out: LangString[] = [];
  for (let i = 0; i < descs.length; i++) {
    const len = offsets[i + 1] - offsets[i];
    const text = len > 0 ? cstr(xorDecode(data.subarray(offsets[i], offsets[i + 1]), len & 0xff)) : '';
    out.push({ description: descs[i], text });
  }
  return out;
}

// ---------------------------------------------------------------------------
// CHARSMAL.DAT (6px) / GRAPHCHR.DAT (8px) — 224 1bpp glyphs starting at char 32

export interface BitmapFont {
  size: number;
  /** glyphs[c] = size*size mask (1 = set) for chars 0..223 (i.e. codepoint - 32). */
  glyphs: Uint8Array[];
}

export function parseFont(data: Uint8Array, size: number): BitmapFont {
  const glyphs: Uint8Array[] = [];
  for (let c = 0; c < 224; c++) {
    const g = new Uint8Array(size * size);
    for (let row = 0; row < size; row++) {
      const bits = data[c * size + row] ?? 0;
      for (let k = size - 1, col = 0; k >= 0; k--, col++) {
        g[row * size + col] = bits & (1 << k) ? 1 : 0;
      }
    }
    glyphs.push(g);
  }
  return { size, glyphs };
}

// ---------------------------------------------------------------------------
// ALTPALS.DAT — 11 alternate palettes (HAR color ramps live in palette 0)

export function parseAltPals(data: Uint8Array): Palette[] {
  const r = new BinaryReader(data);
  const pals: Palette[] = [];
  for (let i = 0; i < 11; i++) {
    const p = new Palette();
    p.loadRange(r, 0, 256);
    pals.push(p);
  }
  return pals;
}

// ---------------------------------------------------------------------------
// *.PIC — pilot portraits

export interface PicPhoto {
  isPlayer: number;
  sex: number;
  /** Colors 0..47 are valid. */
  palette: Palette;
  hasPhoto: number;
  sprite: Sprite;
}

export function parsePic(data: Uint8Array): PicPhoto[] {
  const r = new BinaryReader(data);
  const count = r.i32();
  if (count < 0 || count >= 256) throw new Error('PIC: bad photo count');
  r.seek(200);
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) offsets.push(r.i32());
  const photos: PicPhoto[] = [];
  for (let i = 0; i < count; i++) {
    r.seek(offsets[i]);
    const isPlayer = r.u8();
    const sex = r.u16();
    const palette = new Palette();
    palette.loadRange(r, 0, 48);
    const hasPhoto = r.u8();
    const sprite = Sprite.load(r);
    sprite.width++;
    sprite.height++;
    photos.push({ isPlayer, sex, palette, hasPhoto, sprite });
  }
  return photos;
}
