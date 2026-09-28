// The announcer (AUDIO OPTIONS > ANNOUNCER; not in the original game): calls the rounds, the knockouts and the winners.
// The voice lines are plain MP3 files in audio/announcer/ (made by tools/make-announcer.py), loaded when first needed;
// a missing or unreadable file is simply not said.
import { settings } from '../game/settings';
import { audio } from './audio';

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

const buffers = new Map<string, AudioBuffer>();
let loading = false;

/** Loads the voice lines (in the background; once). */
export function loadAnnouncer(): void {
  if (loading || typeof fetch === 'undefined') return;
  loading = true;
  for (const name of ANNOUNCER_LINES) {
    void fetch(`audio/announcer/${name}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
      .then((data) => audio.decode(data))
      .then((buf) => {
        if (buf) buffers.set(name, buf);
      })
      .catch(() => {
        // not there: not said
      });
  }
}

/** Says a line (when the announcer is on and the line is loaded). */
export function announce(name: string): void {
  if (!settings().sound.announcer) return;
  const buf = buffers.get(name);
  if (buf) audio.playBuffer(buf, (settings().sound.soundVol / 10) * 0.9);
}
