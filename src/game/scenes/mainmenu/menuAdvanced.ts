// Advanced gameplay options (port of the reference mainmenu/menu_advanced.c).
import { KnockDownMode } from '../../constants';
import { Button, Filler, Label, Menu, TextSelector } from '../../gui/widgets';
import { settings, type Settings } from '../../settings';
import type { MainMenuScene } from '../mainmenu';
import { lang, parentMenu, settingsChanged } from './common';

const ON_OFF_OPTS = ['OFF', 'ON'];
const THROW_RANGES = ['0%', '20%', '40%', '60%', '80%', '100%', '120%', '140%', '160%', '180%', '200%', '220%', '240%', '260%', '280%', '300%'];
const JUMP_HEIGHTS = ['80%', '85%', '90%', '95%', '100%', '105%', '110%', '115%', '120%', '125%', '130%'];
const HIT_PAUSES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
const VITALITIES = ['80%', '100%', '120%', '140%', '160%', '180%', '200%', '220%', '240%', '260%', '280%', '300%', '320%', '340%', '360%', '380%', '400%'];
const KNOCK_DOWNS = ['NONE', 'KICKS', 'PUNCHES', 'BOTH'];
const BLOCK_DAMAGES = ['0%', '5%', '10%', '15%', '20%', '25%', '30%', '35%'];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function advanced(): Settings['advanced'] {
  return settings().advanced;
}

export function menuAdvancedCreate(_s: MainMenuScene): Menu {
  const menu = new Menu();
  // menu_advanced_local: the percentage settings are edited as option indices and converted back on DONE.
  const local = {
    throwRange: clamp(Math.trunc(advanced().throwRange / 20), 0, 15),
    jumpHeight: clamp(Math.trunc((advanced().jumpHeight - 80) / 5), 0, 10),
    vitality: clamp(Math.trunc((advanced().vitality - 80) / 20), 0, 16),
    blockDamage: clamp(Math.trunc(advanced().blockDamage / 5), 0, 7),
  };
  const onOff = (title: string, help: string, key: 'rehitMode' | 'defensiveThrows') =>
    new TextSelector(title, help, () => (advanced()[key] ? 1 : 0), (pos) => (advanced()[key] = pos === 1), ON_OFF_OPTS, settingsChanged);
  const localOpt = (title: string, help: string, key: keyof typeof local, opts: string[]) =>
    new TextSelector(title, help, () => local[key], (pos) => (local[key] = pos), opts);

  menu.attach(Label.title('ADVANCED'));
  menu.attach(new Filler());
  menu.attach(onOff('REHIT MODE', lang(276), 'rehitMode'));
  // The reference disables DEF. THROWS, KNOCK DOWN and BLOCK DAMAGE (its fight engine never implemented them); this
  // version implements them after the original game's descriptions (see har.ts).
  menu.attach(onOff('DEF. THROWS', lang(277), 'defensiveThrows'));
  menu.attach(localOpt('THROW RANGE', lang(278), 'throwRange', THROW_RANGES));
  menu.attach(localOpt('JUMP HEIGHT', lang(279), 'jumpHeight', JUMP_HEIGHTS));
  menu.attach(new TextSelector('HIT PAUSE', lang(280), () => advanced().hitPause, (pos) => (advanced().hitPause = pos), HIT_PAUSES, settingsChanged));
  menu.attach(localOpt('VITALITY x', lang(281), 'vitality', VITALITIES));
  menu.attach(new TextSelector('KNOCK DOWN', lang(282), () => advanced().knockDown, (pos) => (advanced().knockDown = pos as KnockDownMode),
    KNOCK_DOWNS, settingsChanged));
  menu.attach(localOpt('BLOCK DAMAGE', lang(283), 'blockDamage', BLOCK_DAMAGES));
  menu.attach(new Button('DONE', 'Go back to the gameplay menu.', false, false, (b) => {
    // menu_advanced_done()
    const a = advanced();
    a.throwRange = local.throwRange * 20;
    a.jumpHeight = local.jumpHeight * 5 + 80;
    a.vitality = local.vitality * 20 + 80;
    a.blockDamage = local.blockDamage * 5;
    parentMenu(b).finished = true;
    settingsChanged();
  }));
  return menu;
}
