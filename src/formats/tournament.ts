import { cp437ToUnicode } from '../i18n/cp437';
import { BinaryReader } from '../util/reader';
import { Palette } from './palette';
import { Pilot } from './pilot';
import { Sprite } from './sprite';
import { trnText } from '../i18n/i18n';

export const MAX_TRN_LOCALES = 10;
export const MAX_TRN_ENDING_HARS = 11;
export const MAX_TRN_ENDING_PAGES = 10;

export interface TournamentLocale {
  logo: Sprite;
  title: string;
  description: string;
  strippedDescription: string;
  descWidth: number;
  descCenter: number;
  descVmove: number;
  descSize: number;
  descColor: number;
  /** endTexts[har][page] */
  endTexts: string[][];
}

export interface TournamentFile {
  filename: string;
  enemyCount: number;
  unknownB: number;
  bkName: string;
  winningsMultiplier: number;
  unknownA: number;
  registrationFee: number;
  assumedInitialValue: number;
  tournamentId: number;
  picFile: string;
  enemies: Pilot[];
  locales: TournamentLocale[];
  /** Colors 128..167 are valid. */
  palette: Palette;
}

function parseDescription(loc: TournamentLocale): void {
  const desc = loc.description;
  let width = 320, center = 0, vmove = 0, size = -1, color = -1;
  let end = 0;
  const grab = (key: string, set: (v: number) => void) => {
    const i = desc.indexOf(`{${key} `);
    if (i >= 0) {
      const m = /^\{\w+ (-?\d+)\}/.exec(desc.slice(i));
      if (m) set(parseInt(m[1], 10));
      if (i > end) end = i;
    }
  };
  grab('WIDTH', (v) => (width = v));
  grab('CENTER', (v) => (center = v));
  grab('VMOVE', (v) => (vmove = v));
  grab('SIZE', (v) => (size = v));
  grab('COLOR', (v) => (color = v));
  const close = desc.indexOf('}', end);
  const start = close < 0 ? 0 : close + 1;
  const open = desc.indexOf('{', start);
  loc.strippedDescription = open >= 0 ? desc.slice(start, open) : desc.slice(start);
  loc.descWidth = width;
  loc.descCenter = center;
  loc.descVmove = vmove;
  loc.descSize = size;
  loc.descColor = color;
}

/**
 * A tournament's texts in the game's language (i18n trnText): its German locale in German, else its English one with
 * the translations of its description and endings.
 */
export function localizedLocale(trn: TournamentFile): TournamentLocale | undefined {
  const en = trn.locales[0];
  if (!en) return en;
  const de = trn.locales[1];
  const text = (s: string, german: string | undefined) => trnText(s, german);
  const loc: TournamentLocale = {
    ...en,
    title: text(en.title, de?.title),
    description: text(en.description, de?.description),
    endTexts: en.endTexts.map((pages, har) => pages.map((p, i) => (p ? text(p, de?.endTexts[har]?.[i]) : p))),
  };
  // Another text is laid out by its own markup; one without any keeps the English one's place, width and color (a
  // custom tournament sets those itself, on a description without markup).
  if (loc.description !== en.description) {
    if (/\{[A-Z]/.test(loc.description)) parseDescription(loc);
    else loc.strippedDescription = loc.description;
  }
  return loc;
}

export function parseTournament(data: Uint8Array, filename: string): TournamentFile {
  const r = new BinaryReader(data);
  if (data.length < 1582) throw new Error('TRN: file too small');
  const enemyCount = r.u16();
  if (enemyCount === 0 || enemyCount >= 256) throw new Error('TRN: bad enemy count');
  const unknownB = r.u16();
  const victoryTextOffset = r.i32();
  const bkName = r.fixedStr(14);
  const trn: TournamentFile = {
    filename,
    enemyCount,
    unknownB,
    bkName,
    winningsMultiplier: r.f32(),
    unknownA: r.i32(),
    registrationFee: r.i32(),
    assumedInitialValue: r.i32(),
    tournamentId: r.i32(),
    picFile: '',
    enemies: [],
    locales: [],
    palette: new Palette(),
  };
  r.seek(300);
  const offsets: number[] = [];
  for (let i = 0; i < enemyCount + 1; i++) offsets.push(r.i32());
  for (let i = 0; i < enemyCount; i++) {
    r.seek(offsets[i]);
    trn.enemies.push(Pilot.loadTrnPilot(r));
  }
  r.seek(offsets[enemyCount]);
  for (let i = 0; i < MAX_TRN_LOCALES; i++) {
    trn.locales.push({
      logo: Sprite.load(r),
      title: '',
      description: '',
      strippedDescription: '',
      descWidth: 320,
      descCenter: 0,
      descVmove: 0,
      descSize: -1,
      descColor: -1,
      endTexts: [],
    });
  }
  trn.palette.loadRange(r, 128, 40);
  const picLen = r.u16();
  trn.picFile = picLen > 0 ? r.fixedStr(picLen) : '';
  for (const loc of trn.locales) {
    loc.title = cp437ToUnicode(r.paddedStr());
    loc.description = cp437ToUnicode(r.paddedStr());
    parseDescription(loc);
  }
  if (r.pos !== victoryTextOffset) throw new Error('TRN: victory text offset mismatch');
  for (const loc of trn.locales) {
    for (let har = 0; har < MAX_TRN_ENDING_HARS; har++) {
      const pages: string[] = [];
      for (let page = 0; page < MAX_TRN_ENDING_PAGES; page++) pages.push(cp437ToUnicode(r.paddedStr()));
      loc.endTexts.push(pages);
    }
  }
  return trn;
}
