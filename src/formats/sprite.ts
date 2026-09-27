import { BinaryReader, BinaryWriter } from '../util/reader';

/**
 * A raw OMF sprite: RLE-ish encoded 8-bit palette indices. Index 0 is transparent.
 * `missing` sprites share pixel data with an earlier sprite of the same `index` (resolved at load).
 */
export class Sprite {
  posX = 0;
  posY = 0;
  width = 0;
  height = 0;
  index = 0;
  missing = 0;
  /** Encoded data (may be shared with another sprite when `missing`). */
  data: Uint8Array | null = null;
  private decoded: Uint8Array | null = null;

  static load(r: BinaryReader): Sprite {
    const s = new Sprite();
    const len = r.u16();
    s.posX = r.i16();
    s.posY = r.i16();
    s.width = r.u16();
    s.height = r.u16();
    s.index = r.u8();
    s.missing = r.u8();
    if (s.missing === 0 && len !== 0) {
      s.data = r.bytes(len).slice();
    }
    return s;
  }

  save(w: BinaryWriter): void {
    w.u16(this.data ? this.data.length : 0);
    w.i16(this.posX);
    w.i16(this.posY);
    w.u16(this.width);
    w.u16(this.height);
    w.u8(this.index);
    w.u8(this.missing);
    if (!this.missing && this.data) w.bytes(this.data);
  }

  /** True when the sprite has no pixel data (its width/height fields are meaningless). */
  isEmpty(): boolean {
    return !this.data || this.data.length === 0 || this.width === 0 || this.height === 0;
  }

  /** Decoded palette indices, row-major width*height (1x1 when empty); 0 = transparent. Cached. */
  pixels(): Uint8Array {
    if (!this.decoded) this.decoded = decodeSprite(this.data, this.width, this.height);
    return this.decoded;
  }

  clone(): Sprite {
    const s = new Sprite();
    s.posX = this.posX;
    s.posY = this.posY;
    s.width = this.width;
    s.height = this.height;
    s.index = this.index;
    s.missing = this.missing;
    s.data = this.data;
    s.decoded = this.decoded;
    return s;
  }
}

/** Decodes OMF sprite data. Opcodes (u16, low 2 bits): 0=set x, 1=run of N pixels, 2=set y, 3=end. */
export function decodeSprite(data: Uint8Array | null, width: number, height: number): Uint8Array {
  // Empty sprites carry garbage dimensions in the original files; they decode to a single transparent pixel.
  if (!data || data.length === 0 || width === 0 || height === 0) return new Uint8Array(1);
  const w = width;
  const h = height;
  const out = new Uint8Array(w * h);
  const size = w * h;
  let x = 0;
  let y = 0;
  let i = 0;
  const len = data.length;
  while (i + 1 < len) {
    const c = data[i] | (data[i + 1] << 8);
    const op = c & 3;
    let n = c >> 2;
    i += 2;
    if (op === 0) {
      x = n;
    } else if (op === 2) {
      y = n;
    } else if (op === 1) {
      while (n > 0 && i < len) {
        const pos = y * width + x;
        if (pos >= size) return out; // truncated data (matches reference guard)
        out[pos] = data[i];
        i++;
        x++;
        n--;
      }
      x = 0;
    } else {
      break;
    }
  }
  return out;
}

/** Encodes indexed pixels (0 = transparent) into OMF sprite data. */
export function encodeSprite(pixels: Uint8Array, w: number, h: number): Uint8Array {
  const out: number[] = [];
  const word = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff);
  for (let y = 0; y < h; y++) {
    let rowWritten = false;
    let x = 0;
    while (x < w) {
      if (pixels[y * w + x] === 0) {
        x++;
        continue;
      }
      let run = 0;
      while (x + run < w && pixels[y * w + x + run] !== 0) run++;
      if (!rowWritten) {
        word(y * 4 + 2);
        rowWritten = true;
      }
      word(x * 4);
      word(run * 4 + 1);
      for (let k = 0; k < run; k++) out.push(pixels[y * w + x + k]);
      x += run;
    }
  }
  word(3);
  return Uint8Array.from(out);
}
