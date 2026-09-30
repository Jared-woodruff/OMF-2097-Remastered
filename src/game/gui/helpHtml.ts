// The help pages in remastered graphics: the language file's 13 help texts as HTML over the game, in the remaster's
// typeface at a readable size. (The original pages set the text in the game's small font, which has capitals only and
// fixed cells; classic graphics keep them, see scenes/mainmenu/menuHelp.ts.) A list of the pages on the left, the
// page on the right; up and down (or a click) choose the page, left and right, PAGE UP / PAGE DOWN or the wheel scroll
// it, ESC closes. The texts' markup becomes headings and paragraphs: {SIZE 8} lines are the page's title, {COLOR:YELLOW}
// lines in the small size are headings, the rest are paragraphs (blank lines between them, lines kept within them).
import { ensureUiFont, UI_FONT } from '../../platform/uiFont';
import { ACT_DOWN, ACT_ESC, ACT_KICK, ACT_LEFT, ACT_RIGHT, ACT_UP, type CtrlType } from '../constants';
import { settings } from '../settings';
import { Menu, playMenuSound } from './widgets';

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

const CSS = `
.omfh { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center;
  font-family: ${UI_FONT}; color: #dfe7ff; animation: omfh-in .18s ease-out; }
@keyframes omfh-in { from { opacity: 0; transform: scale(.985); } to { opacity: 1; transform: none; } }
.omfh-panel { position: relative; display: grid; grid-template-columns: minmax(200px, 27%) 1fr; grid-template-rows: 1fr auto;
  width: min(1240px, 92vw); height: min(820px, 88vh); border-radius: 16px; overflow: hidden;
  background: linear-gradient(180deg, rgba(12, 18, 40, .88), rgba(5, 8, 20, .93));
  border: 1px solid rgba(120, 160, 255, .32);
  box-shadow: 0 30px 90px rgba(0, 0, 0, .65), 0 0 0 1px rgba(0, 0, 0, .5), inset 0 1px 0 rgba(255, 255, 255, .06);
  backdrop-filter: blur(10px) saturate(1.15); }
.omfh-toc { grid-row: 1 / 3; overflow-y: auto; padding: clamp(16px, 2.2vh, 28px) 0;
  background: linear-gradient(180deg, rgba(20, 30, 70, .55), rgba(8, 12, 30, .45)); border-right: 1px solid rgba(120, 160, 255, .18); }
.omfh-brand { padding: 0 clamp(18px, 1.8vw, 28px) clamp(12px, 1.6vh, 20px); font-weight: 900; letter-spacing: .32em;
  font-size: clamp(13px, 1.05vw, 17px); color: #9fb6ff; }
.omfh-topic { display: flex; gap: .8em; align-items: baseline; width: 100%; padding: .72em clamp(18px, 1.8vw, 28px); border: 0;
  background: none; color: #aebbe0; font: 600 clamp(12px, .95vw, 15px) / 1.3 ${UI_FONT}; letter-spacing: .03em; text-align: left;
  cursor: pointer; border-left: 3px solid transparent; }
.omfh-topic:hover { color: #fff; background: rgba(120, 160, 255, .08); }
.omfh-topic b { font-weight: 700; color: #5f74b8; font-size: .85em; min-width: 1.6em; }
.omfh-topic.is-on { color: #ffd766; background: linear-gradient(90deg, rgba(255, 190, 60, .16), rgba(255, 190, 60, 0));
  border-left-color: #ffc23d; }
.omfh-topic.is-on b { color: #ffc23d; }
.omfh-page { overflow-y: auto; padding: clamp(22px, 3.4vh, 44px) clamp(24px, 3.2vw, 56px) clamp(22px, 3vh, 40px);
  scroll-behavior: smooth; }
.omfh-page::-webkit-scrollbar, .omfh-toc::-webkit-scrollbar { width: 8px; }
.omfh-page::-webkit-scrollbar-thumb, .omfh-toc::-webkit-scrollbar-thumb { background: rgba(140, 170, 255, .28); border-radius: 8px; }
.omfh-page h1 { margin: 0 0 .9em; font-weight: 900; font-size: clamp(22px, 2.2vw, 36px); letter-spacing: .05em; line-height: 1.15;
  background: linear-gradient(180deg, #fff 0%, #dfe6f5 46%, #ffffff 52%, #7c8aa8 58%, #e9eef8 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 0 14px rgba(80, 130, 255, .35)); }
.omfh-page h2 { margin: 1.5em 0 .45em; font-weight: 800; font-size: clamp(13px, 1.05vw, 17px); letter-spacing: .14em;
  text-transform: uppercase; color: #ffcc4d; }
.omfh-page p { margin: 0 0 1.05em; font-weight: 500; font-size: clamp(14px, 1.12vw, 19px); line-height: 1.78; letter-spacing: .015em;
  color: #dde6ff; max-width: 60em; }
.omfh-page .c-yellow { color: #ffcc4d; } .omfh-page .c-white { color: #fff; } .omfh-page .c-purple { color: #d6a6ff; }
.omfh-page .c-red { color: #ff8a7a; } .omfh-page .c-green { color: #8ff0a0; } .omfh-page .c-blue { color: #9cc2ff; }
.omfh-keys { display: flex; gap: clamp(14px, 1.8vw, 28px); justify-content: flex-end; align-items: center;
  padding: clamp(10px, 1.4vh, 16px) clamp(24px, 3.2vw, 56px); border-top: 1px solid rgba(120, 160, 255, .16);
  font: 600 clamp(10px, .78vw, 13px) ${UI_FONT}; letter-spacing: .12em; color: #8a9bc8; text-transform: uppercase; }
.omfh-keys kbd { display: inline-block; min-width: 1.6em; margin-right: .35em; padding: .25em .5em; border-radius: 5px;
  font: 700 1em ${UI_FONT}; color: #e9eeff; background: rgba(120, 160, 255, .14); border: 1px solid rgba(140, 170, 255, .35);
  text-align: center; }
.omfh-close { position: absolute; top: 12px; right: 14px; width: 34px; height: 34px; border-radius: 50%; border: 0; cursor: pointer;
  background: rgba(255, 255, 255, .06); color: #cfd9ff; font: 400 22px/34px ${UI_FONT}; }
.omfh-close:hover { background: rgba(255, 255, 255, .14); color: #fff; }
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

/** The help pages as an HTML page over the game (a menu with no entries: it takes the menu actions). */
export class HtmlHelpMenu extends Menu {
  page = 0;
  readonly pages: HelpPageDoc[];
  private root: HTMLDivElement | null = null;
  private topics: HTMLButtonElement[] = [];
  private article: HTMLElement | null = null;

  constructor(texts: string[]) {
    super();
    this.pages = texts.map(parseHelpText);
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
    const panel = el('div', 'omfh-panel');
    const toc = el('nav', 'omfh-toc');
    toc.appendChild(el('div', 'omfh-brand', 'HELP'));
    this.topics = this.pages.map((p, i) => {
      const b = el('button', 'omfh-topic');
      b.append(el('b', undefined, String(i + 1).padStart(2, '0')), el('span', undefined, p.title || `Page ${i + 1}`));
      b.addEventListener('click', () => this.show(i, true));
      toc.appendChild(b);
      return b;
    });
    this.article = el('article', 'omfh-page');
    const keys = el('footer', 'omfh-keys');
    const hint = (k: string[], label: string) => {
      const s = el('span');
      for (const key of k) s.appendChild(el('kbd', undefined, key));
      s.append(label);
      keys.appendChild(s);
    };
    hint(['↑', '↓'], 'Page');
    hint(['PG UP', 'PG DN'], 'Scroll');
    hint(['ESC'], 'Back');
    const close = el('button', 'omfh-close', '×');
    close.title = 'Close';
    close.addEventListener('click', () => this.close());
    panel.append(toc, this.article, keys, close);
    root.appendChild(panel);
    // Clicks outside the panel close the help, like ESC.
    root.addEventListener('mousedown', (e) => {
      if (e.target === root) this.close();
    });
    document.body.appendChild(root);
    this.root = root;
    openPages++;
    this.show(0, false);
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
    this.root.remove();
    this.root = null;
    openPages--;
  }

  /** Nothing is drawn in the game: the page is HTML. It goes when the menu is done (closed or its scene left). */
  override render(): void {
    if (this.finished) this.remove();
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
