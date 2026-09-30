// The credits' end titles, over the city at dawn (stage.ts), on the song: first THE WINNERS, the seven credits landing one
// a bar, each with a picture of its fight's winner taken at the fight (creditsRun.ts rendered()); then, cut to the song's
// last chorus (song.ts), the rest a phrase at a time (the original game, the music, what the remaster is built with,
// thanks, the fine print) while the camera comes down to the statue; on the song's final hit the spotlight, the logo and
// THANKS FOR PLAYING. Worked out from the song's position each frame (update).
import placements from '../../../public/credits/title/title.json';
import { APP_VERSION } from '../../platform/versionLabel';
import { CREDIT_BATTLES, type CreditBattle } from './battles';
import type { FinaleTimes } from './creditsRun';
import { barAt, barTime, BEAT, ENDING_BAR } from './song';
import { clamp01, easeIn, easeOut, easeOutBack, hit, ramp, window01 } from './motion';

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
    from: 4, to: 7, html: () => `<h3>BUILT WITH</h3><div class="omff-grid">${BUILT_WITH.map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`).join('')}</div>`,
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
.omff a { pointer-events: auto; color: #9fe9ff; text-decoration: none; border-bottom: 1px solid rgba(159,233,255,.5); }
.omff-gallery { position: absolute; left: 0; right: 0; top: calc(var(--oy) + 6 * var(--uy)); display: flex; flex-direction: column;
  align-items: center; will-change: transform, opacity; }
.omff h2, .omff h3 { margin: 0; font-weight: 800; letter-spacing: .55em; margin-right: -.55em; color: #ffd84a;
  text-shadow: 0 0 16px rgba(255,190,60,.75), 0 2px 3px rgba(0,0,0,.8); }
.omff h2 { font-size: calc(5.4 * var(--uy)); margin-bottom: calc(4.5 * var(--uy)); }
.omff-cards { display: flex; flex-wrap: wrap; justify-content: center; gap: calc(4 * var(--uy)) calc(5 * var(--ux));
  width: calc(4 * 72 * var(--ux) + 3 * 5 * var(--ux)); }
.omff-card { margin: 0; width: calc(72 * var(--ux)); will-change: transform, opacity, filter; }
.omff-photo { position: relative; aspect-ratio: 3 / 2; border-radius: calc(1.2 * var(--ux)); overflow: hidden;
  background: radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--c) 45%, #0a0c1a), #05060d);
  box-shadow: 0 0 0 calc(.5 * var(--ux)) color-mix(in srgb, var(--c) 80%, #fff), 0 0 calc(5 * var(--ux)) color-mix(in srgb, var(--c) 55%, transparent),
    0 calc(2 * var(--uy)) calc(5 * var(--uy)) rgba(0,0,0,.6); }
.omff-photo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.omff-photo .omff-em { position: absolute; left: 50%; top: 50%; width: 40%; transform: translate(-50%, -50%); color: var(--c); }
.omff-card figcaption { margin-top: calc(1.6 * var(--uy)); text-align: center; }
.omff-card b { display: block; font-weight: 700; font-size: calc(2.8 * var(--uy)); letter-spacing: .28em; margin-right: -.28em;
  color: color-mix(in srgb, var(--c) 55%, #fff); text-shadow: 0 1px 2px #000; }
.omff-card span { display: block; margin-top: .35em; font-weight: 900; font-size: calc(4.1 * var(--uy)); letter-spacing: .04em;
  color: #fff; text-shadow: 0 0 12px color-mix(in srgb, var(--c) 80%, transparent), 0 2px 3px #000; white-space: nowrap; }
.omff-part { position: absolute; left: 6vw; right: 6vw; top: calc(var(--oy) + 22 * var(--uy)); display: flex; flex-direction: column;
  align-items: center; text-align: center; will-change: transform, opacity, filter; }
.omff-part h3 { font-size: calc(5.4 * var(--uy)); margin-bottom: calc(4.5 * var(--uy)); }
.omff-big { font-weight: 900; font-size: calc(13 * var(--uy)); letter-spacing: .05em; line-height: 1.05; color: #fff; margin-bottom: calc(2.5 * var(--uy));
  text-shadow: 0 0 22px rgba(255,150,90,.7), 0 4px 0 rgba(40,10,20,.6), 0 3px 8px rgba(0,0,0,.7); }
.omff-part p { margin: .45em 0; font-weight: 600; font-size: calc(4.3 * var(--uy)); letter-spacing: .05em; color: #fff4ea;
  text-shadow: 0 2px 4px rgba(0,0,0,.85), 0 0 18px rgba(0,0,0,.6); max-width: 60em; }
.omff-part .omff-dim { color: #f2e4ff; font-size: calc(3.4 * var(--uy)); }
.omff-part .omff-thanks { font-size: calc(5.6 * var(--uy)); font-weight: 700; }
.omff-part .omff-fine { font-size: calc(3.5 * var(--uy)); line-height: 1.6; font-weight: 500; }
.omff-nb { white-space: nowrap; }
.omff-grid { display: grid; grid-template-columns: repeat(2, minmax(0, calc(112 * var(--ux)))); gap: calc(2.8 * var(--uy)) calc(12 * var(--ux)); text-align: left; }
.omff-grid div { display: flex; flex-direction: column; gap: .3em; padding-left: calc(2 * var(--ux)); border-left: calc(.6 * var(--ux)) solid #ffb35c; }
.omff-grid b { font-weight: 800; font-size: calc(4.1 * var(--uy)); color: #fff; text-shadow: 0 2px 4px rgba(0,0,0,.85); }
.omff-grid span { font-weight: 600; font-size: calc(3.1 * var(--uy)); letter-spacing: .08em; color: #ffe0c2; text-shadow: 0 2px 3px rgba(0,0,0,.85); }
.omff-last { position: absolute; inset: 0; }
.omff-logo { position: absolute; left: calc(var(--ox) + 214 * var(--ux)); top: calc(var(--oy) + 16 * var(--uy)); width: calc(306 * var(--lx));
  height: calc(192 * var(--ly)); --lx: calc(var(--ux) * .52); --ly: calc(var(--uy) * .52); transform: translateX(-50%); transform-origin: 50% 50%; }
.omff-logo img { position: absolute; display: block; }
.omff-logo .omff-badge { filter: drop-shadow(0 0 calc(3 * var(--uy)) rgba(0,0,0,.85)); }
.omff-logo .omff-digit { filter: drop-shadow(0 0 8px rgba(90,220,255,.8)); }
.omff-end { position: absolute; left: calc(var(--ox) + 214 * var(--ux)); top: calc(var(--oy) + 122 * var(--uy)); transform: translateX(-50%);
  text-align: center; white-space: nowrap; }
.omff-end b { display: block; font-weight: 900; font-size: calc(8.2 * var(--uy)); letter-spacing: .1em; margin-right: -.1em; line-height: 1.1;
  background: linear-gradient(180deg, #ffffff 10%, #ffd84a 55%, #ff7a3d 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 20px rgba(255,160,60,.6)) drop-shadow(0 3px 2px rgba(0,0,0,.7)); }
.omff-end span { display: block; margin-top: calc(3 * var(--uy)); font-weight: 700; font-size: calc(2.6 * var(--uy)); letter-spacing: .5em;
  margin-right: -.5em; color: #ffe9d6; text-shadow: 0 2px 3px rgba(0,0,0,.9); }
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
  private cards: HTMLElement[];
  private photos: HTMLDivElement[];
  private parts: HTMLDivElement[];
  private last: HTMLDivElement;
  private logo: HTMLDivElement;
  private end: HTMLDivElement;
  private prev = -1;

  constructor(links: boolean, emblem: (b: CreditBattle) => string) {
    const el = (this.el = document.createElement('div'));
    el.className = 'omff';
    this.gallery = document.createElement('div');
    this.gallery.className = 'omff-gallery';
    this.gallery.innerHTML = `<h2>THE WINNERS</h2><div class="omff-cards">${CREDIT_BATTLES.map((b) => `<figure class="omff-card"
      style="--c: ${b.accent}"><div class="omff-photo"><div class="omff-em">${emblem(b)}</div></div><figcaption><b>${esc(b.role)}</b>
      <span>${esc(b.title)}</span></figcaption></figure>`).join('')}</div>`;
    this.cards = [...this.gallery.querySelectorAll<HTMLElement>('.omff-card')];
    this.photos = [...this.gallery.querySelectorAll<HTMLDivElement>('.omff-photo')];
    this.parts = PARTS.map((p) => {
      const d = document.createElement('div');
      d.className = 'omff-part';
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
    this.end.innerHTML = `<b>THANKS FOR PLAYING</b><span>ONE MUST FALL 2097 REMASTERED · V${esc(APP_VERSION)}</span>`;
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
    // Before the cut: the winners, one a bar (faster when the cut comes sooner), leaving on the cut's last two beats.
    const g0 = barAt(f.start);
    const room = Math.max(1, barAt(f.jump) - g0 - 1.5);
    const every = Math.min(1, room / (this.cards.length + 1));
    const out = post ? 1 : ramp(t, f.jump - 2 * BEAT, f.jump - 0.05);
    const galleryOn = !post && t > f.start - 0.1;
    this.gallery.style.visibility = galleryOn ? 'visible' : 'hidden';
    if (galleryOn) {
      const title = easeOut(ramp(t, barTime(g0 + 0.25), barTime(g0 + 0.25) + 0.5));
      (this.gallery.firstElementChild as HTMLElement).style.opacity = title.toFixed(3);
      this.gallery.style.opacity = (1 - easeIn(out)).toFixed(3);
      this.gallery.style.transform = `translateY(${(-easeIn(out) * 60).toFixed(1)}px) scale(${(1 + easeIn(out) * 0.08).toFixed(4)})`;
      this.cards.forEach((card, i) => {
        const at = barTime(g0 + 1 + i * every);
        const x = ramp(t, at - 0.05, at + 0.45);
        const s = easeOutBack(x, 1.5);
        const develop = ramp(t, at, at + 1.1);
        card.style.opacity = clamp01(x * 4).toFixed(3);
        card.style.transform = `translateY(${((1 - s) * -40).toFixed(1)}px) rotate(${((1 - s) * (i % 2 ? 4 : -4)).toFixed(2)}deg) scale(${(0.8 + 0.2 * s).toFixed(4)})`;
        card.style.filter = develop < 1 ? `brightness(${(1 + (1 - develop) * 2.2).toFixed(3)}) saturate(${(develop).toFixed(3)})` : '';
      });
    }
    // After the cut: the parts, a phrase each, drifting up.
    this.parts.forEach((el, i) => {
      const p = PARTS[i];
      const a = barTime(ENDING_BAR + p.from), b = barTime(ENDING_BAR + p.to);
      const on = post && t > a - 0.1 && t < b + 0.1;
      el.style.visibility = on ? 'visible' : 'hidden';
      if (!on) return;
      const v = window01(t, a, b, 0.45, 0.4);
      const rise = ramp(t, a, b);
      el.style.opacity = v.toFixed(3);
      el.style.transform = `translateY(${((1 - easeOut(ramp(t, a, a + 0.6))) * 30 - rise * 26).toFixed(1)}px)`;
      el.style.filter = v < 1 ? `blur(${((1 - v) * 6).toFixed(1)}px)` : '';
    });
    // The final hit: the logo struck in, THANKS FOR PLAYING.
    const H = f.hit;
    const lastOn = post && t > H - 0.05;
    this.last.style.visibility = lastOn ? 'visible' : 'hidden';
    if (lastOn) {
      const s = easeOutBack(ramp(t, H - 0.02, H + 0.3), 2);
      this.logo.style.opacity = clamp01((t - H + 0.02) / 0.06).toFixed(3);
      this.logo.style.transform = `translateX(-50%) scale(${(1.5 - 0.5 * s).toFixed(4)})`;
      this.logo.style.filter = `brightness(${(1 + hit(t, H, 0.25) * 2).toFixed(3)})`;
      const e = easeOut(ramp(t, H + BEAT, H + BEAT + 0.7));
      this.end.style.opacity = e.toFixed(3);
      this.end.style.transform = `translateX(-50%) translateY(${((1 - e) * 20).toFixed(1)}px)`;
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
