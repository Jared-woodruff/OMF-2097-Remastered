// Hooks the game logic uses to talk to the host application (renderer, window, persistence).
import type { GraphicsMode } from './game/settings';

export const app = {
  setGraphicsMode(_mode: GraphicsMode): void {},
  getGraphicsMode(): GraphicsMode {
    return 'remastered';
  },
  toggleFullscreen(): void {},
  quit(): void {},
  /** Shows the controls screen (keyboard and controller layouts) over the game. */
  showControls(): void {},
  /** Notified whenever settings change so the host can apply them. */
  settingsChanged(): void {},
};
