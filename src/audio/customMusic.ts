// The player's own music: audio files kept in the browser (IndexedDB; the desktop app's WebView keeps them too) and
// played instead of the original soundtrack in fights or everywhere (OPTIONS > SOUND > MY MUSIC), shuffled.
import { done, openDb, result } from '../platform/db';

export type MyMusicMode = 'off' | 'fights' | 'always';

export interface TrackInfo {
  id: number;
  name: string;
  size: number;
}

interface TrackRecord extends TrackInfo {
  type: string;
  data: Blob;
}

const AUDIO_EXT = /\.(mp3|ogg|oga|opus|wav|flac|m4a|aac|weba|webm|mp4)$/i;

/** Audio files among picked or dropped files. */
export function audioFiles(files: File[]): File[] {
  return files.filter((f) => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name));
}

/** Whether my music replaces the soundtrack piece `name` (the original's file name) in this mode. */
export function myMusicFor(name: string, mode: MyMusicMode): boolean {
  if (mode === 'always') return true;
  return mode === 'fights' && /^ARENA\d/i.test(name);
}

/** A song's display name: its file name without the extension. */
export function songName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
}

// ---- library ----

export async function listTracks(): Promise<TrackInfo[]> {
  const db = await openDb();
  try {
    const all = await result(db.transaction('music', 'readonly').objectStore('music').getAll() as IDBRequest<TrackRecord[]>);
    return all.map(({ id, name, size }) => ({ id, name, size }));
  } finally {
    db.close();
  }
}

/** Adds audio files to the library; returns how many were added (files that are no audio are skipped). */
export async function addTracks(files: File[]): Promise<number> {
  const songs = audioFiles(files);
  if (songs.length === 0) return 0;
  const db = await openDb();
  try {
    const tx = db.transaction('music', 'readwrite');
    const store = tx.objectStore('music');
    for (const f of songs) store.add({ name: songName(f.name), size: f.size, type: f.type, data: f });
    await done(tx);
    return songs.length;
  } finally {
    db.close();
  }
}

export async function clearTracks(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction('music', 'readwrite');
    tx.objectStore('music').clear();
    await done(tx);
  } finally {
    db.close();
  }
}

async function trackData(id: number): Promise<Blob | null> {
  const db = await openDb();
  try {
    const rec = await result(db.transaction('music', 'readonly').objectStore('music').get(id) as IDBRequest<TrackRecord | undefined>);
    return rec?.data ?? null;
  } finally {
    db.close();
  }
}

/** Opens the system's file picker for audio files (must follow a key press or click). */
export function pickAudioFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: 'audio/*,.mp3,.ogg,.opus,.wav,.flac,.m4a' });
    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

// ---- player ----

/**
 * Plays the library through the audio context (so the music volume applies), one random song after the other. Unknown
 * or broken files are skipped.
 */
export class CustomMusicPlayer {
  private el: HTMLAudioElement;
  private gain: GainNode;
  private tracks: TrackInfo[] = [];
  private url: string | null = null;
  private last = -1;
  private active = false;
  private failures = 0;
  /** The song playing now (for the menu), or ''. */
  nowPlaying = '';
  /** Called when a song starts. */
  onSong: ((name: string) => void) | null = null;
  /** Called when none of the songs it tried would play (it has stopped). */
  onFail: (() => void) | null = null;

  constructor(private ctx: AudioContext, volume: number, out: AudioNode = ctx.destination) {
    this.el = new Audio();
    this.el.preload = 'auto';
    const src = ctx.createMediaElementSource(this.el);
    this.gain = ctx.createGain();
    this.gain.gain.value = volume;
    this.targetVolume = volume;
    src.connect(this.gain);
    this.gain.connect(out);
    this.el.addEventListener('ended', () => void this.next());
    this.el.addEventListener('error', () => {
      if (!this.active) return;
      // A file the browser cannot play: try another one (but do not spin through a library of broken files).
      if (++this.failures < Math.min(8, this.tracks.length)) void this.next();
      else this.giveUp();
    });
    this.el.addEventListener('playing', () => {
      if (this.failures > 0 || this.announced !== this.nowPlaying) this.onSong?.(this.nowPlaying);
      this.announced = this.nowPlaying;
      this.failures = 0;
    });
  }

  get count(): number {
    return this.tracks.length;
  }

  get playing(): boolean {
    return this.active;
  }

  async refresh(): Promise<void> {
    try {
      this.tracks = await listTracks();
    } catch {
      this.tracks = [];
    }
    if (this.tracks.length === 0 && this.active) this.stop();
  }

  /** Starts playing (a new song when `fresh`, else keeps the current one going). */
  play(fresh: boolean): void {
    if (this.tracks.length === 0) return;
    if (this.active && !fresh) return;
    this.active = true;
    void this.next();
  }

  async next(): Promise<void> {
    if (!this.active || this.tracks.length === 0) return;
    let i = Math.floor(Math.random() * this.tracks.length);
    if (this.tracks.length > 1 && i === this.last) i = (i + 1) % this.tracks.length;
    this.last = i;
    const track = this.tracks[i];
    const data = await trackData(track.id).catch(() => null);
    if (!this.active) return;
    if (!data) {
      if (++this.failures < Math.min(8, this.tracks.length)) void this.next();
      else this.giveUp();
      return;
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(data);
    this.el.src = this.url;
    this.nowPlaying = track.name;
    // Fade in, like a new piece of the soundtrack starting.
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    const target = this.targetVolume;
    this.gain.gain.setValueAtTime(0, now);
    this.gain.gain.linearRampToValueAtTime(target, now + 1.2);
    this.el.play().catch(() => undefined);
  }

  private targetVolume = 1;
  private announced = '';

  setVolume(v: number): void {
    this.targetVolume = v;
    this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Resumes after the browser blocked playback without a user gesture. */
  resume(): void {
    if (this.active && this.el.paused && this.el.src) this.el.play().catch(() => undefined);
  }

  /** None of the songs it tried would play: it stops, and says so. */
  private giveUp(): void {
    this.stop();
    this.failures = 0;
    this.onFail?.();
  }

  stop(): void {
    this.active = false;
    this.nowPlaying = '';
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    if (this.url) {
      URL.revokeObjectURL(this.url);
      this.url = null;
    }
  }
}
