// MAIN MENU > EXTRAS: the remaster's robot workshop, mods, replays and records, and the original's DEMO and SCOREBOARD.
import { app } from '../../../app';
import { openStudio } from '../../../platform/desktop';
import { Button, Label, Menu } from '../../gui/widgets';
import type { MainMenuScene } from '../mainmenu';
import { menuDone } from './common';
import { mainmenuDemo, mainmenuScoreboard } from './menuMain';

export function menuExtrasCreate(s: MainMenuScene): Menu {
  const menu = new Menu();
  menu.attach(Label.title('EXTRAS'));
  menu.attach(new Button('ROBOT WORKSHOP', 'Build your own robots from the parts of the new robots, try them out and share them ' +
    'as files.', false, false, () => app.showWorkshop()));
  menu.attach(new Button('MODS', 'More robots, arenas and pilots: the new robots and arenas made for the remaster, and mods made ' +
    'by players with OMF Studio. Turn them on or off, install mod files.', false, false, () => app.showMods()));
  menu.attach(new Button('OMF STUDIO', 'The mod tools: make your own robots, arenas and pilots, pixel for pixel, and play them in ' +
    'the game.', false, false, () => void openStudio()));
  menu.attach(new Button('REPLAYS', 'Watch your saved fights again, slow them down, step through them and save clips.', false, false,
    () => app.showReplays()));
  menu.attach(new Button('RECORDS', 'Your statistics, the best results of the modes, and achievements.', false, false,
    () => app.showRecords()));
  // (both come back to this menu)
  menu.attach(new Button('SCOREBOARD', 'The high scores of the one player game.', false, false, () => {
    s.gs.menuReturn = 'extras';
    mainmenuScoreboard(s);
  }));
  menu.attach(new Button('DEMO', 'Sit back and watch the computer fight the computer.', false, false, () => {
    s.gs.menuReturn = 'extras';
    mainmenuDemo(s);
  }));
  menu.attach(new Button('CREDITS', 'The people and projects behind the remaster, fought out: every credit pilots a robot in ' +
    'its own colors and wins its fight.', false, false, () => app.showCredits()));
  menu.attach(new Button('DONE', 'Go back to the main menu.', false, false, menuDone));
  return menu;
}
