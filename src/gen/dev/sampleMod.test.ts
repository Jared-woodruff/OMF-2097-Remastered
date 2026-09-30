// Development aid (MOD_OUT=<folder> npx vitest run src/gen/dev/sampleMod): writes the sample mod (mods/sample.ts) as
// <folder>/omf2097r.sample.omfmod, to install in the game by hand (EXTRAS > MODS, or drop it on the game).
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'vitest';
import { MOD_EXTENSION, writeModPackage } from '../../mods/package';
import { buildSampleMod, SAMPLE_MOD_ID } from '../../mods/sample';
import { extrasPackage, hasGameData, loadGameData } from '../../test/harness';

const OUT = process.env.MOD_OUT;

describe.skipIf(!OUT || !hasGameData)('sample mod', () => {
  it('writes the file', async () => {
    loadGameData();
    const file = path.join(OUT!, `${SAMPLE_MOD_ID}${MOD_EXTENSION}`);
    fs.mkdirSync(OUT!, { recursive: true });
    fs.writeFileSync(file, await writeModPackage(await buildSampleMod(await extrasPackage())));
    console.log(`wrote ${file}`);
  });
});
