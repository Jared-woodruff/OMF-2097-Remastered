// The remaster's credits on screen (EXTRAS > CREDITS, run by creditsRun.ts): HTML over the game, sharp at any resolution,
// in the game's own look (look.ts: its menu frames, the VS screen's box and colors, its typeface and hard shadows, text
// typing in), every picture worked out from the song's position each frame (the show's timetable, see CreditsShow), so
// that it all lands on the music. The title (titleCard.ts) and the end titles (finaleRoll.ts) play over the main menu's
// painted city (stage.ts), at night and at dawn. The fights play on an old computer's monitor (computerRoom.ts), or full
// screen in a window too small for it. On the screen, over each fight: a menu frame wiping across on the downbeat that
// ends the fight before, naming the credit that comes next under its emblem; the VS card, in the VS screen's colors,
// slamming on a downbeat as the frame wipes on. The credit's card flies onto the computer's tower as the round starts,
// its name typing in, and its WINS stamp lands after the final blow (on its beat); full screen, the card comes after the
// blow, under the HUD. A now playing box as the song starts (for a few seconds: then it fades away, out of the show's
// way), and the controls after any input. Leaving, the picture switches off like an old TV.
import type { Track } from '../../audio/audio';
import { ensureUiFont, UI_FONT } from '../../platform/uiFont';
import { CREDIT_BATTLES, type CreditBattle, type CreditEmblem } from './battles';
import { ComputerRoom, MONITOR_TOP, ROOM_CSS } from './computerRoom';
import type { CreditsShow, FightTimes } from './creditsRun';
import { FINALE_CSS, FinaleRoll, finaleLook } from './finaleRoll';
import { LOOK_CSS, typeInto } from './look';
import { easeIn, easeOut, hit, ramp } from './motion';
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
/** The now playing box's meter: columns, and lights in each. */
const EQ_BANDS = 5;
const EQ_LIGHTS = 5;
/** Seconds the controls stay up after the last input. */
const QUIET_AFTER = 4;
/** Clicks this soon after the credits open are the ones that opened them (ms). */
const CLICK_GRACE_MS = 600;
/** Seconds the now playing box stays up once it has come on, and fades away. */
const PLAYING_FOR = 7;
const PLAYING_FADE = 0.8;
/** The now playing box fades while a fighter's feet are left of this (native pixels: the box ends at 114). */
const PLAYING_CLEAR = 150;
/** The now playing box's height (its pixels: its picture and its padding). */
const PLAYING_H = 18;
const NUMBERS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'];
/** Seconds a letter: the names (a sixteenth note), the lines under them. */
const TYPE_NAME = BEAT / 4;
const TYPE_LINE = 0.024;
/** On the computer: the credit lands on the tower this long after the round's start (as the VS card leaves), flying
 * for FLY seconds; it flies off as the cover wipes on. */
const LAND_AFTER_GO = 1.8;
const FLY = 0.32;
/** The tower's credit: its name's largest size, and the width its letters fill (hundredths of the card's width). */
const TOWER_NAME_MAX = 10.5;
const TOWER_NAME_W = 86;

/** The credits' emblems (in the credit's color, currentColor). */
const EMBLEMS: Record<Exclude<CreditEmblem, 'avatar' | 'cover'>, string> = {
  chip: `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-linecap="square" aria-hidden="true">
<path d="M36 26V12M50 26V6M64 26V12M36 74v14M50 74v20M64 74v14M26 36H12M26 50H6M26 64H12M74 36h14M74 50h20M74 64h14" stroke-width="4"/>
<rect x="26" y="26" width="48" height="48" stroke-width="4" fill="rgba(0,0,0,.5)"/>
<rect x="38" y="38" width="24" height="24" fill="currentColor" stroke="none"/></svg>`,
  prism: `<svg viewBox="0 0 100 100" fill="none" stroke-linecap="square" stroke-width="4" aria-hidden="true">
<path d="M4 60 L41 52" stroke="#ffffff"/><path d="M50 16 L78 70 L22 70 Z" stroke="currentColor" fill="rgba(0,0,0,.5)"/>
<path d="M63 47 L97 33" stroke="#ff5050"/><path d="M64 51 L97 44" stroke="#ffff00"/><path d="M65 55 L97 55" stroke="#00ff00"/>
<path d="M66 59 L97 66" stroke="#55dcff"/><path d="M67 63 L97 77" stroke="#a070ff"/></svg>`,
  wave: `<svg viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">${[22, 40, 64, 48, 84, 58, 72, 38, 20]
    .map((h, i) => `<rect x="${6 + i * 10.5}" y="${50 - h / 2}" width="7" height="${h}"/>`).join('')}</svg>`,
  code: `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">
<path d="M33 27 L11 50 L33 73 M67 27 L89 50 L67 73" stroke-width="9"/><path d="M58 17 L42 83" stroke-width="8"/></svg>`,
  disk: `<svg viewBox="0 0 100 100" aria-hidden="true">
<path d="M10 8h66l16 16v68H10z" fill="currentColor"/>
<rect x="28" y="8" width="42" height="28" fill="#20242e"/><rect x="55" y="12" width="9" height="20" fill="currentColor"/>
<rect x="20" y="50" width="60" height="36" fill="#f2f4f7"/>
<path d="M28 61h44M28 69h44M28 77h28" stroke="#7c8694" stroke-width="3"/></svg>`,
};

// Positions in the game's pixels (320 x 200), see look.ts: the window's (as the game's picture fills it, full screen),
// and in the screen's layers those of the game's picture wherever it is. The VS card and the credit's card sit under the
// fight's HUD (its bars and names take the top 30 rows), clear of the robots' heads.
const CSS = `
.omfc { position: fixed; inset: 0; z-index: 18; overflow: hidden; pointer-events: none; user-select: none; color: #f2f4f7;
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

/* The game's screen (the whole window, or the computer's monitor: cut to its glass, its scanlines and reflections). */
.omfc-crt { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: hidden; }
.omfc-room-on .omfc-crt { -webkit-mask: url(credits/computer/screen-mask.png) 0 0 / 100% 100% no-repeat;
  mask: url(credits/computer/screen-mask.png) 0 0 / 100% 100% no-repeat; }
.omfc-crt-glass { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; display: none; }
.omfc-room-up .omfc-crt-glass { display: block; }
.omfc-crt-scan { background: radial-gradient(ellipse at 50% 50%, transparent 58%, rgba(0, 0, 0, .34) 100%),
  repeating-linear-gradient(180deg, transparent 0, transparent 0.25%, rgba(0, 0, 0, .26) 0.38%, transparent 0.5%); }

/* Between the fights: the menu's frame over the whole screen, naming the credit coming up. */
.omfc-cover { position: absolute; inset: 0; visibility: hidden; background-color: #000; box-shadow: none; will-change: clip-path;
  background-position: calc(var(--ox) + 5 * var(--ux)) calc(var(--oy) + 5 * var(--uy)); }
.omfc-cover-edge { position: absolute; top: 0; bottom: 0; left: 0; width: var(--gb); background: var(--g-edge); }
.omfc-upnext { position: absolute; left: 0; right: 0; top: calc(var(--oy) + 64 * var(--uy)); text-align: center; }
.omfc-upnext-em { width: calc(38 * var(--uy)); margin: 0 auto calc(6 * var(--uy)); }
.omfc-upnext-role { margin-top: calc(3 * var(--uy)); font-size: calc(11 * var(--uy)); }

/* The VS card: the VS screen's boxes, yellow names and green lines. */
.omfc-vs { position: absolute; inset: 0; visibility: hidden; }
.omfc-vs-box { position: absolute; top: calc(var(--oy) + 36 * var(--uy)); width: calc(126 * var(--ux)); height: calc(40 * var(--uy));
  padding: calc(4 * var(--uy)) calc(7 * var(--ux)); display: flex; flex-direction: column; justify-content: center; will-change: transform; }
.omfc-vs-l { left: calc(var(--ox) + 10 * var(--ux)); align-items: flex-end; text-align: right; }
.omfc-vs-r { left: calc(var(--ox) + 184 * var(--ux)); align-items: flex-start; text-align: left; }
.omfc-vs-box .omfg-s { font-size: max(10px, calc(3.4 * var(--uy))); }
.omfc-vs-name { margin: calc(1.6 * var(--uy)) 0 calc(1.8 * var(--uy)); font-size: min(calc(8.4 * var(--uy)), calc(112 * var(--ux) / var(--n) / .9)); }
.omfc-vs-mid { position: absolute; left: calc(var(--ox) + 160 * var(--ux)); top: calc(var(--oy) + 56 * var(--uy)); font-size: calc(10 * var(--uy));
  letter-spacing: .02em; transform: translate(-50%, -50%); will-change: transform, opacity; }
.omfc-vs-seam { position: absolute; left: calc(var(--ox) + 160 * var(--ux)); top: calc(var(--oy) + 18 * var(--uy)); height: calc(78 * var(--uy));
  transform: translateX(-50%); mix-blend-mode: screen; opacity: 0; }

/* After the fight: the credit's card, a menu frame under the HUD. */
.omfc-card { position: absolute; left: calc(var(--ox) + 10 * var(--ux)); top: calc(var(--oy) + 33 * var(--uy)); width: calc(300 * var(--ux));
  min-height: calc(52 * var(--uy)); padding: calc(5 * var(--uy)) calc(6 * var(--ux)); display: grid; align-items: center;
  grid-template-columns: calc(42 * var(--uy)) minmax(0, 1fr); column-gap: calc(6 * var(--ux)); visibility: hidden; will-change: clip-path; }
.omfc-card-head { display: flex; justify-content: space-between; align-items: baseline; gap: 1em; }
.omfc-card-row { display: flex; align-items: center; justify-content: space-between; gap: calc(4 * var(--ux));
  margin: calc(1 * var(--uy)) 0 calc(1.6 * var(--uy)); }
.omfc-card-name { min-width: 0; font-size: min(calc(8.6 * var(--uy)), calc(186 * var(--ux) / var(--n) / .9)); }
.omfc-card-detail { font-size: max(9px, calc(3 * var(--uy))); letter-spacing: .1em; white-space: normal; line-height: 1.5; }
.omfc-link { display: inline-block; text-decoration: none; }
a.omfc-link:hover { color: var(--g-gold); text-decoration: underline; }
.omfc-card .omfc-link { margin-top: calc(1.2 * var(--uy)); font-size: max(9px, calc(2.7 * var(--uy))); }
.omfc-stamp { flex: none; padding: calc(1.4 * var(--uy)) calc(3.5 * var(--ux)) calc(1 * var(--uy)); font-size: calc(6.4 * var(--uy));
  letter-spacing: .1em; background: #000; box-shadow: inset 0 0 0 var(--gb) var(--g-yellow); opacity: 0; will-change: transform, opacity; }
.omfc-flash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; }

/* On the computer: the credit's card on the tower (its own scale: --ux and --uy a hundredth of its width). */
.omfc-tower { position: absolute; display: none; visibility: hidden; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: calc(5 * var(--uy)) calc(6 * var(--ux)); will-change: transform; background-color: #00000c;
  box-shadow: inset 0 0 0 var(--gb) var(--g-edge), calc(1.6 * var(--ux)) calc(1.6 * var(--uy)) 0 rgba(0, 0, 0, .55); }
.omfc-room-on .omfc-tower { display: flex; }
.omfc-room-on .omfc-card { display: none; }
.omfc-tower .omfc-em { width: calc(34 * var(--ux)); flex: none; }
.omfc-tower-role { margin-top: calc(5 * var(--uy)); font-size: max(10px, calc(4 * var(--uy))); }
.omfc-tower-name { margin-top: calc(1.6 * var(--uy)); font-size: calc(var(--fs) * var(--uy)); white-space: pre; line-height: 1.14; }
.omfc-tower-detail { margin-top: calc(3.2 * var(--uy)); font-size: max(9px, calc(3.2 * var(--uy))); letter-spacing: .08em;
  white-space: normal; line-height: 1.55; }
.omfc-tower .omfc-link { margin-top: calc(2 * var(--uy)); font-size: max(9px, calc(2.9 * var(--uy))); }
.omfc-tower .omfc-stamp { margin-top: calc(4.5 * var(--uy)); font-size: calc(7 * var(--uy)); }
.omfc-tower-glow { position: absolute; inset: 0; pointer-events: none; opacity: 0;
  box-shadow: 0 0 calc(5 * var(--ux)) calc(.8 * var(--ux)) #2f55ff, inset 0 0 calc(5 * var(--ux)) rgba(47, 85, 255, .7); }
.omfc-tower-flash { position: absolute; inset: 0; pointer-events: none; opacity: 0; background: #fff; }

/* Emblems: in a square frame, like the game's pictures. */
.omfc-em { position: relative; width: 100%; aspect-ratio: 1; color: var(--c); box-sizing: border-box; background: #000;
  box-shadow: 0 0 0 var(--gb) var(--g-edge); will-change: clip-path; }
.omfc-em svg { display: block; width: 76%; height: 76%; margin: 12%; overflow: visible; }
.omfc-em img { display: block; width: 100%; height: 100%; object-fit: cover; }

/* The now playing box (its meter's lights), and the controls. */
.omfc-playing { position: absolute; left: calc(var(--ox) + 6 * var(--ux)); top: calc(var(--oy) + 174 * var(--uy)); display: flex;
  align-items: center; gap: calc(3 * var(--ux)); padding: calc(2.5 * var(--uy)) calc(3.5 * var(--ux)); opacity: 0; }
.omfc-playing .omfg-s { font-size: max(8px, calc(2.4 * var(--uy))); letter-spacing: .12em; line-height: 1.32; }
.omfc-playing img { width: calc(13 * var(--uy)); height: calc(13 * var(--uy)); object-fit: cover; box-shadow: 0 0 0 var(--gb) var(--g-edge); }
.omfc-eq { display: flex; gap: calc(.9 * var(--ux)); height: calc(12 * var(--uy)); margin-left: calc(1 * var(--ux)); }
.omfc-eq b { display: flex; flex-direction: column-reverse; gap: calc(.7 * var(--uy)); width: calc(2.4 * var(--ux)); }
.omfc-eq i { flex: 1; background: var(--g-green); opacity: .16; }
.omfc-eq i:nth-child(4) { background: var(--g-yellow); }
.omfc-eq i:nth-child(5) { background: #ff3a30; }
.omfc-eq i.on { opacity: 1; }
.omfc-ctl { position: absolute; left: calc(var(--ox) + 314 * var(--ux)); top: calc(var(--oy) + 183 * var(--uy)); transform: translateX(-100%);
  display: flex; gap: calc(3 * var(--ux)); transition: opacity .8s; }
.omfc-btn { cursor: pointer; border: 0; padding: calc(1.8 * var(--uy)) calc(4 * var(--ux)); font-size: max(9px, calc(2.6 * var(--uy))); }
.omfc-btn b { font-weight: 700; color: var(--g-dim); margin-right: .6em; }
.omfc-btn:hover { background-color: var(--g-sel); color: var(--g-gold); --sh: var(--g-ink); }
.omfc-quiet .omfc-ctl { opacity: 0; pointer-events: none; }

/* Switching off, like an old TV: the picture folds to a line, the line to a dot, the dot goes out. */
@keyframes omfc-off { 0% { transform: none; filter: none; } 42% { transform: scale(1, .004); filter: brightness(2.6); }
  78% { transform: scale(.004, .004); filter: brightness(4); } 100% { transform: scale(0, 0); filter: brightness(4); } }
.omfc-off, .omfc-off-screen { animation: omfc-off .85s cubic-bezier(.55,0,.8,.4) forwards; }
/* (on the computer: its screen switches off, the rest fades, the room goes dark) */
@keyframes omfc-fade { to { opacity: 0; } }
.omfc-off-room > :not(.omfc-crt):not(.omfc-flash) { animation: omfc-fade .4s ease-in forwards; }
.omfc-off-room .omfc-crt { animation: omfc-off .85s cubic-bezier(.55,0,.8,.4) forwards; }
`;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** A credit's emblem (the avatar, the song's cover, or a drawing in its color), in its frame. */
export function emblemHtml(kind: CreditEmblem): string {
  if (kind === 'avatar') return `<div class="omfc-em"><img alt="" src="${AVATAR}" draggable="false"></div>`;
  if (kind === 'cover') return `<div class="omfc-em"><img alt="" src="${SONG_COVER}" draggable="false"></div>`;
  return `<div class="omfc-em">${EMBLEMS[kind]}</div>`;
}

function link(b: CreditBattle, links: boolean): string {
  if (!b.link) return '';
  const label = esc(b.link.label.toUpperCase());
  return links
    ? `<a class="omfc-link omfg-s omfg-pale" href="${b.link.href}" target="_blank" rel="noopener noreferrer">${label}</a>`
    : `<span class="omfc-link omfg-s omfg-pale">${label}</span>`;
}

export function openCreditsView(opts: CreditsViewOptions): CreditsView {
  if (!document.getElementById('omfc-style')) {
    ensureUiFont();
    const style = document.createElement('style');
    style.id = 'omfc-style';
    // (the game's look first: the parts' own rules refine it)
    style.textContent = LOOK_CSS + CSS + TITLE_CSS + FINALE_CSS + ROOM_CSS;
    document.head.appendChild(style);
  }
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const count = NUMBERS[CREDIT_BATTLES.length] ?? String(CREDIT_BATTLES.length);
  const root = document.createElement('div');
  root.className = 'omfc';
  root.innerHTML = `<div class="omfc-stage"><div class="omfc-vignette"></div></div>
<div class="omfc-card omfg"></div>
<div class="omfc-crt omfg-scale"><div class="omfc-cover omfg"><div class="omfc-upnext"><div class="omfc-upnext-em"></div><div class="omfc-upnext-count omfg-s omfg-gold"></div>
  <div class="omfc-upnext-role omfg-b omfg-green"></div></div><i class="omfc-cover-edge"></i></div>
  <div class="omfc-vs"></div><div class="omfc-crt-glass omfc-crt-scan"></div><img class="omfc-crt-glass" alt="" src="credits/computer/glass.webp" draggable="false"></div>
<div class="omfc-tower omfg omfg-scale"></div>
<div class="omfc-flash"></div>
<div class="omfc-playing omfg omfg-scale"><img alt="" src="${SONG_COVER}"><div><div class="omfg-s omfg-gold">NOW PLAYING</div>
  <div class="omfg-s omfg-white">TWENTY NINETY-SEVEN (REMIX)</div><div class="omfg-s omfg-pale">HADAL STATIC</div></div>
  <div class="omfc-eq">${`<b>${'<i></i>'.repeat(EQ_LIGHTS)}</b>`.repeat(EQ_BANDS)}</div></div>
<div class="omfc-ctl omfg-scale"><button class="omfc-btn omfc-next omfg omfg-s omfg-green" type="button"><b>ENTER</b>NEXT</button>
  <button class="omfc-btn omfc-back omfg omfg-s omfg-green" type="button"><b>ESC</b>BACK</button></div>`;
  document.body.appendChild(root);
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const stageEl = q('.omfc-stage');
  const cover = q('.omfc-cover');
  const coverEdge = q('.omfc-cover-edge');
  const nextEm = q('.omfc-upnext-em');
  const nextCount = q('.omfc-upnext-count');
  const nextRole = q('.omfc-upnext-role');
  const cardEl = q('.omfc-card');
  const crt = q('.omfc-crt');
  const towerEl = q('.omfc-tower');
  const vsEl = q('.omfc-vs');
  const flashEl = q('.omfc-flash');
  const playing = q('.omfc-playing');
  const ctl = q('.omfc-ctl');
  const eq = [...root.querySelectorAll<HTMLElement>('.omfc-eq b')].map((b) => [...b.querySelectorAll<HTMLElement>('i')]);
  const stage = new Stage(calm);
  const title = new TitleCard(count);
  const finale = new FinaleRoll(opts.links, (b) => emblemHtml(b.emblem));
  stageEl.prepend(stage.el);
  stageEl.append(title.el, finale.el);
  // (the light in front: over the city)
  root.insertBefore(stage.front, flashEl);
  const screen = document.getElementById('screen');
  const room = new ComputerRoom(screen instanceof HTMLCanvasElement ? screen : null);
  /** The fights on the computer (else full screen), the screen's width (px), and how far the tower's card flies (px). */
  let inRoom = false;
  let crtW = window.innerWidth;
  let flyFrom = window.innerWidth;
  let song = opts.song;
  const bins = new Uint8Array(song?.analyser.frequencyBinCount ?? 0);
  let level = 0;
  /** The song's time when the now playing box came on (-1: not yet), and how far it is faded for a fighter standing
   * over it (0..1). */
  let playingFrom = -1;
  let crowded = 0;
  let quiet = QUIET_AFTER;
  let shown = -1;
  let card: {
    b: CreditBattle; emblem: HTMLElement | null; role: HTMLElement; name: HTMLElement; detail: HTMLElement; link: HTMLElement | null;
    stamp: HTMLElement; title: string; glow: HTMLElement | null; flash: HTMLElement | null;
  } | null = null;
  let vsParts: { l: HTMLElement; r: HTMLElement; mid: HTMLElement; seam: HTMLImageElement } | null = null;
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
  /** A part placed by the computer's layout (css px, its own scale), or back to its place over the game (null). */
  const putAt = (el: HTMLElement, x: number, y: number, u: number | null) => {
    if (u === null) {
      for (const p of ['left', 'top', '--ux', '--uy']) el.style.removeProperty(p);
      return;
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty('--ux', `${u}px`);
    el.style.setProperty('--uy', `${u}px`);
  };
  /** On el: the game's pixels (--ux, --uy) and its 320 x 200 picture's corner (--ox, --oy) in a box (w x h at left,
   * top) the game's picture fills, as the renderer fits it. */
  const gameUnits = (el: HTMLElement, w: number, h: number, left: number, top: number) => {
    let uy = h / 200, ux = uy * (5 / 6);
    if (320 * ux > w) {
      ux = w / 320;
      uy = ux * 1.2;
    }
    el.style.setProperty('--ux', `${ux}px`);
    el.style.setProperty('--uy', `${uy}px`);
    el.style.setProperty('--ox', `${left + (w - 320 * ux) / 2}px`);
    el.style.setProperty('--oy', `${top + (h - 200 * uy) / 2}px`);
  };
  /** While the room shows: the screen's glass on, the now playing box and the controls on the room's wall (else in their
   * places over the game). */
  let partsInRoom = false;
  const placeParts = (on: boolean) => {
    partsInRoom = on;
    root.classList.toggle('omfc-room-up', on);
    const lay = room.layout;
    if (on && lay) {
      // (the now playing box over the monitor, the controls over the tower: smaller where the wall is cut short)
      const top = Math.max(window.innerHeight * 0.015, lay.pic.y + lay.pic.h * 0.03);
      const u = Math.max(1.5, Math.min(lay.pic.h / 250, (lay.pic.y + lay.pic.h * (MONITOR_TOP - 0.01) - top) / PLAYING_H));
      putAt(playing, lay.screen.x, top, u);
      putAt(ctl, lay.credit.x + lay.credit.w, top, u);
    } else {
      putAt(playing, 0, 0, null);
      putAt(ctl, 0, 0, null);
    }
  };
  /**
   * The computer or not (the window's size). The city, the titles and the parts over the game in the game's pixels of
   * the whole window (where its picture is, full screen); the screen's layers in those of the game's picture, wherever
   * it is (the whole window, or the monitor's screen).
   */
  const place = () => {
    const lay = room.place();
    if (inRoom !== !!lay) shown = -1;
    inRoom = !!lay;
    root.classList.toggle('omfc-room-on', inRoom);
    gameUnits(root, window.innerWidth, window.innerHeight, 0, 0);
    const r = screen?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    crt.style.left = `${r.left}px`;
    crt.style.top = `${r.top}px`;
    crt.style.width = `${r.width}px`;
    crt.style.height = `${r.height}px`;
    gameUnits(crt, r.width, r.height, 0, 0);
    crtW = r.width;
    if (lay) {
      const c = lay.credit;
      towerEl.style.width = `${c.w}px`;
      towerEl.style.height = `${c.h}px`;
      putAt(towerEl, c.x, c.y, c.w / 100);
      flyFrom = window.innerWidth - c.x + c.w * 0.1;
    }
    placeParts(partsInRoom && inRoom);
  };
  place();
  const onResize = () => {
    place();
    stage.resize();
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', wake);
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);
  // The title and the end titles: a click goes on, a right click goes back (not the clicks that opened the credits: a
  // double click on the main menu's button would skip the title at once).
  const openedAt = performance.now();
  /** The winners' pictures handed over (blob URLs). */
  const stills: string[] = [];
  stageEl.addEventListener('click', (e) => {
    if (performance.now() - openedAt < CLICK_GRACE_MS) return;
    if (!(e.target as Element).closest('a, button')) opts.onNext();
  });
  stageEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    opts.onExit();
  });
  q('.omfc-next').addEventListener('click', () => opts.onNext());
  q('.omfc-back').addEventListener('click', () => opts.onExit());

  let nextFor = -1;
  /** The cover's lines: the credit coming up, under its emblem. */
  const makeNext = (n: number) => {
    nextFor = n;
    cover.style.setProperty('--c', CREDIT_BATTLES[n].accent);
    nextEm.innerHTML = emblemHtml(CREDIT_BATTLES[n].emblem);
    nextCount.textContent = `CREDIT ${n + 1} OF ${CREDIT_BATTLES.length}`;
    nextRole.dataset.typed = '';
  };

  /** The tower's credit name: on one line, or on two (split at the space nearest its middle) when it is long. */
  const towerTitle = (title: string): string => {
    if (title.length <= 10) return title;
    let at = -1;
    for (let i = 0; i < title.length; i++) {
      if (title[i] === ' ' && (at < 0 || Math.abs(i - title.length / 2) < Math.abs(at - title.length / 2))) at = i;
    }
    return at < 0 ? title : `${title.slice(0, at)}\n${title.slice(at + 1)}`;
  };

  /** The cards of fight n (made when it comes on). */
  const makeCards = (n: number) => {
    const b = CREDIT_BATTLES[n];
    shown = n;
    cardEl.style.setProperty('--c', b.accent);
    const side = (cls: string, role: string, name: string, har: string) => `<div class="omfc-vs-box ${cls} omfg-vs">
      <div class="omfg-s omfg-green">${esc(role)}</div><div class="omfc-vs-name omfg-b omfg-yellow" style="--n: ${name.length}">${esc(name)}</div>
      <div class="omfg-s omfg-green">${esc(har.toUpperCase())}</div></div>`;
    vsEl.innerHTML = `${side('omfc-vs-l', b.role, b.winner.name, opts.harName(b.winner.har))}${side('omfc-vs-r', 'OPPONENT', b.loser.name, opts.harName(b.loser.har))}
      <img class="omfc-vs-seam" alt="" src="credits/title/strike.webp"><div class="omfc-vs-mid omfg-b omfg-yellow">VS.</div>`;
    vsParts = { l: vsEl.querySelector('.omfc-vs-l')!, r: vsEl.querySelector('.omfc-vs-r')!, mid: vsEl.querySelector('.omfc-vs-mid')!,
      seam: vsEl.querySelector('.omfc-vs-seam')! };
    if (inRoom) {
      // (on the tower: the picture, what they did, the name as large as it fits, the line, the link, WINS)
      const title = towerTitle(b.title);
      const longest = Math.max(...title.split('\n').map((line) => line.length));
      towerEl.style.setProperty('--c', b.accent);
      towerEl.innerHTML = `<i class="omfc-tower-glow"></i>${emblemHtml(b.emblem)}
        <div class="omfc-tower-role omfg-s omfg-gold">${esc(b.role)}</div>
        <div class="omfc-tower-name omfg-b omfg-white" style="--fs: ${Math.min(TOWER_NAME_MAX, TOWER_NAME_W / (longest * 0.93)).toFixed(2)}"></div>
        <div class="omfc-tower-detail omfg-s omfg-grey"></div>${link(b, opts.links)}
        <div class="omfc-stamp omfg-b omfg-yellow">WINS</div><i class="omfc-tower-flash"></i>`;
      cardEl.innerHTML = '';
      card = {
        b, title, emblem: towerEl.querySelector('.omfc-em'), role: towerEl.querySelector('.omfc-tower-role')!,
        name: towerEl.querySelector('.omfc-tower-name')!, detail: towerEl.querySelector('.omfc-tower-detail')!, link: towerEl.querySelector('.omfc-link'),
        stamp: towerEl.querySelector('.omfc-stamp')!, glow: towerEl.querySelector('.omfc-tower-glow'), flash: towerEl.querySelector('.omfc-tower-flash'),
      };
      return;
    }
    cardEl.innerHTML = `${emblemHtml(b.emblem)}<div><div class="omfc-card-head"><span class="omfc-card-role omfg-s omfg-gold">${esc(b.role)}</span>
      <span class="omfg-s omfg-dim">${n + 1} / ${CREDIT_BATTLES.length}</span></div>
      <div class="omfc-card-row"><div class="omfc-card-name omfg-b omfg-white" style="--n: ${b.title.length}"></div>
      <div class="omfc-stamp omfg-b omfg-yellow">WINS</div></div>
      <div class="omfc-card-detail omfg-s omfg-grey"></div>${link(b, opts.links)}</div>`;
    towerEl.innerHTML = '';
    card = {
      b, title: b.title, emblem: cardEl.querySelector('.omfc-em'), role: cardEl.querySelector('.omfc-card-role')!, name: cardEl.querySelector('.omfc-card-name')!,
      detail: cardEl.querySelector('.omfc-card-detail')!, link: cardEl.querySelector('.omfc-link'), stamp: cardEl.querySelector('.omfc-stamp')!,
      glow: null, flash: null,
    };
  };

  /**
   * On the computer, the credit's card over fight f at song time t: flying onto the tower as the round starts (the VS
   * card leaving the screen), the picture drawn down, the name typing in a letter a sixteenth, the lines under it after;
   * WINS stamped on the downbeat after the final blow's beat; flying off as the cover wipes on. Its frame glows with the
   * music.
   */
  const towerCard = (t: number, f: FightTimes) => {
    const landAt = f.go + LAND_AFTER_GO;
    const offAt = f.cut - BEAT;
    const on = t > landAt - FLY && t < offAt + FLY;
    towerEl.style.visibility = on ? 'visible' : 'hidden';
    if (!on || !card) return;
    const inn = easeOut(ramp(t, landAt - FLY, landAt));
    const out = easeIn(ramp(t, offAt, offAt + FLY));
    if (calm) {
      // (less motion: it fades on and off in place)
      towerEl.style.opacity = (inn * (1 - out)).toFixed(3);
    } else {
      const fly = 1 - inn + out;
      towerEl.style.transform = fly > 0 ? `translateX(${(fly * flyFrom).toFixed(1)}px) skewX(${((1 - inn) * 12 - out * 12).toFixed(2)}deg)` : '';
    }
    if (card.glow) card.glow.style.opacity = (0.25 + 0.75 * Math.min(1, level * 1.6)).toFixed(3);
    if (card.emblem) card.emblem.style.clipPath = `inset(0 0 ${((1 - ramp(t, landAt, landAt + 0.3)) * 100).toFixed(1)}% 0)`;
    card.role.style.visibility = t >= landAt ? 'inherit' : 'hidden';
    const nameAt = landAt + 0.1;
    typeInto(card.name, card.title, t, nameAt, TYPE_NAME, 0.6);
    const lineAt = Math.max(nameAt + card.title.length * TYPE_NAME, landAt + 2 * BEAT);
    typeInto(card.detail, card.b.detail.toUpperCase(), t, lineAt, TYPE_LINE);
    if (card.link) card.link.style.visibility = t >= lineAt + card.b.detail.length * TYPE_LINE ? 'inherit' : 'hidden';
    const stampAt = barTime(nextBar(f.blow + BEAT));
    const s = ramp(t, stampAt, stampAt + 0.08);
    card.stamp.style.opacity = t >= stampAt ? '1' : '0';
    card.stamp.style.transform = `scale(${(1 + (1 - s) * 0.9).toFixed(3)})`;
    // (a flash as it lands, and as WINS does)
    if (card.flash) card.flash.style.opacity = (Math.max(hit(t, landAt, 0.14) * 0.4, hit(t, stampAt, 0.12) * 0.3) * (calm ? 0.3 : 1)).toFixed(3);
  };

  /**
   * Over fight n (its timetable f) at song time t: the cover (from `coverFrom`, naming fight `upcoming`), the VS card,
   * the card. Returns whether the cover hides the whole fight.
   */
  const fightOverlay = (t: number, n: number, f: FightTimes | null, coverFrom: number, upcoming: number): boolean => {
    if (n !== shown) makeCards(n);
    // The cover: the menu's frame wiping across over the beat before a fight's cut (its edge the frame's blue line), so
    // that it covers the screen as the arena changes; the next credit typing in; it wipes on across as the next fight's
    // VS card slams.
    const coverTo = f && upcoming === n ? f.vs : Infinity;
    const inCover = upcoming < CREDIT_BATTLES.length && t >= coverFrom && t < coverTo + 0.2;
    cover.style.visibility = inCover ? 'visible' : 'hidden';
    const covered = inCover && t >= coverFrom + BEAT && t < coverTo - 0.02;
    if (inCover) {
      if (upcoming !== nextFor) makeNext(upcoming);
      const inn = easeOut(ramp(t, coverFrom, coverFrom + BEAT));
      // (the next fight's VS card not timed yet: the cover stays)
      const gone = coverTo < Infinity ? easeIn(ramp(t, coverTo - 0.02, coverTo + 0.18)) : 0;
      cover.style.clipPath = `inset(0 ${((1 - inn) * 100).toFixed(2)}% 0 ${(gone * 100).toFixed(2)}%)`;
      const edge = inn < 1 ? inn : gone;
      coverEdge.style.transform = `translateX(${(edge * crtW).toFixed(1)}px) translateX(-50%)`;
      coverEdge.style.opacity = inn < 1 || (gone > 0 && gone < 1) ? '1' : '0';
      // (the emblem drawn down as the frame has wiped across, the count after it)
      const em = nextEm.firstElementChild as HTMLElement | null;
      if (em) em.style.clipPath = `inset(0 0 ${((1 - ramp(t, coverFrom + BEAT * 0.75, coverFrom + BEAT * 1.25)) * 100).toFixed(1)}% 0)`;
      nextCount.style.visibility = t >= coverFrom + BEAT * 1.5 ? 'inherit' : 'hidden';
      typeInto(nextRole, CREDIT_BATTLES[upcoming].role, t, coverFrom + BEAT * 2, TYPE_NAME, 60);
    }
    if (!f) {
      vsEl.style.visibility = cardEl.style.visibility = towerEl.style.visibility = 'hidden';
      return covered;
    }
    // The VS card: the boxes sliding in to meet on the downbeat, VS. stamped on it (the intro's lightning behind), out
    // as the round is about to start.
    const vsOn = t > f.vs - 0.2 && t < f.go + 1.8;
    vsEl.style.visibility = vsOn ? 'visible' : 'hidden';
    if (vsOn && vsParts) {
      const inn = easeOut(ramp(t, f.vs - 0.2, f.vs));
      const out = easeIn(ramp(t, f.go + 1.5, f.go + 1.8));
      vsParts.l.style.transform = `translateX(${((inn - 1) * 160 - out * 160).toFixed(2)}%)`;
      vsParts.r.style.transform = `translateX(${((1 - inn) * 160 + out * 160).toFixed(2)}%)`;
      const stamp = ramp(t, f.vs, f.vs + 0.08);
      vsParts.mid.style.opacity = t >= f.vs && out < 0.5 ? '1' : '0';
      vsParts.mid.style.transform = `translate(-50%, -50%) scale(${(1 + (1 - stamp) * 1.1).toFixed(3)})`;
      vsParts.seam.style.opacity = (hit(t, f.vs, 0.1) * (0.7 + 0.3 * Math.sin(t * 160))).toFixed(3);
    }
    if (inRoom) {
      towerCard(t, f);
      return covered;
    }
    // Full screen, the credit's card: a beat after the blow, wiping open; the picture drawn down, the name typing in a
    // letter a sixteenth, the lines under it after; WINS stamped on the downbeat after the name; the cover wipes over it.
    const cardAt = f.blow + BEAT;
    const cardOn = t > cardAt - 0.02 && t < f.cut;
    cardEl.style.visibility = cardOn ? 'visible' : 'hidden';
    if (cardOn && card) {
      const open = easeOut(ramp(t, cardAt, cardAt + 0.18));
      cardEl.style.clipPath = `inset(0 ${((1 - open) * 100).toFixed(2)}% 0 0)`;
      if (card.emblem) card.emblem.style.clipPath = `inset(0 0 ${((1 - ramp(t, cardAt + 0.1, cardAt + 0.4)) * 100).toFixed(1)}% 0)`;
      card.role.style.visibility = t >= cardAt + 0.1 ? 'inherit' : 'hidden';
      const nameAt = cardAt + 0.15;
      typeInto(card.name, card.b.title, t, nameAt, TYPE_NAME, 0.6);
      const typed = nameAt + card.b.title.length * TYPE_NAME;
      typeInto(card.detail, card.b.detail.toUpperCase(), t, Math.max(typed, cardAt + 2 * BEAT), TYPE_LINE);
      if (card.link) card.link.style.visibility = t >= Math.max(typed, cardAt + 2 * BEAT) + card.b.detail.length * TYPE_LINE ? 'inherit' : 'hidden';
      const stampAt = barTime(nextBar(typed + 0.05));
      const s = ramp(t, stampAt, stampAt + 0.08);
      card.stamp.style.opacity = t >= stampAt ? '1' : '0';
      card.stamp.style.transform = `scale(${(1 + (1 - s) * 0.9).toFixed(3)})`;
    }
    return covered;
  };

  return {
    update(show: CreditsShow, dt: number): void {
      const t = show.t;
      if (leaving) return;
      // The now playing box: on with the song's first bar (or at once, joining it later), for PLAYING_FOR seconds.
      if (song && playingFrom < 0 && t >= barTime(1)) playingFrom = t;
      const playingUp = playingFrom < 0 ? 0 : 1 - ramp(t, playingFrom + PLAYING_FOR, playingFrom + PLAYING_FOR + PLAYING_FADE);
      // The music's levels: the meter (while the box shows), the embers.
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
        if (playingUp > 0) eq.forEach((lights, i) => {
          const a = Math.max(next, Math.floor(from * Math.pow(to / from, i / eq.length)));
          const b = Math.max(a + 1, Math.floor(from * Math.pow(to / from, (i + 1) / eq.length)));
          next = b;
          const lit = Math.round(Math.min(1, band(a, b) * 1.15) * EQ_LIGHTS);
          lights.forEach((el, k) => el.classList.toggle('on', k < lit));
        });
      }
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
      room.show(!look);
      if (partsInRoom !== (inRoom && !look)) placeParts(inRoom && !look);
      stageEl.classList.toggle('omfc-click', !!look);
      if (!inTitle) title.hide();
      if (!inFinale) finale.el.style.display = 'none';
      stage.update(look ?? { lift: 0, pan: 0, zoom: 1, dawn: 0, lit: 0, veil: 1, shake: 0, searchlights: 0, stars: 0 }, t, dt, level);
      if (inTitle) {
        title.update(t, show.titleEnd, {
          strike: (at, x, y, big) => {
            if (big) stage.burst(x, y, 60, 1.3);
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
            stage.burst(x, y, 90, 1.5);
          },
        });
        once('finale', t, fin.start, () => addFlash(fin.start, 0.5));
        if (fin.jumped) once('jump', t, barTime(ENDING_BAR), () => addFlash(barTime(ENDING_BAR), 0.5));
      }
      // The title's end: a white cut to the first fight (the logo's lightning).
      if (show.titleEnd > 0) once('titleEnd', t, show.titleEnd, () => addFlash(show.titleEnd, 0.6));

      // Over the fights.
      let covered = false;
      const n = show.fighting;
      const inFights = !inTitle && !inFinale && show.phase !== 'title' && n >= 0;
      if (inFights) {
        const prev = n > 0 ? show.fights[n - 1] : null;
        const f = show.fights[n];
        // (the cover: coming in for the next fight over this one's last beat, or still up from the fight before's)
        const next = !!f && t >= f.cut - BEAT;
        const coverFrom = next ? f!.cut - BEAT : prev ? prev.cut - BEAT : Infinity;
        covered = fightOverlay(t, n, f && t >= f.cut ? null : f, coverFrom, next ? n + 1 : n);
      } else {
        cover.style.visibility = vsEl.style.visibility = cardEl.style.visibility = towerEl.style.visibility = 'hidden';
      }
      // The now playing box: faded while a fighter stands over it (full screen; not while the cover hides the fight).
      const near = !inRoom && show.fighters && !covered ? Math.max(...show.fighters.map(([x]) => 1 - ramp(x, PLAYING_CLEAR - 30, PLAYING_CLEAR))) : 0;
      crowded += (near - crowded) * Math.min(1, dt * 5);
      playing.style.opacity = (playingUp * (1 - 0.85 * crowded)).toFixed(3);
      let flash = 0;
      for (const [at, k, decay] of flashes) flash = Math.max(flash, k * hit(t, at, decay));
      while (flashes.length && (t - flashes[0][0] > 3 || flashes[0][0] - t > 400)) flashes.shift();
      flashEl.style.opacity = (calm ? flash * 0.3 : flash).toFixed(3);
      prevT = t;
    },

    still(i: number, url: string): void {
      stills.push(url);
      finale.still(i, url);
    },

    songFailed(): void {
      song = null;
      playing.remove();
    },

    wake,

    leave(): void {
      leaving = true;
      // (the fights on the computer: its screen switches off and the room goes dark; else the whole picture switches off)
      if (partsInRoom) {
        root.classList.add('omfc-off-room');
        room.leave();
      } else {
        root.classList.add('omfc-off');
      }
      // (on the monitor, under the title or the end titles, the game's picture would fold around another centre)
      if (inRoom && !partsInRoom) screen?.style.setProperty('visibility', 'hidden');
      else screen?.classList.add('omfc-off-screen');
    },

    dispose(): void {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
      screen?.classList.remove('omfc-off-screen');
      screen?.style.removeProperty('visibility');
      // (the winners' pictures: blobs held until let go)
      for (const url of stills) URL.revokeObjectURL(url);
      room.dispose();
      root.remove();
    },
  };
}
