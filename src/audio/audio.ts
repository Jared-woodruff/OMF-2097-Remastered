// Main-thread side of the audio system: channel allocation (like the original's 3 SFX channels)
// and messaging to the mixing AudioWorklet, which also runs the PSM music player.
import workletUrl from './worklet.ts?worker&url';
import { pitchedSampleRate, SOUND_CHANNEL_COUNT, soundSampleRate, type SoundOpts } from './soundOpts';
import type { SoundEntry } from '../formats/misc';

export const AUDIO_INVALID_HANDLE = 0;

interface ChannelState {
  priority: number;
  soundId: number;
  guid: number;
  endTime: number;
}

export type MusicQuality = 'classic' | 'enhanced';

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
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
      this.node = new AudioWorkletNode(this.ctx, 'omf-audio', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      this.node.connect(this.ctx.destination);
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
    this.started = true;
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
  }

  /** 'classic' = linear resampling like the original mixer; 'enhanced' = high quality interpolation. */
  setQuality(q: MusicQuality): void {
    this.quality = q;
    this.post({ type: 'quality', quality: q });
  }
}

export const audio = new AudioSystem();
