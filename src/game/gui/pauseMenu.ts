// In-fight pause menu (ESC).
import { app } from '../../app';
import { audio } from '../../audio/audio';
import { langGet } from '../../resources/resources';
import { CtrlType } from '../constants';
import type { GameState } from '../gameState';
import { saveSettings, settings } from '../settings';
import { DUMMY_MODE_NAMES, type DummyMode } from '../../controller/dummy';
import { Button, Filler, GuiFrame, Label, Menu, TextSelector, TextSlider, type GuiTheme } from './widgets';
import { FontSize } from './text';

export interface PauseHost {
  quitFight(): void;
  menuVisible: boolean;
  /** Training mode: the dummy's behavior and a position reset are offered too. */
  readonly training?: boolean;
  trainingDummy?(): DummyMode;
  setTrainingDummy?(mode: DummyMode): void;
  resetTrainingPositions?(): void;
}

export class ArenaPauseMenu {
  private frame: GuiFrame;
  private menu: Menu;
  private returnButton: Button;

  constructor(private gs: GameState, private host: PauseHost) {
    const theme: GuiTheme = {
      borderColor: 0xfe, font: FontSize.BIG, primaryColor: 0xfe, secondaryColor: 0xfd, activeColor: 0xff,
      inactiveColor: 0xfe, disabledColor: 0xc0, shadowColor: 0xc0,
    };
    this.frame = new GuiFrame(theme, 60, 5, 181, 127);
    const s = settings();
    const m = new Menu();
    m.attach(Label.title('OMF 2097'));
    m.attach(new Filler());
    this.returnButton = new Button('RETURN TO GAME', 'Continue fighting.', false, false, () => this.close());
    m.attach(this.returnButton);
    if (host.training) {
      m.attach(new TextSelector('DUMMY', 'What the training dummy does: stand, crouch, jump, block high or low attacks, or fight back.',
        () => host.trainingDummy?.() ?? 0, (v) => host.setTrainingDummy?.(v as DummyMode), DUMMY_MODE_NAMES, (v) => {
          settings().training.dummy = v;
        }));
      m.attach(new Button('RESET POSITIONS', 'Put both robots back at their starting positions with full health.', false, false, () => {
        host.resetTrainingPositions?.();
        this.close();
      }));
    }
    m.attach(new TextSlider('SOUND', 'Raise or lower the volume of all sound effects. Press left or right to change.', 10, true,
      () => s.sound.soundVol, (v) => (s.sound.soundVol = v), (v) => audio.setSoundVolume(v / 10)));
    m.attach(new TextSlider('MUSIC', 'Raise or lower the volume of music. Press right or left to change.', 10, true,
      () => s.sound.musicVol, (v) => (s.sound.musicVol = v), (v) => audio.setMusicVolume(v / 10)));
    m.attach(new TextSlider('SPEED', 'Change the speed of the game when in the arena. Press left or right to change.', 10, false,
      () => s.gameplay.speed, (v) => (s.gameplay.speed = v), (v) => gs.setSpeed(v + 5)));
    m.attach(new TextSelector('GRAPHICS', 'Switch between the original pixel graphics and the remastered HD renderer (F2).',
      () => (s.video.graphics === 'classic' ? 0 : 1), (v) => (s.video.graphics = v === 0 ? 'classic' : 'remastered'),
      ['CLASSIC', 'REMASTERED'], (v) => app.setGraphicsMode(v === 0 ? 'classic' : 'remastered')));
    const quitLabel = host.training ? 'EXIT TRAINING' : gs.isTournament() && !gs.matchSettings.sim ? 'FORFEIT' : 'QUIT';
    const quitHelp = host.training ? 'Go back to the main menu.' : langGet(gs.isTournament() ? 323 : 322);
    m.attach(new Button(quitLabel, quitHelp, false, false, () => {
      this.close();
      host.quitFight();
    }));
    this.menu = m;
    this.frame.setRoot(m);
    this.frame.layout();
    m.select(this.returnButton);
  }

  open(): void {
    this.menu.select(this.returnButton);
  }

  close(): void {
    this.host.menuVisible = false;
    this.gs.paused = false;
    saveSettings();
  }

  tick(): void {
    this.frame.tick();
  }

  render(): void {
    this.frame.render();
  }

  action(action: number): void {
    this.frame.action(action, CtrlType.KEYBOARD);
  }
}
