// MAIN MENU > EXTRAS (not in the original game): the remaster's modes and screens.
import { app } from '../../../app';
import { SceneId } from '../../constants';
import { Button, Label, Menu } from '../../gui/widgets';
import { ModeRun, type RunKind } from '../../modes/run';
import { settings } from '../../settings';
import type { MainMenuScene } from '../mainmenu';
import { menuDone } from './common';
import { setupPlayerInput } from './menuMain';

/** Starts an arcade, survival or time attack run: player 1 picks a pilot and a robot, then the fights begin. */
function startRun(s: MainMenuScene, kind: RunKind): void {
  const gs = s.gs;
  setupPlayerInput(gs, 0);
  gs.getPlayer(0).score.setDifficulty(settings().gameplay.difficulty);
  gs.getPlayer(1).score.setDifficulty(settings().gameplay.difficulty);
  gs.setupAi(1);
  gs.matchSettingsReset();
  gs.getPlayer(0).pilot.name = '';
  gs.modeRun = new ModeRun(kind);
  gs.modeLabel = gs.modeRun.label;
  gs.setNext(SceneId.MELEE);
}

export function menuMoreCreate(s: MainMenuScene): Menu {
  const menu = new Menu();
  menu.padding = 2;
  menu.attach(Label.title('EXTRAS'));
  menu.attach(new Button('ARCADE', 'Eight fights against the computer, better and better, with Kreissack last. A lost fight is ' +
    'fought again; your score and time are kept.', false, false, () => startRun(s, 'arcade')));
  menu.attach(new Button('SURVIVAL', 'One round against one opponent after the other, with the health you have left (a ' +
    'quarter comes back after each win). How many can you beat?', false, false, () => startRun(s, 'survival')));
  menu.attach(new Button('TIME ATTACK', 'Five one round fights as fast as you can: the clock runs while you fight.', false, false,
    () => startRun(s, 'timeattack')));
  menu.attach(new Button('REPLAYS', 'Watch your saved fights again, slow them down, step through them and save clips.', false, false,
    () => app.showReplays()));
  menu.attach(new Button('RECORDS', 'Your statistics, the best results of the modes, and achievements.', false, false,
    () => app.showRecords()));
  menu.attach(new Button('WORKSHOP', 'Build your own robots from the parts of the new robots, try them out and share them as files.', false,
    false, () => app.showWorkshop()));
  menu.attach(new Button('TOURNAMENTS', 'Make your own tournaments from the installed ones, with the new robots if you like, ' +
    'and play them from TOURNAMENT PLAY.', false, false, () => app.showTournaments()));
  menu.attach(new Button('DONE', 'Go back to the main menu.', false, false, menuDone));
  return menu;
}
