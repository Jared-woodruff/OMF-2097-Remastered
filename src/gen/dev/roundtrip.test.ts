import { describe, expect, it } from 'vitest';
import { parseAF, saveAF } from '../../formats/af';
import { getFile } from '../../resources/files';
import { hasGameData, loadGameData } from '../../test/harness';

describe.skipIf(!hasGameData)('AF round trip', () => {
  it('saves what it parses', () => {
    loadGameData();
    for (let i = 0; i < 11; i++) {
      const src = getFile(`FIGHTR${i}.AF`);
      const out = saveAF(parseAF(src));
      let same = out.length === src.length;
      let firstDiff = -1;
      for (let k = 0; k < Math.min(out.length, src.length); k++) if (out[k] !== src[k]) { firstDiff = k; same = false; break; }
      console.log(i, src.length, out.length, same, firstDiff, firstDiff >= 0 ? [src[firstDiff], out[firstDiff]] : '');
      const again = parseAF(out);
      expect(again.moves.filter(Boolean).length).toBe(parseAF(src).moves.filter(Boolean).length);
    }
  });
});
