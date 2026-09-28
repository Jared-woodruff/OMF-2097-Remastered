import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../app';
import { audio } from '../audio/audio';
import { setKeyState } from '../controller/input';
import { KeyboardController } from '../controller/keyboard';
import { CtrlType, SceneId } from '../game/constants';
import type { GameState } from '../game/gameState';
import { Button, Menu, TextSelector, TextSlider } from '../game/gui/widgets';
import { MainMenuScene } from '../game/scenes/mainmenu';
import { activeMenu } from '../game/scenes/mainmenu/common';
import { HelpMenu } from '../game/scenes/mainmenu/menuHelp';
import { PresskeyMenu } from '../game/scenes/mainmenu/menuPresskey';
import { defaultSettings, settings } from '../game/settings';
import { drawList } from '../video/draw';
import { vga } from '../video/vga';
import { createGame, hasGameData, HeadlessRunner, installBrowserShims } from './harness';

function keyEvent(code: string, mods: { repeat?: boolean; altKey?: boolean } = {}): KeyboardEvent {
  return {
    code, key: code, repeat: mods.repeat ?? false, altKey: mods.altKey ?? false, ctrlKey: false, shiftKey: false, metaKey: false,
  } as unknown as KeyboardEvent;
}

describe.skipIf(!hasGameData)('main menu (headless)', () => {
  let gs: GameState;
  let run: HeadlessRunner;

  /** Taps a key long enough for the menu to see exactly one action. */
  function press(code: string, times = 1): void {
    for (let i = 0; i < times; i++) {
      setKeyState(code, true);
      run.advance(40);
      setKeyState(code, false);
      run.advance(60);
    }
  }
  const scene = () => gs.sc as MainMenuScene;
  const root = () => scene().frame.root as Menu;
  const current = () => activeMenu(root());
  const selectedText = () => {
    const c = current().current();
    if (c instanceof Button) return c.text.str;
    if (c instanceof TextSelector || c instanceof TextSlider) {
      c.refresh();
      return c.text.str;
    }
    return c?.constructor.name;
  };

  beforeEach(() => {
    installBrowserShims();
    localStorage.clear();
    Object.assign(settings(), defaultSettings());
    // Pin the values these tests navigate from (independent of future changes to the defaults).
    const s = settings();
    Object.assign(s.video, {
      graphics: 'remastered', classicFilter: 'sharp', classicWidescreen: false, crossfade: true, screenShake: true,
      fullscreen: false, bloom: true, motionSmoothing: true, hdHud: true,
    });
    Object.assign(s.sound, { soundVol: 7, musicVol: 6, enhancedMusic: true });
    Object.assign(s.gameplay, { speed: 5, fightMode: 0, power1: 5, power2: 5, hazards: true, difficulty: 1, rounds: 1 });
    Object.assign(s.advanced, { rehitMode: false, throwRange: 100, jumpHeight: 100, hitPause: 4, vitality: 100, blockDamage: 0 });
    gs = createGame(SceneId.MENU);
    run = new HeadlessRunner(gs);
    run.advance(400); // past the scene's input delay
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const k of ['Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) setKeyState(k, false);
  });

  it('starts with the MAIN.BK animations, menu music and the frame at the reference position', () => {
    expect(gs.sc).toBeInstanceOf(MainMenuScene);
    expect(gs.objects.map((o) => o.obj.curAnimation?.id).sort()).toEqual([10, 11]);
    expect(audio.music).toBe('MENU.PSM');
    expect([root().x, root().y, root().w]).toEqual([165, 5, 151]);
    expect(selectedText()).toBe('ONE PLAYER GAME');
    expect(drawList.count).toBeGreaterThan(10);
    // The highlight color pulses.
    const seen = new Set<number>();
    for (let i = 0; i < 20; i++) {
      run.advance(30);
      seen.add(vga.base.colors[255 * 3 + 1]);
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  it('ONE PLAYER GAME: player 1 keyboard vs CPU, then MELEE', () => {
    settings().gameplay.difficulty = 3;
    press('Enter');
    expect(gs.nextId).toBe(SceneId.MELEE);
    expect(gs.getPlayer(0).ctrl.type).toBe(CtrlType.KEYBOARD);
    expect(gs.getPlayer(1).ctrl.type).toBe(CtrlType.AI);
    expect(gs.isSingleplayer()).toBe(true);
    expect(gs.getPlayer(0).score.difficulty).toBe(3);
    expect(gs.getPlayer(0).pilot.name).toBe('');
    run.advance(500);
    expect(gs.thisId).toBe(SceneId.MELEE);
  });

  it('ONE PLAYER GAME uses the configured gamepad (no keyboard fallback while the pad is not exposed yet)', () => {
    settings().keys.ctrlType1 = CtrlType.GAMEPAD;
    settings().keys.gamepad1 = 0;
    press('Enter');
    expect(gs.nextId).toBe(SceneId.MELEE);
    expect(gs.getPlayer(0).ctrl.type).toBe(CtrlType.GAMEPAD);
  });

  it('Alt+Enter (the host fullscreen hotkey) does not press the selected entry', () => {
    setKeyState('Enter', true);
    scene().keyEvent('Enter', keyEvent('Enter', { altKey: true }));
    run.advance(150);
    setKeyState('Enter', false);
    run.advance(60);
    expect(gs.nextId).toBe(SceneId.MENU);
    press('Enter');
    expect(gs.nextId).toBe(SceneId.MELEE);
  });

  it('TWO PLAYER GAME: both keyboard, player 2 on key set 1, then MELEE', () => {
    press('ArrowDown');
    expect(selectedText()).toBe('TWO PLAYER GAME');
    press('Enter');
    expect(gs.nextId).toBe(SceneId.MELEE);
    const c1 = gs.getPlayer(0).ctrl, c2 = gs.getPlayer(1).ctrl;
    expect(c1).toBeInstanceOf(KeyboardController);
    expect(c2).toBeInstanceOf(KeyboardController);
    expect((c1 as KeyboardController).keys).toBe(settings().keys.p1);
    expect((c2 as KeyboardController).keys).toBe(settings().keys.p2);
    expect(gs.isTwoplayer()).toBe(true);
    run.advance(500);
    expect(gs.thisId).toBe(SceneId.MELEE);
  });

  it('TRAINING takes the place of NETWORK PLAY; TOURNAMENT, DEMO and SCOREBOARD start their scenes', () => {
    press('ArrowDown', 3);
    expect(selectedText()).toBe('TRAINING');
    press('ArrowDown');
    expect(selectedText()).toBe('CONFIGURATION');
    press('ArrowUp', 2);
    expect(selectedText()).toBe('TOURNAMENT PLAY');
    press('Enter');
    expect(gs.nextId).toBe(SceneId.MECHLAB);

    gs = createGame(SceneId.MENU);
    run = new HeadlessRunner(gs);
    run.advance(400);
    press('ArrowDown', 8);
    expect(selectedText()).toBe('DEMO');
    press('Enter');
    expect(gs.nextId).toBe(SceneId.VS);
    expect(gs.isDemoplay()).toBe(true);

    gs = createGame(SceneId.MENU);
    run = new HeadlessRunner(gs);
    run.advance(400);
    press('ArrowUp', 2);
    expect(selectedText()).toBe('SCOREBOARD');
    press('Enter');
    expect(gs.nextId).toBe(SceneId.SCOREBOARD);
  });

  it('TRAINING sets up player 1 against a dummy and goes straight to the arena', () => {
    press('ArrowDown', 3);
    press('Enter');
    expect(selectedText()).toBe('ROBOT JAGUAR');
    press('ArrowRight', 2);
    expect(selectedText()).toBe('ROBOT THORN');
    press('ArrowDown', 3);
    press('ArrowRight', 3);
    expect(selectedText()).toBe('ARENA FIRE PIT');
    press('ArrowDown');
    press('ArrowRight', 3);
    expect(selectedText()).toBe('DUMMY BLOCK');
    press('ArrowDown');
    expect(selectedText()).toBe('START');
    press('Enter');
    expect(gs.nextId).toBe(SceneId.ARENA3);
    expect(gs.training).toBe(true);
    expect(gs.getPlayer(0).pilot.harId).toBe(2);
    expect(gs.getPlayer(1).ctrl.type).toBe(CtrlType.KEYBOARD);
    expect(settings().training).toMatchObject({ har: 2, arena: 3, dummy: 3 });
    run.advance(1500);
    expect(gs.thisId).toBe(SceneId.ARENA3);
  });

  it('the mouse hovers, clicks and scrolls menu entries', () => {
    const frame = scene().frame;
    const center = (label: string) => {
      const c = current().items.find((i) => (i instanceof Button || i instanceof TextSelector || i instanceof TextSlider) && i.text.str.startsWith(label))!;
      return [c.x + c.w / 2, c.y + c.h / 2] as const;
    };
    expect(frame.pointer(...center('GAMEPLAY'), 'move')).toBe(true);
    expect(selectedText()).toBe('GAMEPLAY');
    expect(frame.pointer(2, 2, 'click')).toBe(false); // outside the entries
    frame.pointer(...center('GAMEPLAY'), 'click');
    expect(selectedText()).toMatch(/^SPEED/);
    const speed = settings().gameplay.speed;
    frame.pointer(...center('SPEED'), 'wheelUp');
    expect(settings().gameplay.speed).toBe(speed + 1);
    frame.pointer(...center('HAZARDS'), 'click');
    expect(settings().gameplay.hazards).toBe(false);
    frame.pointer(...center('DONE'), 'click');
    expect(selectedText()).toBe('GAMEPLAY');
  });

  it('ESC selects QUIT, a second ESC quits through the credits', () => {
    press('Escape');
    expect(selectedText()).toBe('QUIT');
    expect(gs.nextId).toBe(SceneId.MENU);
    press('Escape');
    expect(gs.nextId).toBe(SceneId.CREDITS);
  });

  it('GAMEPLAY changes and saves the gameplay settings', () => {
    press('ArrowDown', 5);
    press('Enter');
    expect(selectedText()).toBe('SPEED ' + '\x7f'.repeat(5) + '|'.repeat(5));
    press('ArrowRight');
    expect(settings().gameplay.speed).toBe(6);
    expect(gs.speed).toBe(11);
    press('ArrowDown');
    press('ArrowRight');
    expect(settings().gameplay.fightMode).toBe(1);
    press('ArrowDown');
    press('ArrowLeft');
    expect(settings().gameplay.power1).toBe(4);
    press('ArrowDown', 2);
    press('Enter');
    expect(settings().gameplay.hazards).toBe(false);
    press('ArrowDown');
    press('ArrowRight');
    expect(selectedText()).toBe('CPU: VETERAN');
    press('ArrowDown');
    press('ArrowRight');
    expect(selectedText()).toBe('BEST 3 OF 5');
    expect(settings().gameplay.rounds).toBe(2);
    expect(JSON.parse(localStorage.getItem('omf2097r.settings')!).gameplay.rounds).toBe(2);
    press('Escape'); // leaves the submenu through its DONE entry
    expect(current()).toBe(root());
    expect(selectedText()).toBe('GAMEPLAY');
  });

  it('ADVANCED OPTIONS edits percentages and applies them on DONE', () => {
    press('ArrowDown', 5);
    press('Enter');
    press('ArrowDown', 7);
    expect(selectedText()).toBe('ADVANCED OPTIONS');
    press('Enter');
    expect(selectedText()).toBe('REHIT MODE OFF');
    press('Enter');
    expect(settings().advanced.rehitMode).toBe(true);
    press('ArrowDown');
    expect(selectedText()).toBe('DEF. THROWS OFF');
    press('Enter');
    expect(settings().advanced.defensiveThrows).toBe(true);
    press('ArrowDown');
    expect(selectedText()).toBe('THROW RANGE 100%');
    press('ArrowRight');
    press('ArrowDown');
    press('ArrowLeft');
    expect(selectedText()).toBe('JUMP HEIGHT 95%');
    press('ArrowDown');
    press('ArrowRight');
    press('ArrowDown');
    press('ArrowRight', 2);
    expect(selectedText()).toBe('VITALITY x 140%');
    expect(settings().advanced.throwRange).toBe(100); // applied on DONE only
    press('ArrowDown');
    expect(selectedText()).toBe('KNOCK DOWN NONE');
    press('ArrowRight', 3);
    expect(selectedText()).toBe('KNOCK DOWN BOTH');
    press('ArrowDown');
    press('ArrowRight', 2);
    expect(selectedText()).toBe('BLOCK DAMAGE 10%');
    press('ArrowDown');
    expect(selectedText()).toBe('DONE');
    press('Enter');
    const a = settings().advanced;
    expect([a.throwRange, a.jumpHeight, a.hitPause, a.vitality, a.blockDamage, a.knockDown]).toEqual([120, 95, 5, 140, 10, 3]);
    press('Escape');
    expect(current()).toBe(root());
    gs.matchSettingsReset();
    expect(gs.matchSettings.vitality).toBe(140);
  });

  it('VIDEO OPTIONS switch graphics mode and remaster options through the app hooks', () => {
    const setMode = vi.spyOn(app, 'setGraphicsMode');
    const changed = vi.spyOn(app, 'settingsChanged');
    const fullscreen = vi.spyOn(app, 'toggleFullscreen');
    press('ArrowDown', 4);
    press('Enter');
    expect(selectedText()).toBe('LANGUAGE');
    press('ArrowDown', 4);
    press('Enter');
    expect(selectedText()).toBe('VISUALS REMASTERED');
    press('ArrowDown');
    expect(selectedText()).toBe('CROSSFADE ON'); // classic-only options are disabled in remastered mode
    press('ArrowUp');
    press('ArrowRight');
    expect(setMode).toHaveBeenCalledWith('classic');
    expect(settings().video.graphics).toBe('classic');
    press('ArrowDown');
    expect(selectedText()).toBe('FILTER SHARP');
    press('ArrowRight', 2);
    expect(settings().video.classicFilter).toBe('crt');
    press('ArrowDown');
    press('Enter');
    expect(settings().video.classicWidescreen).toBe(true);
    press('ArrowDown');
    press('Enter');
    expect(settings().video.crossfade).toBe(false);
    press('ArrowDown');
    press('Enter');
    expect(settings().video.screenShake).toBe(false);
    press('ArrowDown');
    expect(selectedText()).toBe('FULLSCREEN OFF');
    press('Enter');
    expect(fullscreen).toHaveBeenCalledTimes(1);
    expect(settings().video.fullscreen).toBe(true);
    expect(changed).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('omf2097r.settings')!).video.classicFilter).toBe('crt');
    // The remastered options have their own submenu.
    press('ArrowDown');
    expect(selectedText()).toBe('REMASTERED OPTIONS');
    press('Enter');
    expect(selectedText()).toBe('HD ARTWORK ON');
    press('ArrowDown', 2);
    expect(selectedText()).toBe('FONT REMASTERED');
    press('Enter');
    expect(settings().video.hdFont).toBe('smooth');
    press('Enter');
    expect(settings().video.hdFont).toBe('pixel');
    press('ArrowDown');
    expect(selectedText()).toBe('HUD MODERN');
    press('Enter');
    expect(settings().video.hdHud).toBe(false);
    press('ArrowDown', 2);
    expect(selectedText()).toBe('PARTICLES ON');
    press('Enter');
    expect(settings().video.fxParticles).toBe(false);
    press('ArrowDown', 3);
    expect(selectedText()).toBe('ATMOSPHERE ON');
    press('Escape');
    expect(selectedText()).toBe('REMASTERED OPTIONS');
    press('ArrowDown');
    expect(selectedText()).toBe('DONE');
    press('Enter');
    expect(selectedText()).toBe('VIDEO OPTIONS');
  });

  it('AUDIO OPTIONS apply volumes and music quality live', () => {
    const sound = vi.spyOn(audio, 'setSoundVolume');
    const music = vi.spyOn(audio, 'setMusicVolume');
    const quality = vi.spyOn(audio, 'setQuality');
    press('ArrowDown', 4);
    press('Enter');
    press('ArrowDown', 5);
    press('Enter');
    expect(selectedText()).toBe('SOUND ' + '\x7f'.repeat(7) + '|'.repeat(3));
    press('ArrowLeft');
    expect(sound).toHaveBeenLastCalledWith(0.6);
    press('ArrowDown');
    press('ArrowRight');
    expect(music).toHaveBeenLastCalledWith(0.7);
    press('ArrowDown');
    expect(selectedText()).toBe('ENHANCED MUSIC ON');
    press('Enter');
    expect(quality).toHaveBeenLastCalledWith('classic');
    expect(settings().sound).toMatchObject({ soundVol: 6, musicVol: 7, enhancedMusic: false });
  });

  it('PLAYER 2 INPUT presets swap the keyboard layouts', () => {
    press('ArrowDown', 4);
    press('Enter');
    press('ArrowDown', 2);
    press('Enter');
    expect(selectedText()).toBe('RIGHT KEYBOARD');
    press('Enter');
    const k = settings().keys;
    expect(k.p2.jumpUp).toContain('ArrowUp');
    expect(k.p1.jumpUp).toContain('KeyW');
    expect((gs.getPlayer(1).ctrl as KeyboardController).keys).toBe(k.p2);
    press('ArrowDown', 3);
    expect(selectedText()).toBe('DONE'); // no gamepads connected: the joystick entries are disabled
  });

  it('CUSTOM KEYBOARD captures keys through Scene.keyEvent', () => {
    press('ArrowDown', 4);
    press('Enter');
    press('ArrowDown');
    press('Enter');
    press('ArrowDown', 2);
    expect(selectedText()).toBe('CUSTOM KEYBOARD');
    press('Enter');
    const kb = current();
    expect([kb.x, kb.y, kb.w]).toEqual([25, 5, 270]);
    expect(selectedText()).toBe('JUMP UP' + ' '.repeat(12) + ' '.repeat(10) + 'UP');

    // New key for JUMP UP.
    press('Enter');
    expect(current()).toBeInstanceOf(PresskeyMenu);
    scene().keyEvent('KeyI', keyEvent('KeyI')); // too early: the capture waits 20 ticks
    expect(current()).toBeInstanceOf(PresskeyMenu);
    run.advance(300);
    scene().keyEvent('KeyI', keyEvent('KeyI'));
    run.advance(50);
    expect(settings().keys.p1.jumpUp).toEqual(['KeyI']);
    expect(current()).toBe(kb);
    expect(selectedText()).toMatch(/^JUMP UP +I$/);

    // A key bound elsewhere is refused with a warning; ESC cancels.
    press('ArrowDown');
    press('Enter');
    run.advance(300);
    scene().keyEvent('KeyW', keyEvent('KeyW'));
    const pk = current() as PresskeyMenu;
    expect(pk).toBeInstanceOf(PresskeyMenu);
    expect(pk.text[2].text.str).toBe('W bound to P2 jump up.');
    scene().keyEvent('Escape', keyEvent('Escape'));
    run.advance(50);
    expect(current()).toBe(kb);
    expect(settings().keys.p1.jumpRight).toEqual(defaultSettings().keys.p1.jumpRight);

    // Binding ENTER (which also presses menu entries) does not reopen the capture while it is held.
    press('ArrowDown', 7);
    expect(selectedText()).toMatch(/^PUNCH +ENTER$/);
    press('Enter');
    run.advance(300);
    setKeyState('Enter', true);
    scene().keyEvent('Enter', keyEvent('Enter'));
    run.advance(200);
    expect(current()).toBe(kb);
    setKeyState('Enter', false);
    run.advance(60);
    expect(settings().keys.p1.punch).toEqual(['Enter']);

    // The same event delivered twice (engine + scene listener) is handled once.
    press('ArrowDown');
    press('Enter');
    run.advance(300);
    const ev = keyEvent('KeyK');
    scene().keyEvent('KeyK', ev);
    expect(scene().keyEvent('KeyK', ev)).toBe(true);
    expect(settings().keys.p1.kick).toEqual(['KeyK']);

    // ESC selects DONE, a second ESC leaves the linked keyboard menu.
    run.advance(100);
    press('Escape');
    expect(selectedText()).toBe('DONE');
    press('Escape');
    expect(selectedText()).toBe('CUSTOM KEYBOARD');
    expect(settings().keys.ctrlType1).toBe(CtrlType.KEYBOARD);
    expect(JSON.parse(localStorage.getItem('omf2097r.settings')!).keys.p1.jumpUp).toEqual(['KeyI']);
  });

  it('HELP shows the language file pages and turns pages', () => {
    press('ArrowDown', 6);
    expect(selectedText()).toBe('EXTRAS');
    press('ArrowDown');
    expect(selectedText()).toBe('HELP');
    press('Enter');
    const help = current() as HelpMenu;
    expect(help).toBeInstanceOf(HelpMenu);
    expect(help.doc.map((t) => t.str).join('')).toContain('Welcome to One Must Fall 2097');
    press('ArrowDown');
    expect(help.page).toBe(1);
    press('ArrowUp', 2);
    expect(help.page).toBe(0);
    // PAGE DOWN is player 1's DUCK FORWARD key by default, so the reference filters it out...
    scene().keyEvent('PageDown', keyEvent('PageDown'));
    expect(help.page).toBe(0);
    // ...unless it is not bound to player 1.
    settings().keys.p1.duckForward = ['Numpad3'];
    scene().keyEvent('PageDown', keyEvent('PageDown'));
    expect(help.page).toBe(1);
    press('Escape');
    expect(current()).toBe(root());
  });

  it('LANGUAGE lists the usable languages', () => {
    press('ArrowDown', 4);
    press('Enter');
    press('Enter');
    expect(selectedText()).toBe('English');
    press('ArrowDown');
    expect(selectedText()).toBe('DONE');
    press('Enter');
    expect(selectedText()).toBe('LANGUAGE');
  });
});
