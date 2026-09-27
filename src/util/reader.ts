/** Little-endian binary reader over a byte array, mirroring the original game's file I/O helpers. */
export class BinaryReader {
  readonly data: Uint8Array;
  readonly view: DataView;
  pos: number;

  constructor(data: Uint8Array, pos = 0) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.pos = pos;
  }

  get length(): number {
    return this.data.length;
  }

  get remaining(): number {
    return this.data.length - this.pos;
  }

  /** True while the read position is inside the buffer (the C code's `sd_reader_ok`). */
  ok(): boolean {
    return this.pos < this.data.length;
  }

  private need(n: number): void {
    if (this.pos + n > this.data.length) {
      throw new RangeError(`Read of ${n} bytes at ${this.pos} past end of data (${this.data.length})`);
    }
  }

  u8(): number {
    this.need(1);
    return this.data[this.pos++];
  }

  i8(): number {
    this.need(1);
    return this.view.getInt8(this.pos++);
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /** Returns a view (not a copy) of the next n bytes. */
  bytes(n: number): Uint8Array {
    this.need(n);
    const v = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }

  skip(n: number): void {
    this.pos += n;
  }

  seek(pos: number): void {
    this.pos = pos;
  }

  /** Fixed-size, NUL-padded string field. */
  fixedStr(len: number): string {
    return cstr(this.bytes(len));
  }

  /** u16 length, then `len` chars followed by a NUL terminator (len + 1 bytes). */
  terminatedStr(maxLen = 0xffff): string {
    const len = this.u16();
    if (len >= maxLen) throw new Error(`String too long (${len} >= ${maxLen})`);
    const buf = this.bytes(len + 1);
    if (buf[len] !== 0) throw new Error('String is not NUL terminated');
    return cstr(buf.subarray(0, len));
  }

  /** u16 length, then `len` bytes (NUL padding inside the length). */
  paddedStr(maxLen = 0xffff): string {
    const len = this.u16();
    if (len >= maxLen) throw new Error(`String too long (${len} >= ${maxLen})`);
    return len > 0 ? cstr(this.bytes(len)) : '';
  }
}

/** Decodes a NUL-terminated 8-bit (code page 437 / latin) string. */
export function cstr(bytes: Uint8Array): string {
  let end = bytes.indexOf(0);
  if (end < 0) end = bytes.length;
  let s = '';
  for (let i = 0; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** The original game's rolling-XOR obfuscation (key increments per byte). Returns a new buffer. */
export function xorDecode(bytes: Uint8Array, key: number): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let k = key & 0xff;
  for (let i = 0; i < bytes.length; i++) {
    out[i] = (bytes[i] ^ k) & 0xff;
    k = (k + 1) & 0xff;
  }
  return out;
}

/** Little-endian binary writer (for save files). */
export class BinaryWriter {
  private buf: Uint8Array;
  private view: DataView;
  pos = 0;

  constructor(initial = 1024) {
    this.buf = new Uint8Array(initial);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const nb = new Uint8Array(size);
    nb.set(this.buf);
    this.buf = nb;
    this.view = new DataView(nb.buffer);
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.pos++] = v & 0xff;
  }
  i8(v: number): void {
    this.u8(v);
  }
  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.pos, v & 0xffff, true);
    this.pos += 2;
  }
  i16(v: number): void {
    this.ensure(2);
    this.view.setInt16(this.pos, v, true);
    this.pos += 2;
  }
  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
  }
  i32(v: number): void {
    this.ensure(4);
    this.view.setInt32(this.pos, v | 0, true);
    this.pos += 4;
  }
  f32(v: number): void {
    this.ensure(4);
    this.view.setFloat32(this.pos, v, true);
    this.pos += 4;
  }
  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }
  fill(v: number, n: number): void {
    this.ensure(n);
    this.buf.fill(v, this.pos, this.pos + n);
    this.pos += n;
  }
  fixedStr(s: string, len: number): void {
    const b = new Uint8Array(len);
    for (let i = 0; i < Math.min(s.length, len - 1); i++) b[i] = s.charCodeAt(i) & 0xff;
    this.bytes(b);
  }
  paddedStr(s: string): void {
    if (s.length === 0) {
      this.u16(0);
      return;
    }
    this.u16(s.length + 1);
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
    this.u8(0);
  }
  toBytes(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}
