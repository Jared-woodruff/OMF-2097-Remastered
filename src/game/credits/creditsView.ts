// The remaster's credits on screen (EXTRAS > CREDITS, run by creditsRun.ts): HTML over the game, sharp at any resolution,
// every picture worked out from the song's position each frame (the show's timetable, see CreditsShow), so that it all
// lands on the music. The title (titleCard.ts) and the end titles (finaleRoll.ts) play over the main menu's painted city
// (stage.ts), at night and at dawn. Over each fight: a cover sweeping across on the downbeat that ends the fight before,
// the VS card slamming on a downbeat as the cover leaves, the game's picture punching on the downbeats, a flash on the
// final blow (on its beat), then the credit's card with its WINS stamp; a now playing chip and the controls throughout.
// Leaving, the picture switches off like an old TV.
import type { Track } from '../../audio/audio';
import { ensureUiFont, UI_FONT } from '../../platform/uiFont';
import { CREDIT_BATTLES, type CreditBattle, type CreditEmblem } from './battles';
import type { CreditsShow, FightTimes } from './creditsRun';
import { FINALE_CSS, FinaleRoll, finaleLook } from './finaleRoll';
import { beatPulse, clamp01, easeIn, easeOut, easeOutBack, hit, ramp, window01 } from './motion';
import { barTime, BEAT, ENDING_BAR, nextBar, SECTIONS } from './song';
import { Stage, type StageLook } from './stage';
import { TITLE_CSS, TitleCard } from './titleCard';

export interface CreditsViewOptions {
  /** Links open in the browser (the web version; the desktop app shows them as text). */
  links: boolean;
  song: Track | null;
  /** A robot's name (the game's language file). */
  harName: (harId: number) => string;
  /** The NEXT and BACK buttons (a click on the title and the end titles goes on, a right click goes back). */
  onNext: () => void;
  onExit: () => void;
}

export interface CreditsView {
  /** The show at a moment (dt: song seconds since the last frame). */
  update(show: CreditsShow, dt: number): void;
  /** A picture of fight i's winner (an image URL), for the end titles. */
  still(i: number, url: string): void;
  /** The song could not be played (the game's own music plays instead). */
  songFailed(): void;
  /** Input: the controls show again. */
  wake(): void;
  /** Leaving: the picture switches off. */
  leave(): void;
  dispose(): void;
}

const AVATAR = 'credits/jared-woodruff.jpg';
const SONG_COVER = 'credits/twenty-ninety-seven.jpg';
const CHIP_BARS = 5;
/** Seconds the controls and the hint stay up after the last input. */
const QUIET_AFTER = 4;
const NUMBERS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'];

/** The credits' emblems (in the credit's color, currentColor). */
const EMBLEMS: Record<Exclude<CreditEmblem, 'avatar' | 'cover'>, string> = {
  chip: `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true">
<path d="M36 26V12M50 26V6M64 26V12M36 74v14M50 74v20M64 74v14M26 36H12M26 50H6M26 64H12M74 36h14M74 50h20M74 64h14" stroke-width="3"/>
<rect x="26" y="26" width="48" height="48" rx="9" stroke-width="3" fill="rgba(0,0,0,.4)"/>
<g fill="currentColor" stroke="none"><circle cx="50" cy="6" r="3.2"/><circle cx="50" cy="94" r="3.2"/><circle cx="6" cy="50" r="3.2"/><circle cx="94" cy="50" r="3.2"/></g>
<rect x="38" y="38" width="24" height="24" rx="5" fill="currentColor" stroke="none"/></svg>`,
  prism: `<svg viewBox="0 0 100 100" fill="none" stroke-linecap="round" stroke-width="3.2" aria-hidden="true">
<path d="M4 60 L41 52" stroke="#ffffff"/><path d="M50 16 L78 70 L22 70 Z" stroke="currentColor" fill="rgba(170,255,220,.12)"/>
<path d="M63 47 L97 33" stroke="#ff4d7a"/><path d="M64 51 L97 44" stroke="#ffd84a"/><path d="M65 55 L97 55" stroke="#54ff7a"/>
<path d="M66 59 L97 66" stroke="#33e6ff"/><path d="M67 63 L97 77" stroke="#9a6bff"/></svg>`,
  wave: `<svg viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">${[22, 40, 64, 48, 84, 58, 72, 38, 20]
    .map((h, i) => `<rect x="${6 + i * 10.5}" y="${50 - h / 2}" width="7" height="${h}" rx="3.5"/>`).join('')}</svg>`,
  code: `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<path d="M33 27 L11 50 L33 73 M67 27 L89 50 L67 73" stroke-width="8"/><path d="M58 17 L42 83" stroke-width="7"/></svg>`,
  disk: `<svg viewBox="0 0 100 100" aria-hidden="true">
<path d="M16 8h60l16 16v62a6 6 0 0 1-6 6H16a6 6 0 0 1-6-6V14a6 6 0 0 1 6-6z" fill="currentColor"/>
<rect x="28" y="8" width="42" height="28" rx="2" fill="#20242e"/><rect x="55" y="12" width="9" height="20" rx="1.5" fill="currentColor"/>
<rect x="20" y="50" width="60" height="36" rx="3" fill="#f4efe6"/>
<path d="M28 61h44M28 69h44M28 77h28" stroke="#9aa0ad" stroke-width="3" stroke-linecap="round"/></svg>`,
};

const X_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const NEXT_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 5l8 7-8 7zM12 5l8 7-8 7z"/></svg>`;

const CSS = `
.omfc { position: fixed; inset: 0; z-index: 18; overflow: hidden; pointer-events: none; user-select: none; color: #e8f0ff;
  font-family: ${UI_FONT}; --ux: 4.5px; --uy: 5.4px; --ox: 0px; --oy: 0px; }
.omfc a, .omfc button { pointer-events: auto; }
.omfc-stage { position: absolute; inset: 0; background: #03050f; }
.omfc-stage.omfc-click { pointer-events: auto; cursor: default; }
.omfs { position: absolute; inset: 0; overflow: hidden; }
.omfs-world { position: absolute; inset: 0; }
.omfs-world canvas, .omfs-front { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.omfs-layer { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.omfs-robot_lit { opacity: 0; }
.omfs-horizon { position: absolute; left: 0; right: 0; top: 0; height: 100%; pointer-events: none; opacity: 0; mix-blend-mode: screen;
  background: linear-gradient(0deg, rgba(255,150,80,.85) 0%, rgba(255,95,120,.55) 16%, rgba(190,80,190,.22) 36%, transparent 62%); }
.omfs::after { content: ''; position: absolute; inset: 0; pointer-events: none; opacity: var(--veil, 0); mix-blend-mode: multiply;
  background: radial-gradient(ellipse at 50% 40%, #1a2350 0%, #0a0f28 45%, #020308 100%); }
.omfc-vignette { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(0,0,0,.6)); }
.omfc-grain { position: absolute; inset: -50%; pointer-events: none; opacity: .07; mix-blend-mode: overlay; }

/* Over the fights. */
.omfc-cover { position: absolute; inset: 0; visibility: hidden; will-change: clip-path;
  background: linear-gradient(115deg, color-mix(in srgb, var(--c) 30%, #03040c) 0%, #04050e 55%, color-mix(in srgb, var(--o) 26%, #03040c) 100%); }
.omfc-cover::after { content: ''; position: absolute; inset: 0; opacity: .5;
  background: repeating-linear-gradient(115deg, rgba(255,255,255,.035) 0 2px, transparent 2px 22px); }
.omfc-next { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); text-align: center; z-index: 1; will-change: transform, opacity; }
.omfc-next-count { font-weight: 700; letter-spacing: .6em; margin-right: -.6em; font-size: calc(3.4 * var(--uy)); color: rgba(235,240,255,.85);
  text-shadow: 0 1px 3px #000; }
.omfc-next-role { margin-top: .15em; font-weight: 900; font-size: calc(16 * var(--uy)); letter-spacing: .06em; line-height: 1; color: transparent;
  -webkit-text-stroke: calc(.35 * var(--uy)) color-mix(in srgb, var(--c) 80%, #fff); text-shadow: 0 0 40px color-mix(in srgb, var(--c) 45%, transparent);
  white-space: nowrap; }
.omfc-vs { --h: clamp(118px, 24vh, 300px); --vs: clamp(44px, 6.4vw, 140px); position: absolute; left: 0; right: 0; top: 20%; height: var(--h);
  visibility: hidden; }
.omfc-vs-band { position: absolute; top: 0; bottom: 0; width: calc(50% + var(--h) / 4 - .8vw); box-sizing: border-box; display: flex;
  align-items: center; will-change: transform; }
.omfc-vs-l { left: 0; justify-content: flex-end; padding: 0 calc(var(--h) / 4 + var(--vs) * .9 + 1.6vw) 0 3vw;
  clip-path: polygon(0 0, 100% 0, calc(100% - var(--h) / 2) 100%, 0 100%);
  background: linear-gradient(90deg, rgba(3,4,12,0), color-mix(in srgb, var(--c) 26%, #04050e) 36%, color-mix(in srgb, var(--c) 55%, #04050e));
  box-shadow: inset 0 3px 0 var(--c), inset 0 -3px 0 var(--c); }
.omfc-vs-r { right: 0; justify-content: flex-start; padding: 0 3vw 0 calc(var(--h) / 4 + var(--vs) * .9 + 1.6vw);
  clip-path: polygon(calc(var(--h) / 2) 0, 100% 0, 100% 100%, 0 100%);
  background: linear-gradient(270deg, rgba(3,4,12,0), color-mix(in srgb, var(--o) 26%, #04050e) 36%, color-mix(in srgb, var(--o) 55%, #04050e));
  box-shadow: inset 0 3px 0 var(--o), inset 0 -3px 0 var(--o); }
.omfc-vs-who { display: flex; flex-direction: column; max-width: 100%; }
.omfc-vs-l .omfc-vs-who { align-items: flex-end; text-align: right; }
.omfc-vs-r .omfc-vs-who { align-items: flex-start; text-align: left; }
.omfc-vs-role { font-weight: 700; letter-spacing: .36em; font-size: clamp(10px, 1vw, 19px); color: color-mix(in srgb, var(--c) 60%, #fff);
  text-shadow: 0 0 10px var(--c), 0 1px 2px #000; }
.omfc-vs-l .omfc-vs-role { margin-right: -.36em; }
.omfc-vs-r .omfc-vs-role { color: color-mix(in srgb, var(--o) 45%, #fff); text-shadow: 0 0 10px var(--o), 0 1px 2px #000; }
.omfc-vs-name { margin: .12em 0 .3em; font-weight: 900; line-height: 1.05; letter-spacing: .03em; color: #fff; white-space: nowrap;
  font-size: clamp(15px, min(3.4vw, calc((50vw - var(--vs) * .9 - 6vw) / var(--n) / .84)), 66px); text-shadow: 0 0 18px var(--c), 0 3px 0 rgba(0,0,0,.6); }
.omfc-vs-r .omfc-vs-name { text-shadow: 0 0 18px var(--o), 0 3px 0 rgba(0,0,0,.6); }
.omfc-vs-har { font-weight: 800; letter-spacing: .3em; font-size: clamp(9px, .8vw, 15px); padding: .4em .6em .4em .9em; border-radius: 999px;
  color: #fff; background: rgba(0,0,0,.4); border: 1px solid color-mix(in srgb, var(--c) 70%, #fff); }
.omfc-vs-r .omfc-vs-har { border-color: color-mix(in srgb, var(--o) 60%, #fff); }
.omfc-vs-mid { position: absolute; left: 50%; top: 50%; z-index: 1; font-weight: 900; font-style: italic; font-size: var(--vs);
  line-height: 1; padding: 0 .12em; background: linear-gradient(180deg, #fff 0%, #ffe9a8 36%, #ff9a3d 50%, #a8231c 55%, #ffcf70 72%, #fff 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent; will-change: transform, opacity;
  filter: drop-shadow(0 0 16px rgba(255,150,60,.75)) drop-shadow(0 5px 0 rgba(0,0,0,.75)); }
.omfc-vs-seam { position: absolute; left: 50%; top: -30%; width: calc(var(--h) * .75); height: 160%; transform: translateX(-50%);
  mix-blend-mode: screen; opacity: 0; filter: drop-shadow(0 0 12px #7fd6ff); }
.omfc-vs-count { position: absolute; left: 0; right: 0; bottom: calc(100% + clamp(6px, 1.2vh, 14px)); text-align: center; font-weight: 700;
  letter-spacing: .45em; font-size: clamp(9px, .8vw, 14px); color: rgba(235,240,255,.9); text-shadow: 0 1px 3px #000, 0 0 12px rgba(0,0,0,.8); }

.omfc-scrim { position: absolute; left: 0; right: 0; top: 0; height: 58%; pointer-events: none; opacity: 0;
  background: linear-gradient(180deg, rgba(2,3,10,.88) 0%, rgba(2,3,10,.6) 45%, transparent 100%); }
.omfc-card { --e: calc(22 * var(--uy)); position: absolute; left: calc(var(--ox) + 12 * var(--ux)); right: calc(var(--ox) + 12 * var(--ux));
  top: calc(var(--oy) + 34 * var(--uy)); display: grid; grid-template-columns: var(--e) minmax(0, 1fr); column-gap: calc(7 * var(--ux));
  align-items: center; visibility: hidden; }
.omfc-card .omfc-em { will-change: transform, opacity; }
.omfc-card-head { display: flex; align-items: center; gap: 1.2em; font-weight: 700; letter-spacing: .42em; font-size: calc(3.1 * var(--uy));
  color: color-mix(in srgb, var(--c) 60%, #fff); text-shadow: 0 0 10px var(--c), 0 1px 2px #000; }
.omfc-card-head i { flex: 1; height: 2px; background: linear-gradient(90deg, var(--c), transparent); box-shadow: 0 0 10px var(--c);
  transform-origin: 0 50%; }
.omfc-card-head em { font-style: normal; letter-spacing: .3em; font-size: .8em; color: rgba(225,232,255,.75); }
.omfc-card-name { margin: calc(.6 * var(--uy)) 0 calc(1.4 * var(--uy)); font-weight: 900; line-height: 1.04; letter-spacing: .02em; white-space: nowrap;
  font-size: min(calc(12.5 * var(--uy)), calc((100vw - 2 * var(--ox) - 60 * var(--ux)) / var(--n) / .86)); }
.omfc-card-name span { display: inline-block; white-space: pre; color: #fff; will-change: transform, opacity;
  text-shadow: 0 0 22px color-mix(in srgb, var(--c) 85%, transparent), 0 5px 0 rgba(0,0,0,.55); }
.omfc-card-detail { font-weight: 500; font-size: calc(3.8 * var(--uy)); line-height: 1.4; letter-spacing: .02em; color: #dde3f4;
  text-shadow: 0 2px 3px rgba(0,0,0,.9); }
.omfc-card .omfc-link { display: inline-block; margin-top: calc(2 * var(--uy)); font-weight: 600; font-size: calc(2.9 * var(--uy));
  letter-spacing: .08em; text-decoration: none; color: #fff; padding: .45em 1.1em; border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--c) 70%, transparent); background: color-mix(in srgb, var(--c) 16%, rgba(0,0,0,.4)); }
.omfc-card a.omfc-link:hover { background: color-mix(in srgb, var(--c) 34%, transparent); box-shadow: 0 0 20px var(--c); }
.omfc-stamp { position: absolute; right: 0; top: calc(-3 * var(--uy)); padding: .16em .55em .2em .67em; border: 3px solid var(--c); border-radius: 10px;
  font-weight: 900; font-size: calc(6 * var(--uy)); letter-spacing: .12em; color: #fff; background: rgba(6,7,18,.88); text-shadow: 0 0 12px var(--c);
  box-shadow: 0 0 22px color-mix(in srgb, var(--c) 60%, transparent); opacity: 0; will-change: transform, opacity; }
.omfc-flash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; }

/* Emblems. */
.omfc-em { position: relative; width: 100%; aspect-ratio: 1; color: var(--c); }
.omfc-em svg { display: block; width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0 0 10px color-mix(in srgb, var(--c) 70%, transparent)); }
.omfc-em img { display: block; width: 100%; height: 100%; object-fit: cover; }
.omfc-em-avatar img { border-radius: 50%; box-shadow: 0 0 0 3px var(--c), 0 0 24px var(--c); }
.omfc-em-cover img { border-radius: 12%; box-shadow: 0 0 0 2px color-mix(in srgb, var(--c) 70%, #fff), 0 0 24px var(--c); }

/* The now playing chip, the controls and the hint. */
.omfc-playing { position: absolute; left: clamp(10px, 1.6vw, 28px); bottom: clamp(10px, 2vh, 26px); display: flex; align-items: center; gap: .9em;
  padding: .55em 1.1em .55em .55em; border-radius: 14px; background: rgba(10,8,34,.62); border: 1px solid rgba(255,61,242,.4);
  box-shadow: 0 0 22px rgba(255,61,242,.25); backdrop-filter: blur(6px); opacity: 0; font-size: clamp(9px, .72vw, 13px); }
.omfc-playing img { width: 3.6em; height: 3.6em; border-radius: 8px; object-fit: cover; }
.omfc-playing b { display: block; font-weight: 700; letter-spacing: .3em; font-size: .78em; color: #ff9af2; }
.omfc-playing span { display: block; margin-top: .3em; font-weight: 800; letter-spacing: .06em; color: #fff; }
.omfc-playing em { display: block; margin-top: .2em; font-style: normal; font-weight: 600; letter-spacing: .2em; color: #9fe9ff; font-size: .85em; }
.omfc-eq { display: flex; align-items: flex-end; gap: 3px; height: 2.4em; width: 3.2em; margin-left: .4em; }
.omfc-eq i { flex: 1; height: 100%; border-radius: 3px 3px 1px 1px; transform-origin: bottom; transform: scaleY(.06);
  background: linear-gradient(0deg, #2f5bff, #33e6ff 55%, #ff3df2); box-shadow: 0 0 10px rgba(51,230,255,.5); }
.omfc-ctl { position: absolute; right: clamp(10px, 1.6vw, 28px); bottom: clamp(10px, 2vh, 26px); display: flex; gap: .6em; transition: opacity .8s; }
.omfc-btn { display: flex; align-items: center; gap: .65em; font: 700 clamp(11px, .85vw, 16px)/1 ${UI_FONT}; letter-spacing: .22em; color: #d3e2ff;
  cursor: pointer; background: rgba(10,16,52,.62); border: 1px solid rgba(80,120,255,.5); border-radius: 999px; padding: .8em 1.3em;
  backdrop-filter: blur(6px); transition: color .2s, border-color .2s, box-shadow .2s; }
.omfc-btn:hover { color: #fff; border-color: #33e6ff; box-shadow: 0 0 20px rgba(51,230,255,.55); }
.omfc-btn svg { width: 1.1em; height: 1.1em; }
.omfc-hint { position: absolute; left: 0; right: 0; bottom: clamp(16px, 2.8vh, 34px); text-align: center; pointer-events: none;
  font-weight: 600; font-size: clamp(10px, .8vw, 14px); letter-spacing: .3em; color: rgba(215,225,255,.8); text-shadow: 0 1px 3px #000;
  transition: opacity .8s; }
.omfc-quiet .omfc-ctl, .omfc-quiet .omfc-hint { opacity: 0; }
@media (max-width: 900px) { .omfc-hint { display: none; } .omfc-btn span { display: none; } }

/* Switching off, like an old TV: the picture folds to a line, the line to a dot, the dot goes out. */
@keyframes omfc-off { 0% { transform: none; filter: none; } 42% { transform: scale(1, .004); filter: brightness(2.6); }
  78% { transform: scale(.004, .004); filter: brightness(4); } 100% { transform: scale(0, 0); filter: brightness(4); } }
.omfc-off, .omfc-off-screen { animation: omfc-off .85s cubic-bezier(.55,0,.8,.4) forwards; }
`;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** A credit's emblem (the avatar, the song's cover, or a drawing in its color). */
export function emblemHtml(kind: CreditEmblem): string {
  if (kind === 'avatar') return `<div class="omfc-em omfc-em-avatar"><img alt="" src="${AVATAR}" draggable="false"></div>`;
  if (kind === 'cover') return `<div class="omfc-em omfc-em-cover"><img alt="" src="${SONG_COVER}" draggable="false"></div>`;
  return `<div class="omfc-em">${EMBLEMS[kind]}</div>`;
}

function link(b: CreditBattle, links: boolean): string {
  if (!b.link) return '';
  return links
    ? `<a class="omfc-link" href="${b.link.href}" target="_blank" rel="noopener noreferrer">${esc(b.link.label)}</a>`
    : `<span class="omfc-link">${esc(b.link.label)}</span>`;
}

/** Film grain: a tile of noise, drawn once. */
function grainUrl(): string {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const d = g.createImageData(128, 128);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = Math.random() * 255;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  return c.toDataURL();
}

export function openCreditsView(opts: CreditsViewOptions): CreditsView {
  if (!document.getElementById('omfc-style')) {
    ensureUiFont();
    const style = document.createElement('style');
    style.id = 'omfc-style';
    style.textContent = CSS + TITLE_CSS + FINALE_CSS;
    document.head.appendChild(style);
  }
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const count = NUMBERS[CREDIT_BATTLES.length] ?? String(CREDIT_BATTLES.length);
  const root = document.createElement('div');
  root.className = 'omfc';
  root.innerHTML = `<div class="omfc-stage"><div class="omfc-vignette"></div></div>
<div class="omfc-cover"></div>
<div class="omfc-scrim"></div>
<div class="omfc-card"></div>
<div class="omfc-vs"></div>
<div class="omfc-flash"></div>
<div class="omfc-playing"><img alt="" src="${SONG_COVER}"><div><b>NOW PLAYING</b><span>TWENTY NINETY-SEVEN (REMIX)</span><em>HADAL STATIC</em></div>
  <div class="omfc-eq">${'<i></i>'.repeat(CHIP_BARS)}</div></div>
<div class="omfc-ctl"><button class="omfc-btn omfc-next" type="button"><span>NEXT</span>${NEXT_SVG}</button>
  <button class="omfc-btn omfc-back" type="button">${X_SVG}<span>BACK</span></button></div>
<div class="omfc-hint">ENTER / A &nbsp;NEXT &nbsp;&nbsp;·&nbsp;&nbsp; ESC / B &nbsp;BACK</div>
<div class="omfc-grain"></div>`;
  document.body.appendChild(root);
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const stageEl = q('.omfc-stage');
  const cover = q('.omfc-cover');
  const scrim = q('.omfc-scrim');
  const cardEl = q('.omfc-card');
  const vsEl = q('.omfc-vs');
  const flashEl = q('.omfc-flash');
  const playing = q('.omfc-playing');
  const eq = [...root.querySelectorAll<HTMLElement>('.omfc-eq i')];
  const grain = q('.omfc-grain');
  grain.style.background = `url(${grainUrl()})`;
  const stage = new Stage(calm);
  const title = new TitleCard(count);
  const finale = new FinaleRoll(opts.links, (b) => emblemHtml(b.emblem));
  stageEl.prepend(stage.el);
  stageEl.append(title.el, finale.el);
  // (the light in front: over the city, and over the game in the fights)
  root.insertBefore(stage.front, flashEl);
  const screen = document.getElementById('screen');
  let song = opts.song;
  const bins = new Uint8Array(song?.analyser.frequencyBinCount ?? 0);
  let level = 0;
  let quiet = QUIET_AFTER;
  let shown = -1;
  let cardLetters: HTMLSpanElement[] = [];
  let stamp: HTMLElement | null = null;
  let cardEmblem: HTMLElement | null = null;
  let cardHead: { line: HTMLElement; detail: HTMLElement; link: HTMLElement | null } | null = null;
  let vsParts: { l: HTMLElement; r: HTMLElement; mid: HTMLElement; seam: HTMLImageElement; count: HTMLElement } | null = null;
  let prevT = -1;
  /** Flashes of light (their song time and strength): each event's once. */
  const flashes: [number, number, number][] = [];
  const fired = new Set<string>();
  const once = (key: string, t: number, at: number, f: () => void) => {
    if (fired.has(key) || t < at || t - at > 0.4) return;
    fired.add(key);
    f();
  };
  const addFlash = (at: number, k: number, decay = 0.2) => flashes.push([at, k, decay]);
  let leaving = false;

  const wake = () => {
    root.classList.remove('omfc-quiet');
    quiet = QUIET_AFTER;
  };
  /** The game's 320 x 200 picture in the page (as the renderer fits it), for the cards and the flashes. */
  const place = () => {
    const r = screen?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    let uy = r.height / 200, ux = uy * (5 / 6);
    if (320 * ux > r.width) {
      ux = r.width / 320;
      uy = ux * 1.2;
    }
    root.style.setProperty('--ux', `${ux}px`);
    root.style.setProperty('--uy', `${uy}px`);
    root.style.setProperty('--ox', `${r.left + (r.width - 320 * ux) / 2}px`);
    root.style.setProperty('--oy', `${r.top + (r.height - 200 * uy) / 2}px`);
    return { ux, uy, ox: r.left + (r.width - 320 * ux) / 2, oy: r.top + (r.height - 200 * uy) / 2 };
  };
  let px = place();
  const onResize = () => {
    px = place();
    stage.resize();
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', wake);
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);
  // The title and the end titles: a click goes on, a right click goes back.
  stageEl.addEventListener('click', (e) => {
    if (!(e.target as Element).closest('a, button')) opts.onNext();
  });
  stageEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    opts.onExit();
  });
  q('.omfc-next').addEventListener('click', () => opts.onNext());
  q('.omfc-back').addEventListener('click', () => opts.onExit());

  let nextFor = -1;
  /** The cover's heading: the fight coming up. */
  const makeNext = (n: number) => {
    nextFor = n;
    const b = CREDIT_BATTLES[n];
    cover.style.cssText = `--c: ${b.accent}; --o: ${b.loser.colors?.[0] ?? '#8a8a8a'}`;
    cover.innerHTML = `<div class="omfc-next"><div class="omfc-next-count">CREDIT ${n + 1} OF ${CREDIT_BATTLES.length}</div>
      <div class="omfc-next-role">${esc(b.role)}</div></div>`;
  };

  /** The cards of fight n (made when it comes on). */
  const makeCards = (n: number) => {
    const b = CREDIT_BATTLES[n];
    shown = n;
    const o = b.loser.colors?.[0] ?? '#8a8a8a';
    for (const el of [vsEl, cardEl, scrim]) el.style.cssText = `--c: ${b.accent}; --o: ${o}`;
    const side = (cls: string, role: string, name: string, har: string) => `<div class="omfc-vs-band ${cls}"><div class="omfc-vs-who">
      <div class="omfc-vs-role">${esc(role)}</div><div class="omfc-vs-name" style="--n: ${name.length}">${esc(name)}</div>
      <div class="omfc-vs-har">${esc(har.toUpperCase())}</div></div></div>`;
    vsEl.innerHTML = `<div class="omfc-vs-count">CREDIT ${n + 1} OF ${CREDIT_BATTLES.length}</div>
      ${side('omfc-vs-l', b.role, b.winner.name, opts.harName(b.winner.har))}${side('omfc-vs-r', 'OPPONENT', b.loser.name, opts.harName(b.loser.har))}
      <img class="omfc-vs-seam" alt="" src="credits/title/strike.webp"><div class="omfc-vs-mid">VS</div>`;
    vsParts = { l: vsEl.querySelector('.omfc-vs-l')!, r: vsEl.querySelector('.omfc-vs-r')!, mid: vsEl.querySelector('.omfc-vs-mid')!,
      seam: vsEl.querySelector('.omfc-vs-seam')!, count: vsEl.querySelector('.omfc-vs-count')! };
    cardEl.innerHTML = `${emblemHtml(b.emblem)}<div><div class="omfc-card-head"><span>${esc(b.role)}</span><i></i><em>${n + 1} / ${CREDIT_BATTLES.length}</em></div>
      <div class="omfc-card-name" style="--n: ${b.title.length}">${[...b.title].map((ch) => `<span>${esc(ch)}</span>`).join('')}</div>
      <div class="omfc-card-detail">${esc(b.detail)}</div>${link(b, opts.links)}</div><div class="omfc-stamp">WINS</div>`;
    cardLetters = [...cardEl.querySelectorAll<HTMLSpanElement>('.omfc-card-name span')];
    stamp = cardEl.querySelector('.omfc-stamp');
    cardEmblem = cardEl.querySelector('.omfc-em');
    cardHead = { line: cardEl.querySelector('.omfc-card-head i')!, detail: cardEl.querySelector('.omfc-card-detail')!, link: cardEl.querySelector('.omfc-link') };
  };

  /** Over fight n (its timetable f, the one before it `prev`) at song time t: the cover, the VS card, the blow, the card. */
  const fightOverlay = (t: number, n: number, f: FightTimes | null, prevCut: number, fighters: [number, number][] | null) => {
    if (n !== shown) makeCards(n);
    // The cover: sweeping across on the downbeat that ended the fight before, until this one's VS card.
    const coverFrom = prevCut, coverTo = f ? f.vs : Infinity;
    const inCover = t >= coverFrom && t < coverTo + 0.2;
    cover.style.visibility = inCover ? 'visible' : 'hidden';
    if (inCover) {
      const upcoming = f ? n : Math.min(n + 1, CREDIT_BATTLES.length - 1);
      if (upcoming !== nextFor) makeNext(upcoming);
      const sweep = easeOut(ramp(t, coverFrom, coverFrom + BEAT));
      const gone = easeIn(ramp(t, coverTo - 0.02, coverTo + 0.18));
      const edge = sweep * 130 - 15;
      cover.style.clipPath = `polygon(${(gone * 115 - 15).toFixed(2)}% 0, ${edge.toFixed(2)}% 0, ${(edge - 15).toFixed(2)}% 100%, ${(gone * 115 - 30).toFixed(2)}% 100%)`;
      const head = cover.firstElementChild as HTMLElement | null;
      if (head) {
        const inn = easeOut(ramp(t, coverFrom + BEAT * 0.5, coverFrom + BEAT * 1.6));
        const drift = Math.min(t - coverFrom, 8) * 6;
        head.style.opacity = (inn * (1 - ramp(t, coverTo - 0.35, coverTo - 0.05))).toFixed(3);
        head.style.transform = `translateY(-50%) translateX(${((1 - inn) * 80 - drift).toFixed(1)}px)`;
      }
    }
    if (!f) {
      vsEl.style.visibility = cardEl.style.visibility = 'hidden';
      scrim.style.opacity = '0';
      return;
    }
    // The VS card: in just before its downbeat, the VS slamming on it, out as the round is about to start.
    const vsIn = easeOut(ramp(t, f.vs - 0.22, f.vs));
    const vsOut = easeIn(ramp(t, f.go + 1.5, f.go + 1.8));
    const vsOn = t > f.vs - 0.22 && t < f.go + 1.85;
    vsEl.style.visibility = vsOn ? 'visible' : 'hidden';
    if (vsOn && vsParts) {
      vsParts.l.style.transform = `translateX(${((1 - vsIn) * -104 - vsOut * 104).toFixed(2)}%)`;
      vsParts.r.style.transform = `translateX(${((1 - vsIn) * 104 + vsOut * 104).toFixed(2)}%)`;
      const slam = easeOutBack(ramp(t, f.vs, f.vs + 0.3), 2.6);
      vsParts.mid.style.opacity = (t >= f.vs ? 1 - vsOut : 0).toFixed(3);
      vsParts.mid.style.transform = `translate(-50%, -52%) scale(${(2.4 - 1.4 * slam).toFixed(4)})`;
      vsParts.seam.style.opacity = (hit(t, f.vs, 0.12) * (0.7 + 0.3 * Math.sin(t * 160))).toFixed(3);
      vsParts.count.style.opacity = (ramp(t, f.vs, f.vs + 0.4) * (1 - vsOut)).toFixed(3);
    }
    // The credit's card: a beat after the blow; its name a letter a sixteenth; WINS stamped on the next downbeat.
    const cardAt = f.blow + BEAT;
    const cardOut = ramp(t, f.cut - 0.3, f.cut - 0.05);
    const cardOn = t > cardAt - 0.05 && t < f.cut;
    cardEl.style.visibility = cardOn ? 'visible' : 'hidden';
    scrim.style.opacity = (window01(t, cardAt - 0.1, f.cut, 0.35, 0.3)).toFixed(3);
    if (cardOn) {
      cardEl.style.opacity = (1 - cardOut).toFixed(3);
      cardEl.style.transform = `translateY(${(-easeIn(cardOut) * 30).toFixed(1)}px)`;
      const em = easeOutBack(ramp(t, cardAt, cardAt + 0.35), 2);
      if (cardEmblem) {
        cardEmblem.style.opacity = clamp01(em * 3).toFixed(3);
        cardEmblem.style.transform = `scale(${(0.4 + 0.6 * em).toFixed(4)}) rotate(${((1 - em) * -20).toFixed(1)}deg)`;
      }
      cardLetters.forEach((s, i) => {
        const at = cardAt + 0.08 + i * (BEAT / 4);
        const x = easeOutBack(ramp(t, at, at + 0.22), 2.2);
        s.style.opacity = clamp01(x * 2).toFixed(3);
        s.style.transform = `translateY(${((1 - x) * 26).toFixed(1)}px) scale(${(0.6 + 0.4 * x).toFixed(3)})`;
      });
      if (cardHead) {
        cardHead.line.style.transform = `scaleX(${easeOut(ramp(t, cardAt, cardAt + 2 * BEAT)).toFixed(3)})`;
        cardHead.detail.style.opacity = easeOut(ramp(t, cardAt + 2 * BEAT, cardAt + 2 * BEAT + 0.4)).toFixed(3);
        if (cardHead.link) cardHead.link.style.opacity = easeOut(ramp(t, cardAt + 3 * BEAT, cardAt + 3 * BEAT + 0.4)).toFixed(3);
      }
      const stampAt = barTime(nextBar(cardAt + 2 * BEAT));
      if (stamp) {
        const s = easeOutBack(ramp(t, stampAt, stampAt + 0.3), 2.4);
        stamp.style.opacity = (t >= stampAt ? 1 : 0).toString();
        stamp.style.transform = `rotate(8deg) scale(${(2.4 - 1.4 * s).toFixed(4)})`;
      }
    }
    // The game's picture: punching on the downbeats, harder on the blow (toward the loser), shaking.
    if (screen && !calm) {
      const blow = hit(t, f.blow, 0.28);
      const shake = blow * 10;
      const punch = (t > f.go + 3 && t < f.cut ? beatPulse(t, 0.12) * 0.012 : 0) + blow * 0.07;
      if (fighters && blow > 0.001) {
        const [lx, ly] = fighters[1];
        screen.style.transformOrigin = `${(px.ox + lx * px.ux).toFixed(1)}px ${(px.oy + (ly - 40) * px.uy).toFixed(1)}px`;
      } else {
        screen.style.transformOrigin = '50% 50%';
      }
      screen.style.transform = punch > 0.0005 || shake > 0.05
        ? `translate(${(Math.sin(t * 97) * shake).toFixed(1)}px, ${(Math.cos(t * 71) * shake).toFixed(1)}px) scale(${(1 + punch).toFixed(4)})`
        : '';
    }
    // The blow's flash, sparks and ring; the VS card's flash.
    once(`blow${n}`, t, f.blow, () => {
      addFlash(f.blow, 0.38, 0.12);
      if (fighters) {
        const [lx, ly] = fighters[1];
        const x = px.ox + lx * px.ux, y = px.oy + (ly - 45) * px.uy;
        stage.burst(x, y, 70, 1.4);
        stage.shock(x, y, CREDIT_BATTLES[n].accent);
      }
    });
    once(`vs${n}`, t, f.vs, () => addFlash(f.vs, 0.22, 0.12));
  };

  return {
    update(show: CreditsShow, dt: number): void {
      const t = show.t;
      if (leaving) return;
      // The music's levels: the chip's equalizer, the embers.
      if (song) {
        song.analyser.getByteFrequencyData(bins);
        const band = (a: number, b: number) => {
          let sum = 0;
          for (let i = a; i < b; i++) sum += bins[i];
          return sum / Math.max(1, b - a) / 255;
        };
        level = band(1, 96);
        const from = 1, to = 120;
        let next = from;
        eq.forEach((el, i) => {
          const a = Math.max(next, Math.floor(from * Math.pow(to / from, i / eq.length)));
          const b = Math.max(a + 1, Math.floor(from * Math.pow(to / from, (i + 1) / eq.length)));
          next = b;
          el.style.transform = `scaleY(${(0.06 + band(a, b) * 0.94).toFixed(3)})`;
        });
      }
      playing.style.opacity = song ? (ramp(t, barTime(1), barTime(2)) * (show.finale && t >= show.finale.hit ? 1 - ramp(t, show.finale.hit, show.finale.hit + 1) : 1)).toFixed(3) : '0';
      if (quiet > 0 && (quiet -= dt) <= 0) root.classList.add('omfc-quiet');

      // What covers the screen: the title (till its end) or the end titles; the fights between.
      const inTitle = show.phase === 'title' || (show.phase === 'fights' && t < show.titleEnd);
      const inFinale = show.phase === 'finale' && !!show.finale && t >= show.finale.start - 0.02;
      let look: StageLook | null = null;
      if (inTitle) {
        const drop = barTime(SECTIONS.drop);
        const lift = 150 * (1 - Math.pow(ramp(t, barTime(1), drop), 1.6));
        look = {
          lift, pan: -18 * (1 - ramp(t, 0, drop)), zoom: 1.12 - 0.1 * ramp(t, 0, drop) + hit(t, drop, 0.4) * 0.05, dawn: 0,
          lit: ramp(t, drop, drop + 0.15), veil: 0.62 * ramp(t, drop - 0.05, drop + 0.1) + (1 - ramp(t, 0, barTime(1))),
          shake: hit(t, drop, 0.35) * 3 + [0, 1, 2, 3].reduce((s, i) => s + hit(t, barTime(SECTIONS.drop + 1) + i * BEAT, 0.12) * 1.3, 0),
          searchlights: ramp(t, barTime(4), barTime(10)), stars: 1 - ramp(t, barTime(12), drop),
        };
        // Lightning in the clouds on the intro's beats, flickering through the build.
        const strikes = [4.5, 7, 9.25, 11, 12.5, 13.5, 14, 14.5, 15, 15.25, 15.5, 15.75];
        for (const k of strikes) {
          const at = barTime(k);
          if (prevT < at && t >= at && t - at < 0.25) stage.lightning(40 + ((k * 97) % 1) * 240, 30 + ((k * 53) % 1) * 30, 70 + (k > 14 ? 40 : 0));
        }
      } else if (inFinale && show.finale) {
        const fl = finaleLook(t, show.finale);
        look = { ...fl, veil: 0, shake: hit(t, show.finale.hit, 0.3) * 3, searchlights: 0.3 * (1 - fl.dawn) };
      }
      if (look && calm) look.shake = 0;
      stageEl.style.display = look ? '' : 'none';
      stageEl.classList.toggle('omfc-click', !!look);
      if (!inTitle) title.hide();
      if (!inFinale) finale.el.style.display = 'none';
      // (fights: the stage's layers hidden, its front light over the game)
      stage.update(look ?? { lift: 0, pan: 0, zoom: 1, dawn: 0, lit: 0, veil: 1, shake: 0, searchlights: 0, stars: 0 }, t, dt, level);
      if (inTitle) {
        title.update(t, show.titleEnd, {
          strike: (at, x, y, big) => {
            stage.burst(x, y, big ? 90 : 26, big ? 1.5 : 0.8);
            stage.shock(x, y);
            addFlash(at, big ? 0.9 : 0.25);
          },
        });
      }
      if (inFinale && show.finale) {
        const fin = show.finale;
        finale.update(t, fin, {
          finalHit: () => {
            addFlash(fin.hit, 1);
            const [x, y] = stage.toScreen(108, 70, 0.5);
            stage.burst(x, y, 110, 1.6);
            stage.shock(x, y, 'rgba(255,220,150,.95)');
          },
        });
        once('finale', t, fin.start, () => addFlash(fin.start, 0.7));
        if (fin.jumped) once('jump', t, barTime(ENDING_BAR), () => addFlash(barTime(ENDING_BAR), 0.65));
      }
      // The title's end: a white cut to the first fight.
      if (show.titleEnd > 0) once('titleEnd', t, show.titleEnd, () => addFlash(show.titleEnd, 0.8));

      // Over the fights.
      const n = show.fighting;
      const inFights = !inTitle && !inFinale && show.phase !== 'title' && n >= 0;
      if (inFights) {
        const prev = n > 0 ? show.fights[n - 1] : null;
        const f = show.fights[n];
        // (the cover from the fight before's cut, or from this one's cut while the next arena opens)
        const prevCut = f && t >= f.cut ? f.cut : prev ? prev.cut : show.titleEnd > 0 ? Infinity : -1;
        fightOverlay(t, n, f && t >= f.cut ? null : f, prevCut, show.fighters);
      } else {
        cover.style.visibility = vsEl.style.visibility = cardEl.style.visibility = 'hidden';
        scrim.style.opacity = '0';
        if (screen) screen.style.transform = '';
      }
      let flash = 0;
      for (const [at, k, decay] of flashes) flash = Math.max(flash, k * hit(t, at, decay));
      while (flashes.length && (t - flashes[0][0] > 3 || flashes[0][0] - t > 400)) flashes.shift();
      flashEl.style.opacity = (calm ? flash * 0.3 : flash).toFixed(3);
      grain.style.transform = `translate(${((t * 7919) % 50).toFixed(0)}px, ${((t * 104729) % 50).toFixed(0)}px)`;
      prevT = t;
    },

    still(i: number, url: string): void {
      finale.still(i, url);
    },

    songFailed(): void {
      song = null;
      playing.remove();
    },

    wake,

    leave(): void {
      leaving = true;
      root.classList.add('omfc-off');
      screen?.classList.add('omfc-off-screen');
    },

    dispose(): void {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
      if (screen) {
        screen.classList.remove('omfc-off-screen');
        screen.style.transform = screen.style.transformOrigin = '';
      }
      root.remove();
    },
  };
}
