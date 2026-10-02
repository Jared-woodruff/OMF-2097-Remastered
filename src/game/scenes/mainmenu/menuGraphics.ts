// OPTIONS > GRAPHICS (the reference's video options, mainmenu/menu_video.c, adapted to this version's renderers).
//
// The reference offers renderer API, resolution, FPS limit, framebuffer scale, scaling filter, vsync, aspect and
// fullscreen, applies them on DONE and then asks to confirm the new mode (menu_video_confirm.c). Here the display is a
// resizable canvas/window, so the options are the remaster's (settings.video), applied immediately; the scaling filter
// and aspect choices map to the classic graphics' FILTER and WIDESCREEN. Nothing here can produce an unusable display,
// so the confirmation countdown is not needed. Each kind of graphics has its own submenu: CLASSIC STYLE, REMASTERED (the
// artwork and the look), EFFECTS (the remastered fights' effects).
import { app } from '../../../app';
import { Button, Filler, Label, Menu, TextSelector } from '../../gui/widgets';
import { settings, type Settings } from '../../settings';
import type { MainMenuScene } from '../mainmenu';
import { menuDone, parentMenu, settingsChanged } from './common';

const OFF_ON = ['OFF', 'ON'];
const FILTERS: Settings['video']['classicFilter'][] = ['sharp', 'smooth', 'crt'];
type BoolKey = 'classicWidescreen' | 'crossfade' | 'screenShake' | 'bloom' | 'motionSmoothing' | 'fullscreen' | 'hdArtwork' |
  'hdHud' | 'fxParticles' | 'fxLighting' | 'fxImpact' | 'fxAtmosphere';

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

/** A boolean of the gameplay settings that is about what the game shows (the fight camera, the victory screens). */
function shownOption(title: string, help: string, key: 'fightCamera' | 'victoryScreens'): TextSelector {
  const g = () => settings().gameplay;
  return new TextSelector(title, help, () => (g()[key] ? 1 : 0), (pos) => (g()[key] = pos === 1), OFF_ON, settingsChanged);
}

/** The classic graphics' scaling. */
export function menuClassicStyleCreate(): Menu {
  const menu = new Menu();
  menu.attach(Label.title('CLASSIC STYLE'));
  menu.attach(new Filler());
  menu.attach(new TextSelector('FILTER',
    'Scaling of the classic graphics: SHARP keeps crisp pixels, SMOOTH blends them and CRT emulates an old monitor with scanlines.',
    () => Math.max(0, FILTERS.indexOf(video().classicFilter)), (pos) => (video().classicFilter = FILTERS[pos]),
    ['SHARP', 'SMOOTH', 'CRT'], () => settingsChanged()));
  menu.attach(boolOption('WIDESCREEN',
    'Classic graphics: fill the sides of wide screens with extended backgrounds instead of black bars.', 'classicWidescreen'));
  menu.attach(new Button('DONE', 'Go back to the graphics menu.', false, false, menuDone));
  return menu;
}

/** The remastered graphics' artwork and look. */
export function menuRemasteredCreate(): Menu {
  const menu = new Menu();
  menu.attach(Label.title('REMASTERED'));
  menu.attach(boolOption('HD ARTWORK',
    'Use the high-resolution artwork (backgrounds, robots, portraits). OFF upscales the original images instead.', 'hdArtwork'));
  const FONTS = ['type', 'smooth', 'pixel'] as const;
  menu.attach(new TextSelector('FONT',
    'REMASTERED draws the text in a high-resolution typeface in the style of the original. SMOOTH draws the ' +
    'original letters as clean shapes. PIXEL keeps their square pixels.',
    () => Math.max(0, FONTS.indexOf(video().hdFont)), (pos) => (video().hdFont = FONTS[pos] ?? 'type'),
    ['REMASTERED', 'SMOOTH', 'PIXEL'], () => settingsChanged()));
  menu.attach(new TextSelector('HUD',
    'MODERN draws the health and endurance bars smoothly, with a trail that shows the damage just taken. CLASSIC keeps the original bars.',
    () => (video().hdHud ? 1 : 0), (pos) => (video().hdHud = pos === 1), ['CLASSIC', 'MODERN'], () => settingsChanged()));
  menu.attach(boolOption('SMOOTH MOTION',
    'Interpolate movement between game ticks for fluid motion on high refresh rate displays.', 'motionSmoothing'));
  menu.attach(shownOption('FIGHT CAMERA', 'The view follows the fight and comes closer when the robots are close.', 'fightCamera'));
  menu.attach(new Button('DONE', 'Go back to the graphics menu.', false, false, menuDone));
  return menu;
}

/** The remastered fights' effects. */
export function menuEffectsCreate(): Menu {
  const menu = new Menu();
  menu.attach(Label.title('EFFECTS'));
  menu.attach(boolOption('BLOOM', 'Add a soft glow around bright lights, fire, sparks and energy effects.', 'bloom'));
  menu.attach(boolOption('PARTICLES', 'Sparks fly from hits, dust rises from falls and slams.', 'fxParticles'));
  menu.attach(boolOption('LIGHTING',
    'Hits, fire and energy light up the arena and the robots, and the arena lights the edges of the robots.', 'fxLighting'));
  menu.attach(boolOption('IMPACT FX', 'Shockwaves on heavy hits and a dramatic camera on the knockout blow.', 'fxImpact'));
  menu.attach(boolOption('ATMOSPHERE',
    'Arena ambience: embers and heat haze in the fire pit, blowing sand, drifting dust, light shafts and camera flashes.',
    'fxAtmosphere'));
  menu.attach(new Button('DONE', 'Go back to the graphics menu.', false, false, menuDone));
  return menu;
}

export function menuGraphicsCreate(_s: MainMenuScene): Menu {
  const menu = new Menu();
  // Nine entries: rows a little closer, to fit the frame under the title.
  menu.padding = 2;
  menu.attach(Label.title('GRAPHICS'));
  // "GRAPHICS REMASTERED" is one character too wide for the 151 pixel menu, hence VISUALS.
  menu.attach(new TextSelector('VISUALS',
    'Switch between the original pixel graphics and the remastered HD graphics. Press F2 to switch at any time.',
    () => (video().graphics === 'classic' ? 0 : 1), (pos) => (video().graphics = pos === 0 ? 'classic' : 'remastered'),
    ['CLASSIC', 'REMASTERED'], (pos) => {
      app.setGraphicsMode(pos === 0 ? 'classic' : 'remastered');
      settingsChanged();
    }));
  menu.attach(new Button('CLASSIC STYLE', 'How the classic graphics are scaled: crisp pixels, smoothed, or an old CRT monitor, ' +
    'and wide screens filled or not.', false, false, (b) => parentMenu(b).setSubmenu(menuClassicStyleCreate())));
  menu.attach(new Button('REMASTERED', 'The remastered graphics: the HD artwork, the typeface, the health bars, smooth ' +
    'motion and the fight camera.', false, false, (b) => parentMenu(b).setSubmenu(menuRemasteredCreate())));
  menu.attach(new Button('EFFECTS', 'The effects of the remastered fights: glow, particles, lighting, impacts and arena ' +
    'atmosphere.', false, false, (b) => parentMenu(b).setSubmenu(menuEffectsCreate())));
  menu.attach(boolOption('FULLSCREEN', 'Run the game in fullscreen. F11 or Alt+Enter also toggle fullscreen.', 'fullscreen',
    () => app.toggleFullscreen()));
  menu.attach(boolOption('SCREEN SHAKE',
    "Turn this off to eliminate the screen 'shaking' when a character hits the wall, a character is thrown, etc.", 'screenShake'));
  menu.attach(boolOption('CROSSFADE', 'Fade the screen out and in when switching between scenes.', 'crossfade'));
  menu.attach(shownOption('VICTORY SCREEN',
    'After a one or two player fight (and in the arcade, survival and time attack modes) the winner is shown with a line ' +
    'of theirs.', 'victoryScreens'));
  menu.attach(new Button('DONE', 'Go back to the options.', false, false, menuDone));
  return menu;
}
