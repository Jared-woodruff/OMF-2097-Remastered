// Tournament save games (CHR): creation from a tournament and loading with the tournament's data. Port of the
// reference formats/chr.c (sd_chr_from_trn, sd_chr_load, sd_chr_save); the byte layout itself lives in
// src/formats/chr.ts.
import { chrEnemyCreate, chrParse, chrSerialize, CHR_CUTSCENE_TEXT_COUNT, type ChrFile } from '../../formats/chr';
import type { PicPhoto } from '../../formats/misc';
import { Palette } from '../../formats/palette';
import { PILOT_QUOTE_COUNT, type Pilot } from '../../formats/pilot';
import type { TournamentFile } from '../../formats/tournament';
import { loadPic } from '../../resources/resources';
import { trnLoad } from '../../resources/trnmanager';
import { dossifyFilename } from '../../util/path';
import { PRIMARY, SECONDARY, setPilotColor, TERTIARY } from '../pilotColors';
import { calculateTradeValue, HAR_PRICES, purchaseRandomHar, purchaseRandomHarUpgrades } from '../scenes/mechlab/harEconomy';

export type { ChrEnemy, ChrFile } from '../../formats/chr';
export {
  chrCreate, chrGetEnemy, chrParse, chrSanitizedFilename, chrSerialize, chrUnsanitizedFilename, CHR_CUTSCENE_TEXT_COUNT,
  MAX_CHR_ENEMIES,
} from '../../formats/chr';

const f32 = Math.fround;

/** char[13] fields copied with strncpy (the reference aborts on overflow; the stock names always fit). */
function charField(s: string, size: number): string {
  return s.slice(0, size - 1);
}

/**
 * sd_chr_from_trn(): enters a tournament. `chr.pilot` must already hold a copy of the pilot; this fills in the
 * enemy list (unranked "secret" pilots keep rank 0), the ranks, the rank money bonus and the tournament names.
 */
export function chrFromTrn(chr: ChrFile, trn: TournamentFile, pilot: Pilot): void {
  let ranked = 0;
  chr.enemies = [];
  for (let i = 0; i < trn.enemyCount; i++) {
    const enemy = chrEnemyCreate(trn.enemies[i].clone());
    if (!trn.enemies[i].secret) {
      ranked++;
      enemy.pilot.rank = ranked;
      enemy.trnIndex = i;
    }
    chr.enemies.push(enemy);
  }
  chr.pal = new Palette();
  chr.pilot.enemiesIncUnranked = trn.enemyCount;
  chr.pilot.enemiesExUnranked = ranked;
  chr.pilot.rank = ranked + 1;

  const pilotTotalValue = (calculateTradeValue(chr.pilot) + chr.pilot.money + Math.trunc((HAR_PRICES[0] * 85) / 100)) | 0;
  // float extra_value = (int - int) / 320; int32_t extra = extra_value / 0.6f;
  const extraValue = f32(Math.trunc((pilotTotalValue - trn.assumedInitialValue) / 320));
  let extra = Math.trunc(f32(extraValue / f32(0.6)));
  if (extra > 1500) extra = 1500;
  else if (extra < 0) extra = 0;
  chr.pilot.trnRankMoney = f32((ranked + 10) * 0.5 + Math.trunc(extra / 15));

  chr.pilot.trnName = charField(trn.filename, 13);
  chr.pilot.trnDesc = trn.locales[0]?.title ?? '';
  chr.pilot.trnImage = charField(trn.picFile, 13);
  chr.photo = pilot.photo ? pilot.photo.clone() : null;
}

function tryLoadPic(name: string): PicPhoto[] | null {
  if (!name) return null;
  try {
    return loadPic(dossifyFilename(name));
  } catch (e) {
    console.error(`failed to load tournament image from ${name}`, e);
    return null;
  }
}

/** Copies the per-tournament fields of an enemy from its TRN record (sd_chr_load). */
function copyTrnFields(dst: Pilot, src: Pilot): void {
  dst.trnRankMoney = src.trnRankMoney;
  dst.trnWinningsMult = src.trnWinningsMult;
  dst.pilotId = src.pilotId;
  dst.unknownK = src.unknownK;
  dst.forceArena = src.forceArena;
  dst.difficulty = src.difficulty;
  dst.movement = src.movement;
  // (unk_block_c is not copied by the reference)
  dst.enhancements = src.enhancements.slice();
  dst.secret = src.secret;
  dst.onlyFightOnce = src.onlyFightOnce;
  dst.reqRank = src.reqRank;
  dst.reqMaxRank = src.reqMaxRank;
  dst.reqFighter = src.reqFighter;
  dst.reqDifficulty = src.reqDifficulty;
  dst.reqEnemy = src.reqEnemy;
  dst.reqVitality = src.reqVitality;
  dst.reqAccuracy = src.reqAccuracy;
  dst.reqAvgDmg = src.reqAvgDmg;
  dst.reqScrap = src.reqScrap;
  dst.reqDestroy = src.reqDestroy;
  // Quirk kept: att_jump and ap_close are not copied (they stay 0 for tournament enemies).
  dst.attNormal = src.attNormal;
  dst.attHyper = src.attHyper;
  dst.attDef = src.attDef;
  dst.attSniper = src.attSniper;
  dst.apThrow = src.apThrow;
  dst.apSpecial = src.apSpecial;
  dst.apJump = src.apJump;
  dst.apHigh = src.apHigh;
  dst.apLow = src.apLow;
  dst.apMiddle = src.apMiddle;
  dst.prefJump = src.prefJump;
  dst.prefFwd = src.prefFwd;
  dst.prefBack = src.prefBack;
  dst.unknownE = src.unknownE;
  dst.learning = src.learning;
  dst.forget = src.forget;
  // (unk_block_f is not copied by the reference)
  dst.winnings = src.winnings;
  dst.totalValue = src.totalValue;
  dst.photoId = src.photoId;
}

/** The ending text most of a tournament's robots share (theirs mostly say the same, without naming the robot). */
function commonEnding(ends: string[][]): string[] {
  const count = new Map<string, number>();
  let best: string[] = [], most = 0;
  for (const e of ends) {
    const key = JSON.stringify(e);
    const n = (count.get(key) ?? 0) + 1;
    count.set(key, n);
    if (n > most) (most = n), (best = e);
  }
  return best;
}

/**
 * sd_chr_load(): parses a CHR file and completes it from the resources, like the reference:
 * - tournament ending texts / cutscene BK / tournament id / winnings multiplier from the TRN,
 * - each enemy: HAR colors, a random HAR purchase for "random HAR" (255) pilots, random HAR upgrades bought with
 *   the pilot's money (both use the global RNG, in enemy order), and the AI/requirement data, photo, palette,
 *   sex and quotes from the TRN and its PIC file,
 * - the player's sex from PLAYERS.PIC and the HAR colors.
 * Throws when the data cannot be parsed.
 */
export function chrLoad(data: Uint8Array): ChrFile {
  const chr = chrParse(data);

  const pic = tryLoadPic(chr.pilot.trnImage);
  const trn = chr.pilot.trnName !== '' ? trnLoad(chr.pilot.trnName) : null;

  if (trn) {
    const ends = trn.locales[0]?.endTexts ?? [];
    // (a robot the tournament has no ending for, a new or a mod robot: the ending most of its robots share)
    const texts = ends[chr.pilot.harId] ?? commonEnding(ends);
    for (let i = 0; i < CHR_CUTSCENE_TEXT_COUNT; i++) {
      if ((texts[i] ?? '').length > 0) chr.cutsceneText[i] = texts[i];
    }
    chr.bkName = trn.bkName;
    chr.tournamentId = trn.tournamentId;
    chr.winningsMultiplier = trn.winningsMultiplier;
  }

  for (let i = 0; i < chr.pilot.enemiesIncUnranked; i++) {
    const enemy = chr.enemies[i];
    const p = enemy.pilot;
    // sd_pilot_load_player_from_mem() sets the HAR colors on the fresh pilot (photo 0 for color 16)
    setPilotColor(p, TERTIARY, p.color3);
    setPilotColor(p, SECONDARY, p.color2);
    setPilotColor(p, PRIMARY, p.color1);
    if (p.harId === 255) {
      // pick a random HAR
      purchaseRandomHar(p);
    }
    purchaseRandomHarUpgrades(p);
    const te = trn?.enemies[i];
    if (trn && te) {
      // (the reference crashes when the PIC file or entry is missing; those parts are skipped here)
      const photo = pic?.[te.photoId];
      if (photo) p.palette = photo.palette.clone();
      p.photo = te.photo ? te.photo.clone() : photo ? photo.sprite.clone() : null;
      // copy all the "pilot" fields (eg. winnings) over from the tournament file
      copyTrnFields(p, te);
      if (photo) p.sex = photo.sex;
    }
    for (let m = 0; m < PILOT_QUOTE_COUNT; m++) {
      if (te && te.quotes[m].length > 0) p.quotes[m] = te.quotes[m];
    }
  }

  // chr.photo / chr.pilot.photo were set by the parser.
  // Load the player's sex from PLAYERS.PIC
  const players = tryLoadPic('PLAYERS.PIC');
  const own = players?.[chr.pilot.photoId];
  if (own) chr.pilot.sex = own.sex;

  // Load colors from other files
  setPilotColor(chr.pilot, PRIMARY, chr.pilot.color1);
  setPilotColor(chr.pilot, SECONDARY, chr.pilot.color2);
  setPilotColor(chr.pilot, TERTIARY, chr.pilot.color3);
  return chr;
}

/** sd_chr_save(): the file contents. */
export function chrSave(chr: ChrFile): Uint8Array {
  return chrSerialize(chr);
}

/** sd_pilot_exit_tournament(): the pilot leaves its tournament (kicked out for debts). */
export function pilotExitTournament(pilot: Pilot): void {
  pilot.rank = 0;
  pilot.trnName = '';
  pilot.trnDesc = '';
  pilot.trnImage = '';
}
