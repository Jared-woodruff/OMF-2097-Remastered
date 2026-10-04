// Zip archives: reading (stored and deflated entries, PKZIP self-extractors too) and writing. The web version imports
// the game data from them (platform/gameData.ts); mod packages (.omfmod, see src/mods) are zip archives.

export class ZipError extends Error {}

export interface ZipEntry {
  name: string;
  method: number;
  compSize: number;
  size: number;
  localOffset: number;
}

/** The archive's entries (from its central directory), or null when it is not a zip archive. */
export function readZipEntries(buf: Uint8Array): ZipEntry[] | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // End of central directory record, searched backwards (it may be followed by a comment).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  // Self-extractors store offsets relative to the start of the zip payload, not the file.
  const delta = eocd - cdSize - cdOffset;
  const entries: ZipEntry[] = [];
  let p = cdOffset + delta;
  const latin1 = new TextDecoder('latin1');
  const utf8 = new TextDecoder('utf-8');
  for (let n = 0; n < count; n++) {
    if (p < 0 || p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) throw new ZipError('The archive is damaged.');
    const nameLen = dv.getUint16(p + 28, true);
    // (general purpose flag bit 11: the name is UTF-8)
    const decoder = dv.getUint16(p + 8, true) & 0x800 ? utf8 : latin1;
    entries.push({
      name: decoder.decode(buf.subarray(p + 46, p + 46 + nameLen)),
      method: dv.getUint16(p + 10, true),
      compSize: dv.getUint32(p + 20, true),
      size: dv.getUint32(p + 24, true),
      localOffset: dv.getUint32(p + 42, true) + delta,
    });
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return entries;
}

/** Archives whose files add up to more than this are not opened (a small file can unpack to gigabytes). */
const MAX_UNZIPPED = 1024 * 1024 * 1024;

/** Inflates an entry; more than `limit` bytes (its stated size) means a damaged or hostile archive. */
async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > limit) {
      void reader.cancel().catch(() => undefined);
      throw new ZipError('The archive is damaged.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/** One entry's contents. */
export async function readZipEntry(buf: Uint8Array, e: ZipEntry): Promise<Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const lh = e.localOffset;
  if (lh < 0 || lh + 30 > buf.length || dv.getUint32(lh, true) !== 0x04034b50) throw new ZipError('The archive is damaged.');
  const start = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
  if (start + e.compSize > buf.length) throw new ZipError('The archive is damaged.');
  const raw = buf.subarray(start, start + e.compSize);
  if (e.method === 0) return raw.slice();
  if (e.method === 8) {
    if (e.size > MAX_UNZIPPED) throw new ZipError('The archive is too big to open.');
    try {
      return await inflateRaw(raw, e.size);
    } catch {
      throw new ZipError('The archive is damaged.');
    }
  }
  throw new ZipError(`Unsupported compression in the archive (method ${e.method}).`);
}

/** Every file of an archive by its path ('/' separated; folders left out). Throws ZipError when it is not a zip. */
export async function unzip(buf: Uint8Array): Promise<Map<string, Uint8Array>> {
  const entries = readZipEntries(buf);
  if (!entries) throw new ZipError('This is not a zip archive.');
  if (entries.reduce((n, e) => n + e.size, 0) > MAX_UNZIPPED) throw new ZipError('The archive is too big to open.');
  const out = new Map<string, Uint8Array>();
  for (const e of entries) {
    const name = e.name.replace(/\\/g, '/');
    if (name.endsWith('/')) continue;
    out.set(name, await readZipEntry(buf, e));
  }
  return out;
}

let crcTable: Uint32Array | null = null;

export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Every entry's date: 1 January 2097 (DOS dates count from 1980), so the same files always make the same archive. */
const DOS_DATE = ((2097 - 1980) << 9) | (1 << 5) | 1;

/** Checksums of stored pictures (their bytes never change in place: a changed picture is a new array). */
const pictureCrcs = new WeakMap<Uint8Array, number>();

/**
 * A zip archive of the files, in the given order (each one deflated when that makes it smaller; PNG, WebP and JPEG
 * pictures are stored: they are compressed already).
 */
export async function zip(files: Iterable<[string, Uint8Array]>): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  let count = 0;
  for (const [path, data] of files) {
    const name = enc.encode(path);
    const picture = /\.(png|webp|jpe?g)$/i.test(path);
    const deflated = data.length > 64 && !picture ? await deflateRaw(data) : null;
    const packed = deflated && deflated.length < data.length ? deflated : data;
    const method = packed === data ? 0 : 8;
    let crc = picture ? pictureCrcs.get(data) : undefined;
    if (crc === undefined) {
      crc = crc32(data);
      if (picture) pictureCrcs.set(data, crc);
    }
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x800, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, packed.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, packed.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    parts.push(local, packed);
    central.push(cd);
    offset += local.length + packed.length;
    count++;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, count, true);
  ev.setUint16(10, count, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + end.length);
  let p = 0;
  for (const part of [...parts, ...central, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}
