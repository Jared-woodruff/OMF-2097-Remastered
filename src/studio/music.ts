// Listening to the game's songs in OMF Studio (the music an arena plays): through the game's own player (the MASI port
// in its audio worklet), started on the first listen, without the player's own music.
import { audio } from '../audio/audio';
import { getFile } from '../resources/files';
import { soundBank } from '../resources/resources';
import { h } from './dom';

let ready: Promise<boolean> | null = null;
let playing: string | null = null;
/** Buttons showing what plays (drawn again when it changes). */
const shown = new Set<() => void>();

/** The song playing (its file name), or null. */
export const songPlaying = (): string | null => playing;

/** Plays one of the game's songs ("ARENA2.PSM"), instead of the one playing. */
export async function playSong(name: string): Promise<void> {
  if (!ready) {
    audio.setMyMusicMode('off');
    ready = audio.init(soundBank(), (n) => getFile(n)).then(() => true, () => false);
  }
  if (!(await ready)) return;
  audio.resume();
  audio.stopMusic();
  audio.playMusic(name);
  playing = name;
  for (const f of shown) f();
}

/** Stops the song playing, if any (leaving the arena, testing the mod). */
export function stopSong(): void {
  if (!playing) return;
  audio.stopMusic();
  playing = null;
  for (const f of shown) f();
}

/** A button that plays the song `song()` names, or stops it; it shows which (until it leaves the page). */
export function listenButton(song: () => string): HTMLButtonElement {
  const el = h('button', { class: 'btn small listen', type: 'button' });
  let seen = false;
  const draw = () => {
    if (el.isConnected) seen = true;
    else if (seen) {
      shown.delete(draw);
      return;
    }
    const on = playing !== null && playing === song();
    el.textContent = on ? '■ Stop' : '▶ Listen';
    el.title = on ? 'Stop the music' : 'Play this music';
    el.classList.toggle('on', on);
  };
  el.addEventListener('click', (e) => {
    e.preventDefault();
    if (playing === song()) stopSong();
    else void playSong(song());
  });
  shown.add(draw);
  draw();
  return el;
}
