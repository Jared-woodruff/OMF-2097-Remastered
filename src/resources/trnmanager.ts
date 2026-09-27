// Tournament list and loading (port of the reference resources/trnmanager.c).
// Tournament files are parsed once and cached by `loadTournament`; callers treat the returned data as read-only
// (the CHR code clones the enemy pilots it keeps).
import type { TournamentFile } from '../formats/tournament';
import { listFiles } from './files';
import { loadTournament } from './resources';

/** trnlist_init(): every *.TRN resource that parses, sorted by ascending registration fee. */
export function trnlistInit(): TournamentFile[] {
  const list: TournamentFile[] = [];
  for (const name of listFiles('.TRN')) {
    try {
      list.push(loadTournament(name));
    } catch (e) {
      console.error(`Could not load tournament ${name}`, e);
    }
  }
  // vector_sort(): qsort by registration fee (the stock tournaments all have different fees)
  list.sort((a, b) => (a.registrationFee > b.registrationFee ? 1 : 0) - (a.registrationFee < b.registrationFee ? 1 : 0));
  return list;
}

/** trn_load(): a tournament by file name, or null when it cannot be loaded (the reference returns 1). */
export function trnLoad(trnName: string): TournamentFile | null {
  try {
    return loadTournament(trnName);
  } catch (e) {
    console.error(`Unable to load tournament file '${trnName}'.`, e);
    return null;
  }
}
