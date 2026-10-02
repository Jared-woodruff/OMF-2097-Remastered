// A small button in the main menu's bottom left corner, over the version label, that plays the remaster's credits (HTML
// over the game, in the menus' look: the navy grid in its blue frame, green letters; gold on a blue bar when pointed at).
import { ensureUiFont, UI_FONT } from './uiFont';

let button: HTMLButtonElement | null = null;
let shown = false;
let onPlay: () => void = () => {};

const CSS = `
#omf-credits-btn { position: fixed; left: max(14px, 1.3vw); bottom: calc(max(10px, 1.3vh) + clamp(9px, .68vw, 13px) * 1.35 + max(7px, .8vh));
  z-index: 5; display: flex; align-items: center; gap: .75em; margin: 0; padding: .66em 1.1em .62em .95em; border: 0; cursor: pointer;
  font: 700 clamp(10px, .74vw, 14px) ${UI_FONT}; letter-spacing: .16em; text-transform: uppercase; white-space: nowrap;
  color: #00ff00; text-shadow: .1em .1em 0 #005800; background-color: rgba(0, 0, 12, .82);
  background-image: linear-gradient(90deg, #000059 1px, transparent 1px), linear-gradient(180deg, #000059 1px, transparent 1px);
  background-size: 1.15em 1.15em; background-position: .4em .4em; box-shadow: inset 0 0 0 2px #0000f3, 0 2px 10px rgba(0, 0, 0, .6);
  opacity: 0; pointer-events: none; transition: opacity .5s ease, background-color .12s, color .12s; }
#omf-credits-btn.is-on { opacity: 1; pointer-events: auto; }
#omf-credits-btn svg { display: block; width: .95em; height: .95em; flex: none; fill: currentColor; filter: drop-shadow(.1em .1em 0 #005800); }
#omf-credits-btn:hover { background-color: #1c3c78; color: #ffc840; text-shadow: .1em .1em 0 #050608; }
#omf-credits-btn:hover svg { filter: drop-shadow(.1em .1em 0 #050608); }
`;

/** What the button does (the game's main menu starts the credits). */
export function setCreditsButtonAction(action: () => void): void {
  onPlay = action;
}

/** Shows or hides the button (called every frame: the page is only touched when that changes). */
export function showCreditsButton(visible: boolean): void {
  if (visible === shown || typeof document === 'undefined' || !document.body) return;
  shown = visible;
  if (!button) {
    ensureUiFont();
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    button = document.createElement('button');
    button.id = 'omf-credits-btn';
    button.type = 'button';
    // (never focused: the game's keys stay the game's, and ENTER cannot press it again)
    button.tabIndex = -1;
    button.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 0.5 L9.5 5 L1 9.5 Z"/></svg>Play the credits';
    button.title = "The remaster's credits, fought out to Hadal Static's Twenty Ninety-Seven (Remix)";
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', () => {
      if (shown) onPlay();
    });
    document.body.appendChild(button);
    // (a frame later, so it fades in)
    void button.offsetWidth;
  }
  button.classList.toggle('is-on', visible);
}
