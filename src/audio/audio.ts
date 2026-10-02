// Main-thread side of the audio system: channel allocation (like the original's 3 SFX channels)
// and messaging to the mixing AudioWorklet, which also runs the PSM music player.
import workletUrl from './worklet.ts?worker&url';
import { pitchedSampleRate, SOUND_CHANNEL_COUNT, soundSampleRate, type SoundOpts } from './soundOpts';
import type { SoundEntry } from '../formats/misc';
import { CustomMusicPlayer, myMusicFor, type MyMusicMode } from './customMusic';

export const AUDIO_INVALID_HANDLE = 0;

interface ChannelState {
  priority: number;
  soundId: number;
  guid: number;
  endTime: number;
}

export type MusicQuality = 'classic' | 'enhanced';

/** A song file playing over everything (the credits' song, see AudioSystem.playTrack). */
export interface Track {
  /** The song's levels (for visuals). */
  analyser: AnalyserNode;
  /**
   * The position playing in the song (s), or null while it does not play yet (loading) or has been stopped; past the
   * song's end it runs on (silence after the end), so that what keeps time with it can finish.
   */
  position(): number | null;
  /** Moves the song to a position (s): before a cut. */
  seek(pos: number): void;
  /**
   * Cuts, when the song reaches its position `at`, to `buffer` (a file holding the song from its position
   * `bufferStart` on) playing the song's position `pos`: a jump ahead in the song, on the beat (10 ms crossfade).
   * False when it cannot be done in time (less than 50 ms ahead) or has been done.
   */
  cutTo(buffer: AudioBuffer, at: number, pos: number, bufferStart: number): boolean;
  /** Fades the song out and ends it. */
  stop(fadeSeconds?: number): void;
}

/** Acoustics of a place: reverb time (s), delay before it (s), high frequency damping (Hz), level, early echoes (ms, gain). */
export interface Room {
  decay: number;
  predelay: number;
  damping: number;
  wet: number;
  early: [number, number][];
}

/** The arenas, in order: stadium, danger room, power plant, fire pit, desert. */
export const ROOMS: Room[] = [
  { decay: 1.9, predelay: 0.025, damping: 6500, wet: 0.22, early: [[23, 0.5], [41, 0.35], [67, 0.25]] },
  { decay: 0.85, predelay: 0.006, damping: 9000, wet: 0.26, early: [[7, 0.6], [13, 0.45], [19, 0.35], [29, 0.25]] },
  { decay: 2.6, predelay: 0.04, damping: 3500, wet: 0.26, early: [[38, 0.45], [71, 0.3], [110, 0.2]] },
  { decay: 1.4, predelay: 0.015, damping: 4500, wet: 0.22, early: [[15, 0.5], [31, 0.35], [52, 0.2]] },
  { decay: 0.45, predelay: 0.09, damping: 3000, wet: 0.12, early: [[90, 0.35], [180, 0.12]] },
  // The remaster's arenas: a metal hangar, an ice cave (long and bright), an open roof in the rain, a sealed dome.
  { decay: 2.2, predelay: 0.03, damping: 7500, wet: 0.24, early: [[29, 0.5], [53, 0.35], [89, 0.2]] },
  { decay: 3.1, predelay: 0.035, damping: 8500, wet: 0.3, early: [[21, 0.45], [47, 0.35], [83, 0.25], [127, 0.15]] },
  { decay: 0.5, predelay: 0.06, damping: 2600, wet: 0.1, early: [[70, 0.25], [150, 0.1]] },
  { decay: 1.7, predelay: 0.02, damping: 2200, wet: 0.3, early: [[17, 0.5], [34, 0.4], [61, 0.3]] },
];

/** Stereo impulse response of a room: decorrelated noise decaying to -60 dB, darker as it fades, plus early echoes. */
export function impulseResponse(ctx: Pick<BaseAudioContext, 'sampleRate' | 'createBuffer'>, room: Room, seed: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.ceil(rate * (room.predelay + room.decay * 1.1));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let x = (seed * 7919 + ch * 104729) >>> 0 || 1;
    let lp = 0;
    const start = Math.floor(room.predelay * rate);
    for (let i = start; i < len; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      const white = ((x >>> 0) / 4294967296) * 2 - 1;
      const t = (i - start) / rate;
      const cutoff = room.damping * (1 - 0.7 * Math.min(1, t / room.decay));
      lp += (1 - Math.exp((-2 * Math.PI * cutoff) / rate)) * (white - lp);
      d[i] = lp * Math.exp((-6.9 * t) / room.decay);
    }
    // Early echoes, alternating sides.
    room.early.forEach(([ms, gain], k) => {
      const i = start + Math.floor((ms / 1000) * rate);
      if (i < len) d[i] += gain * (k % 2 === ch ? 1 : 0.55);
    });
  }
  return buf;
}

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  /** Everything the game plays goes through this node to the speakers (and to a clip recording, captureStream). */
  private out: GainNode | null = null;
  private capture: MediaStreamAudioDestinationNode | null = null;
  private pending: { msg: unknown; transfer?: Transferable[] }[] = [];
  private channels: ChannelState[] = [];
  private nextGuid = 1;
  private sounds: SoundEntry[] = [];
  private soundVolume = 0.5;
  private musicVolume = 0.5;
  private currentMusic: string | null = null;
  private musicLoader: ((name: string) => Uint8Array) | null = null;
  private started = false;
  /** Audio could not be started (no Web Audio): messages are dropped instead of queued. */
  private unavailable = false;
  private quality: MusicQuality = 'classic';
  /** Arena acoustics: the effects send of the mixer goes through a convolution reverb. */
  private convolver: ConvolverNode | null = null;
  private wet: GainNode | null = null;
  private impulses = new Map<number, AudioBuffer>();
  private room = -1;
  private acoustics = true;
  private impactBass = true;
  /** The player's own music (OPTIONS > SOUND > MY MUSIC), and where it replaces the soundtrack. */
  private custom: CustomMusicPlayer | null = null;
  private myMusicMode: MyMusicMode = 'fights';
  /** A song file playing over everything (the credits' song, see playTrack), at the music volume. */
  private trackGain: GainNode | null = null;
  /** The mixer's output (music and sounds) and the player's own music, lowered while the newsreader speaks. */
  private mix: GainNode | null = null;
  /** The newsreader's report being read (see playSequence). */
  private sequence: { gain: GainNode; sources: AudioBufferSourceNode[]; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor() {
    for (let i = 0; i < SOUND_CHANNEL_COUNT; i++) this.channels.push({ priority: 0, soundId: 0, guid: 0, endTime: 0 });
  }

  /** Creates the audio context. Browsers require a user gesture before audio can start. */
  async init(sounds: SoundEntry[], musicLoader: (name: string) => Uint8Array): Promise<void> {
    this.sounds = sounds;
    this.musicLoader = musicLoader;
    try {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      await this.ctx.audioWorklet.addModule(workletUrl);
      this.node = new AudioWorkletNode(this.ctx, 'omf-audio', { numberOfInputs: 0, numberOfOutputs: 2, outputChannelCount: [2, 2] });
      this.out = this.ctx.createGain();
      this.out.connect(this.ctx.destination);
      this.mix = this.ctx.createGain();
      this.mix.connect(this.out);
      this.node.connect(this.mix, 0);
      this.convolver = this.ctx.createConvolver();
      this.wet = this.ctx.createGain();
      this.wet.gain.value = 0;
      this.node.connect(this.convolver, 1);
      this.convolver.connect(this.wet);
      this.wet.connect(this.out);
      this.applyRoom();
      this.custom = new CustomMusicPlayer(this.ctx, this.musicVolume, this.mix);
      this.custom.onSong = (name) => this.onSong?.(name);
      this.custom.onFail = () => {
        // (the player's songs would not play here: the original music until the library changes)
        this.myMusicFailed = true;
        const name = this.currentMusic;
        this.currentMusic = null;
        if (name) this.playMusic(name);
        this.onMyMusicFailed?.();
      };
      void this.custom.refresh().then(() => this.refreshMusic());
      this.node.port.onmessage = (e) => {
        if (e.data?.type === 'error') console.error('[audio worklet]', e.data.message);
      };
      // Decode SOUNDS.DAT to float PCM once and hand it to the mixer.
      const pcm = sounds.map((s) => {
        const f = new Float32Array(s.data.length);
        for (let i = 0; i < s.data.length; i++) f[i] = (s.data[i] - 128) / 128;
        return f;
      });
      this.post({ type: 'sounds', sounds: pcm }, pcm.map((p) => p.buffer));
      this.post({ type: 'volume', sound: this.soundVolume, music: this.musicVolume });
      this.post({ type: 'quality', quality: this.quality });
      for (const p of this.pending) this.node.port.postMessage(p.msg, p.transfer ?? []);
      this.pending = [];
    } catch (err) {
      console.warn('Audio unavailable:', err);
      this.ctx = null;
      this.node = null;
      this.unavailable = true;
      this.pending = [];
    }
  }

  /** Resumes the context after a user gesture (needed on the web). */
  resume(): void {
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume();
    this.custom?.resume();
    this.started = true;
  }

  /** Decodes a compressed sound file (null without audio or when it cannot be read). */
  async decode(data: ArrayBuffer): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    try {
      return await this.ctx.decodeAudioData(data);
    } catch {
      return null;
    }
  }

  /** Plays a decoded sound once at the given volume (0..1), with the game's other sounds (the announcer). */
  playBuffer(buffer: AudioBuffer, volume: number): void {
    if (!this.ctx || !this.out) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volume));
    src.connect(gain);
    gain.connect(this.out);
    src.onended = () => gain.disconnect();
    src.start();
  }

  /**
   * Plays decoded sounds one after the other, `lead` seconds from now, each overlapping the one before by `join`
   * seconds (the newsreader's stitched reports: the recordings carry their own pauses and fades). The music and
   * sounds are lowered meanwhile. Replaces the sequence playing.
   */
  playSequence(buffers: AudioBuffer[], volume: number, lead: number, join: number): void {
    if (!this.ctx || !this.out || !this.mix) return;
    this.stopSequence();
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volume));
    gain.connect(this.out);
    const t0 = ctx.currentTime + lead;
    let t = t0;
    const sources = buffers.map((b) => {
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.connect(gain);
      src.start(t);
      t += Math.max(0, b.duration - join);
      return src;
    });
    this.mix.gain.cancelScheduledValues(ctx.currentTime);
    this.mix.gain.setTargetAtTime(0.4, Math.max(ctx.currentTime, t0 - 0.2), 0.08);
    this.mix.gain.setTargetAtTime(1, t + 0.1, 0.25);
    const timer = setTimeout(() => {
      if (this.sequence?.gain === gain) this.sequence = null;
      gain.disconnect();
    }, (t - ctx.currentTime + 1) * 1000);
    this.sequence = { gain, sources, timer };
  }

  /** Stops the sequence playing (a short fade), and brings the music back up. */
  stopSequence(): void {
    const q = this.sequence;
    if (!q || !this.ctx || !this.mix) return;
    this.sequence = null;
    const now = this.ctx.currentTime;
    q.gain.gain.setTargetAtTime(0, now, 0.03);
    for (const s of q.sources) {
      try {
        s.stop(now + 0.2);
      } catch {
        // already stopped
      }
    }
    clearTimeout(q.timer);
    setTimeout(() => q.gain.disconnect(), 400);
    this.mix.gain.cancelScheduledValues(now);
    this.mix.gain.setTargetAtTime(1, now, 0.2);
  }

  /** The game's sound as a stream, for recording a clip (null without audio); releaseCapture() ends it. */
  captureStream(): MediaStream | null {
    if (!this.ctx || !this.out) return null;
    this.capture ??= this.ctx.createMediaStreamDestination();
    this.out.connect(this.capture);
    return this.capture.stream;
  }

  releaseCapture(): void {
    if (!this.out || !this.capture) return;
    try {
      this.out.disconnect(this.capture);
    } catch {
      // not connected
    }
  }

  get isRunning(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  private post(msg: unknown, transfer?: Transferable[]): void {
    if (this.node) this.node.port.postMessage(msg, transfer ?? []);
    else if (!this.unavailable) this.pending.push({ msg, transfer });
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : performance.now() / 1000;
  }

  private isChannelPlaying(ch: number): boolean {
    return this.now() < this.channels[ch].endTime;
  }

  private pickChannel(opts: SoundOpts, identity: number): number {
    if (opts.channel >= 0) return Math.min(opts.channel, SOUND_CHANNEL_COUNT - 1);
    if (identity !== 0 && (opts.skipDuplicate || opts.stopDuplicate)) {
      for (let ch = 0; ch < SOUND_CHANNEL_COUNT; ch++) {
        if (!this.isChannelPlaying(ch) || this.channels[ch].soundId !== identity) continue;
        if (opts.skipDuplicate) return -1;
        return ch;
      }
    }
    for (let ch = 0; ch < SOUND_CHANNEL_COUNT; ch++) if (!this.isChannelPlaying(ch)) return ch;
    for (let ch = 0; ch < SOUND_CHANNEL_COUNT; ch++) if (this.channels[ch].priority <= opts.priority) return ch;
    return -1;
  }

  /** Plays a SOUNDS.DAT entry. Returns a handle (0 if dropped). */
  playSound(soundId: number, opts: SoundOpts): number {
    const s = this.sounds[soundId];
    if (!s || s.data.length === 0) return AUDIO_INVALID_HANDLE;
    const ch = this.pickChannel(opts, soundId);
    if (ch < 0 || ch >= SOUND_CHANNEL_COUNT) return AUDIO_INVALID_HANDLE;
    const rate = pitchedSampleRate(soundSampleRate(s.freqKey), opts.pitch);
    const guid = this.nextGuid++;
    const st = this.channels[ch];
    st.priority = opts.priority;
    st.soundId = soundId;
    st.guid = guid;
    st.endTime = this.now() + s.data.length / rate;
    this.post({ type: 'play', ch, id: soundId, rate, volume: opts.volume, pan: opts.panning, fadeInMs: opts.fadeInMs });
    return (guid << 2) | ch;
  }

  /** Duration of a sound effect in milliseconds at the given pitch (0 if missing). */
  soundDurationMs(soundId: number, pitch: number): number {
    const s = this.sounds[soundId];
    if (!s || s.data.length === 0) return 0;
    return Math.trunc((s.data.length * 1000) / pitchedSampleRate(soundSampleRate(s.freqKey), pitch));
  }

  /** Simple UI sound (menu clicks). */
  playSoundSimple(soundId: number, panning: number, volume = 64): number {
    return this.playSound(soundId, {
      volume, panning, panningEnd: 0, pitch: 0, fadeInMs: 0, priority: 10, channel: -1,
      skipDuplicate: false, stopDuplicate: false, hasPanningSweep: false, followObjectId: 0,
    });
  }

  private resolve(handle: number): number {
    const ch = handle & 3;
    if (ch >= SOUND_CHANNEL_COUNT || this.channels[ch].guid !== handle >>> 2) return -1;
    return ch;
  }

  setPan(handle: number, pan: number): void {
    const ch = this.resolve(handle);
    if (ch >= 0) this.post({ type: 'pan', ch, pan });
  }

  fadeOut(handle: number, ms: number): void {
    const ch = this.resolve(handle);
    if (ch >= 0) this.post({ type: 'fade', ch, ms });
  }

  stopAllSounds(): void {
    for (let ch = 0; ch < SOUND_CHANNEL_COUNT; ch++) {
      this.channels[ch].endTime = 0;
      this.post({ type: 'stop', ch });
    }
  }

  playMusic(name: string): void {
    if (this.currentMusic === name) return;
    this.currentMusic = name;
    // The player's own music instead of the original piece (a new song for every fight).
    if (this.custom && this.custom.count > 0 && !this.myMusicFailed && myMusicFor(name, this.myMusicMode)) {
      this.post({ type: 'musicStop' });
      this.custom.play(/^ARENA\d/i.test(name) || !this.custom.playing);
      return;
    }
    this.custom?.stop();
    if (!this.musicLoader) return;
    let data: Uint8Array;
    try {
      data = this.musicLoader(name);
    } catch (e) {
      console.warn('Music not found', name, e);
      return;
    }
    const copy = data.slice();
    this.post({ type: 'music', name, data: copy }, [copy.buffer]);
  }

  stopMusic(): void {
    if (this.currentMusic === null) return;
    this.currentMusic = null;
    this.post({ type: 'musicStop' });
    this.custom?.stop();
  }

  /** Where the player's own music plays; applied to the music playing now. */
  setMyMusicMode(mode: MyMusicMode): void {
    if (mode === this.myMusicMode) return;
    this.myMusicMode = mode;
    this.refreshMusic();
  }

  /** Re-reads the music library (after songs were added or removed) and applies it to the music playing now. */
  async reloadMyMusic(): Promise<void> {
    const was = !!this.custom?.playing;
    await this.custom?.refresh();
    this.myMusicFailed = false;
    if (was && !this.custom?.playing) {
      // (the last songs were removed while one played: the original piece again)
      const name = this.currentMusic;
      this.currentMusic = null;
      if (name) this.playMusic(name);
      return;
    }
    this.refreshMusic();
  }

  /** Called when one of the player's songs starts. */
  onSong: ((name: string) => void) | null = null;
  /** Called when none of the player's songs would play (the original music plays instead). */
  onMyMusicFailed: (() => void) | null = null;
  /** The player's songs would not play: the original music until the library changes. */
  private myMusicFailed = false;

  /** Songs in the player's music library (0 without audio). */
  get myMusicCount(): number {
    return this.custom?.count ?? 0;
  }

  /** The player's song playing now, or ''. */
  get nowPlaying(): string {
    return this.custom?.playing ? this.custom.nowPlaying : '';
  }

  /** Skips to another of the player's songs, when one is playing. */
  nextSong(): void {
    if (this.custom?.playing) void this.custom.next();
  }

  /** Plays the current piece again from the right source (original or the player's music). */
  private refreshMusic(): void {
    const name = this.currentMusic;
    if (name === null) return;
    const custom = !!this.custom && this.custom.count > 0 && !this.myMusicFailed && myMusicFor(name, this.myMusicMode);
    if (custom === !!this.custom?.playing) return;
    this.currentMusic = null;
    if (!custom) this.custom?.stop();
    this.playMusic(name);
  }

  get music(): string | null {
    return this.currentMusic;
  }

  setSoundVolume(v: number): void {
    this.soundVolume = Math.min(1, Math.max(0, v));
    this.post({ type: 'volume', sound: this.soundVolume, music: this.musicVolume });
  }

  setMusicVolume(v: number): void {
    this.musicVolume = Math.min(1, Math.max(0, v));
    this.post({ type: 'volume', sound: this.soundVolume, music: this.musicVolume });
    this.custom?.setVolume(this.musicVolume);
    if (this.trackGain && this.ctx) this.trackGain.gain.setTargetAtTime(this.musicVolume, this.ctx.currentTime, 0.05);
  }

  /**
   * Plays a song file (a URL, streamed) at the music volume, from its start (`fadeIn` seconds of fade in); the caller
   * stops the game's music meanwhile. Returns the playing track (see Track), or null without audio.
   */
  playTrack(url: string, onError: () => void, fadeIn = 1.6): Track | null {
    const ctx = this.ctx;
    if (!ctx || !this.out) return null;
    const el = new Audio();
    el.preload = 'auto';
    el.addEventListener('error', () => onError(), { once: true });
    el.src = url;
    const src = ctx.createMediaElementSource(el);
    // (the song's own level, for a cut to another file: see cutTo)
    const elGain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(this.musicVolume, ctx.currentTime + Math.max(0.01, fadeIn));
    src.connect(elGain);
    elGain.connect(analyser);
    analyser.connect(gain);
    gain.connect(this.out);
    this.trackGain = gain;
    if (ctx.state !== 'running') void ctx.resume();
    void el.play().catch(() => undefined);
    let stopped = false;
    /** After a cut: the file playing instead, the song position it plays at the context time `at`. */
    let cut: { source: AudioBufferSourceNode; gain: GainNode; at: number; pos: number } | null = null;
    /** The context time the song came to its end (its position runs on past it, in silence), or -1. */
    let endedAt = -1;
    el.addEventListener('ended', () => {
      if (!stopped) endedAt = ctx.currentTime;
    });
    return {
      analyser,
      position: () => {
        if (cut && ctx.currentTime >= cut.at) return cut.pos + (ctx.currentTime - cut.at);
        if (endedAt >= 0) return el.duration + (ctx.currentTime - endedAt);
        return el.readyState >= 2 && !el.paused && el.currentTime > 0 ? el.currentTime : null;
      },
      seek: (pos: number) => {
        if (cut) return;
        el.currentTime = Math.max(0, pos);
        endedAt = -1;
      },
      cutTo: (buffer: AudioBuffer, at: number, pos: number, bufferStart: number) => {
        if (cut || stopped || el.paused) return false;
        const when = ctx.currentTime + (at - el.currentTime);
        if (when < ctx.currentTime + 0.05) return false;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const g = ctx.createGain();
        source.connect(g);
        g.connect(analyser);
        // A 10 ms crossfade on the downbeat, the new file started where it plays the song position `pos`.
        const x = 0.01;
        g.gain.setValueAtTime(0, when - x / 2);
        g.gain.linearRampToValueAtTime(1, when + x / 2);
        elGain.gain.setValueAtTime(1, when - x / 2);
        elGain.gain.linearRampToValueAtTime(0, when + x / 2);
        source.start(when - x / 2, Math.max(0, pos - bufferStart - x / 2));
        cut = { source, gain: g, at: when, pos };
        window.setTimeout(() => el.pause(), (when - ctx.currentTime + 0.2) * 1000);
        return true;
      },
      stop: (fadeSeconds = 0.8) => {
        if (stopped) return;
        stopped = true;
        if (this.trackGain === gain) this.trackGain = null;
        const t = ctx.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(gain.gain.value, t);
        gain.gain.linearRampToValueAtTime(0, t + fadeSeconds);
        window.setTimeout(() => {
          el.pause();
          el.removeAttribute('src');
          el.load();
          try {
            cut?.source.stop();
          } catch {
            // (not started yet)
          }
          src.disconnect();
          cut?.gain.disconnect();
          elGain.disconnect();
          analyser.disconnect();
          gain.disconnect();
        }, fadeSeconds * 1000 + 100);
      },
    };
  }

  /** Fetches and decodes a sound file (null without audio, or when it cannot be had). */
  async loadBuffer(url: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await this.decode(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  /** The place the sounds are heard in: an arena (0..4) gets its acoustics, anything else (-1) is dry. */
  setRoom(room: number): void {
    if (room === this.room) return;
    this.room = room;
    this.applyRoom();
  }

  /** Arena acoustics on or off. */
  setAcoustics(on: boolean): void {
    this.acoustics = on;
    this.applyRoom();
  }

  private applyRoom(): void {
    const ctx = this.ctx, conv = this.convolver, wet = this.wet;
    if (!ctx || !conv || !wet) return;
    const room = this.acoustics ? ROOMS[this.room] : undefined;
    const now = ctx.currentTime;
    wet.gain.cancelScheduledValues(now);
    if (!room) {
      wet.gain.setTargetAtTime(0, now, 0.05);
      return;
    }
    let ir = this.impulses.get(this.room);
    if (!ir) {
      ir = impulseResponse(ctx, room, this.room + 1);
      this.impulses.set(this.room, ir);
    }
    // Switching rooms happens between scenes (behind a fade), when nothing is playing.
    if (conv.buffer !== ir) conv.buffer = ir;
    wet.gain.setTargetAtTime(room.wet, now, 0.05);
  }

  /** Impact bass on or off. */
  setImpactBass(on: boolean): void {
    this.impactBass = on;
  }

  /**
   * A low thump under a heavy impact: `strength` 0..1 sets its level, `weight` 0..1 how deep and long it is (a knockout
   * or a wall slam is heavier than a hit); `pan` -100..100.
   */
  thump(strength: number, weight: number, pan = 0): void {
    if (!this.impactBass || strength <= 0) return;
    const w = Math.max(0, Math.min(1, weight));
    this.post({
      type: 'thump', amp: Math.min(1, strength) * 0.7, f0: 110 - 30 * w, f1: 44 - 10 * w, dur: 0.2 + 0.4 * w,
      pan: Math.max(-100, Math.min(100, pan)),
    });
  }

  /** 'classic' = linear resampling like the original mixer; 'enhanced' = high quality interpolation. */
  setQuality(q: MusicQuality): void {
    this.quality = q;
    this.post({ type: 'quality', quality: q });
  }
}

export const audio = new AudioSystem();
