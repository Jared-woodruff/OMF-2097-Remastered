// The game's own robots, arenas and pilots as OMF Studio shows them (what a copy starts from, the test's preview):
// their fighter and scene files parsed once (the new robots' and arenas' from their mod's package), the pilots'
// portraits from the pilot select screen.
import { parseAF, type AfFile } from '../formats/af';
import { parseBK, type BkFile } from '../formats/bk';
import { getFile } from '../resources/files';
import { indexedCanvas } from './colors';
import { EXTRAS_ARENAS, EXTRAS_ROBOTS, extrasPackage } from './extras';
import { scenePalette } from './pilot/words';

const afs = new Map<number, AfFile>();
const bks = new Map<number, BkFile>();
let melee: BkFile | null = null;

/** One of the game's original robots' fighter files (0-10). Not to edit. */
export function originalAf(harId: number): AfFile {
  let af = afs.get(harId);
  if (!af) afs.set(harId, (af = parseAF(getFile(`FIGHTR${harId}.AF`))));
  return af;
}

/** One of the game's robots' fighter files (0-10: the originals; 11-14: the new robots), or null. Not to edit. */
export async function gameAf(harId: number): Promise<AfFile | null> {
  if (Number.isInteger(harId) && harId >= 0 && harId < 11) return originalAf(harId);
  let af = afs.get(harId);
  if (af) return af;
  const extra = EXTRAS_ROBOTS.find(([n]) => n === harId);
  if (!extra) return null;
  const r = (await extrasPackage()).robots.find((x) => x.id === extra[2]);
  if (!r) return null;
  afs.set(harId, (af = parseAF(r.af)));
  return af;
}

/** One of the game's arenas' scene files (0-4: the originals; 5-8: the new arenas), or null. Not to edit. */
export async function gameBk(index: number): Promise<BkFile | null> {
  let bk = bks.get(index);
  if (bk) return bk;
  const extra = EXTRAS_ARENAS.find(([n]) => n === index);
  if (extra) {
    const a = (await extrasPackage()).arenas.find((x) => x.id === extra[2]);
    if (!a) return null;
    bk = parseBK(a.bk);
  } else if (Number.isInteger(index) && index >= 0 && index < 5) {
    bk = parseBK(getFile(`ARENA${index}.BK`));
  } else {
    return null;
  }
  bks.set(index, bk);
  return bk;
}

/** An original pilot's portrait as the pilot select screen shows it (0 CRYSTAL .. 9 RAVEN), or null. */
export function gamePortrait(pilotId: number): HTMLCanvasElement | null {
  melee ??= parseBK(getFile('MELEE.BK'));
  const s = melee.anims[4]?.animation.sprites[pilotId];
  if (!s || s.isEmpty()) return null;
  const c = indexedCanvas(s.pixels(), s.width, s.height, scenePalette('MELEE.BK'));
  c.className = 'pix';
  return c;
}
