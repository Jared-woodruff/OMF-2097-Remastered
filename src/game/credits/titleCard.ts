// The credits' title, over the city at night (stage.ts) through the song's intro: four lines typing in, a bar apart,
// in a menu frame (look.ts) while the camera sinks from the clouds, each erased a letter at a time for the next; then on the drop the original game's logo, as its
// 1994 intro drew it (tools/credits/title.py cut its pictures out of the remaster's HD artwork): struck by lightning, and
// on the next bar's beats four bolts writing 2 0 9 7 into it; then REMASTERED stamped in a letter at a time, THE
// CREDITS in the menus' green. Worked out from the song's position each frame (update).
import placements from '../../../public/credits/title/title.json';
import { BEAT, barTime, SECTIONS } from './song';
import { eraseInto, typeInto } from './look';
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
.omft-box, .omft-logo, .omft-remastered, .omft-credits, .omft-tag { visibility: hidden; }
.omft-box { position: absolute; left: calc(var(--ox) + 22 * var(--ux)); top: calc(var(--oy) + 122 * var(--uy)); width: calc(276 * var(--ux));
  height: calc(46 * var(--uy)); padding: calc(5 * var(--uy)) calc(10 * var(--ux)); display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: calc(2.6 * var(--uy)); text-align: center; will-change: clip-path; }
.omft-kicker { font-size: calc(8 * var(--uy)); letter-spacing: .3em; margin-right: -.3em; }
.omft-text { font-size: max(11px, calc(4.4 * var(--uy))); letter-spacing: .1em; line-height: 1.45; white-space: normal; text-wrap: balance; }
.omft-logo { position: absolute; left: 50%; top: calc(var(--oy) + ${LOGO_TOP} * var(--uy)); width: calc(306 * var(--lx)); height: calc(192 * var(--ly));
  --lx: calc(var(--ux) * ${LOGO_SCALE}); --ly: calc(var(--uy) * ${LOGO_SCALE}); transform-origin: 50% 55%; will-change: transform, opacity; }
.omft-logo img { position: absolute; display: block; }
.omft-badge { filter: drop-shadow(calc(1.2 * var(--ux)) calc(1.2 * var(--uy)) 0 rgba(0,0,0,.85)); }
.omft-bolt, .omft-strike { mix-blend-mode: screen; opacity: 0; }
.omft-digit { opacity: 0; }
.omft-shine { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: screen;
  -webkit-mask: url(credits/title/badge.webp) center / 100% 100% no-repeat; mask: url(credits/title/badge.webp) center / 100% 100% no-repeat;
  background: linear-gradient(105deg, transparent 40%, rgba(255,255,255,.75) 50%, transparent 60%) no-repeat; background-size: 250% 100%; }
.omft-remastered { position: absolute; left: 0; right: 0; top: calc(var(--oy) + 136 * var(--uy)); text-align: center;
  font-size: calc(10 * var(--uy)); letter-spacing: .42em; margin-right: -.42em; color: #f2f4f7;
  text-shadow: calc(.8 * var(--ux)) calc(.8 * var(--uy)) 0 #0000f3, calc(1.6 * var(--ux)) calc(1.6 * var(--uy)) 0 #050608; }
.omft-credits { position: absolute; left: 0; right: 0; top: calc(var(--oy) + 159 * var(--uy)); text-align: center;
  font-size: calc(7 * var(--uy)); letter-spacing: .5em; margin-right: -.5em; }
.omft-tag { position: absolute; left: 0; right: 0; top: calc(var(--oy) + 172 * var(--uy)); text-align: center; letter-spacing: .3em;
  font-size: max(10px, calc(3.6 * var(--uy))); }
`;

export class TitleCard {
  readonly el: HTMLDivElement;
  /** The lines' frame, its year and its line. */
  private box: HTMLDivElement;
  private kicker: HTMLDivElement;
  private text: HTMLDivElement;
  private logo: HTMLDivElement;
  private strike: HTMLImageElement;
  private bolts: HTMLImageElement[];
  private digits: HTMLImageElement[];
  private shine: HTMLDivElement;
  private remastered: HTMLDivElement;
  private credits: HTMLDivElement;
  private tag: HTMLDivElement;
  private tagText: string;
  private last = -1;

  constructor(count: string) {
    const el = (this.el = document.createElement('div'));
    el.className = 'omft';
    this.box = document.createElement('div');
    this.box.className = 'omft-box omfg';
    this.kicker = document.createElement('div');
    this.kicker.className = 'omft-kicker omfg-b omfg-gold';
    this.text = document.createElement('div');
    this.text.className = 'omft-text omfg-s omfg-white';
    this.box.append(this.kicker, this.text);
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
    this.remastered.className = 'omft-remastered omfg-b';
    this.credits = document.createElement('div');
    this.credits.className = 'omft-credits omfg-b omfg-green';
    this.credits.textContent = 'THE CREDITS';
    this.tag = document.createElement('div');
    this.tag.className = 'omft-tag omfg-s omfg-gold';
    this.tagText = `${count} FIGHTS  ·  ${count} WINNERS`;
    el.append(this.box, this.logo, this.remastered, this.credits, this.tag);
  }

  /** A strike's point on the screen (CSS pixels): the middle of its digit. */
  private strikePoint(i: number): [number, number] {
    const r = this.digits[i].getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }

  /** Off the screen (outside the title). */
  hide(): void {
    for (const e of [this.box, this.logo, this.remastered, this.credits, this.tag]) e.style.visibility = 'hidden';
    this.last = -1;
  }

  /** The title at song time t (its end at `end`: it leaves in the last moment before). */
  update(t: number, end: number, ev: TitleEvents): void {
    const B = barTime;
    const BAR = B(1) - B(0);
    // The lines: the frame wiping open on the first line's bar, each line's year shown and its words typed in over most
    // of a bar, erased a letter at a time over the half bar before the next (the frame never stands empty); the frame
    // wiping shut on the drop.
    const first = B(LINES[0].from), last = Math.min(B(LINES[LINES.length - 1].to), end);
    const boxOn = t > first - 0.02 && t < last;
    this.box.style.visibility = boxOn ? 'visible' : 'hidden';
    if (boxOn) {
      const open = easeOut(ramp(t, first, first + 0.2)), shut = easeIn(ramp(t, last - 0.2, last));
      this.box.style.clipPath = `inset(0 ${((1 - open) * 100).toFixed(2)}% 0 ${(shut * 100).toFixed(2)}%)`;
      const at = LINES.findIndex((l, i) => t >= B(l.from) && t < Math.min(i + 1 < LINES.length ? B(LINES[i + 1].from) : B(l.to), end));
      const line = at >= 0 ? LINES[at] : null;
      this.kicker.style.display = line?.kicker ? '' : 'none';
      if (line) {
        const a = B(line.from) + 0.2;
        this.kicker.textContent = line.kicker;
        const next = LINES[at + 1];
        if (!next || t < B(line.to)) {
          typeInto(this.text, line.text, t, a + (line.kicker ? 0.25 : 0), (BAR * 0.8) / line.text.length, BAR);
        } else {
          // (by the next line's bar, the year last)
          const span = Math.max(0.1, B(next.from) - B(line.to) - 0.12);
          const left = Math.max(0, line.text.length - Math.floor(((t - B(line.to)) / span) * line.text.length));
          eraseInto(this.text, line.text, left);
          if (!left) this.kicker.style.display = 'none';
        }
      } else {
        this.text.textContent = '';
        this.text.dataset.typed = '';
      }
    }

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
        this.digits[i].style.filter = `brightness(${(1 + flare * 1.6).toFixed(2)})`;
      });
      // The shine sweeping over the logo on the bar after.
      const sh = ramp(t, B(SECTIONS.drop + 2), B(SECTIONS.drop + 3));
      this.shine.style.backgroundPosition = `${(130 - sh * 160).toFixed(1)}% 0`;
      this.shine.style.opacity = sh > 0 && sh < 1 ? '1' : '0';
    }
    // REMASTERED stamped in a letter a sixteenth; THE CREDITS on the next downbeat, the count typed in a beat after it.
    const stampAt = B(SECTIONS.drop + 2);
    const on = t < end - 0.05;
    this.remastered.style.visibility = t >= stampAt && on ? 'visible' : 'hidden';
    if (t >= stampAt && on) typeInto(this.remastered, 'REMASTERED', t, stampAt, BEAT / 4);
    const cr = B(SECTIONS.drop + 3);
    this.credits.style.visibility = t >= cr && on ? 'visible' : 'hidden';
    this.tag.style.visibility = t >= cr + BEAT && on ? 'visible' : 'hidden';
    if (t >= cr + BEAT && on) typeInto(this.tag, this.tagText, t, cr + BEAT, 0.02, BEAT * 3);

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
