// The web version's in-browser import of the game data (platform/gameData.ts): unpacking the freeware installer, a
// zip that contains it, or loose files, with the same result as tools/extract-gamedata.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractGameFiles, GameDataError } from '../platform/gameData';
import { GAMEDATA_DIR } from './harness';

const INSTALLER = path.resolve(__dirname, '../../omf21cd/OMF/OMF21.EXE');
const hasInstaller = fs.existsSync(INSTALLER);
const hasData = fs.existsSync(path.join(GAMEDATA_DIR, 'manifest.json'));

function file(p: string, name = path.basename(p)): File {
  return new File([fs.readFileSync(p)], name);
}

/** A minimal zip archive (stored entries) around one file. */
function zipOf(name: string, data: Uint8Array): Uint8Array {
  const enc = new TextEncoder().encode(name);
  const local = new Uint8Array(30 + enc.length + data.length);
  const dv = new DataView(local.buffer);
  dv.setUint32(0, 0x04034b50, true);
  dv.setUint16(8, 0, true);
  dv.setUint32(18, data.length, true);
  dv.setUint32(22, data.length, true);
  dv.setUint16(26, enc.length, true);
  local.set(enc, 30);
  local.set(data, 30 + enc.length);
  const central = new Uint8Array(46 + enc.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, 0, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, enc.length, true);
  cv.setUint32(42, 0, true);
  central.set(enc, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true);
  const out = new Uint8Array(local.length + central.length + end.length);
  out.set(local, 0);
  out.set(central, local.length);
  out.set(end, local.length + central.length);
  return out;
}

describe('in-browser game data import', () => {
  it.skipIf(!hasInstaller || !hasData)('unpacks the freeware installer like the extract tool', async () => {
    const files = await extractGameFiles([file(INSTALLER)]);
    const manifest = JSON.parse(fs.readFileSync(path.join(GAMEDATA_DIR, 'manifest.json'), 'utf8')) as { files: { name: string }[] };
    expect([...files.keys()].sort()).toEqual(manifest.files.map((f) => f.name).sort());
    for (const name of ['FIGHTR0.AF', 'ARENA3.BK', 'MENU.PSM']) {
      expect(Buffer.from(files.get(name)!).equals(fs.readFileSync(path.join(GAMEDATA_DIR, name)))).toBe(true);
    }
  });

  it.skipIf(!hasInstaller)('finds the installer inside a zip', async () => {
    const zipped = zipOf('OMF2097/OMF21.EXE', fs.readFileSync(INSTALLER));
    const files = await extractGameFiles([new File([zipped as BlobPart], 'omf2097.zip')]);
    expect(files.has('FIGHTR0.AF')).toBe(true);
  });

  it.skipIf(!hasData)('accepts the files of an installed game and ignores the rest', async () => {
    const names = ['FIGHTR0.AF', 'MAIN.BK', 'SOUNDS.DAT', 'ENGLISH.DAT'];
    const files = await extractGameFiles([...names.map((n) => file(path.join(GAMEDATA_DIR, n), `omf/${n.toLowerCase()}`)),
      new File(['x'], 'README.TXT')]);
    expect([...files.keys()].sort()).toEqual([...names].sort());
  });

  it('explains what is wrong with other files', async () => {
    await expect(extractGameFiles([new File(['hello'], 'notes.txt')])).rejects.toBeInstanceOf(GameDataError);
    await expect(extractGameFiles([new File([new Uint8Array(10)], 'FIGHTR0.AF')])).rejects.toThrow(/missing/);
  });
});
