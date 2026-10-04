// In-fight pause menu (ESC).
import { app } from '../../app';
import { audio } from '../../audio/audio';
import { langGet } from '../../resources/resources';
import { ACT_ESC, CtrlType } from '../constants';
import { connectedPads, isDown, readPad } from '../../controller/input';
import type { GameState } from '../gameState';
import { saveSettings, settings } from '../settings';
import { DUMMY_MODE_NAMES, type DummyMode } from '../../controller/dummy';
import type { TrainingLab } from '../training/session';
import { trialDone } from '../training/trials';
import { Button, Filler, GuiFrame, Label, Menu, TextSelector, TextSlider, type GuiTheme } from './widgets';
import { FontSize, GLYPH_SHADOW_BOTTOM, GLYPH_SHADOW_RIGHT, Text } from './text';
import { moveListMenu, type MoveListSource } from './moveList';

export interface PauseHost extends Partial<MoveListSource> {
  quitFight(): void;
  menuVisible: boolean;
  /** Training mode: the training lab (the dummy, reversals, recording, frame data...) and a position reset are offered too. */
  readonly training?: boolean;
  readonly lab?: TrainingLab | null;
  trainingDummy?(): DummyMode;
  setTrainingDummy?(mode: DummyMode): void;
  resetTrainingPositions?(): void;
}

/** Keys that close the menu and also fight (ENTER: player 1's punch in the classic layout). */
const RELEASE_KEYS = ['Enter', 'NumpadEnter', 'Escape', 'Space'];

/** Where the pause menu goes (training has more entries). */
export function pauseFrame(training: boolean): { x: number; y: number; w: number; h: number } {
  return { x: 60, y: 5, w: 181, h: training ? 137 : 127 };
}

/** The trials of the COMBO TRIALS page, in two columns (the one picked highlighted). */
class TrialListView extends Filler {
  private texts = new Map<string, Text>();

  constructor(private names: string[], private picked: () => number) {
    super();
  }

  private text(s: string, color: number): Text {
    const k = `${s}|${color}`;
    let t = this.texts.get(k);
    if (!t) {
      t = new Text(FontSize.SMALL, 0xffff, 0xffff, s).setColor(color).setShadowColor(0xc0)
        .setShadow(GLYPH_SHADOW_RIGHT | GLYPH_SHADOW_BOTTOM).setWordWrap(false);
      this.texts.set(k, t);
    }
    return t;
  }

  override render(): void {
    // One column when it fits (titles can be long), else two.
    const rowH = 8;
    const rows = this.names.length * rowH <= this.h - 4 ? this.names.length : Math.ceil(this.names.length / 2);
    const colW = Math.trunc(this.w / 2);
    this.names.forEach((n, i) => {
      const col = i < rows ? 0 : 1;
      const row = i < rows ? i : i - rows;
      const color = i === this.picked() ? this.theme.activeColor : this.theme.primaryColor;
      this.text(n, color).draw(this.x + 12 + col * colW, this.y + 2 + row * rowH);
    });
  }
}

export class ArenaPauseMenu {
  private frame: GuiFrame;
  private menu: Menu;
  private returnButton: Button;
  /** Closed, the fight waiting for the closing key to be let go (see tryResume). */
  private resuming = false;

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
      m.attach(new Button('TRAINING LAB', 'The dummy and its reversal, recording the dummy, frame data, hitboxes and the input display.',
        false, false, () => m.setSubmenu(this.labMenu())));
      m.attach(new Button('RESET POSITIONS', 'Put both robots back at their starting positions with full health (F4).', false, false, () => {
        host.resetTrainingPositions?.();
        host.lab?.meter.reset();
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
    this.resuming = false;
    this.menu.select(this.returnButton);
  }

  /** TRAINING LAB: the dummy and the lab's views. */
  private labMenu(): Menu {
    const host = this.host;
    const lab = host.lab!;
    const t = settings().training;
    const onOff = ['OFF', 'ON'];
    const m = new Menu();
    m.padding = 2;
    m.attach(Label.title('TRAINING LAB'));
    m.attach(new TextSelector('DUMMY', 'What the dummy does: stand, crouch, jump, block high or low attacks, fight back, or play ' +
      'your recording over and over.', () => host.trainingDummy?.() ?? 0, (v) => host.setTrainingDummy?.(v as DummyMode),
    DUMMY_MODE_NAMES, (v) => (t.dummy = v)));
    m.attach(new TextSelector('REVERSAL', 'What the dummy does the moment it can act again after a hit, a block or a knockdown: ' +
      'jump, play your recording, or a special move or throw.', () => lab.reversalIndex(), (v) => lab.setReversalIndex(v),
    lab.reversalChoices().map((c) => c.label)));
    m.attach(new Button(lab.recording ? 'STOP RECORDING' : 'RECORD DUMMY', 'Control the dummy yourself and record what it ' +
      'should do, up to 25 seconds (F5; F5 or pause stops). The dummy then plays it over and over.', false, false, () => {
      this.closeAll();
      lab.toggleRecording();
    }));
    m.attach(new Button('PLAY RECORDING', 'The dummy plays your recording once (F6).', !lab.hasTape, false, () => {
      this.closeAll();
      lab.playTape();
    }));
    m.attach(new TextSelector('FRAME DATA', 'The frame meter, and the startup, active and recovery frames of your last move with ' +
      'the advantage after it hit or was blocked (F8).', () => (t.frameData ? 1 : 0), (v) => (t.frameData = v === 1), onOff));
    m.attach(new TextSelector('HITBOXES', 'Outline what can be hit and mark the hit points of attacks (F9): a hit lands where a ' +
      'hit point touches the other robot.', () => (t.hitboxes ? 1 : 0), (v) => (t.hitboxes = v === 1), onOff));
    m.attach(new TextSelector('INPUTS', 'Show your recent inputs at the left of the screen, with how long each was held (in game ticks).',
      () => (t.inputDisplay ? 1 : 0), (v) => (t.inputDisplay = v === 1), onOff));
    m.attach(new Button('COMBO TRIALS', 'Learn your robot: its special moves, then combos to land on the dummy.', false, false,
      () => m.setSubmenu(this.trialMenu())));
    m.attach(new Button('DONE', 'Go back to the pause menu.', false, false, (b) => ((b.parent as Menu).finished = true)));
    return m;
  }

  /** COMBO TRIALS: pick a trial, start it or watch its demo. */
  private trialMenu(): Menu {
    const lab = this.host.lab!;
    const trials = lab.trials();
    const har = lab.trialHar();
    let pick = lab.trial ? lab.trial.index : Math.max(0, trials.findIndex((_, i) => !trialDone(har, i)));
    const m = new Menu();
    m.padding = 2;
    m.attach(Label.title('COMBO TRIALS'));
    m.attach(new TrialListView(trials.map((tr, i) => `${i + 1}  ${tr.title}${trialDone(har, i) ? '  *' : ''}`), () => pick));
    const names = trials.map((tr, i) => `${i + 1} ${tr.title}${trialDone(har, i) ? ' *' : ''}`);
    m.attach(new TextSelector('TRIAL', 'Choose a trial (a star marks the ones you have done): special moves first, then combos.',
      () => pick, (v) => (pick = v), names.length ? names : ['NONE']));
    m.attach(new Button('START', 'Land the moves on the dummy in one combo. F4 starts over, F6 shows how.', !trials.length, false, () => {
      this.closeAll();
      lab.startTrial(pick);
    }));
    m.attach(new Button('WATCH DEMO', 'Your robot does the trial by itself first.', !trials.length, false, () => {
      this.closeAll();
      lab.startTrial(pick, true);
    }));
    m.attach(new Button('STOP TRIALS', 'Back to free training.', !lab.trial, false, () => {
      this.closeAll();
      lab.stopTrials();
    }));
    m.attach(new Button('DONE', 'Go back.', false, false, (b) => ((b.parent as Menu).finished = true)));
    return m;
  }

  /** Leaves the pause menu (and its pages) and resumes the fight. */
  private closeAll(): void {
    for (let sub = this.menu.activeSubmenu(); sub; sub = sub.activeSubmenu()) sub.finished = true;
    this.close();
  }

  /** ESC while a page of the menu (the move list) is open goes back to the menu; returns false otherwise. */
  back(): boolean {
    if (!this.menu.activeSubmenu()) return false;
    this.frame.action(ACT_ESC, CtrlType.KEYBOARD);
    return true;
  }

  close(): void {
    this.host.menuVisible = false;
    this.resuming = true;
    saveSettings();
    this.tryResume();
  }

  /**
   * The fight goes on once the key or button that closed the menu is let go: ENTER is player 1's punch on the
   * keyboard, A a kick on a pad (the robot would strike at once).
   */
  private tryResume(): void {
    if (!this.resuming) return;
    if (RELEASE_KEYS.some((k) => isDown(k))) return;
    for (const i of connectedPads()) {
      const p = readPad(i);
      if (p && (p.a || p.b || p.x || p.y || p.start || p.back)) return;
    }
    this.resuming = false;
    this.gs.paused = false;
  }

  tick(): void {
    this.tryResume();
    this.frame.tick();
  }

  render(): void {
    this.frame.render();
  }

  action(action: number): void {
    this.frame.action(action, CtrlType.KEYBOARD);
  }
}
