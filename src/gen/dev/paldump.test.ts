import fs from 'node:fs';
import { describe, it } from 'vitest';
import { parseBK } from '../../formats/bk';
import { getFile } from '../../resources/files';
import { hasGameData, loadGameData } from '../../test/harness';

describe.skipIf(!process.env.PAL_DUMP || !hasGameData)('palette dump', () => {
  it('dumps', () => {
    loadGameData();
    const lines: string[] = [];
    for (let a = 0; a < 5; a++) {
      const bk = parseBK(getFile(`ARENA${a}.BK`));
      const p = bk.palettes[0];
      const row: string[] = [];
      for (let i = 0; i < 256; i++) {
        const c = [p.r(i), p.g(i), p.b(i)];
        row.push(`${i.toString(16).padStart(2, '0')}:${c.map((v: number) => v.toString(16).padStart(2, '0')).join('')}`);
      }
      lines.push(`ARENA${a} fileId ${bk.fileId}`);
      for (let i = 0; i < 256; i += 16) lines.push(row.slice(i, i + 16).join(' '));
    }
    fs.writeFileSync(process.env.PAL_DUMP!, lines.join('\n'));
  });
});
