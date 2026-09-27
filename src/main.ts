import { app } from './app';
import { audio } from './audio/audio';
import { initInput, setKeyState } from './controller/input';
import { startViewer } from './debug/viewer';
import { Engine } from './engine';
import { PILOT_INFO, SceneId } from './game/constants';
import { GameState, hasScene } from './game/gameState';
import { setPilotColors } from './game/pilotColors';
import { loadSettings, saveSettings, settings } from './game/settings';
import './game/scenes/index';
import { registerPlaceholders } from './game/scenes/placeholder';
import { getFile, preloadAll } from './resources/files';
import { langGet, loadLanguage, soundBank } from './resources/resources';
import { GLRenderer } from './video/gl/renderer';
import { drawList } from './video/draw';
import { isDesktop, isFullscreen, quitApp, setFullscreen, toggleFullscreen } from './platform/desktop';
import { onKey } from './controller/input';
import { HdAssets, hdAssets } from './video/hd/assets';
import { vga } from './video/vga';
import { FxDirector } from './fx/director';
import { FxType, onFx } from './game/fx';
import { globalRandom } from './util/random';
import { HelpOverlay } from './game/gui/helpOverlay';
import { drainPointer, initMouse, pushPointer } from './controller/mouse';
import { renderedFrames } from './game/gui/widgets';
import { ACT_ESC, ACT_PUNCH } from './game/constants';

const boot = document.getElementById('boot')!;
const canvas = document.getElementById('screen') as HTMLCanvasElement;

/** Hides the mouse pointer over the game after a moment without movement (the game is keyboard / pad driven). */
function autoHideCursor(): void {
  let timer = 0;
  const show = () => {
    canvas.style.cursor = '';
    clearTimeout(timer);
    timer = window.setTimeout(() => (canvas.style.cursor = 'none'), 2000);
  };
  window.addEventListener('mousemove', show);
  show();
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
}

/** Sets up a quick fight from URL parameters: ?fight=0&p1=0&p2=1&h1=0&h2=5 */
function setupQuickFight(gs: GameState, params: URLSearchParams): SceneId {
  const arena = Math.max(0, Math.min(4, parseInt(params.get('fight') ?? '0', 10) || 0));
  for (let i = 0; i < 2; i++) {
    const p = gs.getPlayer(i);
    const pilotId = parseInt(params.get(`p${i + 1}`) ?? String(i), 10) || 0;
    const harId = parseInt(params.get(`h${i + 1}`) ?? String(i === 0 ? 0 : 5), 10) || 0;
    const info = PILOT_INFO[pilotId];
    p.pilot.pilotId = pilotId;
    p.pilot.harId = harId;
    p.pilot.power = info.power;
    p.pilot.agility = info.agility;
    p.pilot.endurance = info.endurance;
    p.pilot.name = langGet(20 + pilotId);
    setPilotColors(p.pilot, info.color1, info.color2, info.color3);
  }
  return SceneId.ARENA0 + arena;
}

async function main(): Promise<void> {
  resize();
  window.addEventListener('resize', resize);
  autoHideCursor();
  await preloadAll((loaded, total) => {
    boot.textContent = `Loading game data… ${Math.round((loaded / total) * 100)}%`;
  });
  loadSettings();
  try {
    loadLanguage(settings().language);
  } catch {
    loadLanguage();
  }
  initInput();
  const renderer = new GLRenderer(canvas);
  // HD artwork (optional: only if the imported bundles are installed).
  await hdAssets.init(renderer.gl, 'hd/');
  // Integrated / mobile GPUs load the artwork at half resolution (a quarter of the memory).
  if (renderer.isLowEndGpu) hdAssets.textureScale = 0.5;
  hdAssets.enabled = settings().video.hdArtwork;
  const params = new URLSearchParams(location.search);
  if (params.has('viewer')) {
    startViewer(renderer);
    return;
  }
  if (!params.has('noaudio')) await audio.init(soundBank(), (name) => getFile(name));
  const s = settings();
  audio.setSoundVolume(s.sound.soundVol / 10);
  audio.setMusicVolume(s.sound.musicVol / 10);
  const resumeAudio = () => audio.resume();
  window.addEventListener('keydown', resumeAudio);
  window.addEventListener('pointerdown', resumeAudio);

  registerPlaceholders();

  let startScene = hasScene(SceneId.INTRO) ? SceneId.INTRO : SceneId.MENU;
  const sceneParam = params.get('scene');
  if (sceneParam) {
    const id = (SceneId as unknown as Record<string, number>)[sceneParam.toUpperCase()];
    if (id !== undefined) startScene = id;
  }
  const gs = new GameState(SceneId.MENU);
  if (params.has('fight')) {
    startScene = setupQuickFight(gs, params);
    gs.arena = startScene - SceneId.ARENA0;
    if (params.has('ai')) gs.setupAi(1);
  }
  if (startScene !== SceneId.MENU) gs.swapScene(startScene);
  // On scene changes: evict stale surfaces from the atlas, and start loading the HD artwork the scene needs (the VS
  // screen also loads both robots and the fight graphics, so fights start with their artwork ready).
  const artworkFor = () => {
    const fight = gs.sc.isArena() || gs.thisId === SceneId.VS;
    const hars = fight ? [0, 1].map((i) => gs.getPlayer(i).pilot?.harId ?? -1).filter((h) => h >= 0) : [];
    const names = HdAssets.bundlesFor(gs.sc.bk?.file ?? null, hars, fight);
    // The arena is picked on the VS screen (or at random right after it): have them all ready.
    if (gs.thisId === SceneId.VS) for (let a = 0; a < 5; a++) names.push(`scene-ARENA${a}`);
    return names;
  };
  gs.onSceneChange = () => {
    renderer.resetAtlas();
    hdAssets.preload(artworkFor());
  };
  // The first screen waits (briefly) for its artwork so it does not pop in.
  boot.textContent = 'Loading artwork…';
  await hdAssets.whenReady(artworkFor(), 4000);

  // Remastered effects follow the game clock (dynamic ticks), so they pause and slow down with the game.
  const fxDirector = new FxDirector();
  // F1: the original help pages over the paused game.
  const help = new HelpOverlay((paused) => (engine.paused = paused));
  // Mouse: menus take hovers and clicks first (topmost frame first), then the scene; other clicks mean "continue"
  // (left) or "back" (right) on screens without menus. Fights ignore the mouse (except their pause menu).
  initMouse(canvas, (px, py) => renderer.canvasToNative(px, py));
  const dispatchPointer = () => {
    for (const e of drainPointer()) {
      if (help.isOpen()) {
        help.pointer(e.kind);
        continue;
      }
      let used = false;
      for (let i = renderedFrames.length - 1; i >= 0 && !used; i--) used = renderedFrames[i].pointer(e.x, e.y, e.kind);
      if (!used) used = gs.sc.pointer(e.x, e.y, e.kind);
      if (used || (e.kind !== 'click' && e.kind !== 'rclick')) continue;
      if (gs.sc.isArena() && !(gs.sc as { menuVisible?: boolean }).menuVisible) continue;
      if (e.kind === 'rclick') gs.menuCtrl.queued = ACT_ESC;
      else if (renderedFrames.length === 0) gs.menuCtrl.queued = ACT_PUNCH;
    }
    renderedFrames.length = 0;
  };
  const engine = new Engine(gs, {
    render: () => {
      dispatchPointer();
      help.update();
      help.render();
      fxDirector.update(gs, engine.ticks + engine.alpha, renderer.options.mode === 'remastered');
      renderer.fx = fxDirector.frame;
      renderer.render();
    },
  });
  // Gamepad rumble on impacts (the player hit feels it most, the attacker a little).
  onFx((e) => {
    if (!settings().keys.rumble || e.playerId < 0) return;
    const victim = gs.getPlayer(e.playerId)?.ctrl;
    const attacker = gs.getPlayer(e.playerId ? 0 : 1)?.ctrl;
    const p = Math.max(0, Math.min(60, e.power));
    switch (e.type) {
      case FxType.HIT:
      case FxType.PROJECTILE_HIT:
      case FxType.HAZARD_HIT:
        victim?.rumble(Math.min(1, 0.3 + p / 45), 70 + p * 4);
        attacker?.rumble(Math.min(0.5, 0.1 + p / 90), 60);
        break;
      case FxType.BLOCK:
        victim?.rumble(0.18, 60);
        break;
      case FxType.KO:
        victim?.rumble(1, 450);
        attacker?.rumble(0.6, 300);
        break;
      case FxType.WALL_SLAM:
        victim?.rumble(0.85, 260);
        break;
      case FxType.LANDING:
        if (p >= 15) victim?.rumble(Math.min(0.8, 0.25 + p / 80), 140);
        break;
    }
  });

  // Apply video/audio settings to the renderer and audio system.
  const applySettings = () => {
    const v = settings().video;
    renderer.options.mode = v.graphics;
    renderer.options.scaleMode = v.classicFilter;
    renderer.options.classicWidescreen = v.classicWidescreen;
    renderer.options.bloom = v.bloom;
    renderer.options.hdResolution = v.hdResolution;
    renderer.textStyle = v.hdFont === 'pixel' ? 1 : 0;
    hdAssets.enabled = v.hdArtwork;
    engine.interpolate = v.motionSmoothing && v.graphics === 'remastered';
    audio.setQuality(settings().sound.enhancedMusic ? 'enhanced' : 'classic');
  };
  applySettings();
  app.setGraphicsMode = (mode) => {
    settings().video.graphics = mode;
    saveSettings();
    applySettings();
  };
  app.getGraphicsMode = () => settings().video.graphics;
  app.settingsChanged = () => {
    saveSettings();
    applySettings();
  };
  // Keep the FULLSCREEN option in sync with the real state (hotkeys, Esc leaving browser fullscreen).
  const syncFullscreenSetting = async () => {
    const fs = await isFullscreen();
    if (settings().video.fullscreen !== fs) {
      settings().video.fullscreen = fs;
      saveSettings();
    }
  };
  app.toggleFullscreen = () => void toggleFullscreen().then(syncFullscreenSetting);
  document.addEventListener('fullscreenchange', () => void syncFullscreenSetting());
  // Browsers only allow fullscreen from a user gesture; the desktop shell can restore it at startup.
  if (isDesktop && settings().video.fullscreen) void setFullscreen(true);
  else if (!isDesktop) void syncFullscreenSetting();
  app.quit = () => {
    if (isDesktop) void quitApp();
    else gs.setNext(SceneId.MENU);
  };
  gs.onQuit = () => app.quit();
  // Global hotkeys: F2 swaps classic/remastered graphics, F11 / Alt+Enter toggle fullscreen.
  onKey((code, e) => {
    if (code === 'F1' && !help.isOpen()) {
      if (!e.repeat) help.open();
      return;
    }
    if (help.isOpen()) {
      if (!e.repeat) help.key(code);
      return;
    }
    if (code === 'F2') {
      if (!e.repeat) app.setGraphicsMode(settings().video.graphics === 'classic' ? 'remastered' : 'classic');
      return;
    }
    if (code === 'F11' || ((code === 'Enter' || code === 'NumpadEnter') && e.altKey)) {
      if (!e.repeat) app.toggleFullscreen();
      return;
    }
    // Raw key events for scenes that want them (text entry, key capture, help pages).
    gs.sc.keyEvent(code, e);
  });

  boot.style.display = 'none';
  engine.start();

  // Debug hooks for automated testing (also usable from the dev console).
  (window as unknown as { __omf: unknown }).__omf = {
    gs,
    engine,
    renderer,
    /** The app's draw list (dynamic imports from the console may get a different module instance after HMR). */
    drawList,
    vga,
    fx: fxDirector,
    audio,
    hdAssets,
    /** Advances the simulation by `ms` of game time (in small chunks, so long steps are not capped). */
    step(ms: number) {
      for (let t = 0; t < ms; t += 20) engine.advance(Math.min(20, ms - t));
    },
    key: setKeyState,
    /** Mouse input in native coordinates, e.g. pointer('click', 240, 40). */
    pointer: pushPointer,
    /** The reference's global RNG (seed it for reproducible recordings) and the effect event feed. */
    random: globalRandom,
    onFx,
    frame() {
      engine.frame(performance.now());
    },
    /**
     * Renders one frame at the given size and uploads it as a PNG to the dev server.
     * Optional crop [x, y, w, h] (in rendered pixels) to inspect details.
     */
    async capture(name: string, w = 960, h = 600, crop?: [number, number, number, number]) {
      const ow = canvas.width, oh = canvas.height;
      canvas.width = w;
      canvas.height = h;
      drawList.begin();
      drawList.interpAlpha = engine.interpolate ? engine.alpha : -1;
      gs.render();
      engine.renderer.render(gs, engine.alpha);
      let url: string;
      if (crop) {
        const c2 = document.createElement('canvas');
        c2.width = crop[2];
        c2.height = crop[3];
        c2.getContext('2d')!.drawImage(canvas, crop[0], crop[1], crop[2], crop[3], 0, 0, crop[2], crop[3]);
        url = c2.toDataURL('image/png');
      } else {
        url = canvas.toDataURL('image/png');
      }
      canvas.width = ow;
      canvas.height = oh;
      const blob = await (await fetch(url)).blob();
      const res = await fetch(`/__debug/capture?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
      return res.json();
    },
  };
}

main().catch((err) => {
  console.error(err);
  boot.textContent = String(err?.message ?? err);
});
