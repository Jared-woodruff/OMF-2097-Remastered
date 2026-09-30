// Layout audit of the menus: every entry fits its frame without overlapping the next one, and help texts fit their
// box (the text engine silently drops lines that do not fit).
import { describe, expect, it } from 'vitest';
import { SceneId } from '../game/constants';
import { ArenaPauseMenu, pauseFrame, type PauseHost } from '../game/gui/pauseMenu';
import { moveListMenu } from '../game/gui/moveList';
import { langGet, loadAf } from '../resources/resources';
import { FontSize, Text } from '../game/gui/text';
import { Button, Component, Label, mainMenuTheme, Menu, TextSelector, TextSlider, type GuiTheme } from '../game/gui/widgets';
import type { MainMenuScene } from '../game/scenes/mainmenu';
import { menuAdvancedCreate } from '../game/scenes/mainmenu/menuAdvanced';
import { menuControlsCreate } from '../game/scenes/mainmenu/menuControls';
import { menuExtrasCreate } from '../game/scenes/mainmenu/menuExtras';
import { menuGameplayCreate } from '../game/scenes/mainmenu/menuGameplay';
import { menuClassicStyleCreate, menuEffectsCreate, menuGraphicsCreate, menuRemasteredCreate } from '../game/scenes/mainmenu/menuGraphics';
import { menuInputCreate } from '../game/scenes/mainmenu/menuInput';
import { KEYBOARD_FRAME, menuKeyboardCreate } from '../game/scenes/mainmenu/menuKeyboard';
import { menuLanguageCreate } from '../game/scenes/mainmenu/menuLanguage';
import { menuMainCreate } from '../game/scenes/mainmenu/menuMain';
import { menuModesCreate } from '../game/scenes/mainmenu/menuModes';
import { menuNewContentCreate } from '../game/scenes/mainmenu/menuNewContent';
import { menuOptionsCreate } from '../game/scenes/mainmenu/menuOptions';
import { menuSoundCreate } from '../game/scenes/mainmenu/menuSound';
import { menuTrainingCreate } from '../game/scenes/mainmenu/menuTraining';
import { createGame, hasGameData } from './harness';

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}
const MAIN_FRAME: Frame = { x: 165, y: 5, w: 151, h: 119 };

function labelOf(c: Component): Text | null {
  if (c instanceof Button || c instanceof Label || c instanceof TextSelector || c instanceof TextSlider) return c.text;
  return null;
}

/** All texts an entry can show (every option of a selector). */
function variants(c: Component): string[] {
  if (c instanceof TextSelector) {
    const pos = c.getPos();
    const out: string[] = [];
    for (let i = 0; i < Math.max(1, c.options.length); i++) {
      c.getPos = () => i;
      c.refresh();
      out.push(c.text.str);
    }
    c.getPos = () => pos;
    c.refresh();
    return out;
  }
  const t = labelOf(c);
  return t ? [t.str] : [];
}

function audit(name: string, menu: Menu, frame: Frame, theme: GuiTheme): string[] {
  const issues: string[] = [];
  menu.init(theme);
  menu.layout(frame.x, frame.y, frame.w, frame.h);
  let prevBottom = -Infinity;
  let prevName = '';
  for (const c of menu.items) {
    const t = labelOf(c);
    if (!t) continue;
    const texts = variants(c);
    const label = texts[0].replace(/\n/g, ' ');
    const probe = new Text(t.font, 0xffff, 0xffff);
    let height = 0;
    for (const s of texts) {
      probe.set(s);
      if (probe.width() > frame.w) issues.push(`${name}: "${s.replace(/\n/g, ' ')}" is ${probe.width()} px wide (frame ${frame.w})`);
      height = Math.max(height, probe.height());
    }
    // Entries are drawn centered in their slot: where the text really is.
    const top = c.y + Math.max(0, (c.h - height) >> 1);
    if (top < prevBottom) issues.push(`${name}: "${label}" overlaps "${prevName}"`);
    if (top + height > frame.y + frame.h) issues.push(`${name}: "${label}" ends below the frame`);
    prevBottom = top + height;
    prevName = label;
    if (c.help) {
      const help = new Text(FontSize.SMALL, menu.helpW, 0xffff, c.help.str);
      if (help.height() > menu.helpBoxH()) issues.push(`${name}: help of "${label}" needs ${help.height()} px (box ${menu.helpBoxH()}): "${c.help.str}"`);
    }
  }
  return issues;
}

describe.skipIf(!hasGameData)('menu layout', () => {
  it('main menu and all its submenus fit their frames', () => {
    const gs = createGame(SceneId.MENU);
    const s = gs.sc as MainMenuScene;
    const theme = mainMenuTheme();
    const menus: [string, Menu, Frame][] = [
      ['MAIN', menuMainCreate(s), MAIN_FRAME],
      ['MORE MODES', menuModesCreate(s), MAIN_FRAME],
      ['TRAINING', menuTrainingCreate(s), MAIN_FRAME],
      ['EXTRAS', menuExtrasCreate(s), MAIN_FRAME],
      ['OPTIONS', menuOptionsCreate(s), MAIN_FRAME],
      ['GAMEPLAY', menuGameplayCreate(s), MAIN_FRAME],
      ['ADVANCED', menuAdvancedCreate(s), MAIN_FRAME],
      ['NEW CONTENT', menuNewContentCreate(), MAIN_FRAME],
      ['CONTROLS', menuControlsCreate(s), MAIN_FRAME],
      ['INPUT 1', menuInputCreate(s, 1), MAIN_FRAME],
      ['INPUT 2', menuInputCreate(s, 2), MAIN_FRAME],
      ['KEYBOARD', menuKeyboardCreate(s, 1), KEYBOARD_FRAME],
      ['GRAPHICS', menuGraphicsCreate(s), MAIN_FRAME],
      ['CLASSIC STYLE', menuClassicStyleCreate(), MAIN_FRAME],
      ['REMASTERED', menuRemasteredCreate(), MAIN_FRAME],
      ['EFFECTS', menuEffectsCreate(), MAIN_FRAME],
      ['SOUND', menuSoundCreate(s), MAIN_FRAME],
      ['LANGUAGE', menuLanguageCreate(s), MAIN_FRAME],
    ];
    const issues = menus.flatMap(([name, m, f]) => audit(name, m, f, theme));
    expect(issues).toEqual([]);
  });

  it('pause menus fit their frame', () => {
    const gs = createGame(SceneId.MENU);
    const theme = mainMenuTheme();
    const issues: string[] = [];
    for (const training of [false, true]) {
      const host: PauseHost = { quitFight() {}, menuVisible: false, training, trainingDummy: () => 0, robot: () => null };
      const pm = new ArenaPauseMenu(gs, host) as unknown as { menu: Menu };
      issues.push(...audit(training ? 'PAUSE (training)' : 'PAUSE', pm.menu, pauseFrame(training), theme));
      expect(pm.menu.items.some((c) => c instanceof Button && c.text.str === 'MOVE LIST')).toBe(true);
    }
    // The move list page of every robot fits the frame too.
    for (let har = 0; har < 11; har++) {
      const af = loadAf(har);
      const page = moveListMenu({ robot: () => ({ af, name: langGet(31 + har) }) }, 0);
      issues.push(...audit(`MOVE LIST ${har}`, page, pauseFrame(false), theme));
      const f = pauseFrame(false);
      const view = page.items[1];
      if (view.y + view.h > f.y + f.h) issues.push(`MOVE LIST ${har}: the list ends below the frame`);
    }
    expect(issues).toEqual([]);
  });
});
