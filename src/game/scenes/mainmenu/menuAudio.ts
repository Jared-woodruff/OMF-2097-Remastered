// Audio options (port of the reference mainmenu/menu_audio.c).
//
// Volumes are applied live like in the reference. The reference's MONO, FREQUENCY, RESAMPLE and MUSIC (original /
// remix tracks) options configure its SDL mixer and have no equivalent in the WebAudio mixer; the resampler choice
// becomes ENHANCED MUSIC (classic linear resampling like the original mixer vs. high quality interpolation).
import { audio } from '../../../audio/audio';
import { Button, Filler, Label, Menu, TextSelector, TextSlider } from '../../gui/widgets';
import { settings, type Settings } from '../../settings';
import type { MainMenuScene } from '../mainmenu';
import { menuDone, settingsChanged } from './common';

function sound(): Settings['sound'] {
  return settings().sound;
}

export function menuAudioCreate(_s: MainMenuScene): Menu {
  const menu = new Menu();
  menu.attach(Label.title('AUDIO'));
  menu.attach(new Filler());
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
  menu.attach(new Button('DONE', 'Exit from this menu.', false, false, menuDone));
  return menu;
}
