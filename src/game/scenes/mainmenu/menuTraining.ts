// Training mode setup (not in the original game; it takes the place of the NETWORK PLAY entry, which this version
// cannot offer). Player 1 practices against a dummy that stands, crouches, jumps, blocks or fights back, with health
// refilling and no knockouts.
import { DummyController, DUMMY_MODE_NAMES, DummyMode } from '../../../controller/dummy';
import { langGet } from '../../../resources/resources';
import { CtrlType, HAR_NAMES, PILOT_INFO, PILOT_NAMES, SceneId } from '../../constants';
import type { GameState } from '../../gameState';
import { Button, Filler, Label, Menu, TextSelector } from '../../gui/widgets';
import { setPilotColors } from '../../pilotColors';
import { settings } from '../../settings';
import type { MainMenuScene } from '../mainmenu';
import { menuDone, settingsChanged } from './common';

const ARENA_NAMES = ['STADIUM', 'DANGER ROOM', 'POWER PLANT', 'FIRE PIT', 'DESERT'];
const PILOTS = PILOT_NAMES.slice(0, 10);

function setPilot(gs: GameState, player: number, pilotId: number, harId: number): void {
  const p = gs.getPlayer(player);
  const info = PILOT_INFO[pilotId];
  p.pilot.pilotId = pilotId;
  p.pilot.harId = harId;
  p.pilot.power = info.power;
  p.pilot.agility = info.agility;
  p.pilot.endurance = info.endurance;
  p.pilot.name = langGet(20 + pilotId);
  p.pilot.photo = null;
  setPilotColors(p.pilot, info.color1, info.color2, info.color3);
  p.score.reset(true);
}

/** Sets up the players and goes straight to the arena. */
export function startTraining(gs: GameState): void {
  const t = settings().training;
  const k = settings().keys;
  if (k.ctrlType1 === CtrlType.GAMEPAD && k.gamepad1 >= 0) gs.setupGamepad(0, k.gamepad1);
  else gs.setupKeyboard(0, 0);
  gs.matchSettingsReset();
  gs.matchSettings.rounds = 0;
  setPilot(gs, 0, t.pilot, t.har);
  // The dummy gets another pilot's colors, so a mirror match is still easy to tell apart.
  setPilot(gs, 1, (t.pilot + 5) % 10, t.opponent);
  if (t.dummy === DummyMode.CPU) gs.setupAi(1);
  else gs.getPlayer(1).setCtrl(new DummyController(gs, t.dummy as DummyMode));
  gs.training = true;
  gs.arena = t.arena;
  gs.setNext(SceneId.ARENA0 + t.arena);
}

export function menuTrainingCreate(s: MainMenuScene): Menu {
  const t = settings().training;
  const menu = new Menu();
  menu.attach(Label.title('TRAINING'));
  menu.attach(new Filler());
  const sel = (title: string, help: string, key: keyof typeof t, options: string[]) =>
    menu.attach(new TextSelector(title, help, () => t[key], (v) => (t[key] = v), options, settingsChanged));
  sel('ROBOT', 'The robot you practice with.', 'har', HAR_NAMES);
  sel('PILOT', 'Your pilot. Pilots differ in power, agility and endurance.', 'pilot', PILOTS);
  sel('OPPONENT', 'The robot of the training dummy.', 'opponent', HAR_NAMES);
  sel('ARENA', 'Where to train. Hazards follow the GAMEPLAY setting.', 'arena', ARENA_NAMES);
  sel('DUMMY', 'What the dummy does: stand, crouch, jump, block high or low attacks, or fight back like the computer. ' +
    'It can also be changed from the pause menu.', 'dummy', DUMMY_MODE_NAMES);
  menu.attach(new Button('START', 'Practice moves and combos: nobody gets knocked out and health refills after every combo.',
    false, false, () => startTraining(s.gs)));
  menu.attach(new Button('DONE', 'Go back to the main menu.', false, false, menuDone));
  return menu;
}
