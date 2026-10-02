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
import { allowedArena, allowedHar, arenaList, arenaName, extraHarIds, modPilotIds, pilotExists, pilotInfo, pilotNameOf } from '../../roster';
import { ensureWorkshopRobot, harIdOf, isWorkshopHar, workshopSpecs } from '../../workshop/registry';
import { WORKSHOP_FIRST_ID } from '../../../gen/workshop';
import type { MainMenuScene } from '../mainmenu';
import { menuDone, settingsChanged } from './common';

/** The original arenas' names as the menus write them (the game's texts say "The Desert"). */
const ORIGINAL_ARENA_NAMES = ['STADIUM', 'DANGER ROOM', 'POWER PLANT', 'FIRE PIT', 'DESERT'];
const PILOTS = PILOT_NAMES.slice(0, 10);

function setPilot(gs: GameState, player: number, pilotId: number, harId: number): void {
  const p = gs.getPlayer(player);
  const info = pilotInfo(pilotId);
  p.pilot.pilotId = pilotId;
  p.pilot.harId = harId;
  p.pilot.power = info.power;
  p.pilot.agility = info.agility;
  p.pilot.endurance = info.endurance;
  p.pilot.name = pilotNameOf(pilotId);
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
  setPilot(gs, 0, pilotExists(t.pilot) ? t.pilot : 0, allowedHar(t.har));
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
  // The remaster's robots only while they are on, the mods' robots, and the workshop's robots (one changed since it was
  // last built is built again when the training starts, see startTraining).
  const workshopIds = workshopSpecs().map((s, slot) => (s ? harIdOf(slot) : -1)).filter((id) => id >= 0);
  const ids = [...HAR_NAMES.slice(0, 11).map((_, i) => i), ...extraHarIds(), ...workshopIds];
  const robots = ids.map((id) => HAR_NAMES[id] ?? '?');
  const keep = (id: number) => (ids.includes(id) ? id : allowedHar(id));
  t.har = keep(t.har);
  t.opponent = keep(t.opponent);
  t.arena = allowedArena(t.arena);
  // (arenas are picked by number, like the robots: the list skips the remaster's when they are off)
  const arenaIds = arenaList();
  const arenas = arenaIds.map((a) => ORIGINAL_ARENA_NAMES[a] ?? arenaName(a).toUpperCase());
  // (pilots by id too: the original ten, then the mods')
  const pilotIds = [...PILOTS.map((_, i) => i), ...modPilotIds()];
  if (!pilotIds.includes(t.pilot)) t.pilot = 0;
  const pilots = pilotIds.map((id) => PILOTS[id] ?? pilotNameOf(id).toUpperCase());
  const menu = new Menu();
  menu.attach(Label.title('TRAINING'));
  menu.attach(new Filler());
  const sel = (title: string, help: string, key: 'har' | 'pilot' | 'opponent' | 'arena' | 'dummy', options: string[]) =>
    menu.attach(new TextSelector(title, help, () => t[key], (v) => (t[key] = v), options, settingsChanged));
  // Robots are picked by id (the list can skip ids).
  const robot = (title: string, help: string, key: 'har' | 'opponent') =>
    menu.attach(new TextSelector(title, help, () => Math.max(0, ids.indexOf(t[key])), (v) => (t[key] = ids[v] ?? 0), robots, settingsChanged));
  robot('ROBOT', 'The robot you practice with (robots built in the workshop too).', 'har');
  menu.attach(new TextSelector('PILOT', 'Your pilot. Pilots differ in power, agility and endurance.', () => Math.max(0, pilotIds.indexOf(t.pilot)),
    (v) => (t.pilot = pilotIds[v] ?? 0), pilots, settingsChanged));
  robot('OPPONENT', 'The robot of the training dummy.', 'opponent');
  menu.attach(new TextSelector('ARENA', 'Where to train. Hazards follow the GAMEPLAY setting.', () => Math.max(0, arenaIds.indexOf(t.arena)),
    (v) => (t.arena = arenaIds[v] ?? 0), arenas, settingsChanged));
  sel('DUMMY', 'What the dummy does: stand, crouch, jump, block high or low attacks, or fight back like the computer. ' +
    'It can also be changed from the pause menu.', 'dummy', DUMMY_MODE_NAMES);
  menu.attach(new Button('START', 'Practice moves and combos: nobody gets knocked out and health refills after every combo.',
    false, false, () => {
      startTraining(s.gs);
      // (back to MORE MODES afterwards)
      s.gs.menuReturn = 'modes';
    }));
  menu.attach(new Button('DONE', 'Go back to the other modes.', false, false, menuDone));
  return menu;
}
