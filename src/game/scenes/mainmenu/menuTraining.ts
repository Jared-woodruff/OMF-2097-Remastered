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
import { allowedArena, allowedHar, arenaCount, EXTRA_HAR_IDS, extraRobotsEnabled } from '../../roster';
import { ensureWorkshopRobot, isWorkshopHar, readyWorkshopHars } from '../../workshop/registry';
import { WORKSHOP_FIRST_ID } from '../../../gen/workshop';
import { GEN_ARENAS } from '../../../gen/scene/arenas';
import type { MainMenuScene } from '../mainmenu';
import { menuDone, settingsChanged } from './common';

const ARENA_NAMES = ['STADIUM', 'DANGER ROOM', 'POWER PLANT', 'FIRE PIT', 'DESERT', ...GEN_ARENAS.map((a) => a.name)];
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
  // A workshop robot is built first (the game may not have built it yet).
  for (const id of [t.har, t.opponent]) if (isWorkshopHar(id)) ensureWorkshopRobot(id - WORKSHOP_FIRST_ID);
  const k = settings().keys;
  if (k.ctrlType1 === CtrlType.GAMEPAD && k.gamepad1 >= 0) gs.setupGamepad(0, k.gamepad1);
  else gs.setupKeyboard(0, 0);
  gs.matchSettingsReset();
  gs.matchSettings.rounds = 0;
  setPilot(gs, 0, t.pilot, allowedHar(t.har));
  // The dummy gets another pilot's colors, so a mirror match is still easy to tell apart.
  setPilot(gs, 1, (t.pilot + 5) % 10, allowedHar(t.opponent));
  // Playing back a recording needs one (else the dummy stands).
  if (t.dummy === DummyMode.PLAYBACK && !t.tape?.frames?.length) t.dummy = DummyMode.STAND;
  if (t.dummy === DummyMode.CPU) gs.setupAi(1);
  else gs.getPlayer(1).setCtrl(new DummyController(gs, t.dummy as DummyMode));
  gs.training = true;
  gs.arena = allowedArena(t.arena);
  gs.setNext(SceneId.ARENA0 + gs.arena);
}

export function menuTrainingCreate(s: MainMenuScene): Menu {
  const t = settings().training;
  // The remaster's robots only while they are on, and the workshop's robots once built.
  const ids = [...HAR_NAMES.slice(0, 11).map((_, i) => i), ...(extraRobotsEnabled() ? EXTRA_HAR_IDS : []), ...readyWorkshopHars()];
  const robots = ids.map((id) => HAR_NAMES[id] ?? '?');
  t.har = allowedHar(t.har);
  t.opponent = allowedHar(t.opponent);
  t.arena = allowedArena(t.arena);
  const arenas = ARENA_NAMES.slice(0, arenaCount());
  const menu = new Menu();
  menu.attach(Label.title('TRAINING'));
  menu.attach(new Filler());
  const sel = (title: string, help: string, key: 'har' | 'pilot' | 'opponent' | 'arena' | 'dummy', options: string[]) =>
    menu.attach(new TextSelector(title, help, () => t[key], (v) => (t[key] = v), options, settingsChanged));
  // Robots are picked by id (the list can skip ids).
  const robot = (title: string, help: string, key: 'har' | 'opponent') =>
    menu.attach(new TextSelector(title, help, () => Math.max(0, ids.indexOf(t[key])), (v) => (t[key] = ids[v] ?? 0), robots, settingsChanged));
  robot('ROBOT', 'The robot you practice with (robots built in the workshop too).', 'har');
  sel('PILOT', 'Your pilot. Pilots differ in power, agility and endurance.', 'pilot', PILOTS);
  robot('OPPONENT', 'The robot of the training dummy.', 'opponent');
  sel('ARENA', 'Where to train. Hazards follow the GAMEPLAY setting.', 'arena', arenas);
  sel('DUMMY', 'What the dummy does: stand, crouch, jump, block high or low attacks, or fight back like the computer. ' +
    'It can also be changed from the pause menu.', 'dummy', DUMMY_MODE_NAMES);
  menu.attach(new Button('START', 'Practice moves and combos: nobody gets knocked out and health refills after every combo.',
    false, false, () => startTraining(s.gs)));
  menu.attach(new Button('DONE', 'Go back to the main menu.', false, false, menuDone));
  return menu;
}
