/**
 * Parser for Epic MegaGames MASI "new PSM" music modules (the format of One Must Fall 2097's
 * MENU.PSM, END.PSM and ARENA0-4.PSM).
 *
 * The result is a plain-data {@link TrackerModule} (typed arrays + small objects, structured-clone
 * friendly) that `tracker.ts` plays back. Values are kept in MASI's native units so the player can
 * reproduce the original line processor exactly (volumes 0..127, effect parameters as stored).
 *
 * File layout (little endian; chunk = 4-byte id + u32 length + body):
 *
 *   "PSM " u32 (fileSize - 12) "FILE"            file header (12 bytes)
 *   SDFT  "MAINSONG"                              format tag (required)
 *   TITL  title text
 *   PBOD  one pattern:  u32 length (again) | id[4] ("P0  ") | u16 rows | rows...
 *           row   = u16 size (incl. itself) | events...
 *           event = u8 flags | u8 channel | [note] [instr] [volume] [effect, param bytes...]
 *                   flags 0x80 note, 0x40 instrument, 0x20 volume, 0x10 effect
 *                   note: high nibble octave, low nibble semitone (0x40 = sample's c5 speed)
 *                   instr: 0-based sample slot (through the OPLH sample map)
 *                   volume: 0..127 (converted from MOD/MTM volumes as 2v-1)
 *                   effect: command byte followed by 0, 1 or 3 parameter bytes (see PARAM_BYTES)
 *   SONG  u8 name[9] ("MAINSONG ") | u8 compression (=1) | u8 channels | sub-chunks:
 *           DATE  "YYMMDD"
 *           OPLH  u16 item count | playlist program (see {@link PlaylistItem})
 *           PPAN  (Sinaria only)  PATT pattern list  DSAM sample list  (informational)
 *   DSMP  one sample: 96-byte header | 8-bit delta-encoded PCM
 *           +0 flags (0x80 = loop) | +1 file name[8] | +9 id[4] ("I0  ") | +13 name[33]
 *           +46 6 bytes | +52 u16 sample number | +54 u32 length | +58 u32 loop start
 *           +62 u32 loop end | +66 u8 flags2 | +67 u8 finetune | +68 u8 default volume (0..127)
 *           +69 u32 (unused) | +73 u32 c5 speed (Hz at note 0x40) | +77 padding[19]
 *
 * References: the original MASI line processor MDRV000R.MUS ("MASI Line Processing Routines v3.50",
 * shipped with the game and disassembled for this implementation: effect parameter byte counts,
 * OPLH opcode lengths and semantics), OpenMPT soundlib/Load_psm.cpp, libxmp src/loaders/masi_load.c,
 * DUMB src/it/readpsm.c and https://moddingwiki.shikadi.net/wiki/ProTracker_Studio_Module.
 */

/** "No note" in {@link TrackerPattern.note}. */
export const NOTE_NONE = 0;
/**
 * Raw note byte 0xFF. MASI clears the channel's volume variable but does not silence the voice
 * (OpenMPT: "apparently not supported by MASI"). Not used by any OMF 2097 track.
 */
export const NOTE_CUT = 255;
/** Note number that plays a sample at its {@link TrackerSample.c5Speed} (raw PSM note 0x40). */
export const NOTE_BASE = 49;
/** Highest volume in MASI units (volume column, default volumes, slides). */
export const VOLUME_MAX = 127;
/** {@link TrackerPattern.param} value for effects that carry no parameter byte in the file. */
export const PARAM_NONE = -1;

/** Event field presence bits in {@link TrackerPattern.mask} (same as the PSM flag byte). */
export const EventMask = {
  Note: 0x80,
  Instrument: 0x40,
  Volume: 0x20,
  Effect: 0x10,
} as const;

/**
 * Effect commands, using the PSM command numbers. Semantics (units are MASI's):
 * volume slides move the 0..127 volume by `param` per tick (fine: once per row); portamentos move
 * the period by `param` per tick (MASI periods are 1/4 Amiga periods, C-4 = 1712 at 8448 Hz);
 * vibrato/tremolo params are `speed << 4 | depth` exactly like ProTracker.
 * Names follow the original line processor (MDRV000R.MUS); where OpenMPT differs it is noted.
 */
export const Effect = {
  None: 0x00,
  FineVolumeSlideUp: 0x01,
  VolumeSlideUp: 0x02,
  FineVolumeSlideDown: 0x03,
  VolumeSlideDown: 0x04,
  /** Behaves like VolumeSlideUp on non-first ticks in MASI; no parameter byte. */
  VolumeSlideUpAlt: 0x05,
  FinePortamentoUp: 0x0b,
  PortamentoUp: 0x0c,
  FinePortamentoDown: 0x0d,
  PortamentoDown: 0x0e,
  TonePortamento: 0x0f,
  TonePortamentoVolumeSlideUp: 0x10,
  /** MASI: tone portamento + volume slide down (OpenMPT maps 0x11 to glissando control). */
  TonePortamentoVolumeSlideDown: 0x11,
  Vibrato: 0x15,
  VibratoWaveform: 0x16,
  VibratoVolumeSlideUp: 0x17,
  VibratoVolumeSlideDown: 0x18,
  Tremolo: 0x1f,
  TremoloWaveform: 0x20,
  /** 24-bit little-endian sample offset (three parameter bytes). */
  SampleOffset: 0x29,
  Retrigger: 0x2a,
  NoteCut: 0x2b,
  NoteDelay: 0x2c,
  /** Re-use the last sample offset (no parameter byte). */
  SampleOffsetRepeat: 0x2d,
  /** Ignored by MASI (one parameter byte). */
  PositionJump: 0x33,
  /** MASI ignores the parameter and always continues at row 0 of the next playlist entry. */
  PatternBreak: 0x34,
  PatternLoop: 0x35,
  PatternDelay: 0x36,
  Speed: 0x3d,
  Tempo: 0x3e,
  Arpeggio: 0x47,
  /** Sets the channel's c5 speed from MASI's finetune table. */
  SetFinetune: 0x48,
  /** Sets the channel's raw pan byte (takes effect at the next instrument load). */
  SetBalance: 0x49,
} as const;

/**
 * Number of parameter bytes following each effect command in pattern data. Copied from the table
 * at 0x6F9 in MDRV000R.MUS (index = command). Commands above 0x50 are rejected by the parser.
 * Note: 0x33 has one byte here (OpenMPT reads two), 0x12 has none.
 */
const PARAM_BYTES: ReadonlyArray<number> = [
  // 0x00-0x0f
  0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
  // 0x10-0x1f
  1, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1,
  // 0x20-0x2f
  1, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1, 1, 1, 0, 0, 0,
  // 0x30-0x3f
  0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0,
  // 0x40-0x50
  0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
];

export interface TrackerSample {
  /** Sample number referenced by the playlist sample map (DSMP header field). */
  number: number;
  name: string;
  /** Original file name the sample came from (e.g. "MENU"). */
  fileName: string;
  /** Sample id string, e.g. "I0". */
  id: string;
  /** Signed 8-bit PCM (decoded from the delta encoding). Empty for unused slots. */
  data: Int8Array;
  loop: boolean;
  /** Loop start in samples (inclusive). */
  loopStart: number;
  /** Loop end in samples (exclusive). */
  loopEnd: number;
  /** Playback rate in Hz at {@link NOTE_BASE}. MASI's default is 8448 Hz. */
  c5Speed: number;
  /** Default volume, raw byte (0..127 in practice; applied unclamped like MASI does). */
  defaultVolume: number;
  /** Header finetune byte (unused by MASI; kept for completeness). */
  finetune: number;
  /** Raw DSMP header flag bytes (offset 0 and 66). */
  flags: number;
  flags2: number;
}

/**
 * One pattern as a sparse, row-ordered event list (the file order is preserved because MASI
 * processes events in that order). Events of row `r` are the indices
 * `rowStart[r] .. rowStart[r + 1] - 1` of the per-event arrays.
 */
export interface TrackerPattern {
  /** Raw 4-character id used by the playlist, e.g. "P0  ". */
  id: string;
  rows: number;
  rowStart: Uint32Array;
  /**
   * Channel of each event. Malformed files may reference channels >= the song's channel count
   * (MASI would scribble over its channel table); the player ignores such events.
   */
  channel: Uint8Array;
  /** {@link EventMask} bits telling which of the following fields are present. */
  mask: Uint8Array;
  /** 1 + octave * 12 + semitone ({@link NOTE_BASE} = raw 0x40), or {@link NOTE_CUT}. */
  note: Uint8Array;
  /** 0-based sample slot (mapped through the song's sample map). */
  instrument: Uint8Array;
  /** Raw volume byte (MASI clamps to 0..127 at playback). */
  volume: Uint8Array;
  /** {@link Effect} command. */
  effect: Uint8Array;
  /** Effect parameter (the full 24-bit value for SampleOffset), or {@link PARAM_NONE}. */
  param: Int32Array;
}

/**
 * The OPLH playlist is a small program executed by MASI whenever a pattern ends: it is a list of
 * "lines" (items) executed in sequence until a `play` item is reached. Jumps address lines.
 */
export type PlaylistItem =
  | { readonly op: 'end' }
  /**
   * Play `pattern` from `startRow` up to (excluding) `endRow` (256 = to the end). Opcode 0x01 plays
   * the whole pattern; 0x02 ("play range") is broken in MASI v3.50 (it does not rebuild its row
   * table, so it reads rows of the previously played pattern); the intended range is played here.
   */
  | { readonly op: 'play'; readonly pattern: number; readonly startRow: number; readonly endRow: number }
  /** MASI v3.50 always takes this jump (the counter is never used to fall through). */
  | { readonly op: 'jumpLoop'; readonly line: number; readonly count: number }
  | { readonly op: 'jump'; readonly line: number }
  /** Replaces bit 0 of the channel flags (bit 0 set = channel volume never updated, i.e. muted). */
  | { readonly op: 'channelFlip'; readonly channel: number; readonly value: number }
  | { readonly op: 'speed'; readonly value: number }
  | { readonly op: 'tempo'; readonly value: number }
  /** map[first + i] = start + i * step for i in 0 .. last - first - 1 */
  | { readonly op: 'sampleMap'; readonly first: number; readonly last: number; readonly start: number; readonly step: number }
  /** Raw signed pan byte (-128..127, stored as read) and type (0 = pan, 2 = surround, 4 = center). */
  | { readonly op: 'pan'; readonly channel: number; readonly pan: number; readonly type: number }
  /** Channel volume 0..255 (255 = unity). */
  | { readonly op: 'channelVolume'; readonly channel: number; readonly volume: number }
  /** Opcodes MASI accepts but ignores (6 = transpose, 9, 11). */
  | { readonly op: 'nop'; readonly code: number };

export interface TrackerSong {
  /** Song type from the SONG chunk, normally "MAINSONG". */
  name: string;
  channels: number;
  /** Conversion date from the DATE sub-chunk (YYMMDD), if present. */
  date: string;
  /** The OPLH program, one entry per line. */
  playlist: PlaylistItem[];

  // --- Format-neutral summary derived from the playlist (informational; the player runs the playlist) ---
  /** Pattern index of each `play` item in playlist order. */
  orders: number[];
  /** Playlist line of each order. */
  orderLines: number[];
  /** Order index the playlist jumps back to at its end (-1 if the playlist ends instead of looping). */
  restartOrder: number;
  /** Speed / tempo in effect when the first pattern starts. */
  initialSpeed: number;
  initialTempo: number;
  /**
   * Speed / tempo re-applied when the song loops (MASI re-executes the playlist lines between the
   * jump target and the restart pattern). Undefined when the loop keeps the current value.
   */
  restartSpeed: number | undefined;
  restartTempo: number | undefined;
  /** MASI has no global volume; always 1. */
  globalVolume: number;
  /** Raw signed pan byte per channel (-128..127, 0 = center, negative = left). */
  channelPanRaw: number[];
  /** Pan per channel in -1 (left) .. +1 (right). */
  channelPan: number[];
  channelSurround: boolean[];
  /** Channel volume 0..1 (OPLH 0x0E; 1 for all OMF tracks). */
  channelVolume: number[];
}

export interface TrackerModule {
  format: 'psm';
  title: string;
  /** Number of channels (maximum over all songs). */
  channels: number;
  /** Sample slots indexed by sample number (missing numbers are empty samples). */
  samples: TrackerSample[];
  patterns: TrackerPattern[];
  /** Subsongs (SONG chunks); OMF files have exactly one. */
  songs: TrackerSong[];
}

const MAX_CHANNELS = 32;
const MAX_ROWS = 255; // MASI reads the row count as a byte.

class Reader {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8(o: number): number {
    return this.bytes[o];
  }
  u16(o: number): number {
    return this.view.getUint16(o, true);
  }
  u32(o: number): number {
    return this.view.getUint32(o, true);
  }
  str(o: number, n: number): string {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.bytes[o + i]);
    return s;
  }
  /** String up to the first NUL, with trailing spaces removed. */
  cstr(o: number, n: number): string {
    let s = '';
    for (let i = 0; i < n; i++) {
      const c = this.bytes[o + i];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s.replace(/\s+$/, '');
  }
}

interface Chunk {
  id: string;
  offset: number; // body offset
  length: number;
}

function readChunks(r: Reader, start: number, end: number, where: string): Chunk[] {
  const chunks: Chunk[] = [];
  let o = start;
  while (o + 8 <= end) {
    const id = r.str(o, 4);
    const length = r.u32(o + 4);
    if (o + 8 + length > end) {
      throw new Error(`PSM: ${where} chunk "${id}" at offset ${o} (length ${length}) extends past the end of its container (${end})`);
    }
    chunks.push({ id, offset: o + 8, length });
    o += 8 + length;
  }
  return chunks;
}

/** Converts a raw PSM note byte to a note number (see {@link NOTE_BASE}). */
function convertNote(raw: number): number {
  if (raw === 0xff) return NOTE_CUT;
  // MASI treats a zero note byte as "no note".
  if (raw === 0) return NOTE_NONE;
  let octave = raw >> 4;
  let semi = raw & 0x0f;
  // Low nibbles 12..15 are invalid (MASI would index past its period table); carry them instead.
  if (semi >= 12) {
    semi -= 12;
    octave++;
  }
  return 1 + octave * 12 + semi;
}

function parsePattern(r: Reader, chunk: Chunk): TrackerPattern {
  const base = chunk.offset;
  const end = base + chunk.length;
  if (chunk.length < 10) throw new Error(`PSM: PBOD chunk at offset ${base - 8} is too short (${chunk.length} bytes)`);
  const id = r.str(base + 4, 4);
  if (id === 'PATT') throw new Error('PSM: Sinaria-style pattern ids ("PATT0   ") are not supported (not a MASI v3.x file)');
  const rows = r.u16(base + 8);
  if (rows === 0 || rows > MAX_ROWS) throw new Error(`PSM: pattern "${id.trim()}" has an invalid row count ${rows}`);

  // First pass: count events so the arrays can be sized exactly.
  const rowOffsets: number[] = [];
  let o = base + 10;
  let count = 0;
  for (let row = 0; row < rows; row++) {
    if (o + 2 > end) throw new Error(`PSM: pattern "${id.trim()}" row ${row} starts past the end of the chunk`);
    const size = r.u16(o);
    if (size < 2 || o + size > end) throw new Error(`PSM: pattern "${id.trim()}" row ${row} has an invalid size ${size}`);
    rowOffsets.push(o);
    const rowEnd = o + size;
    let p = o + 2;
    while (p < rowEnd) {
      if (p + 2 > rowEnd) throw new Error(`PSM: pattern "${id.trim()}" row ${row}: truncated event at offset ${p}`);
      const flags = r.u8(p);
      p += 2;
      if (flags & 0x80) p++;
      if (flags & 0x40) p++;
      if (flags & 0x20) p++;
      if (flags & 0x10) {
        const fx = r.u8(p);
        if (fx >= PARAM_BYTES.length) {
          throw new Error(`PSM: pattern "${id.trim()}" row ${row}: unknown effect command 0x${fx.toString(16)}`);
        }
        p += 1 + PARAM_BYTES[fx];
      }
      if (p > rowEnd) throw new Error(`PSM: pattern "${id.trim()}" row ${row}: event overruns the row (offset ${p}, row end ${rowEnd})`);
      count++;
    }
    o = rowEnd;
  }

  const pat: TrackerPattern = {
    id,
    rows,
    rowStart: new Uint32Array(rows + 1),
    channel: new Uint8Array(count),
    mask: new Uint8Array(count),
    note: new Uint8Array(count),
    instrument: new Uint8Array(count),
    volume: new Uint8Array(count),
    effect: new Uint8Array(count),
    param: new Int32Array(count).fill(PARAM_NONE),
  };

  let e = 0;
  for (let row = 0; row < rows; row++) {
    pat.rowStart[row] = e;
    const ro = rowOffsets[row];
    const rowEnd = ro + r.u16(ro);
    let p = ro + 2;
    while (p < rowEnd) {
      const flags = r.u8(p);
      const ch = r.u8(p + 1);
      p += 2;
      const mask = flags & 0xf0;
      if (flags & 0x80) pat.note[e] = convertNote(r.u8(p++));
      if (flags & 0x40) pat.instrument[e] = r.u8(p++);
      if (flags & 0x20) pat.volume[e] = r.u8(p++);
      if (flags & 0x10) {
        const fx = r.u8(p++);
        const n = PARAM_BYTES[fx];
        pat.effect[e] = fx;
        if (n === 1) pat.param[e] = r.u8(p);
        else if (n === 3) pat.param[e] = r.u8(p) | (r.u8(p + 1) << 8) | (r.u8(p + 2) << 16);
        p += n;
      }
      pat.channel[e] = ch;
      pat.mask[e] = mask;
      e++;
    }
  }
  pat.rowStart[rows] = e;
  return pat;
}

function decodeSample(r: Reader, chunk: Chunk): TrackerSample {
  const h = chunk.offset;
  if (chunk.length < 96) throw new Error(`PSM: DSMP chunk at offset ${h - 8} is too short (${chunk.length} bytes)`);
  const flags = r.u8(h);
  const length = r.u32(h + 54);
  if (96 + length > chunk.length) {
    throw new Error(`PSM: sample "${r.cstr(h + 9, 4)}" claims ${length} bytes but its chunk only holds ${chunk.length - 96}`);
  }
  const data = new Int8Array(length);
  let acc = 0;
  for (let i = 0; i < length; i++) {
    acc = (acc + r.u8(h + 96 + i)) & 0xff; // delta encoding, start value 0
    data[i] = acc > 127 ? acc - 256 : acc;
  }
  let loopStart = r.u32(h + 58);
  let loopEnd = r.u32(h + 62);
  let loop = (flags & 0x80) !== 0;
  if (loopEnd === 0xffffffff || loopEnd > length) loopEnd = length;
  if (loopStart >= loopEnd) loop = false;
  if (!loop) {
    loopStart = 0;
    loopEnd = 0;
  }
  return {
    number: r.u16(h + 52),
    name: r.cstr(h + 13, 33),
    fileName: r.cstr(h + 1, 8),
    id: r.cstr(h + 9, 4),
    data,
    loop,
    loopStart,
    loopEnd,
    c5Speed: r.u32(h + 73),
    defaultVolume: r.u8(h + 68),
    finetune: r.u8(h + 67),
    flags,
    flags2: r.u8(h + 66),
  };
}

/** Opcode lengths in bytes including the opcode (MDRV000R.MUS table at 0x7DB). */
const OPLH_LENGTH: ReadonlyArray<number> = [1, 5, 7, 4, 3, 3, 2, 2, 2, 2, -1, 4, 7, 4, 3];

function parsePlaylist(r: Reader, start: number, end: number, patternIds: Map<string, number>): PlaylistItem[] {
  if (start + 2 > end) throw new Error('PSM: OPLH sub-chunk is too short');
  const count = r.u16(start);
  const items: PlaylistItem[] = [];
  let o = start + 2;
  for (let line = 0; line < count; line++) {
    if (o >= end) break; // MASI would read past the chunk; treat the missing lines as the end
    const op = r.u8(o);
    const len = op < OPLH_LENGTH.length ? OPLH_LENGTH[op] : -1;
    if (len < 0) throw new Error(`PSM: playlist line ${line}: invalid opcode 0x${op.toString(16)} (MASI would hang)`);
    if (o + len > end) throw new Error(`PSM: playlist line ${line}: opcode 0x${op.toString(16)} is truncated`);
    const pattern = (): number => {
      // MASI searches the pattern list by id and falls back to the first pattern when it is missing.
      const idx = patternIds.get(r.str(o + 1, 4));
      return idx ?? 0;
    };
    switch (op) {
      case 0x00:
        items.push({ op: 'end' });
        break;
      case 0x01:
        items.push({ op: 'play', pattern: pattern(), startRow: 0, endRow: MAX_ROWS + 1 });
        break;
      case 0x02:
        items.push({ op: 'play', pattern: pattern(), startRow: r.u8(o + 5), endRow: r.u8(o + 6) });
        break;
      case 0x03:
        items.push({ op: 'jumpLoop', line: r.u16(o + 1), count: r.u8(o + 3) });
        break;
      case 0x04:
        items.push({ op: 'jump', line: r.u16(o + 1) });
        break;
      case 0x05:
        items.push({ op: 'channelFlip', channel: r.u8(o + 1), value: r.u8(o + 2) });
        break;
      case 0x07:
        items.push({ op: 'speed', value: r.u8(o + 1) });
        break;
      case 0x08:
        items.push({ op: 'tempo', value: r.u8(o + 1) });
        break;
      case 0x0c:
        items.push({ op: 'sampleMap', first: r.u8(o + 1), last: r.u8(o + 2), start: r.u16(o + 3), step: r.u16(o + 5) });
        break;
      case 0x0d: {
        const raw = r.u8(o + 2);
        items.push({ op: 'pan', channel: r.u8(o + 1), pan: raw > 127 ? raw - 256 : raw, type: r.u8(o + 3) });
        break;
      }
      case 0x0e:
        items.push({ op: 'channelVolume', channel: r.u8(o + 1), volume: r.u8(o + 2) });
        break;
      default:
        items.push({ op: 'nop', code: op });
        break;
    }
    o += len;
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if ((it.op === 'jump' || it.op === 'jumpLoop') && it.line >= items.length) {
      throw new Error(`PSM: playlist line ${i} jumps to line ${it.line}, but the playlist only has ${items.length} lines`);
    }
  }
  return items;
}

/** Derives the format-neutral order list / restart information from a playlist. */
function summarizeSong(song: TrackerSong): void {
  const pl = song.playlist;
  const n = song.channels;
  song.channelPanRaw = new Array<number>(n).fill(0);
  song.channelSurround = new Array<boolean>(n).fill(false);
  song.channelVolume = new Array<number>(n).fill(1);
  let speed = 6;
  let tempo = 125;
  let started = false;
  for (let line = 0; line < pl.length; line++) {
    const it = pl[line];
    if (it.op === 'play') {
      if (!started) {
        song.initialSpeed = speed;
        song.initialTempo = tempo;
        started = true;
      }
      song.orders.push(it.pattern);
      song.orderLines.push(line);
    } else if (!started) {
      if (it.op === 'speed') speed = it.value;
      else if (it.op === 'tempo') tempo = it.value;
      else if (it.op === 'pan' && it.channel < n) {
        song.channelPanRaw[it.channel] = it.pan;
        song.channelSurround[it.channel] = (it.type & 2) !== 0;
      } else if (it.op === 'channelVolume' && it.channel < n) {
        song.channelVolume[it.channel] = it.volume / 255;
      }
    }
    if (it.op === 'end' || it.op === 'jump' || it.op === 'jumpLoop') {
      if (it.op !== 'end') {
        // Walk from the jump target to the next play item, collecting re-applied settings.
        let rs: number | undefined;
        let rt: number | undefined;
        for (let l = it.line, guard = 0; l < pl.length && guard < pl.length; l++, guard++) {
          const t = pl[l];
          if (t.op === 'speed') rs = t.value;
          else if (t.op === 'tempo') rt = t.value;
          else if (t.op === 'play') {
            song.restartOrder = song.orderLines.indexOf(l);
            if (song.restartOrder < 0) song.restartOrder = 0;
            break;
          } else if (t.op === 'end' || t.op === 'jump' || t.op === 'jumpLoop') break;
        }
        song.restartSpeed = rs;
        song.restartTempo = rt;
      }
      break;
    }
  }
  if (!started) {
    song.initialSpeed = speed;
    song.initialTempo = tempo;
  }
  song.channelPan = song.channelPanRaw.map((p) => Math.max(-1, Math.min(1, p / 127)));
}

/**
 * Parses a MASI "new PSM" file. Throws an Error with a descriptive message on malformed data.
 */
export function parsePSM(data: Uint8Array): TrackerModule {
  if (!(data instanceof Uint8Array)) throw new Error('PSM: expected a Uint8Array');
  if (data.length < 12) throw new Error(`PSM: file too short (${data.length} bytes)`);
  const r = new Reader(data);
  const magic = r.str(0, 4);
  if (magic !== 'PSM ' || r.str(8, 4) !== 'FILE') {
    if (magic === 'PSM\xfe') throw new Error('PSM: this is an old-style "PSM16" module (Silverball), not a MASI "new PSM" file');
    if (magic === 'QUP$') throw new Error('PSM: encrypted PSM files (CONVERT.EXE /K) are not supported');
    throw new Error(`PSM: bad magic "${magic.replace(/[^\x20-\x7e]/g, '?')}" (expected "PSM " ... "FILE")`);
  }
  const chunks = readChunks(r, 12, data.length, 'top-level');
  const sdft = chunks.find((c) => c.id === 'SDFT');
  if (!sdft || sdft.length < 8 || r.str(sdft.offset, 8) !== 'MAINSONG') {
    throw new Error('PSM: missing or invalid SDFT chunk (expected "MAINSONG")');
  }
  const titl = chunks.find((c) => c.id === 'TITL');
  const title = titl ? r.cstr(titl.offset, titl.length) : '';

  // Songs first: they define the channel count needed to validate pattern events.
  const songChunks = chunks.filter((c) => c.id === 'SONG');
  if (songChunks.length === 0) throw new Error('PSM: no SONG chunk');
  let channels = 0;
  for (const c of songChunks) {
    if (c.length < 11) throw new Error('PSM: SONG chunk too short');
    if (r.u8(c.offset + 9) !== 1) throw new Error(`PSM: unsupported SONG compression ${r.u8(c.offset + 9)} (only 1 = uncompressed exists)`);
    const n = r.u8(c.offset + 10);
    if (n === 0 || n > MAX_CHANNELS) throw new Error(`PSM: invalid channel count ${n}`);
    channels = Math.max(channels, n);
  }

  const patterns = chunks.filter((c) => c.id === 'PBOD').map((c) => parsePattern(r, c));
  if (patterns.length === 0) throw new Error('PSM: no patterns (PBOD chunks)');
  const patternIds = new Map<string, number>();
  patterns.forEach((p, i) => {
    if (!patternIds.has(p.id)) patternIds.set(p.id, i);
  });

  const songs: TrackerSong[] = songChunks.map((c) => {
    const sub = readChunks(r, c.offset + 11, c.offset + c.length, 'SONG sub-');
    const oplh = sub.find((s) => s.id === 'OPLH');
    if (!oplh) throw new Error('PSM: SONG chunk has no OPLH (playlist) sub-chunk');
    const date = sub.find((s) => s.id === 'DATE');
    const song: TrackerSong = {
      name: r.cstr(c.offset, 9),
      channels: r.u8(c.offset + 10),
      date: date ? r.cstr(date.offset, date.length) : '',
      playlist: parsePlaylist(r, oplh.offset, oplh.offset + oplh.length, patternIds),
      orders: [],
      orderLines: [],
      restartOrder: -1,
      initialSpeed: 6,
      initialTempo: 125,
      restartSpeed: undefined,
      restartTempo: undefined,
      globalVolume: 1,
      channelPanRaw: [],
      channelPan: [],
      channelSurround: [],
      channelVolume: [],
    };
    summarizeSong(song);
    if (song.orders.length === 0) throw new Error('PSM: the playlist does not play any pattern');
    return song;
  });

  const decoded = chunks.filter((c) => c.id === 'DSMP').map((c) => decodeSample(r, c));
  const maxNumber = decoded.reduce((m, s) => Math.max(m, s.number), -1);
  const samples: TrackerSample[] = [];
  for (let i = 0; i <= maxNumber; i++) {
    samples.push({
      number: i, name: '', fileName: '', id: '', data: new Int8Array(0), loop: false, loopStart: 0, loopEnd: 0,
      c5Speed: 8448, defaultVolume: 0, finetune: 0, flags: 0, flags2: 0,
    });
  }
  for (const s of decoded) samples[s.number] = s;

  return { format: 'psm', title, channels, samples, patterns, songs };
}
