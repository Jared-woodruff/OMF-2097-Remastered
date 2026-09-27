// Dev utility (not a real test): dumps BK backgrounds to PNG and prints remap-table statistics.
// Run with: OMF_DUMP=1 npx vitest run src/test/bgdump.test.ts
import { it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseBK } from '../formats/bk';
import { GAMEDATA_DIR, hasGameData } from './harness';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

export function encodePng(w: number, h: number, rgba: Uint8Array): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

it.skipIf(!hasGameData || !process.env.OMF_DUMP)('dump backgrounds and remap stats', () => {
  const out = path.resolve(__dirname, '../../.captures/bg');
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(GAMEDATA_DIR).filter((f) => f.endsWith('.BK'))) {
    const bk = parseBK(new Uint8Array(fs.readFileSync(path.join(GAMEDATA_DIR, f))));
    const pal = bk.palettes[0].colors;
    const rgba = new Uint8Array(bk.width * bk.height * 4);
    for (let i = 0; i < bk.width * bk.height; i++) {
      const c = bk.background[i];
      rgba.set([pal[c * 3], pal[c * 3 + 1], pal[c * 3 + 2], 255], i * 4);
    }
    fs.writeFileSync(path.join(out, f.replace('.BK', '.png')), encodePng(bk.width, bk.height, rgba));
    if (f.startsWith('ARENA0') || f.startsWith('MAIN')) {
      const lum = (i: number) => 0.299 * pal[i * 3] + 0.587 * pal[i * 3 + 1] + 0.114 * pal[i * 3 + 2];
      const lines: string[] = [];
      bk.remaps[0].tables.forEach((t, r) => {
        let sum = 0, n = 0, same = 0;
        for (let i = 1; i < 256; i++) {
          if (t[i] === i) same++;
          if (lum(i) > 8) {
            sum += lum(t[i]) / lum(i);
            n++;
          }
        }
        lines.push(`${f} remap ${r}: avg lum ratio ${(sum / n).toFixed(3)} identity ${same}/255 sample ${Array.from(t.slice(96, 104)).join(',')}`);
      });
      fs.writeFileSync(path.join(out, `remaps_${f}.txt`), lines.join('\n'));
    }
  }
});
