// In-fight pause menu (ESC).
import { app } from '../../app';
import { audio } from '../../audio/audio';
import { langGet } from '../../resources/resources';
import { ACT_ESC, CtrlType } from '../constants';
import type { GameState } from '../gameState';
import { saveSettings, settings } from '../settings';
import { DUMMY_MODE_NAMES, type DummyMode } from '../../controller/dummy';
import { Button, Filler, GuiFrame, Label, Menu, TextSelector, TextSlider, type GuiTheme } from './widgets';
import { FontSize } from './text';
import { moveListMenu, type MoveListSource } from './moveList';

export interface PauseHost extends Partial<MoveListSource> {
  quitFight(): void;
  menuVisible: boolean;
  /** Training mode: the dummy's behavior, the input display and a position reset are offered too. */
  readonly training?: boolean;
  trainingDummy?(): DummyMode;
  setTrainingDummy?(mode: DummyMode): void;
  resetTrainingPositions?(): void;
}

/** Where the pause menu goes (training has more entries). */
export function pauseFrame(training: boolean): { x: number; y: number; w: number; h: number } {
  return { x: 60, y: 5, w: 181, h: training ? 137 : 127 };
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
    const f = pauseFrame(!!host.training);
    this.frame = new GuiFrame(theme, f.x, f.y, f.w, f.h);
    const s = settings();
    const m = new Menu();
    m.attach(Label.title('OMF 2097'));
    // Training has ten entries: rows one pixel closer and no spacer under the title.
    if (host.training) m.padding = 2;
    else m.attach(new Filler());
    this.returnButton = new Button('RETURN TO GAME', 'Continue fighting.', false, false, () => this.close());
    m.attach(this.returnButton);
    const robot = host.robot?.bind(host);
    if (robot) {
      m.attach(new Button('MOVE LIST', 'The special moves, throws and finishing moves of both robots.', false, false,
        () => m.setSubmenu(moveListMenu({ robot }, 0))));
    }
    m.attach(new Button('CONTROLS', 'The keys and controller buttons of both players, and the layout choices.', false, false,
      () => app.showControls()));
    if (host.training) {
      m.attach(new TextSelector('DUMMY', 'What the training dummy does: stand, crouch, jump, block high or low attacks, or fight back.',
        () => host.trainingDummy?.() ?? 0, (v) => host.setTrainingDummy?.(v as DummyMode), DUMMY_MODE_NAMES, (v) => {
          settings().training.dummy = v;
        }));
      m.attach(new TextSelector('INPUTS', 'Show your recent inputs at the left of the screen, with how long each was held (in game ticks).',
        () => (settings().training.inputDisplay ? 1 : 0), (v) => (settings().training.inputDisplay = v === 1), ['OFF', 'ON']));
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

  /** ESC while a page of the menu (the move list) is open goes back to the menu; returns false otherwise. */
  back(): boolean {
    if (!this.menu.activeSubmenu()) return false;
    this.frame.action(ACT_ESC, CtrlType.KEYBOARD);
    return true;
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
