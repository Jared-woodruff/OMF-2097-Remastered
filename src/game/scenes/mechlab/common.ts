// Shared bits of the mechlab modules: palette colors of MECHLAB.BK (mechlab.h) and a printf for the %s strings.
import { AiDifficulty } from '../../constants';

export const MECHLAB_DARK_GREEN = 165;
export const MECHLAB_BRIGHT_GREEN = 167;
export const MECHLAB_YELLOW = 207;

/** Which dashboard (upper part of the screen) the mechlab shows (dashboard_type). */
export const enum DashboardType {
  NONE,
  STATS,
  NEW_PLAYER,
  SELECT_NEW_PIC,
  SELECT_DIFFICULTY,
  SELECT_TOURNAMENT,
  SIM,
}

/**
 * snprintf/unsafe_snprintf for the language strings used here (%s, %d and %%), truncated to a `bufSize` byte
 * buffer like the reference.
 */
export function cFormat(bufSize: number, fmt: string, ...args: (string | number)[]): string {
  let ai = 0;
  const out = fmt.replace(/%([%sd])/g, (_m, c: string) => {
    if (c === '%') return '%';
    const a = args[ai++];
    if (c === 's') return String(a ?? '');
    return String(Math.trunc(Number(a ?? 0)));
  });
  return out.slice(0, Math.max(0, bufSize - 1));
}

/**
 * AI difficulty of tournament opponents: there's not an exact difficulty mapping for aluminum to 1p mode, but round
 * up to veteran; Iron == Champion, Steel == Deadly, Heavy Metal == F.A.A.K. 2 (inline code of the reference
 * lab_menu_main_arena and lab_dash_sim_done).
 */
export function tournamentAiDifficulty(pilotDifficulty: number): number {
  let difficulty = AiDifficulty.VETERAN;
  if (pilotDifficulty === 1) difficulty = AiDifficulty.CHAMPION;
  else if (pilotDifficulty === 2) difficulty = AiDifficulty.DEADLY;
  else if (pilotDifficulty === 3) difficulty = AiDifficulty.ULTIMATE;
  return difficulty;
}
