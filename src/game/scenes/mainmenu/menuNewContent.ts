// OPTIONS > NEW CONTENT (not in the original game): the robots and arenas made for the remaster, off until the
// player turns them on.
import { EXTRA_HAR_IDS } from '../../roster';
import { hasFighter } from '../../../resources/resources';
import { Button, Filler, Label, Menu, TextSelector } from '../../gui/widgets';
import { settings } from '../../settings';
import { menuDone, settingsChanged } from './common';

export function menuNewContentCreate(): Menu {
  const g = settings().gameplay;
  const menu = new Menu();
  menu.attach(Label.title('NEW CONTENT'));
  menu.attach(new Filler());
  const robots = new TextSelector('NEW ROBOTS',
    'GLACIER, TEMPEST, HELIX and SPECTRE: four robots built for the remaster, with their own special moves and ' +
    'finishers. They join the robot select screen (move down past the second row) and the computer opponents.',
    () => (g.extraRobots ? 1 : 0), (pos) => (g.extraRobots = pos === 1), ['OFF', 'ON'], settingsChanged);
  // Without their files (an incomplete install) they cannot be turned on.
  if (!EXTRA_HAR_IDS.every(hasFighter)) robots.disabled = true;
  menu.attach(robots);
  menu.attach(new TextSelector('NEW ARENAS',
    'Orbital, Ice Cave, Rooftop and Abyss: four arenas built for the remaster join the arena rotation of two player and ' +
    'one player games.',
    () => (g.extraArenas ? 1 : 0), (pos) => (g.extraArenas = pos === 1), ['OFF', 'ON'], settingsChanged));
  menu.attach(new Button('DONE', 'Go back to the options.', false, false, menuDone));
  return menu;
}
