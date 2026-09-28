// Audio options (port of the reference mainmenu/menu_audio.c).
//
// Volumes are applied live like in the reference. The reference's MONO, FREQUENCY, RESAMPLE and MUSIC (original /
// remix tracks) options configure its SDL mixer and have no equivalent in the WebAudio mixer; the resampler choice
// becomes ENHANCED MUSIC (classic linear resampling like the original mixer vs. high quality interpolation). ACOUSTICS
// and IMPACT BASS are the remaster's.
import { audio } from '../../../audio/audio';
import { addTracks, clearTracks, pickAudioFiles } from '../../../audio/customMusic';
import { Button, Label, Menu, TextSelector, TextSlider } from '../../gui/widgets';
import { settings, type Settings } from '../../settings';
import type { MainMenuScene } from '../mainmenu';
import { menuDone, settingsChanged } from './common';

function sound(): Settings['sound'] {
  return settings().sound;
}

const MY_MUSIC: Settings['sound']['myMusic'][] = ['off', 'fights', 'always'];

function libraryHelp(): string {
  const n = audio.myMusicCount;
  return `${n === 0 ? 'Your music library is empty.' : `${n} song${n === 1 ? '' : 's'} in your music library.`} ` +
    'Add MP3, OGG, WAV, FLAC or M4A files here, or drop them onto the game window at any time.';
}

export function menuAudioCreate(_s: MainMenuScene): Menu {
  const menu = new Menu();
  // Nine entries: no spacer row under the title.
  menu.attach(Label.title('AUDIO'));
  // menu_audio_sound_slide
  const volume = new TextSlider('SOUND', 'Raise or lower the volume of all sound effects. Press right or left to change.', 10, true,
    () => sound().soundVol, (pos) => (sound().soundVol = pos), (pos) => {
      audio.setSoundVolume(pos / 10);
      settingsChanged();
    });
  volume.disablePanning = true;
  menu.attach(volume);
  // menu_audio_music_slide
  menu.attach(new TextSlider('MUSIC', 'Raise or lower the volume of music. Press right or left to change.', 10, true,
    () => sound().musicVol, (pos) => (sound().musicVol = pos), (pos) => {
      audio.setMusicVolume(pos / 10);
      settingsChanged();
    }));
  menu.attach(new TextSelector('ENHANCED MUSIC',
    'ON plays the music with high quality interpolation. OFF resamples it like the original sound card mixer.',
    () => (sound().enhancedMusic ? 1 : 0), (pos) => (sound().enhancedMusic = pos === 1), ['OFF', 'ON'], (pos) => {
      audio.setQuality(pos === 1 ? 'enhanced' : 'classic');
      settingsChanged();
    }));
  menu.attach(new TextSelector('ACOUSTICS',
    'The sound effects echo like in the arena they are heard in: the stadium, the steel room, the power plant hall, the ' +
    'fire pit and the open desert.',
    () => (sound().acoustics ? 1 : 0), (pos) => (sound().acoustics = pos === 1), ['OFF', 'ON'], (pos) => {
      audio.setAcoustics(pos === 1);
      settingsChanged();
    }));
  menu.attach(new TextSelector('IMPACT BASS', 'A deep thump under heavy hits, wall slams and knockouts.',
    () => (sound().impactBass ? 1 : 0), (pos) => (sound().impactBass = pos === 1), ['OFF', 'ON'], (pos) => {
      audio.setImpactBass(pos === 1);
      settingsChanged();
    }));
  menu.attach(new TextSelector('MY MUSIC',
    'Play your own songs instead of the original soundtrack: OFF, in FIGHTS (a new song every fight) or ALWAYS. F3 skips to another song.',
    () => Math.max(0, MY_MUSIC.indexOf(sound().myMusic)), (pos) => (sound().myMusic = MY_MUSIC[pos]), ['OFF', 'FIGHTS', 'ALWAYS'],
    (pos) => {
      audio.setMyMusicMode(MY_MUSIC[pos]);
      settingsChanged();
    }));
  const add = new Button('ADD SONGS', libraryHelp(), false, false, () => {
    void pickAudioFiles().then(async (files) => {
      const n = await addTracks(files).catch(() => 0);
      if (n > 0) await audio.reloadMyMusic();
      add.setHelp(libraryHelp());
      remove.setHelp(removeHelp());
    });
  });
  menu.attach(add);
  // Removing asks for a second press.
  let armed = 0;
  const removeHelp = () => (audio.myMusicCount ? 'Remove all songs from your music library (your files stay where they are).' : 'Your music library is empty.');
  const remove = new Button('REMOVE SONGS', removeHelp(), false, false, () => {
    if (audio.myMusicCount === 0) return;
    if (!armed) {
      armed = 120;
      remove.setText('PRESS AGAIN');
      return;
    }
    armed = 0;
    remove.setText('REMOVE SONGS');
    void clearTracks().then(() => audio.reloadMyMusic()).then(() => {
      add.setHelp(libraryHelp());
      remove.setHelp(removeHelp());
    });
  });
  menu.attach(remove);
  menu.onTick = () => {
    if (armed && --armed === 0) remove.setText('REMOVE SONGS');
  };
  menu.attach(new Button('DONE', 'Exit from this menu.', false, false, menuDone));
  return menu;
}
