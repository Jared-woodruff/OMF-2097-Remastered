// The game's look for the credits' HTML (creditsView.ts, titleCard.ts, finaleRoll.ts): the menu frame (gui/widgets.ts
// menuBackground: the shade, its grid every 8 pixels from 5, the blue border), the VS screen's box (its finer blue grid,
// its green border, its yellow names and green text), the pages' colors (gui/page.ts PC), and the remaster's typeface
// with the game's hard shadows. Text types in a letter at a time behind a block cursor, as in the game's text entry. Sizes
// are in the game's pixels (--ux across, --uy down: 320 x 200 on the screen, see the view's place()).
import { UI_FONT } from '../../platform/uiFont';
import { BEAT } from './song';

export const LOOK_CSS = `
.omfc { --g-grid: #000059; --g-edge: #0000f3; --g-shade: rgba(0, 0, 12, .8); --g-green: #00ff00; --g-green-dk: #005800;
  --g-yellow: #ffff00; --g-yellow-dk: #3a3a00; --g-gold: #ffc840; --g-gold-dk: #4a3200; --g-white: #f2f4f7; --g-grey: #aab2bd;
  --g-dim: #7c8694; --g-pale: #9fd0ff; --g-sel: #1c3c78; --g-ink: #050608;
  --gl: max(1px, calc(.45 * var(--uy))); --gb: max(2px, calc(.7 * var(--uy)));
  --fs-s: max(10px, calc(3.3 * var(--uy))); --fs-b: max(15px, calc(6 * var(--uy))); }
.omfg { box-sizing: border-box; background-color: var(--g-shade);
  background-image: linear-gradient(90deg, var(--g-grid) var(--gl), transparent var(--gl)),
    linear-gradient(180deg, var(--g-grid) var(--gl), transparent var(--gl));
  background-size: calc(8 * var(--ux)) calc(8 * var(--uy)); background-position: calc(5 * var(--ux)) calc(5 * var(--uy));
  box-shadow: inset 0 0 0 var(--gb) var(--g-edge); }
.omfg-vs { box-sizing: border-box; background-color: rgba(0, 0, 0, .84);
  background-image: linear-gradient(90deg, #00008f var(--gl), transparent var(--gl)),
    linear-gradient(180deg, #00008f var(--gl), transparent var(--gl));
  background-size: calc(5 * var(--ux)) calc(5 * var(--uy)); background-position: calc(4 * var(--ux)) calc(3 * var(--uy));
  box-shadow: inset 0 0 0 var(--gb) #00d200, inset 0 0 0 calc(2 * var(--gb)) #005c00; }
.omfg-s, .omfg-b { font-family: ${UI_FONT}; text-transform: uppercase; white-space: nowrap; }
.omfg-s { font-weight: 700; font-size: var(--fs-s); letter-spacing: .14em; line-height: 1.35;
  text-shadow: calc(.5 * var(--ux)) calc(.5 * var(--uy)) 0 var(--sh, var(--g-ink)); }
.omfg-b { font-weight: 900; font-size: var(--fs-b); letter-spacing: .06em; line-height: 1.1;
  text-shadow: calc(.8 * var(--ux)) calc(.8 * var(--uy)) 0 var(--sh, var(--g-ink)); }
.omfg-green { color: var(--g-green); --sh: var(--g-green-dk); }
.omfg-yellow { color: var(--g-yellow); --sh: var(--g-yellow-dk); }
.omfg-gold { color: var(--g-gold); }
.omfg-white { color: var(--g-white); }
.omfg-grey { color: var(--g-grey); }
.omfg-dim { color: var(--g-dim); }
.omfg-pale { color: var(--g-pale); }
.omfg-cursor { display: inline-block; width: .62em; height: .74em; margin: 0 -.7em 0 .08em; background: currentColor;
  vertical-align: -.02em; box-shadow: calc(.5 * var(--ux)) calc(.5 * var(--uy)) 0 var(--sh, var(--g-ink)); }
.omfg-rest { visibility: hidden; }
`;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** How many letters of a text typed from `from`, one every `every` seconds, show at time t. */
export function typedCount(length: number, t: number, from: number, every: number): number {
  return t < from ? 0 : Math.min(length, Math.floor((t - from) / every) + 1);
}

/**
 * Types a text into an element at time t: its first letters, the block cursor after them while typing (and for `hold`
 * seconds after, blinking on the eighth notes), the rest kept in place unseen (a centered or right-aligned line does not
 * move as it types).
 */
export function typeInto(el: HTMLElement, text: string, t: number, from: number, every: number, hold = 0): void {
  const k = typedCount(text.length, t, from, every);
  const done = from + (text.length - 1) * every;
  const cursor = t >= from && (k < text.length || (t < done + hold && Math.floor((t - done) / (BEAT / 2)) % 2 === 1));
  const key = `${k}|${cursor ? 1 : 0}|${text}`;
  if (el.dataset.typed === key) return;
  el.dataset.typed = key;
  el.innerHTML = `${esc(text.slice(0, k))}${cursor ? '<i class="omfg-cursor"></i>' : ''}<span class="omfg-rest">${esc(text.slice(k))}</span>`;
}
