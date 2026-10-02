import { BinaryReader, BinaryWriter } from '../util/reader';
import { Sprite } from './sprite';

/** A hit coordinate belonging to one sprite frame of an attack animation. */
export interface CollisionCoord {
  x: number;
  y: number;
  nullValue: number;
  frameId: number;
}

export const ANIMATION_STRING_MAX = 1024;
export const EXTRA_STRING_MAX = 512;

/** Raw animation record shared by AF moves and BK scene animations. */
export class AnimationData {
  startX = 0;
  startY = 0;
  nullValue = 0;
  coords: CollisionCoord[] = [];
  animString = '';
  extraStrings: string[] = [];
  sprites: Sprite[] = [];

  static load(r: BinaryReader): AnimationData {
    const a = new AnimationData();
    a.startX = r.i16();
    a.startY = r.i16();
    a.nullValue = r.u32();
    const coordCount = r.u16();
    const spriteCount = r.u8();
    if (coordCount > 256) throw new Error(`Animation has too many coords (${coordCount})`);
    for (let i = 0; i < coordCount; i++) {
      const tmp = r.u32();
      const lo = tmp & 0xffff;
      const hi = tmp >>> 16;
      a.coords.push({
        x: ((lo & 0x3ff) ^ 0x200) - 0x200,
        nullValue: lo >> 10,
        y: ((hi & 0x3ff) ^ 0x200) - 0x200,
        frameId: hi >> 10,
      });
    }
    a.animString = r.terminatedStr(ANIMATION_STRING_MAX);
    const extraCount = r.u8();
    if (extraCount > 10) throw new Error(`Animation has too many extra strings (${extraCount})`);
    for (let i = 0; i < extraCount; i++) a.extraStrings.push(r.terminatedStr(EXTRA_STRING_MAX));
    for (let i = 0; i < spriteCount; i++) a.sprites.push(Sprite.load(r));
    return a;
  }

  /** Writes the record in the file layout load() reads. */
  save(w: BinaryWriter): void {
    w.i16(this.startX);
    w.i16(this.startY);
    w.u32(this.nullValue);
    w.u16(this.coords.length);
    w.u8(this.sprites.length);
    for (const c of this.coords) {
      const lo = (c.x & 0x3ff) | ((c.nullValue & 0x3f) << 10);
      const hi = (c.y & 0x3ff) | ((c.frameId & 0x3f) << 10);
      w.u32(((hi << 16) | lo) >>> 0);
    }
    w.terminatedStr(this.animString);
    w.u8(this.extraStrings.length);
    for (const e of this.extraStrings) w.terminatedStr(e);
    for (const s of this.sprites) s.save(w);
  }
}

/** Resolves `missing` sprites to the data of the last non-missing sprite with the same index. */
export function resolveMissingSprites(anims: Iterable<AnimationData>): void {
  const table = new Map<number, Uint8Array | null>();
  for (const anim of anims) {
    for (const s of anim.sprites) {
      if (s.missing > 0) {
        const d = table.get(s.index);
        if (d) s.data = d;
      } else {
        table.set(s.index, s.data);
      }
    }
  }
}
