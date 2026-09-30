// The credits' title, over the city at night (stage.ts) through the song's intro: four lines, a bar apart from each
// other's end, while the camera sinks from the clouds; then on the drop the original game's logo, as its 1994 intro drew
// it (tools/credits/title.py cut its pictures out of the remaster's HD artwork): struck by lightning, and on the next
// bar's four beats four bolts writing 2 0 9 7 into it; then REMASTERED, THE CREDITS. Worked out from the song's position
// each frame (update).
import placements from '../../../public/credits/title/title.json';
import { BEAT, barTime, SECTIONS } from './song';
import { clamp01, easeIn, easeOut, easeOutBack, hit, ramp, window01 } from './motion';

type Placed = keyof typeof placements;

/** The lines over the intro: a year, and what happened then; the bar each starts on and ends on. */
const LINES: { kicker: string; text: string; from: number; to: number }[] = [
  { kicker: '1994', text: 'DIVERSIONS ENTERTAINMENT MADE A GAME ABOUT GIANT FIGHTING ROBOTS', from: 2, to: 5.5 },
  { kicker: '2097', text: 'THEY SET IT A CENTURY AHEAD', from: 6, to: 9.5 },
  { kicker: '2026', text: 'THIRTY-TWO YEARS LATER, IT WAS BUILT AGAIN', from: 10, to: 13.5 },
  { kicker: '', text: 'FOR EVERYONE WHO NEVER STOPPED PLAYING', from: 14, to: 16 },
];

/** Where the 1994 intro drew its sprites (native pixels; the logo at 8, 5): the lightning and the digits it leaves. */
const LOGO_AT: [number, number] = [8, 5];
const STRIKES: { bolt: Placed; at: [number, number]; digit: Placed; digitAt: [number, number] }[] = [
  { bolt: 'bolt2', at: [0, 14], digit: 'digit2', digitAt: [110, 118] },
  { bolt: 'bolt0', at: [97, 0], digit: 'digit0', digitAt: [137, 118] },
  { bolt: 'bolt9', at: [117, 0], digit: 'digit9', digitAt: [165, 118] },
  { bolt: 'bolt7', at: [143, 38], digit: 'digit7', digitAt: [193, 118] },
];
const STRIKE_AT: [number, number] = [29, 0];

/** The logo's size on the screen (of its native size) and its top (native rows). */
export const LOGO_SCALE = 0.62;
const LOGO_TOP = 9;

export interface TitleEvents {
  /** A strike of lightning (song time `at`) at a point of the screen (CSS pixels): sparks, a ring, a flash. */
  strike(at: number, x: number, y: number, big: boolean): void;
}

function img(name: Placed, cls: string, origin: [number, number]): HTMLImageElement {
  const p = placements[name];
  const e = document.createElement('img');
  e.className = cls;
  e.alt = '';
  e.draggable = false;
  e.src = `credits/title/${name}.webp`;
  // (in the logo's native pixels: its sprite's place, and the picture's own place in its sprite)
  e.style.left = `calc(${origin[0] - LOGO_AT[0] + p.x} * var(--lx))`;
  e.style.top = `calc(${origin[1] - LOGO_AT[1] + p.y} * var(--ly))`;
  e.style.width = `calc(${p.w} * var(--lx))`;
  e.style.height = `calc(${p.h} * var(--ly))`;
  return e;
}

export const TITLE_CSS = `
.omft { position: absolute; inset: 0; pointer-events: none; }
.omft-line, .omft-logo, .omft-remastered, .omft-credits, .omft-tag { visibility: hidden; }
.omft-line { position: absolute; left: 6vw; right: 6vw; top: calc(var(--oy) + 150 * var(--uy)); text-align: center; }
.omft-kicker { font-weight: 800; letter-spacing: .6em; margin-right: -.6em; font-size: calc(5.2 * var(--uy)); color: #ffc840;
  text-shadow: 0 0 14px rgba(255,190,60,.7), 0 2px 2px rgba(0,0,0,.8); margin-bottom: .7em; }
.omft-text { font-weight: 600; letter-spacing: .3em; margin-right: -.3em; font-size: calc(4.6 * var(--uy)); line-height: 1.5;
  color: #e6eeff; text-shadow: 0 0 18px rgba(90,150,255,.65), 0 2px 3px rgba(0,0,0,.9); }
.omft-text b { font-weight: inherit; display: inline-block; white-space: nowrap; }
.omft-text span { display: inline-block; white-space: pre; will-change: opacity, transform, filter; }
.omft-logo { position: absolute; left: 50%; top: calc(var(--oy) + ${LOGO_TOP} * var(--uy)); width: calc(306 * var(--lx)); height: calc(192 * var(--ly));
  --lx: calc(var(--ux) * ${LOGO_SCALE}); --ly: calc(var(--uy) * ${LOGO_SCALE}); transform-origin: 50% 55%; will-change: transform, opacity; }
.omft-logo img { position: absolute; display: block; }
.omft-badge { filter: drop-shadow(0 0 calc(2 * var(--uy)) rgba(0,0,0,.9)); }
.omft-bolt, .omft-strike { mix-blend-mode: screen; opacity: 0; filter: drop-shadow(0 0 calc(1.5 * var(--uy)) #7fd6ff); }
.omft-digit { opacity: 0; }
.omft-shine { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: screen;
  -webkit-mask: url(credits/title/badge.webp) center / 100% 100% no-repeat; mask: url(credits/title/badge.webp) center / 100% 100% no-repeat;
  background: linear-gradient(105deg, transparent 40%, rgba(255,255,255,.75) 50%, transparent 60%) no-repeat; background-size: 250% 100%; }
.omft-remastered { position: absolute; left: 0; right: 0; top: calc(var(--oy) + 137 * var(--uy)); text-align: center; font-weight: 800;
  font-size: calc(9.6 * var(--uy)); letter-spacing: .5em; margin-right: -.5em; color: #c6f8ff;
  text-shadow: 0 0 6px #33e6ff, 0 0 20px #33e6ff, 0 0 46px #2f5bff; }
.omft-credits { position: absolute; left: 0; right: 0; top: calc(var(--oy) + 160 * var(--uy)); text-align: center; font-weight: 700;
  font-size: calc(4.4 * var(--uy)); letter-spacing: .9em; margin-right: -.9em; color: #ffd84a; text-shadow: 0 0 14px rgba(255,200,60,.8); }
.omft-tag { position: absolute; left: 0; right: 0; top: calc(var(--oy) + 172 * var(--uy)); text-align: center; font-weight: 700;
  font-size: calc(3 * var(--uy)); letter-spacing: .5em; margin-right: -.5em; color: #fff; text-shadow: 0 0 10px #ff3df2, 0 0 26px rgba(255,61,242,.7); }
`;

export class TitleCard {
  readonly el: HTMLDivElement;
  private lines: { el: HTMLDivElement; kicker: HTMLDivElement; letters: HTMLSpanElement[] }[] = [];
  private logo: HTMLDivElement;
  private strike: HTMLImageElement;
  private bolts: HTMLImageElement[];
  private digits: HTMLImageElement[];
  private shine: HTMLDivElement;
  private remastered: HTMLDivElement;
  private credits: HTMLDivElement;
  private tag: HTMLDivElement;
  private last = -1;

  constructor(count: string) {
    const el = (this.el = document.createElement('div'));
    el.className = 'omft';
    for (const l of LINES) {
      const line = document.createElement('div');
      line.className = 'omft-line';
      const kicker = document.createElement('div');
      kicker.className = 'omft-kicker';
      kicker.textContent = l.kicker;
      const text = document.createElement('div');
      text.className = 'omft-text';
      // (letters in words, which wrap as words)
      const letters: HTMLSpanElement[] = [];
      l.text.split(' ').forEach((word, w) => {
        if (w > 0) text.append(' ');
        const b = document.createElement('b');
        for (const ch of word) {
          const s = document.createElement('span');
          s.textContent = ch;
          b.appendChild(s);
          letters.push(s);
        }
        text.appendChild(b);
      });
      if (l.kicker) line.appendChild(kicker);
      line.appendChild(text);
      el.appendChild(line);
      this.lines.push({ el: line, kicker, letters });
    }
    this.logo = document.createElement('div');
    this.logo.className = 'omft-logo';
    this.strike = img('strike', 'omft-strike', STRIKE_AT);
    const badge = img('badge', 'omft-badge', LOGO_AT);
    this.digits = STRIKES.map((s) => img(s.digit, 'omft-digit', s.digitAt));
    this.bolts = STRIKES.map((s) => img(s.bolt, 'omft-bolt', s.at));
    this.shine = document.createElement('div');
    this.shine.className = 'omft-shine';
    this.shine.style.left = badge.style.left;
    this.shine.style.top = badge.style.top;
    this.shine.style.width = badge.style.width;
    this.shine.style.height = badge.style.height;
    this.logo.append(badge, ...this.digits, this.shine, this.strike, ...this.bolts);
    this.remastered = document.createElement('div');
    this.remastered.className = 'omft-remastered';
    this.remastered.textContent = 'REMASTERED';
    this.credits = document.createElement('div');
    this.credits.className = 'omft-credits';
    this.credits.textContent = 'THE CREDITS';
    this.tag = document.createElement('div');
    this.tag.className = 'omft-tag';
    this.tag.textContent = `${count} FIGHTS  ·  ${count} WINNERS`;
    el.append(this.logo, this.remastered, this.credits, this.tag);
  }

  /** A strike's point on the screen (CSS pixels): the middle of its digit. */
  private strikePoint(i: number): [number, number] {
    const r = this.digits[i].getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }

  /** Off the screen (outside the title). */
  hide(): void {
    for (const e of [...this.lines.map((l) => l.el), this.logo, this.remastered, this.credits, this.tag]) e.style.visibility = 'hidden';
    this.last = -1;
  }

  /** The title at song time t (its end at `end`: it leaves in the last moment before). */
  update(t: number, end: number, ev: TitleEvents): void {
    const B = barTime;
    // The lines: letters coming in one after another over most of a bar, the line leaving over the last half bar.
    LINES.forEach((l, i) => {
      const { el, kicker, letters } = this.lines[i];
      const a = B(l.from), b = Math.min(B(l.to), end);
      const on = t > a - 0.1 && t < b + 0.1;
      el.style.visibility = on ? 'visible' : 'hidden';
      if (!on) return;
      const out = ramp(t, b - (B(1) - B(0)) * 0.45, b);
      kicker.style.opacity = (easeOut(ramp(t, a, a + 0.5)) * (1 - out)).toFixed(3);
      kicker.style.transform = `translateY(${((1 - easeOut(ramp(t, a, a + 0.5))) * 12).toFixed(1)}px)`;
      const span = (B(1) - B(0)) * 0.85;
      letters.forEach((s, k) => {
        const at = a + 0.12 + (k / letters.length) * span;
        const x = easeOut(ramp(t, at, at + 0.35));
        s.style.opacity = (x * (1 - out)).toFixed(3);
        s.style.transform = `translateY(${((1 - x) * 10 - out * 14).toFixed(1)}px)`;
        s.style.filter = x < 1 || out > 0 ? `blur(${((1 - x) * 6 + out * 8).toFixed(1)}px)` : '';
      });
      el.style.letterSpacing = out > 0 ? `${(out * 0.3).toFixed(3)}em` : '';
    });

    // The logo: struck on the drop, written 2 0 9 7 on the next bar's beats.
    const drop = B(SECTIONS.drop);
    const logoOn = t > drop - 0.05 && t < end + 0.05;
    this.logo.style.visibility = logoOn ? 'visible' : 'hidden';
    const leave = ramp(t, end - 0.28, end);
    if (logoOn) {
      const slam = easeOutBack(ramp(t, drop - 0.02, drop + 0.26), 2.2);
      const s = (1.55 - 0.55 * slam) * (1 + easeIn(leave) * 0.35);
      this.logo.style.opacity = (clamp01((t - drop + 0.02) / 0.05) * (1 - leave)).toFixed(3);
      this.logo.style.transform = `translateX(-50%) scale(${s.toFixed(4)})`;
      this.strike.style.opacity = (hit(t, drop, 0.09) * (0.7 + 0.3 * Math.sin(t * 150))).toFixed(3);
      STRIKES.forEach((_, i) => {
        const at = B(SECTIONS.drop + 1) + i * BEAT;
        this.bolts[i].style.opacity = (window01(t, at - 0.02, at + 0.17, 0.02, 0.08) * (0.65 + 0.35 * Math.sin(t * 170 + i))).toFixed(3);
        const d = ramp(t, at + 0.04, at + 0.12);
        const flare = hit(t, at + 0.04, 0.35);
        this.digits[i].style.opacity = d.toFixed(3);
        this.digits[i].style.filter = `drop-shadow(0 0 ${(4 + flare * 26).toFixed(1)}px rgba(90,220,255,${(0.6 + flare * 0.4).toFixed(2)})) brightness(${(1 + flare * 1.6).toFixed(2)})`;
      });
      // The shine sweeping over the logo on the bar after.
      const sh = ramp(t, B(SECTIONS.drop + 2), B(SECTIONS.drop + 3));
      this.shine.style.backgroundPosition = `${(130 - sh * 160).toFixed(1)}% 0`;
      this.shine.style.opacity = sh > 0 && sh < 1 ? '1' : '0';
    }
    // REMASTERED lights up (a neon's flicker), THE CREDITS and the count follow.
    const neonAt = B(SECTIONS.drop + 2);
    const n = t - neonAt;
    const flicker = n < 0 ? 0 : n < 0.08 ? 1 : n < 0.12 ? 0.15 : n < 0.2 ? 1 : n < 0.3 ? 0.45 : 1;
    this.remastered.style.opacity = (flicker * (1 - leave)).toFixed(3);
    this.remastered.style.visibility = n > 0 && t < end + 0.05 ? 'visible' : 'hidden';
    const cr = easeOut(ramp(t, B(SECTIONS.drop + 3), B(SECTIONS.drop + 3) + 0.5));
    this.credits.style.visibility = this.tag.style.visibility = cr > 0 && t < end + 0.05 ? 'visible' : 'hidden';
    this.credits.style.opacity = (cr * (1 - leave)).toFixed(3);
    this.credits.style.transform = `translateY(${((1 - cr) * 16).toFixed(1)}px)`;
    const tg = easeOut(ramp(t, B(SECTIONS.drop + 3) + 2 * BEAT, B(SECTIONS.drop + 3) + 2 * BEAT + 0.5));
    this.tag.style.opacity = (tg * (1 - leave)).toFixed(3);

    // The strikes' sparks, once each (not when the time jumped past them).
    const fire = (at: number, f: () => void) => {
      if (this.last < at && t >= at && t - at < 0.25) f();
    };
    fire(drop, () => {
      const r = this.logo.getBoundingClientRect();
      ev.strike(drop, r.left + r.width / 2, r.top + r.height * 0.45, true);
    });
    STRIKES.forEach((_, i) => {
      const at = B(SECTIONS.drop + 1) + i * BEAT + 0.04;
      fire(at, () => ev.strike(at, ...this.strikePoint(i), false));
    });
    this.last = t;
  }
}
