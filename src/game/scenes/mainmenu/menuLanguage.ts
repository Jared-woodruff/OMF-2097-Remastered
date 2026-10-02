// Language selection (port of the reference mainmenu/menu_language.c).
//
// The reference lists ENGLISH.DAT, GERMAN.DAT and any *.LNG file that has an OpenOMF companion file (*.DAT2/*.LNG2)
// with the translation's name. Here: the original game's ENGLISH.DAT and GERMAN.DAT (when present). Texts that only
// exist in this port's menus stay in English, as with the reference's missing companion files.
import { hasFile } from '../../../resources/files';
import { loadLanguage } from '../../../resources/resources';
import { saveSettings, settings } from '../../settings';
import { Button, Filler, Label, Menu, TextSelector } from '../../gui/widgets';
import type { MainMenuScene } from '../mainmenu';
import { parentMenu } from './common';

interface LanguageFile {
  file: string;
  /** LANG2_STR_LANGUAGE of the OpenOMF companion file. */
  name: string;
}

const LANGUAGES: LanguageFile[] = [
  { file: 'ENGLISH.DAT', name: 'English' },
  { file: 'GERMAN.DAT', name: 'Deutsch' },
];

export function menuLanguageCreate(_s: MainMenuScene): Menu {
  const available = LANGUAGES.filter((l) => hasFile(l.file));
  const currentLanguage = settings().language;
  const local = { selectedLanguage: Math.max(0, available.findIndex((l) => l.file === currentLanguage)) };
  const menu = new Menu();
  menu.attach(Label.title('LANGUAGE'));
  menu.attach(new TextSelector('', 'Choose a Language.', () => local.selectedLanguage, (pos) => (local.selectedLanguage = pos),
    available.map((l) => l.name)));
  menu.attach(new Filler());
  menu.attach(new Button('DONE', 'Return to the main menu.', false, false, (b) => {
    // menu_language_done()
    parentMenu(b).finished = true;
    const file = available[local.selectedLanguage].file;
    if (file !== settings().language) {
      settings().language = file;
      saveSettings();
      loadLanguage(file);
    }
  }));
  return menu;
}
