// Video options (port of the reference mainmenu/menu_video.c, adapted to this version's renderers).
//
// The reference offers renderer API, resolution, FPS limit, framebuffer scale, scaling filter, vsync, aspect and
// fullscreen, applies them on DONE and then asks to confirm the new mode (menu_video_confirm.c). Here the display is a
// resizable canvas/window, so the options are the remaster's (settings.video), applied immediately; the scaling filter
// and aspect choices map to CLASSIC FILTER and CLASSIC WIDESCREEN. Nothing here can produce an unusable display, so the
// confirmation countdown is not needed. The remastered renderer's options have their own submenu (the menu frame
// holds at most eight entries under the title).
import { app } from '../../../app';
import { Button, Filler, Label, Menu, TextSelector } from '../../gui/widgets';
import { settings, type Settings } from '../../settings';
import type { MainMenuScene } from '../mainmenu';
import { menuDone, parentMenu, settingsChanged } from './common';

const OFF_ON = ['OFF', 'ON'];
const FILTERS: Settings['video']['classicFilter'][] = ['sharp', 'smooth', 'crt'];
type BoolKey = 'classicWidescreen' | 'crossfade' | 'screenShake' | 'bloom' | 'motionSmoothing' | 'fullscreen' | 'hdArtwork' |
  'fxParticles' | 'fxLighting' | 'fxImpact' | 'fxAtmosphere';

function video(): Settings['video'] {
  return settings().video;
}

/** textselector_create_bind_opts() on a boolean video setting. */
function boolOption(title: string, help: string, key: BoolKey, onToggle?: (on: boolean) => void): TextSelector {
  return new TextSelector(title, help, () => (video()[key] ? 1 : 0), (pos) => (video()[key] = pos === 1), OFF_ON, (pos) => {
    onToggle?.(pos === 1);
    settingsChanged();
  });
}

/** Options of the remastered graphics: artwork, motion, glow and the fight effects. */
export function menuRemasteredCreate(): Menu {
  const menu = new Menu();
  menu.attach(Label.title('REMASTERED'));
  menu.attach(new Filler());
  menu.attach(boolOption('HD ARTWORK',
    'Use the high-resolution artwork (backgrounds, robots, portraits). OFF upscales the original images instead.', 'hdArtwork'));
  menu.attach(boolOption('SMOOTH MOTION',
    'Interpolate movement between game ticks for fluid motion on high refresh rate displays.', 'motionSmoothing'));
  menu.attach(new TextSelector('FONT',
    "The original font, smoothed like the rest of the graphics or kept as crisp pixels.",
    () => (video().hdFont === 'pixel' ? 1 : 0), (pos) => (video().hdFont = pos === 1 ? 'pixel' : 'smooth'), ['SMOOTH', 'PIXEL'],
    () => settingsChanged()));
  menu.attach(boolOption('BLOOM', 'Add a soft glow around bright lights, fire, sparks and energy effects.', 'bloom'));
  menu.attach(boolOption('PARTICLES', 'Sparks fly from hits, dust rises from falls and slams.', 'fxParticles'));
  menu.attach(boolOption('LIGHTING',
    'Hits, fire and energy light up the arena and the robots, and the arena lights the edges of the robots.', 'fxLighting'));
  menu.attach(boolOption('IMPACT FX', 'Shockwaves on heavy hits and a dramatic camera on the knockout blow.', 'fxImpact'));
  menu.attach(boolOption('ATMOSPHERE',
    'Arena ambience: embers and heat haze in the fire pit, blowing sand, drifting dust, light shafts and camera flashes.',
    'fxAtmosphere'));
  menu.attach(new Button('DONE', 'Go back to the video menu.', false, false, menuDone));
  return menu;
}

export function menuVideoCreate(_s: MainMenuScene): Menu {
  const menu = new Menu();
  menu.attach(Label.title('VIDEO'));
  menu.attach(new Filler());
  // "GRAPHICS REMASTERED" is one character too wide for the 151 pixel menu, hence VISUALS.
  menu.attach(new TextSelector('VISUALS',
    'Switch between the original pixel graphics and the remastered HD graphics. Press F2 to switch at any time.',
    () => (video().graphics === 'classic' ? 0 : 1), (pos) => (video().graphics = pos === 0 ? 'classic' : 'remastered'),
    ['CLASSIC', 'REMASTERED'], (pos) => {
      app.setGraphicsMode(pos === 0 ? 'classic' : 'remastered');
      settingsChanged();
      updateModeOptions();
    }));
  const filter = new TextSelector('FILTER',
    'Scaling of the classic graphics: SHARP keeps crisp pixels, SMOOTH blends them and CRT emulates an old monitor with scanlines.',
    () => Math.max(0, FILTERS.indexOf(video().classicFilter)), (pos) => (video().classicFilter = FILTERS[pos]),
    ['SHARP', 'SMOOTH', 'CRT'], () => settingsChanged());
  menu.attach(filter);
  const widescreen = boolOption('WIDESCREEN',
    'Classic graphics: fill the sides of wide screens with extended backgrounds instead of black bars.', 'classicWidescreen');
  menu.attach(widescreen);
  menu.attach(boolOption('CROSSFADE', 'Fade the screen out and in when switching between scenes.', 'crossfade'));
  menu.attach(boolOption('SCREEN SHAKE',
    "Turn this off to eliminate the screen 'shaking' when a character hits the wall, a character is thrown, etc.", 'screenShake'));
  menu.attach(boolOption('FULLSCREEN', 'Run the game in fullscreen. F11 or Alt+Enter also toggle fullscreen.', 'fullscreen',
    () => app.toggleFullscreen()));
  menu.attach(new Button('REMASTERED OPTIONS',
    'HD artwork, smooth motion, glow, and the effects of the remastered fights: particles, lighting, impacts and atmosphere.',
    false, false, (b) => parentMenu(b).setSubmenu(menuRemasteredCreate())));
  menu.attach(new Button('DONE', 'Exit from this menu.', false, false, menuDone));

  // Options that only apply to the classic graphics are disabled in remastered mode. F2 can switch the mode while
  // this menu is open, so this also runs every tick (the selected entry is never disabled under the cursor).
  function updateModeOptions(): void {
    const classic = video().graphics === 'classic';
    for (const c of [filter, widescreen]) {
      if (classic || menu.current() !== c) c.setDisabled(!classic);
    }
  }
  updateModeOptions();
  menu.onTick = updateModeOptions;
  return menu;
}
