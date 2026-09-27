// Hooks the game logic uses to talk to the host application (renderer, window, persistence).
import type { GraphicsMode } from './game/settings';

export const app = {
  setGraphicsMode(_mode: GraphicsMode): void {},
  getGraphicsMode(): GraphicsMode {
    return 'remastered';
  },
  toggleFullscreen(): void {},
  quit(): void {},
  /** Notified whenever settings change so the host can apply them. */
  settingsChanged(): void {},
};
