#!/usr/bin/env node
// Extracts the original One Must Fall 2097 data files into public/gamedata/.
//
// Usage: node tools/extract-gamedata.mjs [source]
//   source may be:
//     - the CD's OMF21.EXE (a PKZIP self-extractor), or any .zip containing the game
//     - a directory containing an installed copy of the game
//   Defaults to omf21cd/OMF/OMF21.EXE, then gamedata/.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'gamedata');

// Files the engine needs at runtime (matched case-insensitively).
const WANTED = /\.(AF|BK|PSM|PIC|TRN)$|^(ALTPALS|CHARSMAL|GRAPHCHR|ENGLISH|GERMAN|SOUNDS)\.DAT$/i;

function readZipEntries(buf) {
  // Locate the End Of Central Directory record (scan backwards).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  // Self-extractors may store offsets relative to the start of the zip payload, not the file.
  const delta = eocd - cdSize - cdOffset;
  const entries = [];
  let p = cdOffset + delta;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42) + delta;
    const name = buf.toString('latin1', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries.map((e) => ({
    name: path.basename(e.name.replace(/\\/g, '/')),
    size: e.size,
    read() {
      const lh = e.localOffset;
      if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error(`Bad local header for ${e.name}`);
      const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
      const raw = buf.subarray(start, start + e.compSize);
      if (e.method === 0) return Buffer.from(raw);
      if (e.method === 8) return zlib.inflateRawSync(raw);
      throw new Error(`Unsupported compression method ${e.method} for ${e.name}`);
    },
  }));
}

function listSource(src) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    return fs.readdirSync(src).filter((f) => fs.statSync(path.join(src, f)).isFile()).map((f) => ({
      name: f,
      read: () => fs.readFileSync(path.join(src, f)),
    }));
  }
  return readZipEntries(fs.readFileSync(src));
}

const candidates = process.argv[2]
  ? [path.resolve(process.argv[2])]
  : [path.join(root, 'omf21cd', 'OMF', 'OMF21.EXE'), path.join(root, 'gamedata')];
const source = candidates.find((c) => fs.existsSync(c));
if (!source) {
  console.error('Could not find the original game data. Pass the path to OMF21.EXE, a zip, or a game directory.');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const files = listSource(source).filter((e) => WANTED.test(e.name));
if (!files.some((f) => /^FIGHTR0\.AF$/i.test(f.name))) {
  console.error(`No OMF 2097 data found in ${source}`);
  process.exit(1);
}
const manifest = [];
for (const f of files) {
  const data = f.read();
  const name = f.name.toUpperCase();
  fs.writeFileSync(path.join(outDir, name), data);
  manifest.push({ name, size: data.length });
}
manifest.sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ files: manifest }, null, 1));
console.log(`Extracted ${manifest.length} files from ${path.relative(root, source) || source} to public/gamedata/`);
