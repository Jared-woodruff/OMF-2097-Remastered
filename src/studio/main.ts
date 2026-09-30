// OMF Studio: the modding tool of One Must Fall 2097 Remastered (studio.html). It makes robots, arenas and pilots in
// the game's own formats and builds them into mod packages (src/mods) that the game loads. It needs the original
// game's files like the game does (the palettes, the moves and colors every robot shares): from the server (the
// desktop app, the dev server) or the ones the game imported in this browser.
import { loadStoredGameFiles } from '../platform/gameData';
import { APP_VERSION } from '../platform/versionLabel';
import { preloadAll } from '../resources/files';
import { loadGenerated } from '../resources/generated';
import { loadLanguage } from '../resources/resources';
import { StudioApp } from './app';
import { h } from './dom';

async function main(): Promise<void> {
  const root = document.getElementById('studio')!;
  const loading = document.getElementById('loading');
  const fromServer = await preloadAll((loaded, total) => {
    if (loading) loading.textContent = `OMF STUDIO · LOADING THE GAME'S FILES ${Math.round((loaded / total) * 100)}%`;
  });
  if (!fromServer && !(await loadStoredGameFiles())) {
    root.replaceChildren(h('div', { class: 'start' }, h('div', { class: 'inner' },
      h('h1', { class: 'logo' }, 'OMF STUDIO'),
      h('p', { class: 'tag' }, 'OMF Studio needs the game\'s files. Start the game once in this browser: it asks for them and ' +
        'keeps them, and Studio uses the same ones.'),
      h('a', { class: 'btn primary', href: './index.html' }, 'Open the game'))));
    return;
  }
  await loadGenerated();
  try {
    loadLanguage();
  } catch {
    // (names of the originals are only shown in lists)
  }
  document.title = `OMF Studio${APP_VERSION ? ` ${APP_VERSION}` : ''}`;
  const app = new StudioApp(root);
  // For automated checks (like the game's window.__omf).
  (window as unknown as { __studio: StudioApp }).__studio = app;
}

main().catch((err) => {
  console.error(err);
  const root = document.getElementById('studio');
  if (root) root.textContent = `OMF Studio could not start: ${String((err as Error)?.message ?? err)}`;
});
