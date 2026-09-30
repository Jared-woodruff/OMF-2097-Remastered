import { app } from './app';
import { audio } from './audio/audio';
import { initInput, setKeyState } from './controller/input';
import { startViewer } from './debug/viewer';
import { Engine } from './engine';
import { ANIM_IDLE, PILOT_INFO, SceneId } from './game/constants';
import { GameState, hasScene } from './game/gameState';
import { setPilotColors } from './game/pilotColors';
import { loadSettings, saveSettings, settings } from './game/settings';
import './game/scenes/index';
import { registerPlaceholders } from './game/scenes/placeholder';
import { getFile, preloadAll } from './resources/files';
import { loadGenerated } from './resources/generated';
import { GeneratedArtwork } from './gen/hdArtwork';
import { MOVE } from './gen/fighter/moveset';
import { EXTRA_HAR_IDS, extraRobotsEnabled } from './game/roster';
import { loadStoredGameFiles, provideGameFiles } from './platform/gameData';
import { showImportScreen } from './platform/importScreen';
import { fonts, langGet, loadLanguage, soundBank } from './resources/resources';
import { GLRenderer } from './video/gl/renderer';
import { drawList } from './video/draw';
import { isDesktop, isFullscreen, quitApp, setFullscreen, toggleFullscreen } from './platform/desktop';
import { onKey } from './controller/input';
import { HdAssets, hdAssets } from './video/hd/assets';
import { buildGlyphAtlas, loadTypeface, type GlyphAtlas } from './video/hd/typeface';
import TypefaceWorker from './video/hd/typefaceWorker.ts?worker';
import { vga } from './video/vga';
import { FxDirector } from './fx/director';
import { FxType, onFx } from './game/fx';
import { globalRandom } from './util/random';
import { HelpOverlay } from './game/gui/helpOverlay';
import { htmlHelpOpen } from './game/gui/helpHtml';
import { APP_VERSION, showVersionLabel } from './platform/versionLabel';
import { firstRunSetup } from './platform/setupScreen';
import { drainPointer, initMouse, pushPointer } from './controller/mouse';
import { renderedFrames } from './game/gui/widgets';
import { startTraining } from './game/scenes/mainmenu/menuTraining';
import { seedQuickFight, setupQuickFight } from './game/quickFight';
import { applyPadSettings } from './game/controls';
import { addTracks, audioFiles } from './audio/customMusic';
import { toast } from './platform/toast';
import { saveFile } from './platform/files';
import { ACT_ESC, ACT_PUNCH } from './game/constants';
import { ReplaysPage } from './game/replay/replaysPage';
import { RunResultsPage } from './game/modes/resultsPage';
import { RecordsPage } from './game/records/recordsPage';
import { MS_PER_OMF_TICK_SLOWEST } from './game/constants';
import { ReplaySession } from './game/replay/playback';
import { ClipExporter } from './platform/clipExport';
import { TouchControls } from './platform/touch';
import { WorkshopPage, type WorkshopHost } from './game/workshop/workshopPage';
import { buildWorkshopInBackground, ensureWorkshopRobot, harIdOf, isWorkshopHar } from './game/workshop/registry';
import { hasFighter } from './resources/resources';
import { CustomTournamentsPage } from './game/tournament/customPage';
import { CreditsRun, startCredits } from './game/credits/creditsRun';
import { registerCustomTournaments } from './game/tournament/custom';
import { ModeRun } from './game/modes/run';
import { setupPlayerInput } from './game/scenes/mainmenu/menuMain';
import { FightCamera } from './video/camera';
import { loadAnnouncer } from './audio/announcer';
import { CtrlType } from './game/constants';
import { MenuScene } from './video/stage/parallax';

const boot = document.getElementById('boot')!;
{
  const ver = boot.querySelector<HTMLElement>('.ver');
  if (ver) ver.textContent = `v${APP_VERSION}`;
}
/** The loading screen's stage (and its bar and percentage, 0..1). */
function bootStatus(text: string, progress?: number): void {
  const line = boot.querySelector<HTMLElement>('.text');
  if (line) line.textContent = text;
  else boot.textContent = text;
  if (progress === undefined) return;
  const p = Math.max(0, Math.min(1, progress));
  const fill = boot.querySelector<HTMLElement>('.fill');
  if (fill) fill.style.width = `${Math.round(p * 1000) / 10}%`;
  const pct = boot.querySelector<HTMLElement>('.pct');
  if (pct) pct.textContent = `${Math.round(p * 100)}%`;
}
/** The loading screen fades out (and is gone a moment later). */
function hideBoot(): void {
  boot.classList.add('is-done');
  window.setTimeout(() => {
    if (boot.classList.contains('is-done')) boot.style.display = 'none';
  }, 650);
}
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

/** Font family name of the remastered typeface. */
const TYPEFACE_FAMILY = 'OMF Remastered';

/** The main menu's parallax layers (tools/menu-pack). */
const MENU_LAYERS = 'hd/menu/';
/** Where the main menu scene starts its loop (seconds): the spotlight on the robot's chest. */
const STAGE_START = 0.3;

/** How long a fight waits at most for its remastered artwork (see onSceneChange). */
const ARTWORK_WAIT_MS = 4000;

async function main(): Promise<void> {
  resize();
  window.addEventListener('resize', resize);
  autoHideCursor();
  // The original game data: from the server (npm run extract, the desktop app), else imported earlier in this
  // browser, else the player provides it now (web version).
  const fromServer = await preloadAll((loaded, total) => {
    bootStatus('LOADING GAME DATA', (loaded / total) * 0.8);
  });
  if (!fromServer && !(await loadStoredGameFiles())) {
    boot.style.display = 'none';
    provideGameFiles(await showImportScreen());
    boot.style.display = '';
    bootStatus('LOADING GAME DATA', 0.8);
  }
  // The remaster's own content (the new robots), shipped with the app.
  bootStatus('PREPARING THE ROBOTS', 0.82);
  await loadGenerated();
  loadSettings();
  try {
    loadLanguage(settings().language);
  } catch {
    loadLanguage();
  }
  initInput();
  bootStatus('STARTING THE RENDERER', 0.86);
  const renderer = new GLRenderer(canvas);
  // HD artwork (optional: only if the imported bundles are installed).
  await hdAssets.init(renderer.gl, 'hd/');
  // Integrated / mobile GPUs load the artwork at half resolution (a quarter of the memory).
  if (renderer.isLowEndGpu) hdAssets.textureScale = 0.5;
  hdAssets.enabled = settings().video.hdArtwork;
  // The remaster's robots get their HD artwork rendered on the GPU (between frames, as scenes need it).
  const genArt = new GeneratedArtwork(renderer.gl, hdAssets);
  const params = new URLSearchParams(location.search);
  if (params.has('viewer')) {
    startViewer(renderer);
    return;
  }
  // Development: render the generated arenas' HD backgrounds (see gen/dev/arenaHd.ts).
  if (import.meta.env.DEV && params.has('genarenahd')) {
    const { renderArenaHd } = await import('./gen/dev/arenaHd');
    await renderArenaHd(renderer.gl, (s) => bootStatus(s), params.get('genarenahd') || undefined);
    return;
  }
  if (!params.has('noaudio')) {
    await audio.init(soundBank(), (name) => getFile(name));
    loadAnnouncer();
  }
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
    // (&seed: the same fight every time, the computer on both sides; see quickFight.ts)
    if (import.meta.env.DEV && params.has('seed')) seedQuickFight(gs, params);
    else if (params.has('ai')) gs.setupAi(1);
  }
  // ?training: straight into training mode with the last used setup.
  if (params.has('training')) {
    startScene = SceneId.MENU;
    startTraining(gs);
  }
  if (startScene !== SceneId.MENU) gs.swapScene(startScene);
  // On scene changes: evict stale surfaces from the atlas, and start loading the HD artwork the scene needs (the VS
  // screen also loads both robots and the fight graphics, so fights start with their artwork ready).
  // The artwork a scene shows itself...
  const sceneArtwork = () => {
    const fight = gs.sc.isArena() || gs.thisId === SceneId.VS;
    const hars = fight ? [0, 1].map((i) => gs.getPlayer(i).pilot?.harId ?? -1).filter((h) => h >= 0) : [];
    return HdAssets.bundlesFor(gs.sc.bk?.file ?? null, hars, fight);
  };
  // ...and what it loads ahead: the arena is picked on the VS screen (or at random right after it), have them all ready.
  const artworkFor = () => {
    const names = sceneArtwork();
    if (gs.thisId === SceneId.VS) for (let a = 0; a < 5; a++) names.push(`scene-ARENA${a}`);
    return names;
  };
  // The main menu's parallax scene (loaded when the menu is first shown in remastered mode).
  const menuScene = new MenuScene();
  const menuLoading = () => renderer.options.mode === 'remastered' && gs.thisId === SceneId.MENU && menuScene.loading;
  // The generated robots' artwork: all of the fighting robots, the select screen's cells and idle animations.
  const wantGenerated = () => {
    const fight = gs.sc.isArena() || gs.thisId === SceneId.VS;
    if (fight) genArt.want([0, 1].map((i) => gs.getPlayer(i).pilot?.harId ?? -1));
    if (gs.sc.isArena() && gs.sc.bk) genArt.wantArena(gs.sc.bk);
    else if (gs.thisId === SceneId.MELEE && extraRobotsEnabled()) genArt.want(EXTRA_HAR_IDS, [MOVE.PORTRAIT_CELL, ANIM_IDLE]);
  };
  gs.onSceneChange = () => {
    renderer.resetAtlas();
    hdAssets.preload(artworkFor());
    wantGenerated();
    // A scene whose artwork is not there yet (a fight entered without the VS screen, which loads it beforehand, the
    // first visit of a screen): the game waits on the scene's black first frame until it is (a few seconds at most),
    // so nothing starts blurry and sharpens a moment later.
    if (renderer.options.mode === 'remastered' && gs.thisId === SceneId.MENU) menuScene.load(MENU_LAYERS);
    if (renderer.options.mode === 'remastered' && (hdAssets.loading(sceneArtwork()) || menuLoading())) {
      engine.waiting = true;
      artworkWaitEnd = performance.now() + ARTWORK_WAIT_MS;
    }
    audio.setRoom(gs.sc.isArena() ? gs.thisId - SceneId.ARENA0 : -1);
    // Back from trying a workshop robot: the workshop opens again.
    if (workshopAfter && gs.thisId === SceneId.MENU) {
      workshopAfter = false;
      onMenu = () => app.showWorkshop();
    }
  };
  let workshopAfter = false;
  let artworkWaitEnd = 0;
  // Pages that open once the main menu is back and has faded in (the replay list after watching a replay, the results
  // of an arcade, survival or time attack run).
  let onMenu: (() => void) | null = null;
  audio.setRoom(gs.sc.isArena() ? gs.thisId - SceneId.ARENA0 : -1);
  wantGenerated();
  // The first screen waits (briefly) for its artwork so it does not pop in.
  bootStatus('LOADING ARTWORK', 0.9);
  if (renderer.options.mode === 'remastered') menuScene.load(MENU_LAYERS);
  await hdAssets.whenReady(artworkFor(), 4000);
  if (gs.thisId === SceneId.MENU) await menuScene.whenReady(4000);
  bootStatus('READY', 1);

  // Remastered effects follow the game clock (dynamic ticks), so they pause and slow down with the game.
  const fxDirector = new FxDirector();
  const camera = new FightCamera();
  // F1: the original help pages over the paused game.
  const help = new HelpOverlay((paused) => (engine.paused = paused));
  // Touch controls: in fights (not replays, demos or the pause menu) and on the robot select screen.
  const touch = new TouchControls();
  const touchWanted = () => {
    if (help.isOpen()) return false;
    if (gs.thisId === SceneId.MELEE) return true;
    const menuOpen = (gs.sc as { menuVisible?: boolean }).menuVisible;
    return gs.sc.isArena() && !gs.replay && !gs.isDemoplay() && !menuOpen && gs.getPlayer(0).ctrl.type !== CtrlType.AI;
  };
  // Mouse: menus take hovers and clicks first (topmost frame first), then the scene; other clicks mean "continue"
  // (left) or "back" (right) on screens without menus. Fights ignore the mouse (except their pause menu).
  initMouse(canvas, (px, py) => renderer.canvasToNative(px, py));
  const dispatchPointer = () => {
    for (const e of drainPointer()) {
      if (help.isOpen()) {
        help.pointer(e.kind, e.x, e.y);
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
  // The main menu's parallax scene in remastered mode (video/stage/parallax.ts): its clock starts when the menu
  // opens, and its camera leans toward the mouse.
  let stageSince = -1;
  /** Development: a fixed time for the menu scene (seconds), or null. */
  const stageDebug = { time: null as number | null };
  let lean: [number, number] | null = null;
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    lean = [((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1];
  });
  canvas.addEventListener('pointerleave', () => {
    lean = [0, 0];
  });
  // It stands for MAIN.BK's picture wherever the game shows it (the main menu, the scoreboard, the help pages); its loop
  // starts over each time the main menu opens. Screens that darken the picture's colors (the scoreboard) darken it too.
  let stageScene = -1;
  let pictureColors: { bk: unknown; used: number[] } | null = null;
  const pictureBrightness = () => {
    const bk = gs.sc.bk;
    if (!bk) return 1;
    if (pictureColors?.bk !== bk) {
      const seen = new Set<number>(bk.background.data);
      pictureColors = { bk, used: [...seen].filter((i) => i > 0) };
    }
    const ref = bk.palettes[0].colors, cur = vga.undarkened.colors;
    let a = 0, b = 0;
    for (const i of pictureColors.used) {
      a += cur[i * 3] + cur[i * 3 + 1] + cur[i * 3 + 2];
      b += ref[i * 3] + ref[i * 3 + 1] + ref[i * 3 + 2];
    }
    return b > 0 ? Math.min(1, a / b) : 1;
  };
  const menuBackdrop = () => {
    if (renderer.options.mode !== 'remastered') return null;
    if (gs.thisId === SceneId.MENU) menuScene.load(MENU_LAYERS);
    if (!menuScene.ready) return null;
    const now = performance.now();
    if (stageSince < 0 || (gs.thisId === SceneId.MENU && stageScene !== SceneId.MENU)) stageSince = now;
    stageScene = gs.thisId;
    menuScene.update(stageDebug.time ?? STAGE_START + (now - stageSince) / 1000, lean);
    menuScene.brightness = pictureBrightness();
    return menuScene;
  };
  const engine = new Engine(gs, {
    render: () => {
      if (onMenu && gs.thisId === SceneId.MENU && gs.nextId === SceneId.MENU && gs.thisWaitTicks === 0 && !help.isOpen()) {
        const open = onMenu;
        onMenu = null;
        open();
      }
      if (engine.waiting && ((!hdAssets.loading(sceneArtwork()) && !menuLoading()) || performance.now() > artworkWaitEnd)) engine.waiting = false;
      dispatchPointer();
      touch.update(settings().keys.touch, touchWanted());
      help.update();
      help.render();
      // The product's name and version in the main menu's corner (not over the help, the pages or the credits).
      showVersionLabel(gs.thisId === SceneId.MENU && gs.nextId === SceneId.MENU && !engine.waiting && !help.isOpen() &&
        !htmlHelpOpen() && !gs.credits);
      fxDirector.update(gs, engine.ticks + engine.alpha, renderer.options.mode === 'remastered');
      renderer.fx = fxDirector.frame;
      renderer.backdrop = menuBackdrop();
      renderer.camera = camera.update(gs, performance.now(), settings().gameplay.fightCamera && renderer.options.mode === 'remastered');
      if (renderer.options.mode === 'remastered' && hdAssets.enabled) genArt.pump(4);
      // (a page or the credits' titles covering the screen: nothing of the game shows)
      if (!help.coversScreen() && !(gs.credits instanceof CreditsRun && gs.credits.coversScreen())) {
        renderer.render();
        // (the credits keep a picture of each fight's winner, taken while the frame is there)
        if (gs.credits instanceof CreditsRun) gs.credits.rendered(canvas);
      }
      clips.frame();
    },
  });
  // Impact bass: a low thump under heavy hits, slams and knockouts (the original sounds stay as they are).
  onFx((e) => {
    const p = Math.max(0, Math.min(60, e.power));
    const pan = ((e.x - 160) / 160) * 40;
    switch (e.type) {
      case FxType.HIT:
      case FxType.PROJECTILE_HIT:
      case FxType.HAZARD_HIT:
        if (p >= 6) audio.thump((p - 4) / 36, 0.1 + p / 120, pan);
        break;
      case FxType.KO:
        audio.thump(1, 1, pan);
        break;
      case FxType.WALL_SLAM:
        audio.thump(0.85, 0.75, pan);
        break;
      case FxType.LANDING:
        if (p >= 15) audio.thump((p - 10) / 40, 0.4, pan);
        break;
    }
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

  // The remastered typeface (FONT: REMASTERED): loaded and its glyphs built in a worker the first time it is wanted
  // (here if the worker cannot draw text); text keeps the smooth letters until then.
  let typefaceWanted = false;
  const wantTypeface = () => {
    if (typefaceWanted) return;
    typefaceWanted = true;
    const url = new URL('fonts/Orbitron.ttf', location.href).href;
    const here = () => void loadTypeface(url, TYPEFACE_FAMILY).then((ok) => {
      const atlas = ok ? buildGlyphAtlas(TYPEFACE_FAMILY, fonts()) : null;
      if (atlas) renderer.setGlyphAtlas(atlas);
    });
    try {
      const worker = new TypefaceWorker();
      worker.onmessage = (e: MessageEvent<GlyphAtlas | null>) => {
        worker.terminate();
        if (e.data) renderer.setGlyphAtlas(e.data);
        else here();
      };
      worker.onerror = () => {
        worker.terminate();
        here();
      };
      worker.postMessage({ url, family: TYPEFACE_FAMILY, fonts: fonts() });
    } catch {
      here();
    }
  };
  // Apply video/audio settings to the renderer and audio system.
  const applySettings = () => {
    const v = settings().video;
    renderer.options.mode = v.graphics;
    renderer.options.scaleMode = v.classicFilter;
    renderer.options.classicWidescreen = v.classicWidescreen;
    renderer.options.bloom = v.bloom;
    renderer.options.hdResolution = v.hdResolution;
    renderer.textStyle = v.hdFont === 'pixel' ? 1 : v.hdFont === 'type' ? 2 : 0;
    if (v.hdFont === 'type') wantTypeface();
    renderer.options.hdHud = v.hdHud;
    hdAssets.enabled = v.hdArtwork;
    engine.interpolate = v.motionSmoothing && v.graphics === 'remastered';
    audio.setQuality(settings().sound.enhancedMusic ? 'enhanced' : 'classic');
    applyPadSettings();
    audio.setAcoustics(settings().sound.acoustics);
    audio.setMyMusicMode(settings().sound.myMusic);
    audio.setImpactBass(settings().sound.impactBass);
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
  app.showControls = () => help.open('controls');
  // Replays: the list (EXTRAS > REPLAYS) over the menu; watching a fight, and saving clips of it.
  app.showReplays = () => help.open(new ReplaysPage((record) => {
    // A fight with a workshop robot needs it built (and still there).
    for (const p of record.meta.players) {
      if (isWorkshopHar(p.harId)) ensureWorkshopRobot(p.harId - harIdOf(0));
      if (!hasFighter(p.harId)) {
        toast('This fight was played with a robot that is not in the workshop any more.', 4000);
        return;
      }
    }
    new ReplaySession(gs, record, () => {
      clips.cancel();
      onMenu = () => app.showReplays();
      gs.menuReturn = 'extras';
      gs.setNext(SceneId.MENU);
    }).start();
  }, () => gs.speed));
  app.showRunResults = (result) => (onMenu = () => help.open(new RunResultsPage(result)));
  // The robot workshop: trying a robot in training or in a fight against the computer.
  const workshopHost: WorkshopHost = {
    train(slot, spec) {
      settings().training.har = harIdOf(slot);
      startTraining(gs);
      const c = spec.colors;
      setPilotColors(gs.getPlayer(0).pilot, c[0], c[1], c[2]);
      gs.menuReturn = 'extras';
      workshopAfter = true;
    },
    fight(slot, spec) {
      setupPlayerInput(gs, 0);
      gs.setupAi(1);
      gs.matchSettingsReset();
      const p1 = gs.getPlayer(0);
      const info = PILOT_INFO[settings().training.pilot] ?? PILOT_INFO[0];
      p1.pilot.pilotId = settings().training.pilot;
      p1.pilot.harId = harIdOf(slot);
      p1.pilot.power = info.power;
      p1.pilot.agility = info.agility;
      p1.pilot.endurance = info.endurance;
      p1.pilot.name = langGet(20 + p1.pilot.pilotId);
      p1.pilot.photo = null;
      setPilotColors(p1.pilot, spec.colors[0], spec.colors[1], spec.colors[2]);
      gs.modeRun = new ModeRun('exhibition');
      gs.modeRun.setupOpponent(gs);
      gs.setNext(SceneId.VS);
    },
  };
  app.showWorkshop = () => {
    const open = () => help.open(new WorkshopPage(workshopHost));
    if (gs.thisId === SceneId.MENU && gs.nextId === SceneId.MENU) open();
    else onMenu = open;
  };
  buildWorkshopInBackground();
  app.showTournaments = () => help.open(new CustomTournamentsPage());
  app.showCredits = () => startCredits(gs, { links: !isDesktop });
  registerCustomTournaments();
  app.showRecords = () => help.open(new RecordsPage(() => Math.trunc(8 + MS_PER_OMF_TICK_SLOWEST - ((settings().gameplay.speed + 5) / 15) * MS_PER_OMF_TICK_SLOWEST)));
  const clips = new ClipExporter({
    canvas,
    viewport: () => renderer.viewport(),
    audioStream: () => audio.captureStream(),
    releaseAudio: () => audio.releaseCapture(),
  });
  app.exportReplay = (kind) => {
    if (gs.replay) clips.start(gs.replay, kind);
  };
  app.cancelExport = () => clips.cancel();
  // Screenshots (PRINT SCREEN; F12 in the desktop app): the frame at the display's resolution, saved as a PNG where
  // replays and clips go.
  const screenshot = () => {
    if (help.coversScreen()) return;
    engine.frame(performance.now());
    canvas.toBlob((blob) => {
      if (!blob) return;
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      const name = `OMF 2097 ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.png`;
      saveFile(name, blob, 'image/png')
        .then((where) => toast(`Screenshot saved${where === name ? '' : `: ${where}`}`, 3500))
        .catch(() => toast('The screenshot could not be saved.', 3500));
    }, 'image/png');
  };
  // (Windows gives PRINT SCREEN to the page only as a key release)
  window.addEventListener('keyup', (e) => {
    if (e.code === 'PrintScreen') screenshot();
  });
  // Global hotkeys: F2 swaps classic/remastered graphics, F11 / Alt+Enter toggle fullscreen.
  onKey((code, e) => {
    if (code === 'F12' && isDesktop) {
      if (!e.repeat) screenshot();
      return;
    }
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
    if (code === 'F3') {
      if (!e.repeat) audio.nextSong();
      return;
    }
    if (code === 'F11' || ((code === 'Enter' || code === 'NumpadEnter') && e.altKey)) {
      if (!e.repeat) app.toggleFullscreen();
      return;
    }
    // Raw key events for scenes that want them (text entry, key capture, help pages).
    gs.sc.keyEvent(code, e);
  });

  // The player's own music: songs dropped onto the window go to the library; a notice names each song as it starts.
  audio.onSong = (name) => toast(`\u266A  ${name}`);
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (audioFiles(files).length === 0) return;
    e.preventDefault();
    void addTracks(files).then(async (n) => {
      await audio.reloadMyMusic();
      toast(`${n} song${n === 1 ? '' : 's'} added to your music (${audio.myMusicCount} in total). OPTIONS > SOUND > MY MUSIC chooses where they play.`, 5000);
    }).catch(() => toast('The songs could not be saved in this browser.'));
  });

  // Switching to another window or tab pauses a fight (?nopause keeps it running, e.g. for recordings).
  if (!params.has('nopause')) {
    window.addEventListener('blur', () => gs.sc.focusLost());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) gs.sc.focusLost();
    });
  }

  // The first start: the setup over the finished loading screen (not for the development pages and recordings, which
  // open with parameters).
  if (!settings().setupDone && !['scene', 'fight', 'training', 'credits', 'nosetup'].some((p) => params.has(p))) {
    await firstRunSetup(boot);
  }
  hideBoot();
  engine.start();
  // Development: ?credits starts the remaster's credits (=n: at the n-th fight; past the last: the end titles).
  if (import.meta.env.DEV && params.has('credits')) startCredits(gs, { links: !isDesktop, start: Number(params.get('credits')) || 0 });

  // Debug hooks for automated testing (also usable from the dev console).
  (window as unknown as { __omf: unknown }).__omf = {
    gs,
    engine,
    /** The host hooks (show the replay list, records...). */
    app,
    renderer,
    /** The live menu scene's clock override (set `time` to freeze it at a moment). */
    stage: stageDebug,
    /** The app's draw list (dynamic imports from the console may get a different module instance after HMR). */
    drawList,
    vga,
    fx: fxDirector,
    audio,
    hdAssets,
    genArt,
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

// Web version: work offline and be installable (not in the desktop app or the dev server).
if (import.meta.env.PROD && !isDesktop && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => undefined));
}

main().catch((err) => {
  console.error(err);
  boot.style.display = '';
  boot.classList.remove('is-done');
  boot.classList.add('is-error');
  bootStatus(String(err?.message ?? err));
});
