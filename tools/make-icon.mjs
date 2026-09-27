#!/usr/bin/env node
// Turns the original game's icon (public/gamedata/OMF.ICO, a 32x32 16-colour BMP icon) into PNG
// sources for the app icons:
//   src-tauri/icons/source.png  1024x1024 -> then run: npx tauri icon src-tauri/icons/source.png
//   public/favicon.png            64x64
// Nearest-neighbour scaling keeps the pixel art crisp. Pixels hidden by the icon's AND mask (or
// with zero alpha in 32-bit icons) become transparent.
//
// Usage: node tools/make-icon.mjs [path/to/icon.ico]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.resolve(process.argv[2] ?? path.join(root, 'public', 'gamedata', 'OMF.ICO'));
const outputs = [
  { file: path.join(root, 'src-tauri', 'icons', 'source.png'), size: 1024 },
  { file: path.join(root, 'public', 'favicon.png'), size: 64 },
];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isPng = (data) => data.subarray(0, 8).equals(PNG_SIGNATURE);

/** Decodes the largest (then deepest) image of an .ico file to { width, height, rgba }. */
function decodeIco(buf) {
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error('Not an .ico file');
  const images = [];
  for (let i = 0; i < buf.readUInt16LE(4); i++) {
    const p = 6 + i * 16;
    const data = buf.subarray(buf.readUInt32LE(p + 12), buf.readUInt32LE(p + 12) + buf.readUInt32LE(p + 8));
    // Directory bit counts are often 0, so take the depth from the image header itself.
    const depth = isPng(data) ? 32 : data.readUInt16LE(14);
    images.push({ area: (buf[p] || 256) * (buf[p + 1] || 256), depth, data });
  }
  if (!images.length) throw new Error('Icon contains no images');
  images.sort((a, b) => b.area - a.area || b.depth - a.depth);
  const { data } = images[0];
  return isPng(data) ? decodePng(data) : decodeDib(data);
}

/** BMP-style icon image: BITMAPINFOHEADER, palette (<= 8 bpp), bottom-up XOR bitmap, 1 bpp AND mask. */
function decodeDib(data) {
  const headerSize = data.readUInt32LE(0);
  const width = data.readInt32LE(4);
  const height = data.readInt32LE(8) / 2; // the stored height covers the XOR bitmap + AND mask
  const bpp = data.readUInt16LE(14);
  const compression = data.readUInt32LE(16);
  if (compression !== 0 || ![1, 2, 4, 8, 24, 32].includes(bpp)) {
    throw new Error(`Unsupported icon bitmap (${bpp} bpp, compression ${compression})`);
  }
  const colors = bpp <= 8 ? data.readUInt32LE(32) || 1 << bpp : 0;
  const palette = data.subarray(headerSize, headerSize + colors * 4); // B, G, R, reserved
  const xorOffset = headerSize + colors * 4;
  const xorStride = Math.ceil((width * bpp) / 32) * 4;
  const andOffset = xorOffset + xorStride * height;
  const andStride = Math.ceil(width / 32) * 4;

  const rgba = Buffer.alloc(width * height * 4);
  let hasAlpha = false;
  for (let y = 0; y < height; y++) {
    const row = xorOffset + (height - 1 - y) * xorStride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let p;
      if (bpp <= 8) {
        const bit = x * bpp;
        p = ((data[row + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1)) * 4;
        rgba[o + 3] = 255;
      } else {
        p = row + x * (bpp / 8);
        rgba[o + 3] = bpp === 32 ? data[p + 3] : 255;
        hasAlpha ||= bpp === 32 && data[p + 3] !== 0;
      }
      const src = bpp <= 8 ? palette : data;
      rgba[o] = src[p + 2] ?? 0;
      rgba[o + 1] = src[p + 1] ?? 0;
      rgba[o + 2] = src[p] ?? 0;
    }
  }
  // 32 bpp icons carry their own alpha; older ones (and all-zero-alpha 32 bpp) rely on the AND mask.
  if (bpp === 32 && !hasAlpha) for (let o = 3; o < rgba.length; o += 4) rgba[o] = 255;
  if ((bpp < 32 || !hasAlpha) && data.length >= andOffset + andStride * height) {
    for (let y = 0; y < height; y++) {
      const row = andOffset + (height - 1 - y) * andStride;
      for (let x = 0; x < width; x++) {
        if ((data[row + (x >> 3)] >> (7 - (x & 7))) & 1) rgba.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 4);
      }
    }
  }
  return { width, height, rgba };
}

/** PNG-compressed icon image (Vista+ icons): 8-bit RGB/RGBA, non-interlaced. */
function decodePng(data) {
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat = [];
  for (let p = 8; p + 8 <= data.length; ) {
    const length = data.readUInt32BE(p);
    const type = data.toString('latin1', p + 4, p + 8);
    const body = data.subarray(p + 8, p + 8 + length);
    if (type === 'IHDR') [width, height, depth, colorType, interlace] = [body.readUInt32BE(0), body.readUInt32BE(4), body[8], body[9], body[12]];
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += 12 + length;
  }
  const channels = { 2: 3, 6: 4 }[colorType];
  if (depth !== 8 || !channels || interlace) {
    throw new Error(`Unsupported PNG icon (bit depth ${depth}, colour type ${colorType}, interlace ${interlace})`);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const predictor = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      if (predictor === undefined) throw new Error(`Bad PNG filter type ${filter}`);
      px[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + predictor) & 255;
    }
  }
  if (channels === 4) return { width, height, rgba: px };
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let i = 0; i < width * height; i++) px.copy(rgba, i * 4, i * 3, i * 3 + 3);
  return { width, height, rgba };
}

function scaleNearest({ width, height, rgba }, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const sy = Math.floor((y * height) / size);
    for (let x = 0; x < size; x++) {
      const s = (sy * width + Math.floor((x * width) / size)) * 4;
      rgba.copy(out, (y * size + x) * 4, s, s + 4);
    }
  }
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/** Minimal PNG encoder: 8-bit RGBA, no interlacing, filter type 0 on every row. */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

if (!fs.existsSync(input)) {
  console.error(`Icon not found: ${input}\nRun "npm run extract" first, or pass the path to an .ico file.`);
  process.exit(1);
}
const icon = decodeIco(fs.readFileSync(input));
for (const { file, size } of outputs) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePng(size, size, scaleNearest(icon, size)));
  console.log(`${path.relative(root, file)}: ${size}x${size} (from ${icon.width}x${icon.height} ${path.basename(input)})`);
}
