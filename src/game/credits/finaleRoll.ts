// The credits' end titles, over the city at dawn (stage.ts), on the song, in the game's look (look.ts): first THE
// WINNERS, the seven credits drawn in one a bar, each with a picture of its fight's winner taken at the fight
// (creditsRun.ts rendered()); then, from the song's last sixteen bars (song.ts ENDING_BAR), the rest a phrase at a time
// in menu frames wiping open and shut (the original game, the music, what the remaster is built with, thanks, the fine
// print) while the camera comes down to the statue; on the song's final hit the spotlight, the logo and THANKS FOR
// PLAYING typing in. Worked out from the song's position each frame (update).
import placements from '../../../public/credits/title/title.json';
import { UI_FONT } from '../../platform/uiFont';
import { APP_VERSION } from '../../platform/versionLabel';
import { CREDIT_BATTLES, type CreditBattle } from './battles';
import type { FinaleTimes } from './creditsRun';
import { barAt, barTime, BEAT, ENDING_BAR } from './song';
import { typeInto } from './look';
import { clamp01, easeIn, easeOut, easeOutBack, hit, ramp } from './motion';

/** The projects and tools the remaster builds on. */
const BUILT_WITH: [string, string][] = [
  ['OpenOMF', 'MIT License'],
  ['xBR-lv2 by Hyllian', 'MIT License'],
  ['Orbitron by Matt McInerney', 'SIL Open Font License 1.1'],
  ['ElevenLabs · Eleven v4', "The announcers' voices"],
  ['FFmpeg', 'LGPL / GPL, as a tool'],
  ['Tauri', 'MIT / Apache-2.0'],
  ['Vite · TypeScript · Vitest', 'MIT / Apache-2.0'],
];

/** The end titles after the cut: the bars (from ENDING_BAR) each part comes in on and leaves on. */
const PARTS: { from: number; to: number; html: (links: boolean) => string }[] = [
  {
    from: 0, to: 2, html: () => `<h3>THE ORIGINAL GAME</h3><div class="omff-big">ONE MUST FALL 2097</div>
      <p><span class="omff-nb">© 1994 Diversions Entertainment</span> · <span class="omff-nb">Published by Epic MegaGames</span></p>
      <p>Freeware since 1999: everyone may share it, nobody may sell it.</p>`,
  },
  {
    from: 2, to: 4, html: (links) => `<h3>MUSIC</h3><div class="omff-big">HADAL STATIC</div><p>"Twenty Ninety-Seven (Remix)", the song playing now</p>
      <p>${links ? '<a href="https://www.hadalstatic.com/releases/twenty-ninety-seven/" target="_blank" rel="noopener noreferrer">hadalstatic.com</a>' : 'hadalstatic.com'}</p>
      <p class="omff-dim">The original soundtrack plays through the game's own music engine</p>`,
  },
  {
    from: 4, to: 7, html: () => `<h3>BUILT WITH</h3><div class="omff-grid">${BUILT_WITH.map(([n, l]) => `<div><b class="omfg-s omfg-white">${n}</b><span class="omfg-s omfg-dim">${l}</span></div>`).join('')}</div>`,
  },
  {
    from: 7, to: 9, html: () => `<h3>THANK YOU</h3><p class="omff-thanks">The OpenOMF project, for its years of research</p>
      <p class="omff-thanks">Everyone who kept One Must Fall alive</p><p class="omff-thanks">And you, for playing</p>`,
  },
  {
    from: 9, to: 11, html: () => `<p class="omff-fine">An unofficial fan remaster, not affiliated with or endorsed by Diversions Entertainment or
      Epic MegaGames. All trademarks belong to their owners.</p><p class="omff-fine">The remaster's code: MIT License. The original game's
      files and the artwork made from them: the game's freeware terms. <b>Free forever: never pay for this game.</b></p>`,
  },
];

/** The camera comes down to the statue from this bar (after ENDING_BAR), and is there on this one. */
export const DESCEND_FROM = 9;
export const DESCEND_TO = 14;

export const FINALE_CSS = `
.omff { position: absolute; inset: 0; pointer-events: none; }
.omff-gallery, .omff-part, .omff-last { visibility: hidden; }
.omff a { pointer-events: auto; color: #9fd0ff; text-decoration: none; }
.omff a:hover { color: #ffc840; text-decoration: underline; }
.omff-gallery { position: absolute; left: 0; right: 0; top: calc(var(--oy) + 8 * var(--uy)); display: flex; flex-direction: column;
  align-items: center; will-change: clip-path; }
.omff-gallery h2 { margin: 0 0 calc(6 * var(--uy)); font-size: calc(7 * var(--uy)); letter-spacing: .4em; margin-right: -.4em; }
.omff-cards { display: flex; flex-wrap: wrap; justify-content: center; gap: calc(5 * var(--uy)) calc(6 * var(--ux));
  width: calc(4 * 70 * var(--ux) + 3 * 6 * var(--ux)); }
.omff-card { margin: 0; width: calc(70 * var(--ux)); visibility: hidden; }
.omff-photo { position: relative; aspect-ratio: 3 / 2; overflow: hidden; background: #000; box-shadow: 0 0 0 var(--gb) var(--g-edge);
  will-change: clip-path; }
.omff-photo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.omff-photo .omff-em { position: absolute; left: 50%; top: 50%; width: 40%; transform: translate(-50%, -50%); }
.omff-photo .omfc-em { box-shadow: none; background: none; }
.omff-card figcaption { margin-top: calc(2.2 * var(--uy)); padding: calc(1.6 * var(--uy)) calc(1.5 * var(--ux)); text-align: center; }
.omff-card figcaption .omfg-s { display: block; font-size: max(8px, calc(2.6 * var(--uy))); letter-spacing: .06em; overflow: hidden;
  text-overflow: clip; }
.omff-part { position: absolute; left: calc(var(--ox) + 24 * var(--ux)); width: calc(272 * var(--ux)); top: calc(var(--oy) + 14 * var(--uy));
  padding: calc(7 * var(--uy)) calc(11 * var(--ux)) calc(6 * var(--uy)); display: flex; flex-direction: column; align-items: center;
  text-align: center; will-change: clip-path; }
.omff-part h3 { margin: 0 0 calc(4 * var(--uy)); font: 900 calc(6 * var(--uy)) / 1.1 ${UI_FONT}; letter-spacing: .4em; margin-right: -.4em;
  color: #00ff00; text-shadow: calc(.8 * var(--ux)) calc(.8 * var(--uy)) 0 #005800; }
.omff-big { margin-bottom: calc(3 * var(--uy)); font: 900 calc(9.5 * var(--uy)) / 1.1 ${UI_FONT}; letter-spacing: .06em; color: #ffff00;
  text-shadow: calc(.9 * var(--ux)) calc(.9 * var(--uy)) 0 #3a3a00; white-space: nowrap; }
.omff-part p { margin: .35em 0; font: 500 max(12px, calc(3.4 * var(--uy))) / 1.6 ${UI_FONT}; letter-spacing: .02em; color: #dde2ec;
  text-shadow: calc(.45 * var(--ux)) calc(.45 * var(--uy)) 0 #050608; max-width: 60em; }
.omff-part .omff-dim { color: #aab2bd; font-size: max(11px, calc(3 * var(--uy))); }
.omff-part .omff-thanks { font-weight: 700; font-size: max(13px, calc(4.2 * var(--uy))); color: #f2f4f7; }
.omff-part .omff-fine { font-size: max(11px, calc(3.1 * var(--uy))); line-height: 1.7; }
.omff-part .omff-fine b { color: #ffc840; font-weight: 700; }
.omff-nb { white-space: nowrap; }
.omff-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: calc(2.8 * var(--uy)) calc(12 * var(--ux)); width: 100%;
  text-align: left; }
.omff-grid div { display: flex; flex-direction: column; gap: .2em; }
.omff-grid b { font-size: max(10px, calc(3.2 * var(--uy))); }
.omff-grid span { font-size: max(9px, calc(2.6 * var(--uy))); letter-spacing: .1em; }
.omff-last { position: absolute; inset: 0; }
.omff-logo { position: absolute; left: calc(var(--ox) + 214 * var(--ux)); top: calc(var(--oy) + 16 * var(--uy)); width: calc(306 * var(--lx));
  height: calc(192 * var(--ly)); --lx: calc(var(--ux) * .52); --ly: calc(var(--uy) * .52); transform: translateX(-50%); transform-origin: 50% 50%; }
.omff-logo img { position: absolute; display: block; }
.omff-logo .omff-badge { filter: drop-shadow(calc(1.2 * var(--ux)) calc(1.2 * var(--uy)) 0 rgba(0,0,0,.85)); }
.omff-end { position: absolute; left: calc(var(--ox) + 214 * var(--ux)); top: calc(var(--oy) + 122 * var(--uy)); transform: translateX(-50%);
  text-align: center; white-space: nowrap; }
.omff-end b { display: block; font-size: calc(8 * var(--uy)); letter-spacing: .1em; margin-right: -.1em; }
.omff-end span { display: block; margin-top: calc(3 * var(--uy)); letter-spacing: .3em; margin-right: -.3em; }
`;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

type Placed = keyof typeof placements;
function logoImg(name: Placed, cls: string, x: number, y: number): string {
  const p = placements[name];
  return `<img class="${cls}" alt="" draggable="false" src="credits/title/${name}.webp" style="left: calc(${x + p.x} * var(--lx)); ` +
    `top: calc(${y + p.y} * var(--ly)); width: calc(${p.w} * var(--lx)); height: calc(${p.h} * var(--ly))">`;
}

export interface FinaleEvents {
  /** The final hit (once): the spotlight, a flash. */
  finalHit(): void;
}

export class FinaleRoll {
  readonly el: HTMLDivElement;
  private gallery: HTMLDivElement;
  private heading: HTMLElement;
  private cards: HTMLElement[];
  private photos: HTMLDivElement[];
  private parts: HTMLDivElement[];
  private last: HTMLDivElement;
  private logo: HTMLDivElement;
  private end: HTMLDivElement;
  private thanks: HTMLElement;
  private version: HTMLElement;
  private prev = -1;

  constructor(links: boolean, emblem: (b: CreditBattle) => string) {
    const el = (this.el = document.createElement('div'));
    el.className = 'omff';
    this.gallery = document.createElement('div');
    this.gallery.className = 'omff-gallery';
    this.gallery.innerHTML = `<h2 class="omfg-b omfg-green">THE WINNERS</h2><div class="omff-cards">${CREDIT_BATTLES.map((b) => `<figure class="omff-card"
      style="--c: ${b.accent}"><div class="omff-photo"><div class="omff-em">${emblem(b)}</div></div><figcaption class="omfg">
      <b class="omfg-s omfg-gold">${esc(b.role)}</b><span class="omfg-s omfg-white">${esc(b.title)}</span></figcaption></figure>`).join('')}</div>`;
    this.heading = this.gallery.querySelector('h2')!;
    this.cards = [...this.gallery.querySelectorAll<HTMLElement>('.omff-card')];
    this.photos = [...this.gallery.querySelectorAll<HTMLDivElement>('.omff-photo')];
    this.parts = PARTS.map((p) => {
      const d = document.createElement('div');
      d.className = 'omff-part omfg';
      d.innerHTML = p.html(links);
      return d;
    });
    this.last = document.createElement('div');
    this.last.className = 'omff-last';
    this.logo = document.createElement('div');
    this.logo.className = 'omff-logo';
    this.logo.innerHTML = logoImg('badge', 'omff-badge', 0, 0) +
      ([['digit2', 102], ['digit0', 129], ['digit9', 157], ['digit7', 185]] as [Placed, number][]).map(([n, x]) => logoImg(n, 'omff-digit', x, 113)).join('');
    this.end = document.createElement('div');
    this.end.className = 'omff-end';
    this.end.innerHTML = `<b class="omfg-b omfg-yellow"></b><span class="omfg-s omfg-grey"></span>`;
    this.thanks = this.end.querySelector('b')!;
    this.version = this.end.querySelector('span')!;
    this.last.append(this.logo, this.end);
    el.append(this.gallery, ...this.parts, this.last);
  }

  /** The picture of fight i's winner (an image URL). */
  still(i: number, url: string): void {
    const photo = this.photos[i];
    if (!photo) return;
    const img = document.createElement('img');
    img.alt = '';
    img.src = url;
    photo.querySelector('.omff-em')?.remove();
    photo.appendChild(img);
  }

  /** The end titles at song time t. */
  update(t: number, f: FinaleTimes, ev: FinaleEvents): void {
    this.el.style.display = '';
    const E0 = barTime(ENDING_BAR);
    const post = f.jumped && t >= E0 - 0.3;
    // Before the cut: the winners, one a bar (faster when the cut comes sooner), each picture drawn down from the top
    // and its caption under it; the whole wiping away over the cut's last two beats.
    const g0 = barAt(f.start);
    const room = Math.max(1, barAt(f.jump) - g0 - 1.5);
    const every = Math.min(1, room / (this.cards.length + 1));
    const out = post ? 1 : easeIn(ramp(t, f.jump - 2 * BEAT, f.jump - 0.05));
    const galleryOn = !post && t > f.start - 0.1 && out < 1;
    this.gallery.style.visibility = galleryOn ? 'visible' : 'hidden';
    if (galleryOn) {
      this.heading.style.visibility = t >= barTime(g0 + 0.25) ? 'inherit' : 'hidden';
      if (t >= barTime(g0 + 0.25)) typeInto(this.heading, 'THE WINNERS', t, barTime(g0 + 0.25), BEAT / 4);
      this.gallery.style.clipPath = `inset(0 0 0 ${(out * 100).toFixed(2)}%)`;
      this.cards.forEach((card, i) => {
        const at = barTime(g0 + 1 + i * every);
        const x = ramp(t, at, at + 0.35);
        card.style.visibility = t >= at ? 'inherit' : 'hidden';
        this.photos[i].style.clipPath = `inset(0 0 ${((1 - x) * 100).toFixed(1)}% 0)`;
        (card.lastElementChild as HTMLElement).style.visibility = x >= 1 ? 'inherit' : 'hidden';
      });
    }
    // After the cut: the parts, a phrase each, their frames wiping open and shut.
    this.parts.forEach((el, i) => {
      const p = PARTS[i];
      const a = barTime(ENDING_BAR + p.from), b = barTime(ENDING_BAR + p.to);
      const on = post && t > a - 0.02 && t < b;
      el.style.visibility = on ? 'visible' : 'hidden';
      if (!on) return;
      const open = easeOut(ramp(t, a, a + 0.22)), shut = easeIn(ramp(t, b - 0.24, b - 0.02));
      el.style.clipPath = `inset(0 ${((1 - open) * 100).toFixed(2)}% 0 ${(shut * 100).toFixed(2)}%)`;
    });
    // The final hit: the logo struck in, THANKS FOR PLAYING typing in a beat later.
    const H = f.hit;
    const lastOn = post && t > H - 0.05;
    this.last.style.visibility = lastOn ? 'visible' : 'hidden';
    if (lastOn) {
      const s = easeOutBack(ramp(t, H - 0.02, H + 0.3), 2);
      this.logo.style.opacity = clamp01((t - H + 0.02) / 0.06).toFixed(3);
      this.logo.style.transform = `translateX(-50%) scale(${(1.5 - 0.5 * s).toFixed(4)})`;
      this.logo.style.filter = `brightness(${(1 + hit(t, H, 0.25) * 2).toFixed(3)})`;
      typeInto(this.thanks, 'THANKS FOR PLAYING', t, H + BEAT, BEAT / 4, 4);
      const v = `ONE MUST FALL 2097 REMASTERED · V${APP_VERSION}`;
      typeInto(this.version, v, t, H + BEAT + 18 * (BEAT / 4) + 0.2, 0.025);
    }
    if (this.prev < H && t >= H && t - H < 0.3 && post) ev.finalHit();
    this.prev = t;
  }
}

/** The camera and the light of the end titles at song time t. */
export function finaleLook(t: number, f: FinaleTimes): { lift: number; zoom: number; pan: number; dawn: number; lit: number; stars: number } {
  const E0 = barTime(ENDING_BAR);
  const post = f.jumped && t >= E0 - 0.3;
  if (!post) {
    // (dawn breaking: the camera up in the sky, drifting)
    const k = ramp(t, f.start, f.jump);
    return { lift: 110 - k * 20, zoom: 1.04, pan: 40 - k * 30, dawn: 0.45 + k * 0.3, lit: 0, stars: 0.6 * (1 - k) };
  }
  const down = easeOut(ramp(t, barTime(ENDING_BAR + DESCEND_FROM), barTime(ENDING_BAR + DESCEND_TO)));
  const lit = t >= f.hit ? 1 : 0;
  const settle = hit(t, f.hit, 0.6);
  return { lift: 90 * (1 - down), zoom: 1.03 + settle * 0.05, pan: 10 * (1 - down) + 22 * down, dawn: 0.85 + down * 0.15, lit, stars: 0 };
}
