// The help pages in remastered graphics: the language file's 13 help texts, readable, in the look of the remaster's
// other pages (records, replays...: page.ts). The game draws the page's frame, its title and its keys like theirs; the
// text is HTML laid over the frame at the game's scale, in the remaster's typeface, sharp at any size, long pages
// scrolling. (The original pages set the text in the game's small font, which has capitals only and fixed cells;
// classic graphics keep them, see scenes/mainmenu/menuHelp.ts.) The topics on the left like the pages' tabs, the page
// on the right; up and down (or a click) choose the topic, left and right, PAGE UP / PAGE DOWN or the wheel scroll it,
// ESC (or a right click) closes. The texts' markup becomes headings and paragraphs: {SIZE 8} lines are the page's
// title, {COLOR:YELLOW} lines in the small size are headings, the rest are paragraphs (blank lines between them, lines
// kept within them).
import { ensureUiFont, UI_FONT } from '../../platform/uiFont';
import { ACT_DOWN, ACT_ESC, ACT_KICK, ACT_LEFT, ACT_RIGHT, ACT_UP, type CtrlType } from '../constants';
import { settings } from '../settings';
import { PC, Page } from './page';
import { FontSize, HAlign } from './text';
import { playMenuSound } from './widgets';

export interface HelpBlock {
  kind: 'title' | 'heading' | 'text';
  /** Lines of the block, each a list of runs with the color name they are in ('' = the default color). */
  lines: { text: string; color: string }[][];
}

export interface HelpPageDoc {
  title: string;
  blocks: HelpBlock[];
}

/** The upper half of code page 437, the DOS character set of the language files (the German texts' letters). */
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

/** A language file string's characters as Unicode (they are the game font's code page 437 codes). */
export function cp437(text: string): string {
  return text.replace(/[-ÿ]/g, (c) => CP437_HIGH[c.charCodeAt(0) - 0x80] ?? c);
}

/** Parses a help text of the language file (its markup: {SIZE n}, {COLOR:NAME}, {CENTER ON}...). */
export function parseHelpText(source: string): HelpPageDoc {
  // (a German page has a size tag without its closing brace: "{SIZE 6Nicht nur...")
  const src = cp437(source).replace(/\{(SIZE|SPACINGG?|WIDTH) *(\d+)(?=[^\d}])/g, '{$1 $2}');
  // (the pages are laid out in the big font until they say otherwise, see menuHelp.ts)
  let size = 8;
  let color = '';
  const blocks: HelpBlock[] = [];
  let block: HelpBlock | null = null;
  const end = () => {
    if (block && block.lines.some((l) => l.some((r) => r.text.trim()))) blocks.push(block);
    block = null;
  };
  for (const rawLine of src.split('\n')) {
    const runs: { text: string; color: string }[] = [];
    let kindColor = '';
    let lineSize = size;
    const parts = rawLine.split(/(\{[^}]*\})/);
    for (const part of parts) {
      const tag = /^\{([A-Z]+)(?::|\s)?\s*([^}]*)\}$/.exec(part);
      if (tag) {
        const [, name, arg] = tag;
        if (name === 'SIZE') size = Number(arg) || 6;
        else if (name === 'COLOR') color = arg.trim().toUpperCase() === 'DEFAULT' ? '' : arg.trim().toLowerCase();
        continue;
      }
      if (!part) continue;
      // The size and color of the line's first letters decide what kind of line it is.
      if (!runs.some((r) => r.text.trim())) {
        lineSize = size;
        kindColor = color;
      }
      const last = runs[runs.length - 1];
      if (last && last.color === color) last.text += part;
      else runs.push({ text: part, color });
    }
    const text = runs.map((r) => r.text).join('');
    if (!text.trim()) {
      end();
      continue;
    }
    // Indented first lines (three spaces) and doubled spaces are typewriter layout, not meaning.
    runs[0].text = runs[0].text.replace(/^\s+/, '');
    for (const r of runs) r.text = r.text.replace(/ {2,}/g, ' ');
    const kind: HelpBlock['kind'] = lineSize >= 8 ? 'title' : kindColor === 'yellow' ? 'heading' : 'text';
    if (kind !== 'text' || !block || block.kind !== 'text') {
      end();
      block = { kind, lines: [] };
    }
    block.lines.push(runs);
    if (kind !== 'text') end();
  }
  end();
  const title = blocks.find((b) => b.kind === 'title');
  return {
    title: title ? title.lines.map((l) => l.map((r) => r.text).join('')).join(' ').trim() : '',
    blocks: blocks.filter((b) => b !== title),
  };
}

/** Whether the help pages are shown as HTML: in remastered graphics, where there is a page to show them on. */
export function htmlHelpWanted(): boolean {
  return settings().video.graphics === 'remastered' && typeof document !== 'undefined' && !!document.body &&
    typeof document.createElement === 'function';
}

/** The page's keys, drawn by the game under the text like the other pages' (records: "< > PAGE   ESC BACK"). */
const KEYS = 'UP/DOWN TOPIC   < > SCROLL   ESC BACK';

// Sizes are in the game's pixels (--ux across, --uy down: 320 x 200 on the screen, see place()), colors are the pages'
// palette (page.ts PC: white, grey, dim, gold, the lists' selection bar, the letters' shadow).
const CSS = `
.omfh { position: fixed; inset: 0; z-index: 40; --ux: 4.5px; --uy: 5.4px; --ox: 0px; --oy: 0px; font-family: ${UI_FONT};
  color: #f2f4f7; animation: omfh-in .14s ease-out; }
@keyframes omfh-in { from { opacity: 0 } to { opacity: 1 } }
.omfh-frame { position: absolute; left: calc(var(--ox) + 8 * var(--ux)); top: calc(var(--oy) + 5 * var(--uy));
  width: calc(304 * var(--ux)); height: calc(190 * var(--uy)); }
.omfh-toc { position: absolute; left: calc(8 * var(--ux)); top: calc(24 * var(--uy)); width: calc(106 * var(--ux));
  bottom: calc(18 * var(--uy)); display: flex; flex-direction: column; gap: calc(.5 * var(--uy)); overflow-y: auto;
  scrollbar-width: none; }
.omfh-toc::-webkit-scrollbar { display: none; }
.omfh-topic { display: grid; grid-template-columns: calc(12 * var(--ux)) 1fr; align-items: baseline; width: 100%;
  box-sizing: border-box; padding: calc(1.2 * var(--uy)) calc(2.5 * var(--ux)); border: 0; border-radius: calc(1.5 * var(--ux));
  background: none; cursor: pointer; text-align: left; color: #aab2bd; text-transform: uppercase; letter-spacing: .1em;
  font: 700 max(11px, calc(3.6 * var(--uy))) / 1.25 ${UI_FONT}; text-shadow: calc(.45 * var(--ux)) calc(.45 * var(--uy)) 0 #050608; }
.omfh-topic b { font-weight: 700; color: #7c8694; }
.omfh-topic:hover { color: #f2f4f7; }
.omfh-topic.is-on { color: #ffc840; background: rgba(28, 60, 120, .88); }
.omfh-topic.is-on b { color: #ffc840; }
.omfh-page { position: absolute; left: calc(124 * var(--ux)); right: calc(6 * var(--ux)); top: calc(22 * var(--uy));
  bottom: calc(18 * var(--uy)); overflow-y: auto; padding-right: calc(5 * var(--ux)); scroll-behavior: smooth;
  scrollbar-width: thin; scrollbar-color: #0000f3 #000059; }
.omfh-page::-webkit-scrollbar { width: calc(1.2 * var(--ux)); }
.omfh-page::-webkit-scrollbar-track { background: #000059; }
.omfh-page::-webkit-scrollbar-thumb { background: #0000f3; }
.omfh-count { margin-bottom: calc(1.2 * var(--uy)); font: 700 max(10px, calc(2.9 * var(--uy))) ${UI_FONT}; letter-spacing: .2em;
  color: #7c8694; text-shadow: calc(.4 * var(--ux)) calc(.4 * var(--uy)) 0 #050608; }
.omfh-page h1 { margin: 0 0 calc(3.4 * var(--uy)); font: 900 max(17px, calc(5.8 * var(--uy))) / 1.12 ${UI_FONT}; letter-spacing: .08em;
  text-transform: uppercase; color: #f2f4f7; text-shadow: calc(.8 * var(--ux)) calc(.8 * var(--uy)) 0 #050608; }
.omfh-page h2 { margin: calc(4.2 * var(--uy)) 0 calc(1.4 * var(--uy)); font: 700 max(11px, calc(3.6 * var(--uy))) / 1.3 ${UI_FONT};
  letter-spacing: .12em; text-transform: uppercase; color: #ffc840; text-shadow: calc(.45 * var(--ux)) calc(.45 * var(--uy)) 0 #050608; }
.omfh-page p { margin: 0 0 calc(2.8 * var(--uy)); font: 500 max(13px, calc(3.5 * var(--uy))) / 1.72 ${UI_FONT}; letter-spacing: .02em;
  color: #dde2ec; text-shadow: calc(.4 * var(--ux)) calc(.4 * var(--uy)) 0 #050608; }
.omfh-page .c-yellow { color: #ffc840; } .omfh-page .c-white { color: #fff; } .omfh-page .c-purple { color: #c9a2ff; }
.omfh-page .c-red { color: #ff5a50; } .omfh-page .c-green { color: #5ce66e; } .omfh-page .c-blue { color: #7cbeff; }
.omfh-more { position: absolute; right: calc(9 * var(--ux)); bottom: calc(18.5 * var(--uy)); pointer-events: none; opacity: 0;
  color: #ffc840; font: 900 max(10px, calc(3.2 * var(--uy))) ${UI_FONT}; text-shadow: calc(.45 * var(--ux)) calc(.45 * var(--uy)) 0 #050608;
  transition: opacity .2s; }
.omfh-more.is-on { opacity: 1; animation: omfh-blink 1s steps(2, jump-none) infinite; }
@keyframes omfh-blink { 50% { opacity: .25 } }
.omfh-close { position: absolute; right: calc(4 * var(--ux)); top: calc(2.5 * var(--uy)); padding: calc(.6 * var(--uy)) calc(1.5 * var(--ux));
  border: 0; background: none; cursor: pointer; color: #7c8694; font: 900 max(11px, calc(4 * var(--uy))) / 1 ${UI_FONT};
  text-shadow: calc(.45 * var(--ux)) calc(.45 * var(--uy)) 0 #050608; }
.omfh-close:hover { color: #ffc840; }
@media (prefers-reduced-motion: reduce) { .omfh, .omfh-more.is-on { animation: none; } .omfh-page { scroll-behavior: auto; } }
`;

let styleAdded = false;
/** HTML help pages on screen. */
let openPages = 0;

/** Whether the HTML help is on screen. */
export function htmlHelpOpen(): boolean {
  return openPages > 0;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The game's canvas: the HTML follows its 320 x 200 picture (see renderer.ts viewport()). */
function gameCanvas(): HTMLElement | null {
  return document.getElementById('screen');
}

/**
 * The help pages over the game, as one of the remaster's pages (it takes the menu actions: the main menu's HELP, or
 * F1 through helpOverlay.ts). The game draws the frame, the title and the keys; the topics and the text are HTML.
 */
export class HtmlHelpMenu extends Page {
  page = 0;
  readonly pages: HelpPageDoc[];
  private root: HTMLDivElement | null = null;
  private topics: HTMLButtonElement[] = [];
  private article: HTMLElement | null = null;
  private more: HTMLElement | null = null;
  private readonly onResize = () => this.place();

  constructor(texts: string[]) {
    super();
    this.pages = texts.map(parseHelpText);
    // (the pages' colors: the keys, and a scene's palette may not have them; helpOverlay.ts restores the palette)
    this.setColors();
    this.build();
  }

  private build(): void {
    ensureUiFont();
    if (!styleAdded) {
      styleAdded = true;
      const style = document.createElement('style');
      style.id = 'omfh-style';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    const root = el('div', 'omfh');
    const frame = el('div', 'omfh-frame');
    const toc = el('nav', 'omfh-toc');
    this.topics = this.pages.map((p, i) => {
      const b = el('button', 'omfh-topic');
      b.append(el('b', undefined, String(i + 1).padStart(2, '0')), el('span', undefined, p.title || `Page ${i + 1}`));
      b.addEventListener('click', () => this.show(i, true));
      toc.appendChild(b);
      return b;
    });
    this.article = el('article', 'omfh-page');
    this.article.addEventListener('scroll', () => this.showMore(), { passive: true });
    this.more = el('div', 'omfh-more', '▼');
    const close = el('button', 'omfh-close', 'X');
    close.title = 'Close';
    close.addEventListener('click', () => this.close());
    frame.append(toc, this.article, this.more, close);
    root.appendChild(frame);
    // A click beside the frame closes the help, like ESC, and so does a right click (as on the other pages).
    root.addEventListener('mousedown', (e) => {
      if (e.target === root) this.close();
    });
    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.close();
    });
    document.body.appendChild(root);
    this.root = root;
    openPages++;
    this.place();
    window.addEventListener('resize', this.onResize);
    this.show(0, false);
  }

  /** Lays the HTML over the game's picture: its origin and its pixels (as the renderer fits 320 x 200 on the canvas). */
  private place(): void {
    const canvas = gameCanvas();
    const r = canvas?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    let uy = r.height / 200;
    let ux = uy * (5 / 6);
    if (320 * ux > r.width) {
      ux = r.width / 320;
      uy = ux * 1.2;
    }
    const s = this.root?.style;
    s?.setProperty('--ux', `${ux}px`);
    s?.setProperty('--uy', `${uy}px`);
    s?.setProperty('--ox', `${r.left + (r.width - 320 * ux) / 2}px`);
    s?.setProperty('--oy', `${r.top + (r.height - 200 * uy) / 2}px`);
    this.showMore();
  }

  /** Shows page `i` (from its top). */
  show(i: number, sound = true): void {
    if (i < 0 || i >= this.pages.length || !this.article) return;
    if (sound && i !== this.page) playMenuSound(19);
    this.page = i;
    this.topics.forEach((b, k) => b.classList.toggle('is-on', k === i));
    this.topics[i]?.scrollIntoView({ block: 'nearest' });
    const doc = this.pages[i];
    const a = this.article;
    a.replaceChildren();
    a.appendChild(el('div', 'omfh-count', `${String(i + 1).padStart(2, '0')} / ${String(this.pages.length).padStart(2, '0')}`));
    a.appendChild(el('h1', undefined, doc.title));
    for (const b of doc.blocks) {
      const node = el(b.kind === 'text' ? 'p' : 'h2');
      b.lines.forEach((line, k) => {
        if (k > 0) node.appendChild(document.createElement('br'));
        for (const r of line) {
          if (r.color && r.color !== 'default' && b.kind === 'text') node.appendChild(el('span', `c-${r.color}`, r.text));
          else node.append(r.text);
        }
      });
      a.appendChild(node);
    }
    a.scrollTop = 0;
    this.showMore();
  }

  /** The blinking arrow while there is more of the page below. */
  private showMore(): void {
    const a = this.article;
    if (a && this.more) this.more.classList.toggle('is-on', a.scrollTop + a.clientHeight < a.scrollHeight - 4);
  }

  private scroll(pages: number): void {
    if (this.article) this.article.scrollBy({ top: this.article.clientHeight * 0.8 * pages });
  }

  private close(): void {
    if (this.finished) return;
    this.finished = true;
    this.remove();
  }

  private remove(): void {
    if (!this.root) return;
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
    this.root = null;
    openPages--;
  }

  /** The frame, the title and the keys, as the other pages draw them (the HTML is over them). */
  override render(): void {
    if (this.finished) {
      this.remove();
      return;
    }
    this.drawFrame('HELP');
    this.drawText('keys', KEYS, 160, 184, FontSize.SMALL, PC.dim, HAlign.CENTER);
  }

  override tick(): void {
    if (this.finished) this.remove();
  }

  override free(): void {
    this.remove();
    super.free();
  }

  override keyEvent(code: string, _e: KeyboardEvent): boolean {
    if (code === 'PageDown') this.scroll(1);
    else if (code === 'PageUp') this.scroll(-1);
    else if (code === 'Home') this.show(0);
    else if (code === 'End') this.show(this.pages.length - 1);
    else return false;
    return true;
  }

  override action(action: number, _source: CtrlType): number {
    if (action === ACT_UP) this.show(Math.max(0, this.page - 1));
    else if (action === ACT_DOWN) this.show(Math.min(this.pages.length - 1, this.page + 1));
    else if (action === ACT_RIGHT) this.scroll(1);
    else if (action === ACT_LEFT) this.scroll(-1);
    else if (action === ACT_ESC || action === ACT_KICK) this.close();
    else return 0;
    return 1;
  }
}
