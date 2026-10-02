/**
 * Real-time player for MASI PSM modules ({@link TrackerModule} from `psm.ts`).
 *
 * Two parts:
 *  - {@link MasiSequencer}: a port of the original MASI "Line Processing Routines" v3.50
 *    (MDRV000R.MUS, 16-bit real-mode x86, (c) 1994 Joshua C. Jensen, shipped with One Must Fall
 *    2097). It was disassembled for this implementation and its behaviour is reproduced exactly,
 *    including integer arithmetic and quirks (verified tick-by-tick against the original code run
 *    under a CPU emulator). Hex addresses in comments refer to offsets in MDRV000R.MUS.
 *  - {@link TrackerPlayer}: the sound-driver side (what MASI's Sound Blaster / GUS drivers do):
 *    voices, resampling (nearest / linear / cubic), volume and the Sound Blaster driver's pan law
 *    (MDRV004R.MUS), with short volume ramps to avoid clicks.
 *
 * No DOM / Web APIs are used and nothing is allocated while rendering, so the player can run
 * inside an AudioWorklet `process()` call. This module has only type imports, so it can also be
 * loaded directly by Node (type stripping) and by AudioWorkletGlobalScope bundles.
 */
import type {
  Effect as EffectTable,
  EventMask as EventMaskTable,
  NOTE_CUT as NoteCutValue,
  PARAM_NONE as ParamNoneValue,
  PlaylistItem,
  TrackerModule,
  TrackerPattern,
  TrackerSample,
  TrackerSong,
} from './psm';

// Local copies of the constants in psm.ts (type-checked to be identical) so this module has no
// runtime imports.
const FX: typeof EffectTable = {
  None: 0x00,
  FineVolumeSlideUp: 0x01,
  VolumeSlideUp: 0x02,
  FineVolumeSlideDown: 0x03,
  VolumeSlideDown: 0x04,
  VolumeSlideUpAlt: 0x05,
  FinePortamentoUp: 0x0b,
  PortamentoUp: 0x0c,
  FinePortamentoDown: 0x0d,
  PortamentoDown: 0x0e,
  TonePortamento: 0x0f,
  TonePortamentoVolumeSlideUp: 0x10,
  TonePortamentoVolumeSlideDown: 0x11,
  Vibrato: 0x15,
  VibratoWaveform: 0x16,
  VibratoVolumeSlideUp: 0x17,
  VibratoVolumeSlideDown: 0x18,
  Tremolo: 0x1f,
  TremoloWaveform: 0x20,
  SampleOffset: 0x29,
  Retrigger: 0x2a,
  NoteCut: 0x2b,
  NoteDelay: 0x2c,
  SampleOffsetRepeat: 0x2d,
  PositionJump: 0x33,
  PatternBreak: 0x34,
  PatternLoop: 0x35,
  PatternDelay: 0x36,
  Speed: 0x3d,
  Tempo: 0x3e,
  Arpeggio: 0x47,
  SetFinetune: 0x48,
  SetBalance: 0x49,
};
const MASK: typeof EventMaskTable = { Note: 0x80, Instrument: 0x40, Volume: 0x20, Effect: 0x10 };
const NOTE_CUT: typeof NoteCutValue = 255;
const PARAM_NONE: typeof ParamNoneValue = -1;

/** Default output gain applied on top of `setVolume()` (see {@link TrackerPlayerOptions.mixGain}). */
export const DEFAULT_MIX_GAIN = 0.3;

// --- MASI tables (MDRV000R.MUS) -------------------------------------------------------------
/**
 * Period table at 0x656 (ST3-style periods, C..B; C-4 = 1712 at 8448 Hz). Entries 12..15 are the
 * words that follow in memory (the finetune table); only reachable through malformed notes.
 */
const PERIODS = [1712, 1616, 1524, 1440, 1356, 1280, 1208, 1140, 1076, 1016, 960, 906, 8448, 8509, 8571, 8633];
/** Middle-C speed per finetune value (table at 0x66E, used by effect 0x48). */
const FINETUNE_C5 = [8448, 8509, 8571, 8633, 8696, 8759, 8822, 8886, 7974, 8032, 8090, 8148, 8208, 8267, 8327, 8387];
/** Vibrato / tremolo half-sine (ProTracker's table, at 0x636). */
const SINE = [
  0, 24, 49, 74, 97, 120, 141, 161, 180, 197, 212, 224, 235, 244, 250, 253,
  255, 253, 250, 244, 235, 224, 212, 197, 180, 161, 141, 120, 97, 74, 49, 24,
];
/** period = PERIODS[semitone] * 0x21000 >> octave / c5speed (0xA06). 0x21000 = 16 * 8448. */
const PERIOD_SCALE = 0x21000;
/** frequency (Hz) = 0xDCB000 / period (0xB1E). 0xDCB000 = 1712 * 8448. */
const FREQ_SCALE = 0xdcb000;
/** Portamento clamps (0xF54 / 0xF6E): the ProTracker range 113..856 in quarter periods. */
const PORTA_MIN = 0x1c4;
const PORTA_MAX = 0xd60;
const DEFAULT_C5 = 0x2100; // 8448 Hz, the value MASI initialises channels with (0x7B2)

const s16 = (v: number): number => (v << 16) >> 16;

/**
 * The calls MASI's line processor makes into the sound driver (driver function numbers in
 * brackets). `channel` identifies the voice (MASI allocates one voice per channel).
 */
export interface MasiDriver {
  /** [0x0F + 0x0C] Stop the voice and start `sample` at `offset` with volume 0. */
  noteOn(channel: number, sample: number, offset: number, pan: number, flags: number): void;
  /** [0x0D] Restart the voice's current sample at `offset` (retrigger / note delay). */
  setPosition(channel: number, offset: number): void;
  /** [0x10] Voice volume, 0..127. */
  setVolume(channel: number, volume: number): void;
  /** [0x14] Voice playback rate in Hz (integer, as computed by MASI). */
  setFrequency(channel: number, hz: number): void;
  /** [0x06] Song tempo in BPM (ticks per second = tempo * 2 / 5). */
  setTempo(bpm: number): void;
}

/** One channel of the line processor (the 36-byte structure at 0x1B6 + 0x24 * channel). */
class SeqChannel {
  note = 0; // +00 note of the current row (0 = none), as a psm.ts note number
  instrument = 0; // +01
  effect = 0; // +02
  param = 0; // +03 (one byte)
  flags = 0; // +04 bit0 = no volume updates (muted), bit1 = surround, bit2 = center
  volume = 0; // +05 0..127 (raw byte)
  pan = 0; // +09 raw signed pan byte
  chanVolume = 0xff; // +0A
  c5 = DEFAULT_C5; // +0C
  offset = 0; // +10 sample offset for the next note-on
  offsetMem = 0; // +14
  period = 0; // +18 16-bit
  portaTarget = 0; // +1A
  arpNote = 0; // +1C
  volSlideMem = 0; // +1D bit7 = direction up
  portaSpeed = 0; // +1E
  vibParam = 0; // +1F
  vibPos = 0; // +20
  tremParam = 0; // +21
  tremPos = 0; // +22
  waveforms = 0; // +23 low nibble vibrato, high nibble tremolo

  reset(): void {
    this.note = this.instrument = this.effect = this.param = this.flags = this.volume = this.pan = 0;
    this.chanVolume = 0xff;
    this.c5 = DEFAULT_C5;
    this.offset = this.offsetMem = this.period = this.portaTarget = this.arpNote = 0;
    this.volSlideMem = this.portaSpeed = this.vibParam = this.vibPos = this.tremParam = this.tremPos = this.waveforms = 0;
  }
}

/** Converts a psm.ts note number to MASI's raw note byte (octave << 4 | semitone). */
function rawNote(note: number): number {
  if (note === 0) return 0;
  const n = note - 1;
  return (((n / 12) | 0) << 4 | n % 12) & 0xff;
}

/**
 * Port of MASI's line processor. Call {@link MasiSequencer.step} once per tick (every
 * 2.5 / tempo seconds); it reports everything audible through the {@link MasiDriver} passed to
 * the constructor. {@link TrackerPlayer} does this for you; use the sequencer directly only to
 * inspect or re-route the event stream.
 */
export class MasiSequencer {
  readonly module: TrackerModule;
  readonly song: TrackerSong;
  readonly channels: number;
  /** When false, the song stops (ended = true) instead of following a backward playlist jump. */
  loop = true;
  /** Number of times the playlist has jumped backwards (i.e. the song has looped). */
  loopCount = 0;

  private readonly driver: MasiDriver;
  private readonly chans: SeqChannel[] = [];
  private readonly sampleMap = new Uint16Array(256);
  private readonly lineToOrder: Int32Array;

  // Globals (MLPR data segment)
  private tickCounter = 0; // 0x17F
  private speed = 0; // 0x180
  private tempo = 0; // 0x181
  private curRow = 0; // 0x176
  private rowCount = 0; // 0x17A
  private rowLimit = 0; // 0x19A
  private line = 0; // 0x19E, next playlist line
  private jumpCounter = 0; // 0x18E
  private delayCount = 0; // 0x18A
  private delayPending = 0; // 0x18B
  private flow = 0; // 0x18C (1 = pattern loop, 2 = pattern break)
  private breakRow = 0; // 0x192 (stored but ignored by MASI)
  private loopRow = 0; // 0x196
  private patLoopCount = 0; // 0x18D
  private songEnded = false; // 0x156
  private isEnded = false;
  private pat: TrackerPattern | null = null;
  private patIndex = 0;
  private orderIndex = 0;
  // Per-event scratch (0x6F6 / 0x6F7 / 0x68F and the 96-byte sample header copy at 0x692)
  private volOut = 0xff;
  private perOut = 0;
  private instrLoaded = false;
  private hdrSample = 0;
  private hdrPan = 0;
  private hdrFlags = 0;
  private curEvent = 0;

  constructor(module: TrackerModule, driver: MasiDriver, songIndex = 0) {
    const song = module.songs[songIndex];
    if (!song) throw new Error(`MASI: song ${songIndex} does not exist (module has ${module.songs.length})`);
    this.module = module;
    this.song = song;
    this.channels = song.channels;
    this.driver = driver;
    for (let i = 0; i < this.channels; i++) this.chans.push(new SeqChannel());
    this.lineToOrder = new Int32Array(song.playlist.length).fill(-1);
    song.orderLines.forEach((line, order) => {
      if (this.lineToOrder[line] < 0) this.lineToOrder[line] = order;
    });
    this.reset();
  }

  /** Current position (order index into `song.orders`, pattern index, row). */
  get order(): number {
    return this.orderIndex;
  }
  get pattern(): number {
    return this.patIndex;
  }
  get row(): number {
    return this.curRow & 0xffff;
  }
  get tick(): number {
    return this.tickCounter;
  }
  get currentSpeed(): number {
    return this.speed;
  }
  /** Current tempo in BPM (125 until the playlist sets one). */
  get currentTempo(): number {
    return this.tempo || 125;
  }
  get ended(): boolean {
    return this.isEnded;
  }

  /** Back to the start of the song (MASI init, 0x768 / 0x7A2). */
  reset(): void {
    for (const c of this.chans) c.reset();
    // MASI's sample map is filled by the playlist (opcode 0x0C); identity is the sensible default.
    for (let i = 0; i < 256; i++) this.sampleMap[i] = i;
    this.tickCounter = this.speed = this.tempo = 0;
    this.curRow = this.rowCount = this.rowLimit = this.line = 0;
    this.jumpCounter = this.delayCount = this.delayPending = this.flow = this.breakRow = 0;
    this.loopRow = this.patLoopCount = 0;
    this.songEnded = this.isEnded = false;
    this.pat = null;
    this.patIndex = this.orderIndex = 0;
    this.loopCount = 0;
  }

  /** Processes one tick (0xA44). */
  step(): void {
    if (this.isEnded) return;
    this.tickCounter = (this.tickCounter + 1) & 0xff;
    if (this.tickCounter < this.speed) {
      this.otherTick();
      return;
    }
    this.tickCounter = 0;
    this.curRow = (this.curRow + 1) >>> 0;
    if (this.delayPending !== 0) {
      this.delayCount = this.delayPending;
      this.delayPending = 0;
    }
    if (this.delayCount !== 0) {
      this.delayCount = (this.delayCount - 1) & 0xff;
      if (this.delayCount !== 0) this.curRow = (this.curRow - 1) >>> 0; // repeat the row
    }
    let nextEntry = false;
    if (this.flow !== 0) {
      const f = this.flow;
      this.flow = 0;
      if (f === 1) {
        // Pattern loop: jump back to the loop start row.
        this.seekRow(this.loopRow);
        this.rowProc();
        return;
      }
      // Pattern break: the target row (0x192) is ignored, the next playlist entry starts at its first row.
      if (f === 2) nextEntry = true;
    }
    if (!nextEntry && (this.curRow & 0xffff) < this.rowLimit) {
      this.seekRow(this.curRow & 0xffff);
      this.rowProc();
      return;
    }
    this.breakRow = 0;
    this.flow = 0;
    this.advancePlaylist();
    this.delayCount = 0;
    if (this.songEnded || this.isEnded) return;
    this.rowProc();
  }

  private rowProc(): void {
    // 0xADE: during a pattern delay the row is not re-read; only the per-tick effects run.
    if (this.delayCount === 0) this.processRow();
    else this.otherTick();
  }

  /** 0xDCF */
  private seekRow(row: number): void {
    this.curRow = row > this.rowCount ? this.rowCount : row;
  }

  /** Executes playlist lines until a pattern starts (0x822). */
  private advancePlaylist(): void {
    const pl = this.song.playlist;
    const n = this.channels;
    let guard = 0;
    for (;;) {
      if (++guard > pl.length * 2 + 16 || this.line >= pl.length) {
        // A playlist without a reachable pattern would hang MASI.
        this.songEnded = this.isEnded = true;
        return;
      }
      const lineNo = this.line;
      const it: PlaylistItem = pl[lineNo];
      this.line = lineNo + 1;
      switch (it.op) {
        case 'end':
          // MASI flags the song as finished (0x86B). The game's tracks never get here (they jump).
          if (this.loop) {
            this.line = 0;
            this.loopCount++;
            continue;
          }
          this.songEnded = this.isEnded = true;
          return;
        case 'play': {
          // MASI falls back to the first pattern for unknown ids (the parser already maps them).
          const index = it.pattern < this.module.patterns.length ? it.pattern : 0;
          const pat = this.module.patterns[index];
          this.pat = pat;
          this.patIndex = index;
          this.orderIndex = this.lineToOrder[lineNo];
          this.rowCount = pat.rows & 0xff;
          this.seekRow(it.startRow);
          this.rowLimit = it.endRow < this.rowCount ? it.endRow : this.rowCount;
          return;
        }
        case 'jumpLoop':
        case 'jump':
          // MASI v3.50 updates the jump-loop counter but always takes the jump (0x8D2).
          if (it.op === 'jumpLoop') this.jumpCounter = this.jumpCounter === 0 ? it.count : (this.jumpCounter - 1) & 0xff;
          if (it.line <= lineNo) {
            if (!this.loop) {
              this.isEnded = true;
              return;
            }
            this.loopCount++;
          }
          this.line = it.line;
          continue;
        case 'channelFlip':
          if (it.channel < n) {
            const c = this.chans[it.channel];
            c.flags = ((c.flags & 0xfe) | it.value) & 0xff;
          }
          continue;
        case 'speed':
          this.speed = it.value;
          continue;
        case 'tempo':
          this.tempo = it.value;
          this.driver.setTempo(it.value);
          continue;
        case 'sampleMap': {
          let v = it.start;
          for (let i = it.first; i < it.last && i < 256; i++) {
            this.sampleMap[i] = v & 0xffff;
            v += it.step;
          }
          continue;
        }
        case 'pan':
          if (it.channel < n) {
            const c = this.chans[it.channel];
            c.pan = it.pan;
            c.flags = ((c.flags & 0xf9) | it.type) & 0xff;
          }
          continue;
        case 'channelVolume':
          if (it.channel < n) this.chans[it.channel].chanVolume = it.volume;
          continue;
        case 'nop':
          continue;
      }
    }
  }

  /** New row: read the events (0xB6C). Only channels with an event are processed. */
  private processRow(): void {
    const chans = this.chans;
    for (let c = 0; c < this.channels; c++) {
      chans[c].note = 0;
      chans[c].effect = 0;
    }
    const pat = this.pat;
    if (!pat || this.curRow >= pat.rows) return;
    const end = pat.rowStart[this.curRow + 1];
    for (let e = pat.rowStart[this.curRow]; e < end; e++) {
      const c = pat.channel[e];
      if (c >= this.channels) continue;
      const ch = chans[c];
      this.volOut = 0xff;
      this.perOut = 0;
      this.curEvent = e;
      this.processEvent(ch, c, pat, e);
      this.output(ch, c);
    }
  }

  /** Ticks other than the first of a row (0xAF8): continuous effects for every channel. */
  private otherTick(): void {
    const chans = this.chans;
    for (let c = 0; c < this.channels; c++) {
      const ch = chans[c];
      this.volOut = 0xff;
      this.perOut = 0;
      this.tickEffect(ch, c);
      this.output(ch, c);
    }
  }

  /** Sends the frequency / volume produced by an event or effect to the driver (0xBD6-0xC24). */
  private output(ch: SeqChannel, c: number): void {
    if (this.perOut !== 0) this.driver.setFrequency(c, Math.floor(FREQ_SCALE / this.perOut));
    if (this.volOut !== 0xff && (ch.flags & 1) === 0) {
      const a = ((this.volOut << 1) & 0xff) * ch.chanVolume;
      let hi = a >> 8;
      if (hi !== 0) hi = (hi + 1) & 0xff;
      this.driver.setVolume(c, hi >> 1);
    }
  }

  /** Period of a raw note byte for the channel's c5 speed (0xA06). */
  private periodRaw(ch: SeqChannel, raw: number): number {
    const c5 = ch.c5 !== 0 ? ch.c5 : DEFAULT_C5; // MASI would divide by zero
    const num = (PERIODS[raw & 0x0f] * PERIOD_SCALE) >>> (raw >> 4);
    return Math.floor(num / c5) & 0xffff;
  }

  /**
   * 24-bit sample offset of an event (0x1106 reads the three bytes before the end of the current
   * event). If a channel has two events in one row and only the first carries the offset command,
   * MASI would read unrelated bytes of the second event; that cannot occur in converted files and
   * is treated as offset 0 here.
   */
  private eventOffset(pat: TrackerPattern, e: number): number {
    const p = pat.param[e];
    return p >= 0 ? p & 0xffffff : 0;
  }

  /** Loads the channel's instrument into the sample header copy (0xD4B). */
  private loadInstrument(ch: SeqChannel, fromInstrumentColumn: boolean): void {
    this.instrLoaded = true;
    const slot = this.sampleMap[ch.instrument] & 0xff;
    const smp: TrackerSample | undefined = this.module.samples[slot];
    this.hdrSample = slot;
    this.hdrPan = ch.pan;
    this.hdrFlags = ((smp ? smp.flags2 : 0) | (ch.flags & 2 ? 1 : 0) | (ch.flags & 4 ? 2 : 0)) & 0xff;
    ch.c5 = smp ? smp.c5Speed : DEFAULT_C5;
    let v = ch.volume;
    if (fromInstrumentColumn) {
      ch.volSlideMem = 0;
      v = smp ? smp.defaultVolume : 0; // not clamped, as in MASI
    }
    ch.volume = v;
    this.volOut = v;
    ch.offset = 0;
  }

  /** Row-start processing of one event (0xC2D). */
  private processEvent(ch: SeqChannel, c: number, pat: TrackerPattern, e: number): void {
    this.instrLoaded = false;
    const mask = pat.mask[e];
    if (mask & MASK.Note) {
      ch.note = pat.note[e];
      ch.arpNote = ch.note;
    }
    if (mask & MASK.Instrument) {
      ch.instrument = pat.instrument[e];
      this.loadInstrument(ch, true);
    }
    if (mask & MASK.Volume) {
      const v = pat.volume[e] > 0x7f ? 0x7f : pat.volume[e];
      ch.volume = v;
      this.volOut = v;
    }
    if (mask & MASK.Effect) {
      ch.effect = pat.effect[e];
      const p = pat.param[e];
      // Commands without parameter bytes keep the previous parameter.
      if (p !== PARAM_NONE) ch.param = p & 0xff;
    }
    if (ch.note === NOTE_CUT) {
      // Clears the volume variable only; nothing is sent to the voice.
      ch.note = 0;
      ch.arpNote = 0;
      ch.volume = 0;
      this.rowEffect(ch, c);
      return;
    }
    if (ch.note === 0) {
      this.rowEffect(ch, c);
      return;
    }
    const fx = ch.effect;
    if (fx === FX.SetFinetune) {
      this.setFinetune(ch, ch.param);
    } else if (fx === FX.TonePortamento || fx === FX.TonePortamentoVolumeSlideUp || fx === FX.TonePortamentoVolumeSlideDown) {
      // Tone portamento: the note only sets the target, it is not triggered.
      ch.portaTarget = this.periodRaw(ch, rawNote(ch.note));
      this.rowEffect(ch, c);
      return;
    }
    // A note without instrument re-loads the current instrument but keeps the volume.
    if (!this.instrLoaded) this.loadInstrument(ch, false);
    if (fx === FX.SampleOffsetRepeat) ch.offset = ch.offsetMem;
    else if (fx === FX.SampleOffset) ch.offset = ch.offsetMem = this.eventOffset(pat, e);
    const per = this.periodRaw(ch, rawNote(ch.note));
    ch.period = per;
    this.perOut = per;
    if (fx === FX.NoteDelay) {
      // Not triggered now; also skips the row effects (0xD06 jumps straight into 0x116A).
      this.noteDelay(ch, c, ch.param);
      return;
    }
    // New note: vibrato / tremolo restart. MASI uses SETE here, so the position becomes 1 (not 0)
    // unless the "no retrigger" waveform bit is set, in which case it becomes 0 (0xD09).
    ch.vibPos = ch.waveforms & 0x04 ? 0 : 1;
    ch.tremPos = ch.waveforms & 0x40 ? 0 : 1;
    this.driver.noteOn(c, this.hdrSample, ch.offset, this.hdrPan, this.hdrFlags);
    this.rowEffect(ch, c);
  }

  /** First-tick effects (0xDFA). */
  private rowEffect(ch: SeqChannel, c: number): void {
    const p = ch.param;
    switch (ch.effect) {
      case FX.FinePortamentoUp:
        this.portaUp(ch, p);
        break;
      case FX.FinePortamentoDown:
        this.portaDown(ch, p);
        break;
      case FX.FineVolumeSlideUp:
        this.volSlideUp(ch, p);
        break;
      case FX.FineVolumeSlideDown:
        this.volSlideDown(ch, p);
        break;
      case FX.VibratoWaveform:
        ch.waveforms = ((ch.waveforms & 0xf0) | p) & 0xff;
        break;
      case FX.SetFinetune:
        this.setFinetune(ch, p);
        break;
      case FX.TremoloWaveform:
        ch.waveforms = ((ch.waveforms & 0x0f) | (p << 4)) & 0xff;
        break;
      case FX.SampleOffsetRepeat:
        ch.offset = ch.offsetMem;
        break;
      case FX.SampleOffset:
        ch.offset = ch.offsetMem = this.pat ? this.eventOffset(this.pat, this.curEvent) : 0;
        break;
      case FX.PatternBreak:
        this.breakRow = p;
        this.flow = 2;
        break;
      case FX.Speed:
        if (p !== 0) {
          this.tickCounter = 0;
          this.speed = p;
        }
        break;
      case FX.Tempo:
        this.tempo = p;
        this.driver.setTempo(p);
        break;
      case FX.PatternLoop:
        this.patternLoop(p);
        break;
      case FX.SetBalance:
        // Stored for the next instrument load; MASI never re-sends pan to a playing voice.
        ch.pan = p > 127 ? p - 256 : p;
        break;
      case FX.PatternDelay:
        if (this.delayCount === 0) this.delayPending = p;
        break;
      case FX.Retrigger:
        this.retrigger(ch, c, p);
        break;
      case FX.NoteCut:
        this.noteCut(ch, p);
        break;
      case FX.NoteDelay:
        this.noteDelay(ch, c, p);
        break;
      default:
        // Every other event re-sends the base period (this ends a vibrato / arpeggio).
        this.perOut = ch.period;
        break;
    }
  }

  /** Effects on the other ticks (0xE86). */
  private tickEffect(ch: SeqChannel, c: number): void {
    const p = ch.param;
    switch (ch.effect) {
      case FX.Arpeggio:
        this.arpeggio(ch, p);
        break;
      case FX.PortamentoUp:
        this.portaUp(ch, p);
        break;
      case FX.PortamentoDown:
        this.portaDown(ch, p);
        break;
      case FX.TonePortamento:
        this.tonePorta(ch, p);
        break;
      case FX.Vibrato:
        this.vibrato(ch, p);
        break;
      case FX.TonePortamentoVolumeSlideUp:
        this.tonePorta(ch, 0);
        this.volSlideUp(ch, p);
        break;
      case FX.TonePortamentoVolumeSlideDown:
        this.tonePorta(ch, 0);
        this.volSlideDown(ch, p);
        break;
      case FX.VibratoVolumeSlideUp:
        this.vibrato(ch, 0);
        this.volSlideUp(ch, p);
        break;
      case FX.VibratoVolumeSlideDown:
        this.vibrato(ch, 0);
        this.volSlideDown(ch, p);
        break;
      case FX.Retrigger:
        this.retrigger(ch, c, p);
        break;
      case FX.NoteCut:
        this.noteCut(ch, p);
        break;
      case FX.NoteDelay:
        this.noteDelay(ch, c, p);
        break;
      case FX.Tremolo:
        this.tremolo(ch, p);
        break;
      case FX.VolumeSlideUp:
      case FX.VolumeSlideUpAlt:
        this.volSlideUp(ch, p);
        break;
      case FX.VolumeSlideDown:
        this.volSlideDown(ch, p);
        break;
    }
  }

  /** 0xEF8. A zero parameter repeats the last slide, including its direction. */
  private volSlideUp(ch: SeqChannel, p: number): void {
    if (p === 0) {
      const m = ch.volSlideMem;
      if ((m & 0x80) === 0) {
        this.slideDown(ch, m & 0x7f);
        return;
      }
      p = m & 0x7f;
    }
    this.slideUp(ch, p);
  }

  /** 0xF2A */
  private volSlideDown(ch: SeqChannel, p: number): void {
    if (p === 0) {
      const m = ch.volSlideMem;
      if (m & 0x80) {
        this.slideUp(ch, m & 0x7f);
        return;
      }
      p = m & 0x7f;
    }
    this.slideDown(ch, p);
  }

  /** 0xF0A: 8-bit add, clamped to 127. */
  private slideUp(ch: SeqChannel, a: number): void {
    ch.volSlideMem = (a | 0x80) & 0xff;
    let v = (ch.volume + a) & 0xff;
    if (v >= 0x7f) v = 0x7f;
    ch.volume = v;
    this.volOut = v;
  }

  /** 0xF3C: 8-bit subtract, negative results become 0. */
  private slideDown(ch: SeqChannel, a: number): void {
    ch.volSlideMem = a & 0xff;
    let v = (ch.volume - a) & 0xff;
    if (v & 0x80) v = 0;
    ch.volume = v;
    this.volOut = v;
  }

  /** 0xF54: the period is clamped to 452 (not only when sliding past it). */
  private portaUp(ch: SeqChannel, p: number): void {
    let per = (ch.period - p) & 0xffff;
    if (per < PORTA_MIN) per = PORTA_MIN;
    ch.period = per;
    this.perOut = per;
  }

  /** 0xF6E */
  private portaDown(ch: SeqChannel, p: number): void {
    let per = (ch.period + p) & 0xffff;
    if (per >= PORTA_MAX) per = PORTA_MAX;
    ch.period = per;
    this.perOut = per;
  }

  /** 0xF88: slides `speed` period units per tick towards the target (signed 16-bit compares). */
  private tonePorta(ch: SeqChannel, p: number): void {
    const speed = p !== 0 ? p : ch.portaSpeed;
    ch.portaSpeed = speed;
    const target = ch.portaTarget;
    if (ch.period === target) return;
    let per = s16(ch.period);
    const t = s16(target);
    if (per > t) {
      per = s16(per - speed);
      if (per < t) per = t;
    } else {
      per = s16(per + speed);
      if (per > t) per = t;
    }
    ch.period = per & 0xffff;
    this.perOut = ch.period;
  }

  /** 0xFD6: ProTracker-style vibrato; depth units are 1/128 of a (quarter) period per step. */
  private vibrato(ch: SeqChannel, p: number): void {
    if (p !== 0) {
      let v = ch.vibParam;
      if (p & 0x0f) v = (v & 0xf0) | (p & 0x0f);
      if (p & 0xf0) v = (v & 0x0f) | (p & 0xf0);
      ch.vibParam = v;
    }
    const pos = ch.vibPos;
    const idx = (pos >> 2) & 0x1f;
    const type = ch.waveforms & 3;
    let amp: number;
    if (type === 0) amp = SINE[idx];
    else if (type === 1) amp = pos < 0x80 ? (idx << 3) & 0xff : 0xff - ((idx << 3) & 0xff);
    else amp = 0xff;
    const delta = (((ch.vibParam & 0x0f) << 2) * amp) >> 7;
    this.perOut = (pos < 0x80 ? ch.period + delta : ch.period - delta) & 0xffff;
    ch.vibPos = (pos + ((ch.vibParam >> 2) & 0x3c)) & 0xff;
  }

  /** 0x106C (unused by OMF 2097; ported with MASI's quirks). */
  private tremolo(ch: SeqChannel, p: number): void {
    if (p !== 0) {
      let v = ch.tremParam;
      if (p & 0x0f) v = (v & 0xf0) | (p & 0x0f);
      if (p & 0xf0) v = (v & 0x0f) | (p & 0xf0);
      ch.tremParam = v;
    }
    const pos = ch.tremPos;
    const idx = (pos >> 2) & 0x1f;
    const type = (ch.waveforms >> 4) & 3;
    let amp: number;
    if (type === 0) amp = SINE[idx];
    else if (type === 1) amp = (idx << 3) & 0xff; // MASI tests the wrong variable here: never inverted
    else amp = 0xff;
    const delta = ((ch.tremParam & 0x0f) * amp) >> 6;
    let v = pos < 0x80 ? ch.volume + delta : ch.volume - delta;
    if (v > 0xff || v < 0) v = 0; // carry / borrow
    // MASI then clamps with a signed compare against 0x7F, which never changes the value
    // (0x80..0xFF are negative), so no clamp here.
    this.volOut = v;
    ch.tremPos = (pos + ((ch.tremParam >> 2) & 0x3c)) & 0xff;
  }

  /**
   * 0x11EE. Note MASI's octave carry uses OR instead of ADD, so carries out of odd octaves are
   * lost (reproduced as is; OMF 2097 does not use arpeggio).
   */
  private arpeggio(ch: SeqChannel, p: number): void {
    const r = this.tickCounter % 3;
    const x = r === 1 ? p >> 4 : r === 2 ? p & 0x0f : 0;
    const raw = rawNote(ch.arpNote);
    let semi = (raw & 0x0f) + x;
    let carry = 0;
    while (semi >= 12) {
      carry = (carry + 0x10) & 0xff;
      semi -= 12;
    }
    this.perOut = this.periodRaw(ch, ((((raw & 0xf0) + semi) & 0xff) | carry) & 0xff);
  }

  /** 0x1234 */
  private setFinetune(ch: SeqChannel, p: number): void {
    ch.c5 = FINETUNE_C5[p & 0x0f]; // MASI does not mask (reads past its table for p > 15)
  }

  /** 0x112A: retrigger every `p` ticks of the row (tick 0 only when there is no new note). */
  private retrigger(ch: SeqChannel, c: number, p: number): void {
    if (p === 0) return;
    const t = this.tickCounter;
    if (t === 0 && ch.note !== 0) return;
    if (t % p === 0) this.driver.setPosition(c, 0);
  }

  /** 0x115A */
  private noteCut(ch: SeqChannel, p: number): void {
    if (p === this.tickCounter) {
      ch.volume = 0;
      this.volOut = 0;
    }
  }

  /** 0x116A: restarts the voice's current sample at the delay tick. */
  private noteDelay(ch: SeqChannel, c: number, p: number): void {
    let v = 0xff;
    if (p === this.tickCounter && ch.note !== 0) {
      this.driver.setPosition(c, 0);
      v = ch.volume;
    }
    this.volOut = v;
  }

  /** 0x119E */
  private patternLoop(p: number): void {
    if (p === 0) {
      this.loopRow = this.curRow & 0xffff;
      return;
    }
    if (this.patLoopCount === 0) {
      this.patLoopCount = p;
    } else {
      this.patLoopCount = (this.patLoopCount - 1) & 0xff;
      if (this.patLoopCount === 0) return;
    }
    this.curRow = this.loopRow;
    this.flow = 1;
  }
}

// ------------------------------------------------------------------------------------------
// Mixer
// ------------------------------------------------------------------------------------------

export type InterpolationMode = 'nearest' | 'linear' | 'cubic';

export interface TrackerPlayerOptions {
  /** Subsong index (default 0). */
  song?: number;
  /**
   * Linear gain applied to the mix before `setVolume()`. The default ({@link DEFAULT_MIX_GAIN})
   * keeps the loudest OMF 2097 track (ARENA0) around -3.7 dBFS peak at volume 1.
   */
  mixGain?: number;
  /**
   * 1 (default) = the Sound Blaster driver's panning as is (OMF channels sit at +-63: the near
   * side at full level, the far side at ~50%); 0 = mono.
   */
  stereoSeparation?: number;
  interpolation?: InterpolationMode;
  loop?: boolean;
}

/** Guard samples before / after each sample buffer (interpolation reads up to 2 ahead, 1 behind). */
const PAD_BEFORE = 1;
const PAD_AFTER = 3;

interface PreparedSample {
  /** PAD_BEFORE guard samples, the data (up to the loop end when looping), PAD_AFTER guards. */
  buf: Float32Array;
  length: number;
  loop: boolean;
  loopStart: number;
  /** Where playback wraps or stops (loop end when looping, else the sample length). */
  end: number;
}

function prepareSample(s: TrackerSample | undefined): PreparedSample | null {
  if (!s || s.data.length === 0) return null;
  const end = s.loop ? s.loopEnd : s.data.length;
  const buf = new Float32Array(PAD_BEFORE + end + PAD_AFTER);
  for (let i = 0; i < end; i++) buf[PAD_BEFORE + i] = s.data[i] / 128;
  if (s.loop) {
    // Unroll the loop start into the guard so interpolation across the loop point is seamless.
    const len = s.loopEnd - s.loopStart;
    for (let i = 0; i < PAD_AFTER; i++) buf[PAD_BEFORE + end + i] = s.data[s.loopStart + (i % len)] / 128;
  }
  return { buf, length: s.data.length, loop: s.loop, loopStart: s.loopStart, end };
}

class Voice {
  /** Tails only fade out; they stop when the fade completes. */
  readonly isTail: boolean;
  smp: PreparedSample | null = null;
  active = false;
  /** Set by a note-on until the first volume arrives (that one gets the short attack ramp). */
  fresh = false;
  pos = 0;
  step = 0;
  volume = 0; // 0..127, as set by the driver
  panL = 1;
  panR = 1;
  gainL = 0; // current (ramped) gains
  gainR = 0;
  targetL = 0;
  targetR = 0;
  rampLeft = 0;
  dL = 0;
  dR = 0;

  constructor(isTail: boolean) {
    this.isTail = isTail;
  }

  copyFrom(v: Voice): void {
    this.smp = v.smp;
    this.active = v.active;
    this.pos = v.pos;
    this.step = v.step;
    this.volume = v.volume;
    this.panL = v.panL;
    this.panR = v.panR;
    this.gainL = v.gainL;
    this.gainR = v.gainR;
    this.targetL = v.targetL;
    this.targetR = v.targetR;
    this.rampLeft = v.rampLeft;
    this.dL = v.dL;
    this.dR = v.dR;
  }
}

/**
 * Plays a {@link TrackerModule}. `render()` mixes (adds) into the given buffers and never
 * allocates, so it can be called from an AudioWorkletProcessor.
 */
export class TrackerPlayer {
  readonly module: TrackerModule;
  readonly sampleRate: number;
  private readonly seq: MasiSequencer;
  private readonly samples: (PreparedSample | null)[];
  private readonly voices: Voice[] = [];
  /** Fading copies of voices that were cut by a new note (declicking). */
  private readonly tails: Voice[] = [];
  private readonly rampIn: number;
  private readonly rampOut: number;
  private readonly rampVol: number;
  private mixGain: number;
  private separation: number;
  private master = 1;
  private interp: InterpolationMode = 'linear';
  private samplesPerTick: number;
  private tickLeft = 0;
  private stopped = false;

  constructor(module: TrackerModule, sampleRate: number, options: TrackerPlayerOptions = {}) {
    if (!(sampleRate > 0)) throw new Error(`TrackerPlayer: invalid sample rate ${sampleRate}`);
    this.module = module;
    this.sampleRate = sampleRate;
    this.mixGain = Number.isFinite(options.mixGain) ? Math.max(0, options.mixGain as number) : DEFAULT_MIX_GAIN;
    this.separation = Math.max(0, Math.min(1, options.stereoSeparation ?? 1));
    if (options.interpolation) this.interp = options.interpolation;
    this.samples = module.samples.map(prepareSample);
    this.rampIn = Math.max(1, Math.round(sampleRate * 0.0005));
    this.rampOut = Math.max(1, Math.round(sampleRate * 0.003));
    this.rampVol = Math.max(1, Math.round(sampleRate * 0.0015));
    this.samplesPerTick = (sampleRate * 2.5) / 125;
    const driver: MasiDriver = {
      noteOn: (c, s, o, p, f) => this.noteOn(c, s, o, p, f),
      setPosition: (c, o) => this.setPosition(c, o),
      setVolume: (c, v) => this.setVoiceVolume(c, v),
      setFrequency: (c, hz) => this.setFrequency(c, hz),
      setTempo: (bpm) => this.setTempo(bpm),
    };
    this.seq = new MasiSequencer(module, driver, options.song ?? 0);
    for (let i = 0; i < this.seq.channels; i++) {
      this.voices.push(new Voice(false));
      this.tails.push(new Voice(true));
    }
    this.seq.loop = options.loop ?? true;
  }

  /** Master music volume 0..1 (applied on top of the mix gain). */
  setVolume(v: number): void {
    this.master = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
    for (let c = 0; c < this.voices.length; c++) this.updateTarget(this.voices[c], this.rampVol);
  }

  setInterpolation(mode: InterpolationMode): void {
    if (mode === 'nearest' || mode === 'linear' || mode === 'cubic') this.interp = mode;
  }

  /**
   * Whether to follow the song's own loop (default true, like the game). With false the song ends
   * (`ended` becomes true, voices fade out) where it would loop; call reset() to play it again.
   */
  setLoop(loop: boolean): void {
    this.seq.loop = loop;
  }

  /** Changes the mix gain (see {@link TrackerPlayerOptions.mixGain}). */
  setMixGain(gain: number): void {
    this.mixGain = Number.isFinite(gain) ? Math.max(0, gain) : DEFAULT_MIX_GAIN;
    for (let c = 0; c < this.voices.length; c++) this.updateTarget(this.voices[c], this.rampVol);
  }

  /** Restarts the song from the beginning (silences all voices). */
  reset(): void {
    this.seq.reset();
    for (let c = 0; c < this.voices.length; c++) {
      this.voices[c].active = false;
      this.voices[c].smp = null;
      this.voices[c].volume = 0;
      this.voices[c].gainL = this.voices[c].gainR = this.voices[c].targetL = this.voices[c].targetR = 0;
      this.voices[c].rampLeft = 0;
      this.tails[c].active = false;
    }
    this.samplesPerTick = (this.sampleRate * 2.5) / 125;
    this.tickLeft = 0;
    this.stopped = false;
  }

  /** Index into `module.songs[n].orders` of the playing pattern. */
  get order(): number {
    return this.seq.order;
  }
  get row(): number {
    return this.seq.row;
  }
  /** Index into `module.patterns` of the playing pattern. */
  get pattern(): number {
    return this.seq.pattern;
  }
  /** True once the song has finished (only happens with setLoop(false)). */
  get ended(): boolean {
    return this.seq.ended;
  }
  get speed(): number {
    return this.seq.currentSpeed;
  }
  get tempo(): number {
    return this.seq.currentTempo;
  }
  /** How many times the song has looped back to its restart position. */
  get loopCount(): number {
    return this.seq.loopCount;
  }

  /** Mixes `frames` stereo frames into left/right starting at `offset` (adds to the contents). */
  render(left: Float32Array, right: Float32Array, offset: number, frames: number): void {
    let pos = offset;
    let remaining = frames;
    while (remaining > 0) {
      if (this.tickLeft <= 0) {
        if (!this.seq.ended) {
          this.seq.step();
        } else if (!this.stopped) {
          // Song finished: fade everything out.
          this.stopped = true;
          for (let c = 0; c < this.voices.length; c++) this.cutToTail(c);
        }
        this.tickLeft += this.samplesPerTick;
      }
      let n = Math.ceil(this.tickLeft);
      if (n > remaining) n = remaining;
      for (let c = 0; c < this.voices.length; c++) {
        const t = this.tails[c];
        if (t.active) this.mixVoice(t, left, right, pos, n);
        const v = this.voices[c];
        if (v.active) this.mixVoice(v, left, right, pos, n);
      }
      this.tickLeft -= n;
      pos += n;
      remaining -= n;
    }
  }

  // --- driver side ------------------------------------------------------------------------

  private setTempo(bpm: number): void {
    if (bpm > 0) this.samplesPerTick = (this.sampleRate * 2.5) / bpm;
  }

  private setFrequency(c: number, hz: number): void {
    this.voices[c].step = hz / this.sampleRate;
  }

  private setVoiceVolume(c: number, vol: number): void {
    const v = this.voices[c];
    v.volume = vol;
    this.updateTarget(v, v.fresh ? this.rampIn : this.rampVol);
    v.fresh = false;
  }

  /** Moves a sounding voice to the channel's tail slot, fading it out. */
  private cutToTail(c: number): void {
    const v = this.voices[c];
    if (!v.active || (v.gainL === 0 && v.gainR === 0 && v.targetL === 0 && v.targetR === 0)) {
      v.active = false;
      return;
    }
    const t = this.tails[c];
    t.copyFrom(v);
    t.targetL = t.targetR = 0;
    t.rampLeft = this.rampOut;
    t.dL = -t.gainL / this.rampOut;
    t.dR = -t.gainR / this.rampOut;
    v.active = false;
    v.gainL = v.gainR = 0;
  }

  private noteOn(c: number, sample: number, offset: number, pan: number, flags: number): void {
    this.cutToTail(c);
    const v = this.voices[c];
    const smp = this.samples[sample] ?? null;
    v.smp = smp;
    // The SB driver starts the voice at volume 0 (header byte 0x44 = 0xFF); MASI sets it right after.
    v.volume = 0;
    v.gainL = v.gainR = v.targetL = v.targetR = 0;
    v.rampLeft = 0;
    v.fresh = true;
    this.setPan(v, pan, flags);
    if (!smp) {
      v.active = false; // empty sample: the driver refuses the note, the channel stays silent
      return;
    }
    this.startAt(v, smp, offset);
  }

  private setPosition(c: number, offset: number): void {
    const v = this.voices[c];
    const smp = v.smp;
    if (!smp) return;
    if (v.active) {
      // Retrigger: fade the old position out instead of clicking.
      const vol = v.volume;
      const tl = v.targetL, tr = v.targetR;
      this.cutToTail(c);
      v.volume = vol;
      v.targetL = tl;
      v.targetR = tr;
    }
    v.gainL = v.gainR = 0;
    this.startAt(v, smp, offset);
    this.updateTarget(v, this.rampIn);
  }

  private startAt(v: Voice, smp: PreparedSample, offset: number): void {
    if (offset >= smp.end) {
      if (!smp.loop) {
        v.active = false;
        return;
      }
      offset = smp.loopStart;
    }
    v.pos = offset;
    v.active = true;
  }

  /**
   * Pan law of the MASI Sound Blaster driver (MDRV004R.MUS 0x0F91-0x104D): the side the channel
   * is panned to plays at full volume, the other side is attenuated linearly; +-127 are hard
   * left/right. Header flag 1 = surround (right channel inverted), 2 = center.
   */
  private setPan(v: Voice, pan: number, flags: number): void {
    if (flags & 1) {
      v.panL = 1;
      v.panR = -1;
      return;
    }
    if (flags & 2) {
      v.panL = v.panR = 1;
      return;
    }
    let p = pan;
    if (this.separation !== 1) p = Math.round(p * this.separation);
    if (p <= -127) {
      v.panL = 1;
      v.panR = 0;
    } else if (p >= 127) {
      v.panL = 0;
      v.panR = 1;
    } else if (p <= 0) {
      v.panL = 1;
      v.panR = (p + 127) / 128;
    } else {
      v.panL = (129 - p) / 128;
      v.panR = 1;
    }
  }

  private updateTarget(v: Voice, ramp: number): void {
    const g = (v.volume / 127) * this.mixGain * this.master;
    v.targetL = g * v.panL;
    v.targetR = g * v.panR;
    if (v.targetL === v.gainL && v.targetR === v.gainR) {
      v.rampLeft = 0;
      return;
    }
    v.rampLeft = ramp;
    v.dL = (v.targetL - v.gainL) / ramp;
    v.dR = (v.targetR - v.gainR) / ramp;
  }

  /** Resamples one voice into the output (adds). */
  private mixVoice(v: Voice, left: Float32Array, right: Float32Array, start: number, frames: number): void {
    const smp = v.smp;
    if (!smp) {
      v.active = false;
      return;
    }
    const buf = smp.buf;
    const end = smp.end;
    const loopLen = smp.end - smp.loopStart;
    const step = v.step;
    const mode = this.interp;
    let pos = v.pos;
    let gL = v.gainL;
    let gR = v.gainR;
    let ramp = v.rampLeft;
    const dL = v.dL;
    const dR = v.dR;
    const stop = start + frames;
    for (let i = start; i < stop; i++) {
      const ip = Math.floor(pos);
      const k = ip + PAD_BEFORE;
      let s: number;
      if (mode === 'linear') {
        const s0 = buf[k];
        s = s0 + (buf[k + 1] - s0) * (pos - ip);
      } else if (mode === 'cubic') {
        // Catmull-Rom spline through 4 points.
        const f = pos - ip;
        const y0 = buf[k - 1], y1 = buf[k], y2 = buf[k + 1], y3 = buf[k + 2];
        s = y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)));
      } else {
        s = buf[k];
      }
      if (ramp > 0) {
        gL += dL;
        gR += dR;
        if (--ramp === 0) {
          gL = v.targetL;
          gR = v.targetR;
        }
      }
      left[i] += s * gL;
      right[i] += s * gR;
      pos += step;
      if (pos >= end) {
        if (smp.loop && loopLen > 0) {
          pos -= loopLen * Math.floor((pos - smp.loopStart) / loopLen);
        } else {
          v.active = false;
          break;
        }
      }
    }
    v.pos = pos;
    v.gainL = gL;
    v.gainR = gR;
    v.rampLeft = ramp;
    // A tail that has faded out is finished. (Main voices keep running at volume 0, like MASI's.)
    if (v.isTail && ramp === 0) v.active = false;
  }
}

/** Result of {@link measureSong}. */
export interface SongMeasurement {
  /** Seconds until the song first loops back (or ends). */
  seconds: number;
  ticks: number;
  rows: number;
  /** True if the playlist jumps back (loops) rather than ending. */
  loops: boolean;
}

/**
 * Runs the sequencer without audio to find the song length (time until the first backward
 * playlist jump or the end). Uses nominal tick timing (2.5 / tempo seconds).
 */
export function measureSong(module: TrackerModule, songIndex = 0, maxSeconds = 3600): SongMeasurement {
  let tempo = 125;
  const driver: MasiDriver = {
    noteOn() {},
    setPosition() {},
    setVolume() {},
    setFrequency() {},
    setTempo(bpm: number) {
      if (bpm > 0) tempo = bpm;
    },
  };
  const seq = new MasiSequencer(module, driver, songIndex);
  seq.loop = false;
  let seconds = 0;
  let ticks = 0;
  let rows = 0;
  while (!seq.ended && seconds < maxSeconds) {
    seq.step();
    if (seq.ended) break;
    if (seq.tick === 0) rows++;
    seconds += 2.5 / tempo;
    ticks++;
  }
  const loops = module.songs[songIndex].restartOrder >= 0;
  return { seconds, ticks, rows, loops };
}
