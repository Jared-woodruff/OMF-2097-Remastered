// The announcers (OPTIONS > SOUND > ANNOUNCER; not in the original game): call the rounds, the knockouts and the winners
// in a male or a female voice. The voice lines are plain MP3 files in audio/announcer/<voice>/ (made by
// tools/make-announcer.py), loaded when a voice is first needed; a missing or unreadable file is simply not said.
import { settings, type Settings } from '../game/settings';
import { audio } from './audio';

export type AnnouncerVoice = Exclude<Settings['sound']['announcer'], 'off'>;

const ROBOTS = ['jaguar', 'shadow', 'thorn', 'pyros', 'electra', 'katana', 'shredder', 'flail', 'gargoyle', 'chronos', 'nova',
  'glacier', 'tempest', 'helix', 'spectre'];

export const ANNOUNCER_LINES = [
  'round1', 'round2', 'round3', 'round4', 'round5', 'round6', 'round7', 'final', 'ready', 'fight', 'ko', 'perfect', 'scrap',
  'destruction', 'youwin', 'youlose', 'draw', 'newrecord', 'finalfight', ...ROBOTS.map((r) => `win-${r}`),
];

/** The line saying that a robot won ('' for the workshop's robots: they have no line). */
export function winLine(harId: number): string {
  return ROBOTS[harId] ? `win-${ROBOTS[harId]}` : '';
}

/** Decoded lines by `voice/line`, and the loads under way. */
const buffers = new Map<string, AudioBuffer>();
const pending = new Map<string, Promise<AudioBuffer | null>>();

function line(voice: AnnouncerVoice, name: string): Promise<AudioBuffer | null> {
  const key = `${voice}/${name}`;
  let p = pending.get(key);
  if (!p) {
    p = fetch(`audio/announcer/${key}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
      .then((data) => audio.decode(data))
      .then((buf) => {
        if (buf) buffers.set(key, buf);
        return buf;
      })
      .catch(() => null); // not there: not said
    pending.set(key, p);
  }
  return p;
}

/** Loads a voice's lines in the background (the chosen voice when none is given; once per voice). */
export function loadAnnouncer(voice = settings().sound.announcer): void {
  if (voice === 'off' || typeof fetch === 'undefined') return;
  for (const name of ANNOUNCER_LINES) void line(voice, name);
}

function volume(): number {
  return (settings().sound.soundVol / 10) * 0.9;
}

/** Says a line in the chosen voice (when the announcer is on and the line is loaded). */
export function announce(name: string): void {
  const voice = settings().sound.announcer;
  if (voice === 'off') return;
  const buf = buffers.get(`${voice}/${name}`);
  if (buf) audio.playBuffer(buf, volume());
}

/** Loads a voice and lets it be heard (the options menu): "Fight!", as soon as it is there, if still chosen. */
export function previewAnnouncer(voice: Settings['sound']['announcer']): void {
  if (voice === 'off' || typeof fetch === 'undefined') return;
  loadAnnouncer(voice);
  void line(voice, 'fight').then((buf) => {
    if (buf && settings().sound.announcer === voice) audio.playBuffer(buf, volume());
  });
}
