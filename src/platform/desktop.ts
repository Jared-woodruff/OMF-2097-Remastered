/**
 * Platform shim: desktop (Tauri 2) vs. plain web build.
 *
 * On desktop this talks to Tauri through the global API that `app.withGlobalTauri` injects as
 * `window.__TAURI__` (src-tauri/tauri.conf.json), so the web bundle has no runtime npm
 * dependencies. Only the window commands allowed in src-tauri/capabilities/default.json are
 * usable: is/set fullscreen, set title and close; and the shell's own `save_file` and `open_studio`
 * commands (src-tauri/src/lib.rs).
 *
 * None of the functions reject. Failures (e.g. a browser refusing fullscreen outside a user
 * gesture) are logged with console.warn and otherwise ignored.
 */

/** The subset of Tauri's `Window` class (`window.__TAURI__.window`) used here. */
interface TauriWindow {
  setFullscreen(fullscreen: boolean): Promise<void>;
  isFullscreen(): Promise<boolean>;
  setTitle(title: string): Promise<void>;
  close(): Promise<void>;
}

interface TauriGlobal {
  window: { getCurrentWindow(): TauriWindow };
  core: {
    invoke<T>(cmd: string, args?: Record<string, unknown> | ArrayBuffer | Uint8Array, options?: { headers: Record<string, string> }): Promise<T>;
  };
}

const tauri: TauriGlobal | undefined =
  typeof window === 'undefined' ? undefined : (window as Window & { __TAURI__?: TauriGlobal }).__TAURI__;

/** The game's native window when running in the desktop shell. */
const appWindow: TauriWindow | undefined = tauri?.window.getCurrentWindow();

/** True when running inside the Tauri desktop shell (with its global API available). */
export const isDesktop: boolean = appWindow !== undefined;

/**
 * Inside another page's frame (OMF Studio's test of a mod): the desktop shell's API reaches frames too, but the window
 * is Studio's, so the game leaves it alone (fullscreen, title, closing); saving files still works.
 */
export const framed: boolean = typeof window !== 'undefined' && window.self !== window.top;

/** The native window the game may change (not when framed). */
const ownWindow: TauriWindow | undefined = framed ? undefined : appWindow;

function warn(what: string, err: unknown): void {
  console.warn(`[platform] ${what} failed:`, err);
}

/**
 * Enters or leaves fullscreen.
 * - Desktop: native borderless fullscreen of the game window; works at any time.
 * - Web: Fullscreen API on `<html>`. Browsers only allow entering it from a user gesture
 *   (key/click handler), so call this synchronously from the input handler.
 */
export async function setFullscreen(on: boolean): Promise<void> {
  if (framed) return;
  try {
    if (ownWindow) {
      await ownWindow.setFullscreen(on);
    } else if (on && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } else if (!on && document.fullscreenElement) {
      await document.exitFullscreen();
    }
  } catch (err) {
    warn(`setFullscreen(${on})`, err);
  }
}

/** Whether the game is currently fullscreen. */
export async function isFullscreen(): Promise<boolean> {
  if (!ownWindow) return document.fullscreenElement !== null;
  try {
    return await ownWindow.isFullscreen();
  } catch (err) {
    warn('isFullscreen()', err);
    return false;
  }
}

/** Toggles fullscreen (bind to e.g. Alt+Enter / F11). Same user-gesture rule as setFullscreen on the web. */
export async function toggleFullscreen(): Promise<void> {
  // On the web, decide synchronously so requestFullscreen() still runs inside the user gesture.
  const on = ownWindow ? !(await isFullscreen()) : document.fullscreenElement === null;
  await setFullscreen(on);
}

/** Sets the page title and, on desktop, the native window title. */
export async function setTitle(title: string): Promise<void> {
  document.title = title;
  if (!ownWindow) return;
  try {
    await ownWindow.setTitle(title);
  } catch (err) {
    warn('setTitle()', err);
  }
}

/**
 * Quits the game.
 * - Desktop: closes the window, which exits the app.
 * - Web: does nothing; a page can't close a tab it didn't open. Hide "Quit" options when `!isDesktop`.
 */
export async function quitApp(): Promise<void> {
  if (!ownWindow) return;
  try {
    await ownWindow.close();
  } catch (err) {
    warn('quitApp()', err);
  }
}

/** Opens OMF Studio, the modding tool: a window of the desktop app, a new tab on the web. */
export async function openStudio(): Promise<void> {
  if (!tauri) {
    window.open('./studio.html', '_blank', 'noopener');
    return;
  }
  try {
    await tauri.core.invoke('open_studio');
  } catch (err) {
    warn('openStudio()', err);
  }
}

/**
 * Desktop: saves a file in Downloads\OMF 2097 Remastered (a number is added when the name is taken) and resolves to
 * its path. Rejects on failure, or on the web (use a download there).
 */
export async function saveDesktopFile(name: string, data: Uint8Array): Promise<string> {
  if (!tauri) throw new Error('not the desktop app');
  return tauri.core.invoke<string>('save_file', data, { headers: { 'x-file-name': name } });
}
