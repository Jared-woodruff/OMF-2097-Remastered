// The player's own music: which files count as songs and where they replace the soundtrack.
import { describe, expect, it } from 'vitest';
import { audioFiles, myMusicFor, songName } from '../audio/customMusic';

describe('my music', () => {
  it('replaces the arena music in fights, or all music', () => {
    expect(myMusicFor('ARENA0.PSM', 'fights')).toBe(true);
    expect(myMusicFor('ARENA4.PSM', 'fights')).toBe(true);
    expect(myMusicFor('MENU.PSM', 'fights')).toBe(false);
    expect(myMusicFor('END.PSM', 'always')).toBe(true);
    expect(myMusicFor('ARENA1.PSM', 'off')).toBe(false);
  });

  it('takes audio files by type or extension', () => {
    const f = (name: string, type = '') => new File(['x'], name, { type });
    const picked = audioFiles([f('a.mp3'), f('b.FLAC'), f('c', 'audio/ogg'), f('notes.txt', 'text/plain'), f('cover.jpg', 'image/jpeg'), f('d.m4a')]);
    expect(picked.map((x) => x.name)).toEqual(['a.mp3', 'b.FLAC', 'c', 'd.m4a']);
  });

  it('names songs after their files', () => {
    expect(songName('01_Hyper_Beam.mp3')).toBe('01 Hyper Beam');
    expect(songName('Theme.v2.ogg')).toBe('Theme.v2');
  });
});
