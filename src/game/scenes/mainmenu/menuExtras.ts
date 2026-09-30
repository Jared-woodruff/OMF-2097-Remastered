// MAIN MENU > EXTRAS: the remaster's robot workshop, replays and records, and the original's DEMO and SCOREBOARD.
import { app } from '../../../app';
import { Button, Label, Menu } from '../../gui/widgets';
import type { MainMenuScene } from '../mainmenu';
import { menuDone } from './common';
import { mainmenuDemo, mainmenuScoreboard } from './menuMain';

export function menuExtrasCreate(s: MainMenuScene): Menu {
  const menu = new Menu();
  menu.attach(Label.title('EXTRAS'));
  menu.attach(new Button('ROBOT WORKSHOP', 'Build your own robots from the parts of the new robots, try them out and share them ' +
    'as files.', false, false, () => app.showWorkshop()));
  menu.attach(new Button('REPLAYS', 'Watch your saved fights again, slow them down, step through them and save clips.', false, false,
    () => app.showReplays()));
  menu.attach(new Button('RECORDS', 'Your statistics, the best results of the modes, and achievements.', false, false,
    () => app.showRecords()));
  menu.attach(new Button('SCOREBOARD', 'The high scores of the one player game.', false, false, () => mainmenuScoreboard(s)));
  menu.attach(new Button('DEMO', 'Sit back and watch the computer fight the computer.', false, false, () => mainmenuDemo(s)));
  menu.attach(new Button('CREDITS', 'The people and projects behind the remaster, fought out: every credit pilots a robot in ' +
    'its own colors and wins its fight.', false, false, () => app.showCredits()));
  menu.attach(new Button('DONE', 'Go back to the main menu.', false, false, menuDone));
  return menu;
}
