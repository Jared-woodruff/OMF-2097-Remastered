// Gameplay options (port of the reference mainmenu/menu_gameplay.c).
import { AI_DIFFICULTY_NAMES, ROUND_TYPE_NAMES } from '../../constants';
import { Button, Filler, Label, Menu, TextSelector, TextSlider } from '../../gui/widgets';
import { settings, type Settings } from '../../settings';
import type { MainMenuScene } from '../mainmenu';
import { menuDone, parentMenu, settingsChanged } from './common';
import { menuAdvancedCreate } from './menuAdvanced';

function gameplay(): Settings['gameplay'] {
  return settings().gameplay;
}

export function menuGameplayCreate(s: MainMenuScene): Menu {
  const menu = new Menu();
  menu.attach(Label.title('GAMEPLAY'));
  menu.attach(new Filler());
  menu.attach(new TextSlider('SPEED', 'Change the overall speed of the game. Press left and right to change.', 10, false,
    () => gameplay().speed, (pos) => (gameplay().speed = pos), (pos) => {
      // menu_gameplay_speed_slide
      s.gs.setSpeed(pos + 5);
      settingsChanged();
    }));
  menu.attach(new TextSelector('FIGHT MODE',
    'Fight mode can be either normal or hyper. Hyper mode will enhance your special moves. Check the robot description ' +
    'section of help for more information.',
    () => gameplay().fightMode, (pos) => (gameplay().fightMode = pos), ['NORMAL', 'HYPER'], settingsChanged));
  menu.attach(new TextSlider('POWER 1',
    "Change the power of player 1's hits and throws. This setting will take effect only in two player games. Press " +
    'left and right to change.',
    7, false, () => gameplay().power1, (pos) => (gameplay().power1 = pos), settingsChanged));
  // The reference repeats player 1's help text here; this is the original game's text (ENGLISH.DAT string 300).
  menu.attach(new TextSlider('POWER 2',
    "Change the power of player 2's hits and throws. This setting will take effect only in two player games. Press " +
    'left and right to change.',
    7, false, () => gameplay().power2, (pos) => (gameplay().power2 = pos), settingsChanged));
  menu.attach(new TextSelector('HAZARDS',
    'Some arenas have dangerous environments: spikes, electricity, fighter planes, and the like. This option turns them ' +
    'on and off.',
    () => (gameplay().hazards ? 1 : 0), (pos) => (gameplay().hazards = pos === 1), ['OFF', 'ON'], settingsChanged));
  menu.attach(new TextSelector('CPU:',
    'This determines how well the computer fights in a one player game. This has no effect on two player games. Press ' +
    'left and right to change.',
    () => gameplay().difficulty, (pos) => (gameplay().difficulty = pos), AI_DIFFICULTY_NAMES, settingsChanged));
  menu.attach(new TextSelector('',
    'This will set matches so they are one round, best two out of three rounds, or best three out of five rounds.',
    () => gameplay().rounds, (pos) => (gameplay().rounds = pos), ROUND_TYPE_NAMES, settingsChanged));
  menu.attach(new Button('ADVANCED OPTIONS', 'Do I really have to tell you what this is?', false, false,
    (b) => parentMenu(b).setSubmenu(menuAdvancedCreate(s))));
  menu.attach(new Button('DONE', 'Go back to the main menu.', false, false, menuDone));
  return menu;
}
