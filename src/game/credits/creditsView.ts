// The remaster's credits on screen (EXTRAS > CREDITS, run by creditsRun.ts): HTML over the game, sharp at any
// resolution. The title over an animated space backdrop (backdrop.ts) while the song starts; over each fight, a VS card
// as it begins and the credit's card once the credit has won; a now playing chip and the controls throughout; last,
// the end titles as slides over the backdrop (the winners, what the remaster is built with, the licenses, thanks).
import type { audio } from '../../audio/audio';
import { ensureUiFont, UI_FONT } from '../../platform/uiFont';
import { Backdrop } from './backdrop';
import { CREDIT_BATTLES, type CreditBattle, type CreditEmblem } from './battles';

/** The song playing (its analyser feeds the equalizer and the backdrop). */
export type Song = NonNullable<ReturnType<typeof audio.playTrack>>;

export interface CreditsViewOptions {
  /** Links open in the browser (the web version; the desktop app shows them as text). */
  links: boolean;
  song: Song | null;
  /** A robot's name (the game's language file). */
  harName: (harId: number) => string;
  /** The NEXT and BACK buttons, a click (next), the wheel and a right click (back) on the title and the end titles. */
  onNext: () => void;
  onPrevious: () => void;
  onExit: () => void;
}

export interface CreditsView {
  /** The title, over the backdrop (covers the game), or not. */
  intro(on: boolean): void;
  /** The cards of fight n: the VS card, the credit's card (changes animate). */
  cards(n: number, vs: boolean, won: boolean): void;
  /** Fades the screen to black (a skip's cut to the next fight), or back. */
  wipe(on: boolean): void;
  /** The end titles at a slide, over the backdrop. */
  finale(slide: number): void;
  readonly slides: number;
  /** The song could not be played (the game's own music plays instead). */
  songFailed(): void;
  frame(dt: number): void;
  dispose(): void;
}

const AVATAR = 'credits/jared-woodruff.jpg';
const SONG_COVER = 'credits/twenty-ninety-seven.jpg';
/** Bars of the now playing chip's equalizer. */
const CHIP_BARS = 5;
/** Seconds the controls and the hint stay up after the last input. */
const QUIET_AFTER = 5;
const NUMBERS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'];

/** The projects and tools the remaster builds on. */
const BUILT_WITH: [string, string, string][] = [
  ['OpenOMF', 'The open-source reimplementation whose reverse engineering this remaster follows.', 'MIT License'],
  ['xBR-lv2 by Hyllian', 'Edge-directed upscaling, adapted for the remastered sprites.', 'MIT License'],
  ['Orbitron', 'Typeface by Matt McInerney and The League of Moveable Type.', 'SIL Open Font License 1.1'],
  ['ElevenLabs', "The announcers' voices: Victor and Kristen, performed with Eleven v4.", 'Text to speech · elevenlabs.io'],
  ['FFmpeg', "The announcers' arena sound.", 'LGPL / GPL · used as a tool'],
  ['Tauri', 'The Windows desktop app.', 'MIT / Apache-2.0'],
  ['Vite · TypeScript · Vitest', 'Build and test tools.', 'MIT / Apache-2.0'],
];

/** The credits' emblems (in the credit's color, currentColor). */
const EMBLEMS: Record<Exclude<CreditEmblem, 'avatar' | 'cover'>, string> = {
  chip: `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true">
<path d="M36 26V12M50 26V6M64 26V12M36 74v14M50 74v20M64 74v14M26 36H12M26 50H6M26 64H12M74 36h14M74 50h20M74 64h14" stroke-width="3"/>
<rect x="26" y="26" width="48" height="48" rx="9" stroke-width="3" fill="rgba(0,0,0,.4)"/>
<g fill="currentColor" stroke="none"><circle cx="50" cy="6" r="3.2"/><circle cx="50" cy="94" r="3.2"/><circle cx="6" cy="50" r="3.2"/><circle cx="94" cy="50" r="3.2"/></g>
<rect class="omfc-core" x="38" y="38" width="24" height="24" rx="5" fill="currentColor" stroke="none"/></svg>`,
  prism: `<svg viewBox="0 0 100 100" fill="none" stroke-linecap="round" stroke-width="3.2" aria-hidden="true">
<path d="M4 60 L41 52" stroke="#ffffff"/>
<path class="omfc-prism" d="M50 16 L78 70 L22 70 Z" stroke="currentColor" fill="rgba(170,255,220,.12)"/>
<path d="M63 47 L97 33" stroke="#ff4d7a"/><path d="M64 51 L97 44" stroke="#ffd84a"/><path d="M65 55 L97 55" stroke="#54ff7a"/>
<path d="M66 59 L97 66" stroke="#33e6ff"/><path d="M67 63 L97 77" stroke="#9a6bff"/></svg>`,
  wave: `<svg class="omfc-wave" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">${[22, 40, 64, 48, 84, 58, 72, 38, 20]
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
@property --omfc-a { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
.omfc { position: fixed; inset: 0; z-index: 18; overflow: hidden; pointer-events: none; user-select: none; color: #e8f0ff;
  font-family: ${UI_FONT}; transition: opacity .6s; }
.omfc.omfc-gone { opacity: 0; }
.omfc a, .omfc button { pointer-events: auto; }
.omfc-nb { white-space: nowrap; }
@keyframes omfc-in { from { opacity: 0; transform: translateY(18px) } to { opacity: 1; transform: none } }
@keyframes omfc-spin { to { --omfc-a: 360deg } }

/* The stage: the title and the end titles over the space backdrop, covering the game. */
.omfc-stage { position: absolute; inset: 0; z-index: 1; background: #02030a; opacity: 0; visibility: hidden; cursor: default;
  transition: opacity .8s, visibility 0s .8s; }
.omfc-stage.omfc-on { opacity: 1; visibility: visible; pointer-events: auto; transition: opacity .8s; }
.omfc-bg { position: absolute; inset: 0; width: 100%; height: 100%; }
.omfc-stage::before { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 2;
  background: radial-gradient(ellipse at 50% 45%, transparent 52%, rgba(0,0,0,.72)); }
.omfc-stage::after { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 3; opacity: .45;
  background: repeating-linear-gradient(180deg, rgba(0,0,0,.28) 0 1px, transparent 1px 3px); animation: omfc-flicker 7s steps(1) infinite; }
@keyframes omfc-flicker { 0%, 100% { opacity: .45 } 47% { opacity: .38 } 48% { opacity: .52 } 49% { opacity: .45 } }
.omfc-stage[data-show="intro"] .omfc-finale, .omfc-stage[data-show="finale"] .omfc-intro { display: none; }

.omfc-intro { position: absolute; inset: 0; z-index: 1; box-sizing: border-box; padding-bottom: 11vh; display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center; }
.omfc-kicker { font-weight: 700; letter-spacing: .6em; margin-right: -.6em; font-size: clamp(14px, 1.6vw, 28px); color: #a9bcff;
  text-shadow: 0 0 14px rgba(80,120,255,.9); animation: omfc-in 1.2s .3s both; }
.omfc-title { position: relative; font-weight: 900; font-size: clamp(96px, 18vw, 320px); line-height: .92; letter-spacing: .03em;
  background: linear-gradient(180deg, #ffffff 0%, #d6deff 28%, #6f8bff 47%, #16237a 51%, #8db0ff 60%, #ffffff 78%, #b7c3ff 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 26px rgba(60,110,255,.6)) drop-shadow(0 7px 0 rgba(0,0,10,.65)); animation: omfc-slam 1.3s .5s cubic-bezier(.2,.9,.25,1) both; }
.omfc-title::after { content: attr(data-text); position: absolute; inset: 0; background: linear-gradient(105deg, transparent 42%, rgba(255,255,255,.95) 50%, transparent 58%);
  background-size: 260% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: omfc-sweep 5.5s 2s ease-in-out infinite; }
@keyframes omfc-sweep { 0% { background-position: 130% 0 } 40%, 100% { background-position: -30% 0 } }
@keyframes omfc-slam { from { opacity: 0; transform: scale(1.6); letter-spacing: .4em } 70% { opacity: 1 } to { opacity: 1; transform: none } }
.omfc-remastered { margin-top: .25em; font-weight: 800; font-size: clamp(22px, 3.8vw, 66px); letter-spacing: .5em; margin-right: -.5em; color: #c6f8ff;
  text-shadow: 0 0 6px #33e6ff, 0 0 20px #33e6ff, 0 0 46px #2f5bff; animation: omfc-neon 2.6s 1.5s both; }
@keyframes omfc-neon { 0% { opacity: 0 } 8% { opacity: 1 } 11% { opacity: .15 } 15% { opacity: 1 } 28% { opacity: .45 } 31%, 100% { opacity: 1 } }
.omfc-rule { width: min(780px, 72vw); height: 2px; margin: clamp(20px, 3.4vh, 40px) auto; transform: scaleX(0);
  background: linear-gradient(90deg, transparent, #33e6ff 20%, #ff3df2 50%, #33e6ff 80%, transparent);
  box-shadow: 0 0 14px #33e6ff, 0 0 34px #ff3df2; animation: omfc-grow 1.4s 1.9s cubic-bezier(.2,.8,.2,1) forwards; }
@keyframes omfc-grow { to { transform: scaleX(1) } }
.omfc-sub { font-weight: 600; letter-spacing: .8em; margin-right: -.8em; font-size: clamp(12px, 1.35vw, 24px); color: #ffd84a;
  text-shadow: 0 0 12px rgba(255,200,60,.85); animation: omfc-in 1s 2.5s both; }
.omfc-tag { margin-top: 1.5em; font-weight: 700; letter-spacing: .45em; margin-right: -.45em; font-size: clamp(11px, 1.1vw, 19px); color: #fff;
  text-shadow: 0 0 10px #ff3df2, 0 0 26px rgba(255,61,242,.7); animation: omfc-in 1s 3.2s both; }

/* The end titles: slides, one at a time. */
.omfc-finale { position: absolute; inset: 0; z-index: 1; }
.omfc-slide { position: absolute; inset: 0; box-sizing: border-box; padding: 5vh 4vw 21vh; display: flex; flex-direction: column;
  overflow-y: auto; overflow-x: hidden; scrollbar-width: none; text-align: center; opacity: 0; visibility: hidden; transform: translateY(7vh);
  transition: opacity .6s, transform .7s cubic-bezier(.5,0,.8,.3), visibility 0s .7s; }
.omfc-slide::-webkit-scrollbar { display: none; }
.omfc-slide.omfc-past { transform: translateY(-7vh); }
.omfc-slide.omfc-on { opacity: 1; visibility: visible; transform: none; transition: opacity .9s .3s, transform 1s .3s cubic-bezier(.2,.8,.2,1); }
.omfc-inner { margin: auto; width: min(1560px, 92vw); display: flex; flex-direction: column; align-items: center; }
.omfc-slide h2 { align-self: stretch; display: flex; align-items: center; gap: 1em; margin: 0 0 clamp(18px, 3.4vh, 44px); font-weight: 800;
  font-size: clamp(16px, 1.9vw, 32px); letter-spacing: .5em; color: #ffd84a; text-shadow: 0 0 16px rgba(255,200,60,.75); }
.omfc-slide h2 span { margin-right: -.5em; }
.omfc-slide h2::before, .omfc-slide h2::after { content: ''; flex: 1; height: 2px; box-shadow: 0 0 12px rgba(255,200,60,.8); }
.omfc-slide h2::before { background: linear-gradient(90deg, transparent, #ffd84a); }
.omfc-slide h2::after { background: linear-gradient(270deg, transparent, #ffd84a); }
.omfc-dots { position: absolute; left: 0; right: 0; bottom: clamp(52px, 8vh, 90px); z-index: 4; display: flex; justify-content: center; gap: 10px; }
.omfc-dots i { width: 10px; height: 10px; border-radius: 5px; background: rgba(170,190,255,.35); transition: width .4s, background .4s, box-shadow .4s; }
.omfc-dots i.omfc-on { width: 30px; background: #ffd84a; box-shadow: 0 0 12px rgba(255,200,60,.8); }

.omfc-wins { --g: clamp(12px, 1.3vw, 24px); align-self: stretch; display: flex; flex-wrap: wrap; justify-content: center; gap: var(--g); }
.omfc-tile { position: relative; box-sizing: border-box; flex: 0 1 calc((100% - 3 * var(--g)) / 4); min-width: min(250px, 100%);
  display: grid; grid-template-columns: clamp(40px, 3.3vw, 64px) minmax(0, 1fr); column-gap: clamp(10px, .9vw, 16px); align-items: center;
  align-content: start; padding: clamp(14px, 1.3vw, 26px) clamp(14px, 1.3vw, 24px); border-radius: 18px; text-align: left;
  background: linear-gradient(160deg, color-mix(in srgb, var(--c) 20%, rgba(8,10,30,.92)), rgba(5,6,20,.94));
  border: 1px solid color-mix(in srgb, var(--c) 55%, transparent); box-shadow: 0 0 26px color-mix(in srgb, var(--c) 22%, transparent);
  opacity: 0; transform: translateY(26px) scale(.96); transition: opacity .7s, transform .7s cubic-bezier(.2,.8,.2,1); }
.omfc-on .omfc-tile { opacity: 1; transform: none; }
.omfc-tile .omfc-em { grid-row: span 2; }
.omfc-tile-role { align-self: end; font-weight: 700; font-size: clamp(9px, .7vw, 13px); letter-spacing: .24em; color: color-mix(in srgb, var(--c) 65%, #fff); }
.omfc-tile-name { align-self: start; margin-top: .2em; font-weight: 900; font-size: clamp(14px, 1.2vw, 23px); line-height: 1.15; letter-spacing: .03em;
  color: #fff; text-shadow: 0 0 12px color-mix(in srgb, var(--c) 70%, transparent); }
.omfc-tile p { grid-column: 1 / -1; margin: .9em 0 0; font-size: clamp(11px, .82vw, 15px); line-height: 1.5; letter-spacing: .02em; color: #c3cbe8; }
.omfc-tile .omfc-link { grid-column: 1 / -1; justify-self: start; white-space: nowrap; font-size: clamp(10px, .76vw, 14px); }

.omfc-grid { align-self: stretch; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: clamp(12px, 1.5vw, 26px); text-align: left; }
.omfc-item { position: relative; padding: 1.2em 1.35em 1.1em; border-radius: 16px; background: linear-gradient(160deg, rgba(22,34,100,.6), rgba(7,9,32,.78));
  border: 1px solid rgba(80,120,255,.38); box-shadow: inset 0 0 34px rgba(47,91,255,.14); opacity: 0; transform: translateY(30px);
  transition: opacity .7s cubic-bezier(.2,.8,.2,1), transform .7s cubic-bezier(.2,.8,.2,1); }
.omfc-on .omfc-item { opacity: 1; transform: none; }
.omfc-item h3 { margin: 0 0 .5em; font-weight: 800; font-size: clamp(15px, 1.35vw, 24px); color: #fff; letter-spacing: .05em; text-shadow: 0 0 12px rgba(100,150,255,.7); }
.omfc-item p { margin: 0 0 .9em; font-size: clamp(12px, 1vw, 18px); color: #aebbef; line-height: 1.5; letter-spacing: .02em; }
.omfc-lic { display: inline-block; font-size: clamp(10px, .85vw, 15px); font-weight: 700; letter-spacing: .1em; color: #33e6ff;
  border: 1px solid rgba(51,230,255,.55); border-radius: 7px; padding: .3em .7em; background: rgba(51,230,255,.06); }

.omfc-notes h2 { margin-bottom: clamp(12px, 2.2vh, 30px); }
.omfc-notes .omfc-gap { margin-top: clamp(18px, 3.6vh, 50px); }
.omfc-original { font-weight: 900; font-size: clamp(30px, 4.4vw, 74px); letter-spacing: .05em; color: #fff; margin-bottom: .2em;
  text-shadow: 0 0 12px rgba(255,120,60,.8), 0 0 36px rgba(255,60,40,.55), 0 4px 0 #2a0a06; }
.omfc-notes p { color: #bcc9ff; font-size: clamp(13px, 1.25vw, 22px); line-height: 1.6; letter-spacing: .04em; margin: .3em auto; max-width: 62ch; }
.omfc-notes .omfc-note { color: #7f90c8; font-size: clamp(11px, .95vw, 17px); }
.omfc-end { min-height: 60vh; justify-content: center; }
.omfc-thanks { font-weight: 900; font-size: clamp(36px, 6.4vw, 118px); letter-spacing: .08em; line-height: 1.1;
  background: linear-gradient(180deg, #ffffff 10%, #ffd84a 55%, #ff7a3d 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 24px rgba(255,170,60,.65)); animation: omfc-beat 3.6s ease-in-out infinite; }
@keyframes omfc-beat { 50% { transform: scale(1.035) } }
.omfc-tagline { margin-top: 1.6em; letter-spacing: .7em; margin-right: -.7em; color: #a9bcff; font-size: clamp(12px, 1.35vw, 23px); text-shadow: 0 0 12px rgba(80,120,255,.8); }

/* Emblems and links. */
.omfc-em { position: relative; width: 100%; aspect-ratio: 1; color: var(--c); }
.omfc-em svg { display: block; width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0 0 10px color-mix(in srgb, var(--c) 70%, transparent)); }
.omfc-em img { display: block; width: 100%; height: 100%; object-fit: cover; }
.omfc-em-avatar img { border-radius: 50%; box-shadow: 0 0 0 3px var(--c), 0 0 24px var(--c); }
.omfc-em-cover img { border-radius: 12%; box-shadow: 0 0 0 2px color-mix(in srgb, var(--c) 70%, #fff), 0 0 24px var(--c); }
.omfc-core { animation: omfc-core 2.2s ease-in-out infinite; transform-origin: 50px 50px; }
@keyframes omfc-core { 50% { opacity: .35; transform: scale(.82) } }
.omfc-prism { animation: omfc-prism 3s ease-in-out infinite; }
@keyframes omfc-prism { 50% { fill: rgba(170,255,220,.4) } }
.omfc-wave rect { transform-box: fill-box; transform-origin: center; animation: omfc-wave 1.2s ease-in-out infinite; }
${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `.omfc-wave rect:nth-child(${i + 1}) { animation-delay: ${(-0.13 * ((i * 5) % 9)).toFixed(2)}s }`).join('\n')}
@keyframes omfc-wave { 50% { transform: scaleY(.45) } }
.omfc-link { display: inline-block; margin-top: .9em; font-weight: 600; font-size: clamp(11px, .95vw, 17px); letter-spacing: .08em; text-decoration: none;
  color: #fff; padding: .45em 1.1em; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--c, #33e6ff) 70%, transparent);
  background: color-mix(in srgb, var(--c, #33e6ff) 14%, transparent); transition: background .25s, box-shadow .25s; }
a.omfc-link:hover { background: color-mix(in srgb, var(--c, #33e6ff) 32%, transparent); box-shadow: 0 0 20px var(--c, #33e6ff); }

/* A fight's VS card: the credit's band from the left, the opponent's from the right, VS where they meet. */
.omfc-vs { --h: clamp(118px, 23vh, 290px); --w: calc(50% + var(--h) / 4 - .8vw); --vs: clamp(44px, 6.2vw, 136px); position: absolute;
  left: 0; right: 0; top: 21%; height: var(--h); z-index: 2; }
.omfc-vs-band { position: absolute; top: 0; bottom: 0; width: var(--w); box-sizing: border-box; display: flex; align-items: center;
  opacity: 0; transition: transform .32s cubic-bezier(.6,0,.9,.5), opacity .32s; }
.omfc-vs-l { left: 0; justify-content: flex-end; padding: 0 calc(var(--h) / 4 + var(--vs) * .9 + 1.6vw) 0 3vw; transform: translateX(-104%);
  clip-path: polygon(0 0, 100% 0, calc(100% - var(--h) / 2) 100%, 0 100%);
  background: linear-gradient(90deg, rgba(3,4,12,0), color-mix(in srgb, var(--c) 24%, #04050e) 36%, color-mix(in srgb, var(--c) 50%, #04050e));
  box-shadow: inset 0 3px 0 var(--c), inset 0 -3px 0 var(--c); }
.omfc-vs-r { right: 0; justify-content: flex-start; padding: 0 3vw 0 calc(var(--h) / 4 + var(--vs) * .9 + 1.6vw); transform: translateX(104%);
  clip-path: polygon(calc(var(--h) / 2) 0, 100% 0, 100% 100%, 0 100%);
  background: linear-gradient(270deg, rgba(3,4,12,0), color-mix(in srgb, var(--o) 24%, #04050e) 36%, color-mix(in srgb, var(--o) 50%, #04050e));
  box-shadow: inset 0 3px 0 var(--o), inset 0 -3px 0 var(--o); }
.omfc-vs.omfc-on .omfc-vs-band { opacity: 1; transform: none; transition: transform .42s cubic-bezier(.2,.9,.25,1.05), opacity .15s; }
.omfc-vs-who { display: flex; flex-direction: column; max-width: 100%; }
.omfc-vs-l .omfc-vs-who { align-items: flex-end; text-align: right; }
.omfc-vs-r .omfc-vs-who { align-items: flex-start; text-align: left; }
.omfc-vs-role { font-weight: 700; letter-spacing: .36em; font-size: clamp(10px, 1vw, 19px); color: color-mix(in srgb, var(--c) 60%, #fff);
  text-shadow: 0 0 10px var(--c), 0 1px 2px #000; }
.omfc-vs-l .omfc-vs-role { margin-right: -.36em; }
.omfc-vs-r .omfc-vs-role { color: color-mix(in srgb, var(--o) 45%, #fff); text-shadow: 0 0 10px var(--o), 0 1px 2px #000; }
.omfc-vs-name { margin: .12em 0 .3em; font-weight: 900; line-height: 1.05; letter-spacing: .03em; color: #fff; white-space: nowrap;
  font-size: clamp(15px, min(3.3vw, calc((50vw - var(--vs) * .9 - 6vw) / var(--n) / .84)), 64px); text-shadow: 0 0 18px var(--c), 0 3px 0 rgba(0,0,0,.6); }
.omfc-vs-r .omfc-vs-name { text-shadow: 0 0 18px var(--o), 0 3px 0 rgba(0,0,0,.6); }
.omfc-vs-har { font-weight: 800; letter-spacing: .3em; font-size: clamp(9px, .8vw, 15px); padding: .4em .6em .4em .9em; border-radius: 999px;
  color: #fff; background: rgba(0,0,0,.4); border: 1px solid color-mix(in srgb, var(--c) 70%, #fff); }
.omfc-vs-r .omfc-vs-har { border-color: color-mix(in srgb, var(--o) 60%, #fff); }
.omfc-vs-mid { position: absolute; left: 50%; top: 50%; z-index: 1; font-weight: 900; font-style: italic; font-size: var(--vs);
  line-height: 1; padding: 0 .12em; transform: translate(-50%, -52%) scale(2.6); opacity: 0;
  background: linear-gradient(180deg, #fff 0%, #ffe9a8 36%, #ff9a3d 50%, #a8231c 55%, #ffcf70 72%, #fff 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 16px rgba(255,150,60,.75)) drop-shadow(0 5px 0 rgba(0,0,0,.75)); transition: transform .2s, opacity .2s; }
.omfc-vs.omfc-on .omfc-vs-mid { opacity: 1; transform: translate(-50%, -52%) scale(1);
  transition: transform .36s .3s cubic-bezier(.3,1.7,.5,1), opacity .12s .3s; }
.omfc-vs-flash { position: absolute; left: 50%; top: 50%; width: calc(var(--h) * 1.8); aspect-ratio: 1; margin: calc(var(--h) * -.9) 0 0 calc(var(--h) * -.9);
  border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,.95), rgba(255,190,90,.5) 30%, transparent 65%); opacity: 0; pointer-events: none; }
.omfc-vs.omfc-on .omfc-vs-flash { animation: omfc-flash .7s .36s ease-out both; }
@keyframes omfc-flash { 0% { opacity: 0; transform: scale(.2) } 25% { opacity: 1 } 100% { opacity: 0; transform: scale(1.5) } }
.omfc-vs-count { position: absolute; left: 0; right: 0; bottom: calc(100% + clamp(6px, 1.2vh, 14px)); text-align: center; font-weight: 700;
  letter-spacing: .45em; font-size: clamp(9px, .8vw, 14px); color: rgba(235,240,255,.9); text-shadow: 0 1px 3px #000, 0 0 12px rgba(0,0,0,.8);
  opacity: 0; transition: opacity .25s; }
.omfc-vs.omfc-on .omfc-vs-count { opacity: 1; transition: opacity .5s .45s; }

/* The credit's card, once the fight is won. */
.omfc-win { --e: clamp(64px, 7.2vw, 136px); position: absolute; left: 50%; top: 18.5%; z-index: 2; box-sizing: border-box; width: min(1080px, 92vw);
  display: grid; grid-template-columns: var(--e) minmax(0, 1fr); column-gap: clamp(16px, 2vw, 38px); align-items: center;
  padding: clamp(16px, 1.7vw, 32px) clamp(22px, 2.6vw, 50px); border-radius: clamp(16px, 1.4vw, 26px); border: 2px solid transparent;
  background: linear-gradient(160deg, color-mix(in srgb, var(--c) 16%, rgba(7,9,24,.9)), rgba(4,5,15,.92)) padding-box,
    conic-gradient(from var(--omfc-a), var(--c), #fff, var(--c), color-mix(in srgb, var(--c) 35%, #000), var(--c)) border-box;
  box-shadow: 0 0 44px color-mix(in srgb, var(--c) 42%, transparent), 0 18px 44px rgba(0,0,0,.55);
  opacity: 0; transform: translateX(-50%) scale(1.12); transition: opacity .35s, transform .35s; animation: omfc-spin 5s linear infinite; }
.omfc-win.omfc-on { opacity: 1; transform: translateX(-50%); transition: opacity .2s, transform .55s cubic-bezier(.2,1.5,.4,1); }
.omfc-win::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: #fff; opacity: 0; pointer-events: none; }
.omfc-win.omfc-on::before { animation: omfc-flashout .6s ease-out; }
@keyframes omfc-flashout { from { opacity: .8 } to { opacity: 0 } }
.omfc-win-role { font-weight: 700; letter-spacing: .4em; font-size: clamp(11px, 1vw, 19px); color: color-mix(in srgb, var(--c) 60%, #fff);
  text-shadow: 0 0 10px var(--c); }
.omfc-win-name { margin-top: .14em; font-weight: 900; line-height: 1.06; letter-spacing: .03em; color: #fff;
  font-size: clamp(20px, min(4.2vw, calc((min(1080px, 92vw) - 300px) / var(--n) / .88)), 76px);
  text-shadow: 0 0 16px color-mix(in srgb, var(--c) 85%, transparent), 0 4px 0 rgba(0,0,0,.55); }
.omfc-win-detail { margin-top: .55em; font-weight: 500; font-size: clamp(12px, 1.12vw, 21px); line-height: 1.45; letter-spacing: .02em; color: #d9def0; }
.omfc-stamp { position: absolute; right: clamp(-14px, -1vw, -6px); top: clamp(-20px, -1.5vw, -10px); padding: .16em .55em .2em .67em;
  border: 3px solid var(--c); border-radius: 10px; font-weight: 900; font-size: clamp(16px, 2vw, 38px); letter-spacing: .12em; color: #fff;
  background: rgba(6,7,18,.88); text-shadow: 0 0 12px var(--c); box-shadow: 0 0 22px color-mix(in srgb, var(--c) 60%, transparent);
  opacity: 0; transform: rotate(8deg); }
.omfc-win.omfc-on .omfc-stamp { animation: omfc-stamp .5s .45s cubic-bezier(.3,1.6,.5,1) both; }
@keyframes omfc-stamp { from { opacity: 0; transform: rotate(8deg) scale(2.4) } to { opacity: 1; transform: rotate(8deg) scale(1) } }

.omfc-wipe { position: absolute; inset: 0; z-index: 3; background: #000; opacity: 0; transition: opacity .26s; }
.omfc-wipe.omfc-on { opacity: 1; }

/* The now playing chip, the controls and the hint. */
.omfc-playing { position: absolute; left: clamp(10px, 1.6vw, 28px); bottom: clamp(10px, 2vh, 26px); z-index: 4; display: flex; align-items: center; gap: .9em;
  padding: .55em 1.1em .55em .55em; border-radius: 14px; background: rgba(10,8,34,.66); border: 1px solid rgba(255,61,242,.45);
  box-shadow: 0 0 22px rgba(255,61,242,.3); backdrop-filter: blur(6px); opacity: 0; transform: translateY(12px);
  transition: opacity .8s, transform .8s; font-size: clamp(9px, .75vw, 13px); }
.omfc-playing.omfc-on { opacity: 1; transform: none; }
.omfc-playing img { width: 3.6em; height: 3.6em; border-radius: 8px; object-fit: cover; }
.omfc-playing b { display: block; font-weight: 700; letter-spacing: .3em; font-size: .78em; color: #ff9af2; }
.omfc-playing span { display: block; margin-top: .3em; font-weight: 800; letter-spacing: .06em; color: #fff; }
.omfc-playing em { display: block; margin-top: .2em; font-style: normal; font-weight: 600; letter-spacing: .2em; color: #9fe9ff; font-size: .85em; }
.omfc-eq { display: flex; align-items: flex-end; gap: 3px; height: 2.4em; width: 3.2em; margin-left: .4em; }
.omfc-eq i { flex: 1; height: 100%; border-radius: 3px 3px 1px 1px; transform-origin: bottom; transform: scaleY(.06);
  background: linear-gradient(0deg, #2f5bff, #33e6ff 55%, #ff3df2); box-shadow: 0 0 10px rgba(51,230,255,.5); }
.omfc-ctl { position: absolute; right: clamp(10px, 1.6vw, 28px); bottom: clamp(10px, 2vh, 26px); z-index: 4; display: flex; gap: .6em; transition: opacity .8s; }
.omfc-btn { display: flex; align-items: center; gap: .65em; font: 700 clamp(11px, .85vw, 16px)/1 ${UI_FONT}; letter-spacing: .22em; color: #d3e2ff;
  cursor: pointer; background: rgba(10,16,52,.66); border: 1px solid rgba(80,120,255,.55); border-radius: 999px; padding: .8em 1.3em;
  backdrop-filter: blur(6px); transition: color .2s, border-color .2s, box-shadow .2s; }
.omfc-btn:hover { color: #fff; border-color: #33e6ff; box-shadow: 0 0 20px rgba(51,230,255,.55); }
.omfc-btn svg { width: 1.1em; height: 1.1em; }
.omfc-hint { position: absolute; left: 0; right: 0; bottom: clamp(16px, 2.8vh, 34px); z-index: 4; text-align: center; pointer-events: none;
  font-weight: 600; font-size: clamp(10px, .8vw, 14px); letter-spacing: .3em; color: rgba(215,225,255,.8); text-shadow: 0 1px 3px #000;
  transition: opacity .8s; }
.omfc-quiet .omfc-ctl, .omfc-quiet .omfc-hint { opacity: 0; }
@media (max-width: 900px) { .omfc-hint { display: none; } .omfc-btn span { display: none; } }

@media (prefers-reduced-motion: reduce) {
  .omfc, .omfc *, .omfc *::before, .omfc *::after { animation: none !important; transition-duration: .01s !important; transition-delay: 0s !important; }
  .omfc-rule { transform: none; }
  .omfc-win.omfc-on .omfc-stamp { opacity: 1; }
}
`;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function emblem(kind: CreditEmblem): string {
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

function markup(links: boolean): string {
  const count = NUMBERS[CREDIT_BATTLES.length] ?? String(CREDIT_BATTLES.length);
  const tiles = CREDIT_BATTLES.map((b, i) => `<article class="omfc-tile" style="--c: ${b.accent}; transition-delay: ${(0.35 + 0.07 * i).toFixed(2)}s">
      ${emblem(b.emblem)}<div class="omfc-tile-role">${esc(b.role)}</div><div class="omfc-tile-name">${esc(b.title)}</div>
      <p>${esc(b.detail)}</p>${link(b, links)}</article>`).join('');
  const items = BUILT_WITH.map(([name, what, lic], i) => `<div class="omfc-item" style="transition-delay: ${(0.35 + 0.07 * i).toFixed(2)}s">
      <h3>${esc(name)}</h3><p>${esc(what)}</p><span class="omfc-lic">${esc(lic)}</span></div>`).join('');
  return `<div class="omfc-stage" data-show="intro">
  <canvas class="omfc-bg"></canvas>
  <section class="omfc-intro">
    <div class="omfc-kicker">ONE MUST FALL</div>
    <div class="omfc-title" data-text="2097">2097</div>
    <div class="omfc-remastered">REMASTERED</div>
    <div class="omfc-rule"></div>
    <div class="omfc-sub">THE CREDITS</div>
    <div class="omfc-tag">${count} FIGHTS &nbsp;·&nbsp; ${count} WINNERS</div>
  </section>
  <section class="omfc-finale">
    <div class="omfc-slide"><div class="omfc-inner"><h2><span>THE WINNERS</span></h2><div class="omfc-wins">${tiles}</div></div></div>
    <div class="omfc-slide"><div class="omfc-inner"><h2><span>BUILT WITH</span></h2><div class="omfc-grid">${items}</div></div></div>
    <div class="omfc-slide"><div class="omfc-inner omfc-notes">
      <h2><span>THE ORIGINAL GAME</span></h2>
      <div class="omfc-original">ONE MUST FALL 2097</div>
      <p><span class="omfc-nb">© 1994 Diversions Entertainment</span> &nbsp;·&nbsp; <span class="omfc-nb">Published by Epic MegaGames</span> &nbsp;·&nbsp;
        <span class="omfc-nb">Freeware since 1999</span></p>
      <p>Its owners let everyone share it, as long as nobody charges for it.</p>
      <h2 class="omfc-gap"><span>THE REMASTER'S CODE</span></h2>
      <p>Released under the MIT License. The original game's files and the artwork made from them come with it on the game's
        freeware terms: free of charge, never sold.</p>
      <p class="omfc-note">An unofficial fan remaster, not affiliated with or endorsed by the original authors. All trademarks belong to their owners.</p>
    </div></div>
    <div class="omfc-slide"><div class="omfc-inner omfc-end"><div class="omfc-thanks">THANKS FOR PLAYING</div><div class="omfc-tagline">ONE MUST FALL</div></div></div>
    <div class="omfc-dots">${'<i></i>'.repeat(4)}</div>
  </section>
</div>
<div class="omfc-vs"></div>
<div class="omfc-win"></div>
<div class="omfc-wipe"></div>
<div class="omfc-playing"><img alt="" src="${SONG_COVER}"><div><b>NOW PLAYING</b><span>TWENTY NINETY-SEVEN (REMIX)</span><em>HADAL STATIC</em></div>
  <div class="omfc-eq">${'<i></i>'.repeat(CHIP_BARS)}</div></div>
<div class="omfc-ctl"><button class="omfc-btn omfc-next" type="button"><span>NEXT</span>${NEXT_SVG}</button>
  <button class="omfc-btn omfc-back" type="button">${X_SVG}<span>BACK</span></button></div>
<div class="omfc-hint">ENTER / A &nbsp;NEXT &nbsp;&nbsp;·&nbsp;&nbsp; ESC / B &nbsp;BACK</div>`;
}

/** A fight's VS card: the credit (its role, name and robot) against the opponent. */
function versusMarkup(b: CreditBattle, n: number, harName: (harId: number) => string): string {
  const side = (cls: string, role: string, name: string, har: string) => `<div class="omfc-vs-band ${cls}"><div class="omfc-vs-who">
    <div class="omfc-vs-role">${esc(role)}</div><div class="omfc-vs-name" style="--n: ${name.length}">${esc(name)}</div>
    <div class="omfc-vs-har">${esc(har.toUpperCase())}</div></div></div>`;
  return `<div class="omfc-vs-count">CREDIT ${n + 1} OF ${CREDIT_BATTLES.length}</div>
    ${side('omfc-vs-l', b.role, b.winner.name, harName(b.winner.har))}
    ${side('omfc-vs-r', 'OPPONENT', b.loser.name, harName(b.loser.har))}
    <div class="omfc-vs-flash"></div><div class="omfc-vs-mid">VS</div>`;
}

/** The credit's card: the emblem, the role, the name and what they did. */
function winnerMarkup(b: CreditBattle, links: boolean): string {
  return `${emblem(b.emblem)}<div><div class="omfc-win-role">${esc(b.role)}</div>
    <div class="omfc-win-name" style="--n: ${b.title.length}">${esc(b.title)}</div>
    <div class="omfc-win-detail">${esc(b.detail)}</div>${link(b, links)}</div><div class="omfc-stamp">WINS</div>`;
}

export function openCreditsView(opts: CreditsViewOptions): CreditsView {
  if (!document.getElementById('omfc-style')) {
    ensureUiFont();
    const style = document.createElement('style');
    style.id = 'omfc-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const root = document.createElement('div');
  root.className = 'omfc';
  root.innerHTML = markup(opts.links);
  document.body.appendChild(root);
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const stage = q('.omfc-stage');
  const vsEl = q('.omfc-vs');
  const winEl = q('.omfc-win');
  const wipeEl = q('.omfc-wipe');
  const playing = q('.omfc-playing');
  const slides = [...root.querySelectorAll<HTMLElement>('.omfc-slide')];
  const dots = [...root.querySelectorAll<HTMLElement>('.omfc-dots i')];
  const eq = [...root.querySelectorAll<HTMLElement>('.omfc-eq i')];
  const backdrop = new Backdrop(q<HTMLCanvasElement>('.omfc-bg'), calm);
  let song = opts.song;
  const bins = new Uint8Array(song?.analyser.frequencyBinCount ?? 0);
  let t = 0;
  let bassAvg = 0;
  let lastBeat = 0;
  /** The fight the cards are made for, and whether they are up. */
  let shown = -1;
  let vsOn = false;
  let wonOn = false;
  /** The backdrop is drawn while the stage is up (and fading out). */
  let stageLeft = 0;
  let scroll = 0;
  let scrollTo = 0;
  let quiet = QUIET_AFTER;
  let wheelAt = 0;
  const timers: number[] = [];

  const wake = () => {
    root.classList.remove('omfc-quiet');
    quiet = QUIET_AFTER;
  };
  const showStage = () => {
    stage.classList.add('omfc-on');
    stageLeft = Infinity;
  };
  const center = (el: HTMLElement): [number, number] => {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };

  // The title and the end titles: a click goes on, a right click goes back to the menu, the wheel turns the slides.
  stage.addEventListener('click', (e) => {
    if (!(e.target as Element).closest('a, button')) opts.onNext();
  });
  stage.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    opts.onExit();
  });
  stage.addEventListener('wheel', (e) => {
    const now = performance.now();
    if (Math.abs(e.deltaY) < 4 || now - wheelAt < 450) return;
    wheelAt = now;
    if (e.deltaY > 0) opts.onNext();
    else opts.onPrevious();
  }, { passive: true });
  q('.omfc-next').addEventListener('click', () => opts.onNext());
  q('.omfc-back').addEventListener('click', () => opts.onExit());
  const onResize = () => backdrop.resize();
  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', wake);
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);
  timers.push(window.setTimeout(() => song && playing.classList.add('omfc-on'), 1800));

  return {
    slides: slides.length,

    intro(on: boolean): void {
      if (!on) {
        stage.classList.remove('omfc-on');
        stageLeft = 0.9;
        return;
      }
      stage.dataset.show = 'intro';
      showStage();
      // (the title lands with a shockwave)
      timers.push(window.setTimeout(() => {
        const [x, y] = center(q('.omfc-title'));
        backdrop.shock(x, y);
        backdrop.burst(x, y, 60);
      }, 1300));
    },

    cards(n: number, vs: boolean, won: boolean): void {
      if (n !== shown && n >= 0) {
        const b = CREDIT_BATTLES[n];
        shown = n;
        vsOn = wonOn = false;
        vsEl.classList.remove('omfc-on');
        winEl.classList.remove('omfc-on');
        vsEl.style.cssText = `--c: ${b.accent}; --o: ${b.loser.colors?.[0] ?? '#8a8a8a'}`;
        vsEl.innerHTML = versusMarkup(b, n, opts.harName);
        winEl.style.cssText = `--c: ${b.accent}`;
        winEl.innerHTML = winnerMarkup(b, opts.links);
        // (laid out hidden first, so that the cards animate in)
        void vsEl.offsetWidth;
      }
      if (vs !== vsOn) vsEl.classList.toggle('omfc-on', (vsOn = vs));
      if (won !== wonOn) winEl.classList.toggle('omfc-on', (wonOn = won));
    },

    wipe(on: boolean): void {
      wipeEl.classList.toggle('omfc-on', on);
    },

    finale(slide: number): void {
      stage.dataset.show = 'finale';
      showStage();
      slides.forEach((el, i) => {
        el.classList.toggle('omfc-on', i === slide);
        el.classList.toggle('omfc-past', i < slide);
      });
      dots.forEach((el, i) => el.classList.toggle('omfc-on', i === slide));
      scrollTo = slide * window.innerHeight * 0.55;
      const [x, y] = [window.innerWidth / 2, window.innerHeight * 0.45];
      timers.push(window.setTimeout(() => {
        backdrop.burst(x, y, slide === slides.length - 1 ? 90 : 36);
        if (slide === slides.length - 1) backdrop.shock(x, y);
      }, 450));
      wake();
    },

    songFailed(): void {
      song = null;
      playing.remove();
    },

    frame(dt: number): void {
      t += dt;
      const live = (stageLeft -= dt) > 0;
      // The music's levels: the chip's equalizer, the backdrop, sparks on the beats.
      if (song) {
        song.analyser.getByteFrequencyData(bins);
        const band = (a: number, b: number) => {
          let sum = 0;
          for (let i = a; i < b; i++) sum += bins[i];
          return sum / Math.max(1, b - a) / 255;
        };
        const bass = band(1, 7);
        backdrop.bass = bass * bass;
        backdrop.level = band(1, 96);
        // (a beat: the low end well above its recent average)
        bassAvg += (bass - bassAvg) * Math.min(1, dt * 2.5);
        const now = performance.now();
        if (bass > 0.45 && bass > bassAvg * 1.18 && now - lastBeat > 280) {
          lastBeat = now;
          if (live) backdrop.beat(Math.min(1, (bass - bassAvg) * 4));
        }
        // (logarithmic bands, the low end gets more bars; each bar its own bins)
        const from = 1, to = 120;
        let next = from;
        eq.forEach((el, i) => {
          const a = Math.max(next, Math.floor(from * Math.pow(to / from, i / eq.length)));
          const b = Math.max(a + 1, Math.floor(from * Math.pow(to / from, (i + 1) / eq.length)));
          next = b;
          el.style.transform = `scaleY(${(0.06 + band(a, b) * 0.94).toFixed(3)})`;
        });
      }
      if (live) {
        scroll += (scrollTo - scroll) * Math.min(1, dt * 2.5);
        backdrop.frame(dt, t, scroll);
      }
      if (quiet > 0 && (quiet -= dt) <= 0) root.classList.add('omfc-quiet');
    },

    dispose(): void {
      for (const id of timers) window.clearTimeout(id);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
      root.classList.add('omfc-gone');
      window.setTimeout(() => root.remove(), 700);
    },
  };
}
