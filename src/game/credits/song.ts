// The credits' song, Hadal Static's "Twenty Ninety-Seven (Remix)" (public/audio/credits, the artist's 24-bit master),
// as music: its beats, its bars and its sections, which the credits keep time with (conductor.ts). The master runs at
// a steady 137.98 BPM: a beat tracker over it (the README trailer's, .captures/readme-media/beattrack.py) found its 679
// beats within 10 ms (RMS) of a straight line, which this is. Bars start on beat 2 (the first two beats are a pickup),
// so bar k's downbeat is beat 2 + 4k; bar 168's is the song's final hit, after which it rings out.

/** Seconds per beat, and the time of beat 0. */
export const BEAT = 0.434839;
export const FIRST_BEAT = 0.0078;
/** The song's length (s). */
export const SONG_LENGTH = 295.114;

/** The time of beat n (fractional beats in between). */
export function beatTime(n: number): number {
  return FIRST_BEAT + n * BEAT;
}

/** The time of bar k's downbeat (fractional bars in between). */
export function barTime(k: number): number {
  return beatTime(2 + 4 * k);
}

/** The bar playing at time t (fractional: 16.5 is bar 16's third beat). */
export function barAt(t: number): number {
  return ((t - FIRST_BEAT) / BEAT - 2) / 4;
}

/** The first downbeat at or after time t (of bars counted in steps of `every` bars from bar 0). */
export function nextBar(t: number, every = 1): number {
  return Math.ceil(barAt(t) / every - 1e-6) * every;
}

/** The song's sections (their first bars), as the credits use them. */
export const SECTIONS = {
  /** The intro: pads, the city at night. */
  intro: 0,
  /** Two bars rising to the drop. */
  build: 14,
  /** The drop: the full band. */
  drop: 16,
  verse: 24,
  preChorus: 40,
  chorus: 44,
  verse2: 62,
  chorus2: 82,
  /** The last chorus, and its final hit. */
  finalChorus: 144,
  finalHit: 168,
} as const;

/**
 * The song's ending as its own file (public/audio/credits, made by tools/credits/ending.mjs): the final chorus's last
 * sixteen bars and the ring-out, from a little before bar ENDING_BAR's downbeat. The credits cut to it on a downbeat
 * (conductor.ts), so that their end titles finish on the final hit whenever the fights end.
 */
export const ENDING_FILE = 'audio/credits/twenty-ninety-seven-remix-ending.flac';
export const ENDING_BAR = 152;
/** Seconds of the ending file before bar ENDING_BAR's downbeat. */
export const ENDING_PREROLL = 0.1;
