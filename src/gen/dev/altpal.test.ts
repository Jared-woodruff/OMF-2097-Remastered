import fs from 'node:fs';
import { describe, it } from 'vitest';
import { altPalettes } from '../../resources/resources';
import { hasGameData, loadGameData } from '../../test/harness';

describe.skipIf(!process.env.ALTPAL_DUMP || !hasGameData)('altpal dump', () => {
  it('dumps', () => {
    loadGameData();
    const p = altPalettes()[0];
    const lines: string[] = [];
    for (let r = 0; r < 16; r++) {
      const row: string[] = [];
      for (let k = 0; k < 16; k++) row.push([p.r(r * 16 + k), p.g(r * 16 + k), p.b(r * 16 + k)].map((v) => v.toString(16).padStart(2, '0')).join(''));
      lines.push(`${r}: ${row.join(' ')}`);
    }
    fs.writeFileSync(process.env.ALTPAL_DUMP!, lines.join('\n'));
  });
});
