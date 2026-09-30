// npm run hd:export and newart:export empty their folder first, so they refuse to run over the image model's
// deliveries (*.hd.png, which are not in git) unless given --force: tools/hd-pack/delivered.mjs.
import { expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deliveredFiles, deliveredRefusal } from './delivered.mjs';

it('finds delivered paintings anywhere in a pack folder, and refuses to empty it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omf-pack-'));
  try {
    const move = path.join('tier2_fighters', 'FLAIL', 'm11_idle');
    fs.mkdirSync(path.join(dir, move), { recursive: true });
    fs.writeFileSync(path.join(dir, move, 'f000.png'), '');
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{}');
    // A pack as the export writes it: sources, guides and specs, nothing delivered.
    expect(deliveredFiles(dir)).toEqual([]);
    expect(deliveredRefusal(dir, 'hd:export')).toBeNull();
    expect(deliveredRefusal(path.join(dir, 'not-made-yet'), 'hd:export')).toBeNull();

    fs.writeFileSync(path.join(dir, move, 'f000.hd.png'), '');
    expect(deliveredFiles(dir)).toEqual([path.join(move, 'f000.hd.png')]);
    const refusal = deliveredRefusal(dir, 'newart:export');
    expect(refusal).toContain('holds 1 delivered painting (');
    expect(refusal).toContain('npm run newart:export -- <folder>');
    expect(refusal).toContain('npm run newart:export -- --force');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
