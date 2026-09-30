// OMF Studio's animation string tokens (studio/anim.ts): every animation string of the game's files is written back
// exactly as it was, and reads as the same frames and tags the engine plays.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAF } from '../formats/af';
import { parseBK } from '../formats/bk';
import { decodeScript } from '../script/script';
import { tagName } from '../script/tags';
import { formatAnim, newFrame, newTag, parseAnim, setFrame } from '../studio/anim';
import { GAMEDATA_DIR, GENERATED_DIR, hasGameData } from './harness';

/** Every animation and extra string of the original and generated files. */
function allStrings(): string[] {
  const out: string[] = [];
  for (const dir of [GAMEDATA_DIR, GENERATED_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const data = new Uint8Array(fs.readFileSync(path.join(dir, f)));
      const anims = /\.AF$/i.test(f) ? parseAF(data).moves.map((m) => m?.animation) : /\.BK$/i.test(f) ? parseBK(data).anims.map((a) => a?.animation) : [];
      for (const a of anims) if (a) out.push(a.animString, ...a.extraStrings);
    }
  }
  return out.filter((s) => s.length > 0);
}

describe.skipIf(!hasGameData)('animation string tokens', () => {
  const strings = allStrings();

  it('write every string of the game back exactly', () => {
    expect(strings.length).toBeGreaterThan(1000);
    for (const s of strings) expect(formatAnim(parseAnim(s))).toBe(s);
  });

  it('read as the frames and tags the engine plays', () => {
    for (const s of strings) {
      const t = parseAnim(s);
      const script = decodeScript(s);
      expect(t.frames.length, s).toBe(script.frames.length);
      t.frames.forEach((f, i) => {
        const e = script.frames[i];
        expect([f.sprite, f.ticks], s).toEqual([e.sprite, e.tickLen]);
        // (skipped text and stray letters carry no tag)
        const tags = f.tags.filter((g) => g.name).map((g) => `${g.name}${g.value ?? ''}`);
        const engine = e.tags.filter((g) => g.key !== 0xff).map((g) => `${tagName(g.key)}${g.hasParam ? g.value : ''}`);
        expect(tags, s).toEqual(engine);
      });
    }
  });
});

describe('editing animation strings', () => {
  it('changes only what is edited', () => {
    const t = parseAnim('sp7sf10l20s5A1-x+5B2-cpC2');
    setFrame(t.frames[1], 3, 4);
    expect(formatAnim(t)).toBe('sp7sf10l20s5A1-x+5D4-cpC2');
    t.frames[2].tags.push(newTag('s', 12));
    expect(formatAnim(t)).toBe('sp7sf10l20s5A1-x+5D4-cps12C2');
  });

  it('new frames and tags read back as they were made', () => {
    const t = parseAnim('');
    t.frames.push(newFrame(0, 3, [newTag('x+', -4), newTag('n', null)]), newFrame(25, 12, [], true));
    const s = formatAnim(t);
    expect(s).toBe('x+-4nA3-Z12');
    const script = decodeScript(s);
    expect(script.frames.map((f) => [f.sprite, f.tickLen])).toEqual([[0, 3], [25, 12]]);
  });
});
