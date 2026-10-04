// OMF Studio: the modding tool of One Must Fall 2097 Remastered (studio.html). It makes robots, arenas and pilots in
// the game's own formats and builds them into mod packages (src/mods) that the game loads. It needs the original
// game's files like the game does (the palettes, the moves and colors every robot shares): from the server (the
// desktop app, the dev server) or the ones the game imported in this browser.
import { loadStoredGameFiles } from '../platform/gameData';
import { APP_VERSION } from '../platform/versionLabel';
import { preloadAll } from '../resources/files';
import { loadLanguage } from '../resources/resources';
import { StudioApp } from './app';
import { h } from './dom';
import { hero } from './ui';

async function main(): Promise<void> {
  const root = document.getElementById('studio')!;
  const bar = document.querySelector<HTMLElement>('#loading .load-bar i');
  const label = document.querySelector<HTMLElement>('#loading .load-text');
  const fromServer = await preloadAll((loaded, total) => {
    const pct = Math.round((loaded / total) * 100);
    if (bar) bar.style.width = `${pct}%`;
    if (label) label.textContent = `Loading the game's files · ${pct}%`;
  });
  if (!fromServer && !(await loadStoredGameFiles())) {
    root.replaceChildren(h('div', { class: 'start' }, h('div', { class: 'inner' },
      hero('OMF Studio needs the game\'s files. Start the game once in this browser: it asks for them and keeps them, and Studio uses the same ones.'),
      h('div', { style: { textAlign: 'center' } }, h('a', { class: 'btn go', href: './index.html' }, '▶ Open the game')))));
    return;
  }
  try {
    loadLanguage();
  } catch {
    // (names of the originals are only shown in lists)
  }
  document.title = `OMF Studio${APP_VERSION ? ` ${APP_VERSION}` : ''}`;
  const app = new StudioApp(root);
  // For automated checks (like the game's window.__omf).
  (window as unknown as { __studio: StudioApp }).__studio = app;
  // The desktop app: closing the window does not ask the page (no beforeunload), so the last changes are saved first.
  const studioWindow = (window as unknown as { __TAURI__?: { window: { getCurrentWindow(): StudioWindow } } }).__TAURI__?.window.getCurrentWindow();
  if (studioWindow && window.self === window.top) {
    void studioWindow.onCloseRequested(async (e) => {
      if (!app.unsaved) return;
      e.preventDefault();
      if (await app.canLeave()) await studioWindow.destroy();
    });
  }
}

/** The part of Tauri's window used here (src/platform/desktop.ts has the game's). */
interface StudioWindow {
  onCloseRequested(handler: (e: { preventDefault(): void }) => void | Promise<void>): Promise<unknown>;
  destroy(): Promise<void>;
}

main().catch((err) => {
  console.error(err);
  const root = document.getElementById('studio');
  if (root) root.textContent = `OMF Studio could not start: ${String((err as Error)?.message ?? err)}`;
});
