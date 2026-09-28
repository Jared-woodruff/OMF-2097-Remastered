// The remaster's credits (EXTRAS > CREDITS; not in the original game): who made the remaster, then the projects and
// licenses it builds on. A page of its own in HTML over the game, sharp at any resolution like a film's end titles: an
// animated space backdrop on a canvas (stars, a drifting nebula, a neon grid floor, rising sparks, shooting stars), the
// titles scrolling up by themselves, bursts of sparks as the cards come in, and the game's ending theme playing.
import { audio } from '../../audio/audio';
import { isDown } from '../../controller/input';
import { ensureUiFont, UI_FONT } from '../../platform/uiFont';

export interface CreditsView {
  /** Scrolls a step up (-1) or down (1); the titles pause their own scrolling for a moment. */
  step(dir: number): void;
  /** To the top (-1) or the end (1). */
  jump(dir: number): void;
  /** Stops or restarts the titles' own scrolling. */
  toggleAuto(): void;
  dispose(): void;
}

export interface CreditsOptions {
  /** The page is to close (the BACK button, a right click). */
  onExit: () => void;
  /** Links open in the browser (the web version; the desktop app shows them as text). */
  links: boolean;
  /** Development: open at the n-th card or section (0: from the start). */
  start?: number;
}

const AVATAR = 'credits/jared-woodruff.jpg';
const GITHUB = 'https://github.com/Jared-woodruff';

/** The projects and tools the remaster builds on. */
const BUILT_WITH: [string, string, string][] = [
  ['OpenOMF', 'The open-source reimplementation whose reverse engineering this remaster follows.', 'MIT License'],
  ['xBR-lv2 by Hyllian', 'Edge-directed upscaling, adapted for the remastered sprites.', 'MIT License'],
  ['Orbitron', 'Typeface by Matt McInerney and The League of Moveable Type.', 'SIL Open Font License 1.1'],
  ['eSpeak NG', "The announcer's synthesized voice.", 'GPL-3.0 · used as a tool'],
  ['FFmpeg', "The announcer's arena PA sound.", 'LGPL / GPL · used as a tool'],
  ['Tauri', 'The Windows desktop app.', 'MIT / Apache-2.0'],
  ['Vite · TypeScript · Vitest', 'Build and test tools.', 'MIT / Apache-2.0'],
];

const CHIP_SVG = `<svg viewBox="0 0 100 100" fill="none" stroke-linecap="round" aria-hidden="true">
<defs><linearGradient id="omfc-g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#33e6ff"/><stop offset="1" stop-color="#6d7bff"/></linearGradient></defs>
<g stroke="url(#omfc-g1)" stroke-width="3">
<path d="M36 26V12M50 26V6M64 26V12M36 74v14M50 74v20M64 74v14M26 36H12M26 50H6M26 64H12M74 36h14M74 50h20M74 64h14"/>
<rect x="26" y="26" width="48" height="48" rx="9" fill="rgba(20,40,120,.55)"/></g>
<g fill="#33e6ff"><circle cx="50" cy="6" r="3.2"/><circle cx="50" cy="94" r="3.2"/><circle cx="6" cy="50" r="3.2"/><circle cx="94" cy="50" r="3.2"/></g>
<rect class="omfc-core" x="38" y="38" width="24" height="24" rx="5" fill="#33e6ff"/>
</svg>`;

const PRISM_SVG = `<svg viewBox="0 0 100 100" fill="none" stroke-linecap="round" stroke-width="3.2" aria-hidden="true">
<path d="M4 60 L41 52" stroke="#ffffff"/>
<path class="omfc-prism" d="M50 16 L78 70 L22 70 Z" stroke="#cfe0ff" fill="rgba(170,200,255,.16)"/>
<path d="M63 47 L97 33" stroke="#ff4d7a"/><path d="M64 51 L97 44" stroke="#ffd84a"/><path d="M65 55 L97 55" stroke="#54ff7a"/>
<path d="M66 59 L97 66" stroke="#33e6ff"/><path d="M67 63 L97 77" stroke="#9a6bff"/>
</svg>`;

const X_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

const CSS = `
@property --omfc-a { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
.omfc { position: fixed; inset: 0; z-index: 18; background: #02030a; color: #e8f0ff; overflow: hidden; user-select: none;
  font-family: ${UI_FONT}; opacity: 0; transition: opacity .7s; cursor: default; }
.omfc.omfc-on { opacity: 1; }
.omfc-bg { position: absolute; inset: 0; width: 100%; height: 100%; }
.omfc::before { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 2;
  background: radial-gradient(ellipse at 50% 45%, transparent 52%, rgba(0,0,0,.72)); }
.omfc::after { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 3; opacity: .45;
  background: repeating-linear-gradient(180deg, rgba(0,0,0,.28) 0 1px, transparent 1px 3px); animation: omfc-flicker 7s steps(1) infinite; }
@keyframes omfc-flicker { 0%, 100% { opacity: .45 } 47% { opacity: .38 } 48% { opacity: .52 } 49% { opacity: .45 } }
.omfc-scroller { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; z-index: 1; scrollbar-width: none; }
.omfc-scroller::-webkit-scrollbar { display: none; }
.omfc-content { width: min(1120px, 88vw); margin: 0 auto; padding-bottom: 12vh; }

.omfc-hero { min-height: 100vh; box-sizing: border-box; padding-bottom: 11vh; display: flex; flex-direction: column; align-items: center;
  justify-content: center; text-align: center; }
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
@keyframes omfc-in { from { opacity: 0; transform: translateY(18px) } to { opacity: 1; transform: none } }

.omfc-lead { display: grid; gap: clamp(22px, 2.6vw, 44px); margin: 6vh 0 18vh; }
@media (min-aspect-ratio: 5/4) and (min-width: 900px) {
  .omfc-lead { grid-template-columns: 1.12fr 1fr; }
  .omfc-lead .omfc-duo { grid-template-columns: 1fr; }
  .omfc-human { display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .omfc-human .omfc-name { font-size: clamp(30px, 3.4vw, 64px); }
}
.omfc-card { position: relative; border-radius: 24px; padding: clamp(20px, 2.3vw, 42px); text-align: center; border: 2px solid transparent;
  background: linear-gradient(160deg, rgba(16,26,82,.78), rgba(5,7,28,.86)) padding-box,
    conic-gradient(from var(--omfc-a), #2f5bff, #33e6ff, #ff3df2, #ffd84a, #2f5bff) border-box;
  box-shadow: 0 0 46px rgba(47,91,255,.28), inset 0 0 70px rgba(47,91,255,.14); animation: omfc-spin 8s linear infinite; }
@keyframes omfc-spin { to { --omfc-a: 360deg } }
.omfc-role { font-weight: 700; letter-spacing: .45em; margin-right: -.45em; font-size: clamp(12px, 1.25vw, 21px); color: #a9bcff;
  text-shadow: 0 0 10px rgba(80,120,255,.8); }
.omfc-avatar { position: relative; width: clamp(150px, 15vw, 260px); aspect-ratio: 1; margin: clamp(18px, 2.2vw, 34px) auto; }
.omfc-glow { position: absolute; inset: -6%; border-radius: 50%; opacity: .6; filter: blur(26px);
  background: conic-gradient(from var(--omfc-a), #33e6ff, #2f5bff, #ff3df2, #ffd84a, #33e6ff); animation: omfc-spin 5s linear infinite, omfc-breathe 3.2s ease-in-out infinite; }
@keyframes omfc-breathe { 50% { opacity: .9; transform: scale(1.05) } }
.omfc-ring { position: absolute; inset: 0; border-radius: 50%; background: conic-gradient(from var(--omfc-a), #33e6ff, #2f5bff, #ff3df2, #ffd84a, #33e6ff);
  -webkit-mask: radial-gradient(circle, transparent 57%, #000 58.5%, #000 63.5%, transparent 65%); mask: radial-gradient(circle, transparent 57%, #000 58.5%, #000 63.5%, transparent 65%);
  animation: omfc-spin 3s linear infinite; }
.omfc-avatar img { position: absolute; inset: 8.5%; width: 83%; height: 83%; border-radius: 50%; object-fit: cover;
  box-shadow: 0 0 0 4px rgba(4,6,26,.95), 0 0 50px rgba(51,230,255,.35); }
.omfc-holo { position: absolute; inset: 8.5%; border-radius: 50%; mix-blend-mode: screen; pointer-events: none;
  background: linear-gradient(180deg, transparent 0%, rgba(120,225,255,.32) 49%, rgba(255,255,255,.5) 50%, transparent 51%) 0 0 / 100% 260%; animation: omfc-scan 3.6s linear infinite; }
@keyframes omfc-scan { from { background-position: 0 -130% } to { background-position: 0 230% } }
.omfc-orbit { position: absolute; inset: -7%; border-radius: 50%; border: 1px dashed rgba(120,160,255,.35); animation: omfc-rot 14s linear infinite; }
.omfc-orbit i { position: absolute; width: 9px; height: 9px; margin: -4.5px; border-radius: 50%; background: #fff; box-shadow: 0 0 10px #33e6ff, 0 0 22px #33e6ff; }
.omfc-orbit i:nth-child(1) { left: 50%; top: 0 } .omfc-orbit i:nth-child(2) { left: 93.3%; top: 75% } .omfc-orbit i:nth-child(3) { left: 6.7%; top: 75%; background: #ffd84a; box-shadow: 0 0 10px #ffd84a, 0 0 22px #ff8a3d }
@keyframes omfc-rot { to { rotate: 360deg } }
.omfc-name { font-weight: 900; font-size: clamp(32px, 4.8vw, 82px); letter-spacing: .06em; color: #fff; line-height: 1.1;
  text-shadow: 0 0 10px rgba(130,175,255,.95), 0 0 32px rgba(47,91,255,.85), 0 4px 0 #0a1440; }
.omfc-link { display: inline-block; margin-top: .9em; font-weight: 600; font-size: clamp(13px, 1.3vw, 22px); color: #33e6ff; text-decoration: none;
  letter-spacing: .08em; padding: .5em 1.2em; border: 1px solid rgba(51,230,255,.5); border-radius: 999px; background: rgba(51,230,255,.07);
  transition: background .25s, box-shadow .25s, color .25s; }
a.omfc-link:hover { background: rgba(51,230,255,.2); color: #fff; box-shadow: 0 0 22px rgba(51,230,255,.6); }
.omfc-duo { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(430px, 100%), 1fr)); gap: inherit; }
.omfc-emblem { width: clamp(62px, 5.4vw, 104px); aspect-ratio: 1; margin: clamp(10px, 1.3vw, 20px) auto; filter: drop-shadow(0 0 16px rgba(51,230,255,.75)); }
.omfc-emblem svg { width: 100%; height: 100%; overflow: visible; }
.omfc-core { animation: omfc-core 2.2s ease-in-out infinite; transform-origin: 50px 50px; }
@keyframes omfc-core { 50% { opacity: .35; transform: scale(.82) } }
.omfc-prism { animation: omfc-prism 3s ease-in-out infinite; }
@keyframes omfc-prism { 50% { fill: rgba(170,200,255,.4) } }
.omfc-duo .omfc-name { font-size: clamp(22px, 2.4vw, 44px); }
.omfc-duo .omfc-role { font-size: clamp(11px, .95vw, 17px); letter-spacing: .25em; margin-right: -.25em; }
.omfc-badge { display: inline-block; margin-top: .8em; padding: .55em 1.4em .55em 1.7em; border-radius: 999px; font-weight: 800; letter-spacing: .3em;
  font-size: clamp(11px, 1.05vw, 18px); color: #070a1e; background: linear-gradient(90deg, #33e6ff, #6d7bff, #ff3df2, #33e6ff) 0 0 / 300% 100%;
  animation: omfc-flow 4s linear infinite; box-shadow: 0 0 24px rgba(51,230,255,.6); }
.omfc-badge-alt { background-image: linear-gradient(90deg, #ffd84a, #ff7a3d, #ff3df2, #ffd84a); box-shadow: 0 0 24px rgba(255,160,60,.55); }
@keyframes omfc-flow { to { background-position: 300% 0 } }

.omfc-section { margin: 0 0 18vh; text-align: center; }
.omfc-section h2 { display: flex; align-items: center; gap: 1em; margin: 0 0 1.3em; font-weight: 800; font-size: clamp(16px, 1.9vw, 32px);
  letter-spacing: .5em; color: #ffd84a; text-shadow: 0 0 16px rgba(255,200,60,.75); }
.omfc-section h2::before, .omfc-section h2::after { content: ''; flex: 1; height: 2px; box-shadow: 0 0 12px rgba(255,200,60,.8); }
.omfc-section h2::before { background: linear-gradient(90deg, transparent, #ffd84a); }
.omfc-section h2::after { background: linear-gradient(270deg, transparent, #ffd84a); }
.omfc-original { font-weight: 900; font-size: clamp(30px, 4.4vw, 74px); letter-spacing: .05em; color: #fff; margin-bottom: .45em;
  text-shadow: 0 0 12px rgba(255,120,60,.8), 0 0 36px rgba(255,60,40,.55), 0 4px 0 #2a0a06; }
.omfc-section p { color: #bcc9ff; font-size: clamp(13px, 1.3vw, 22px); line-height: 1.75; letter-spacing: .04em; margin: .5em auto; max-width: 62ch; }
.omfc-nb { white-space: nowrap; }
.omfc-section .omfc-note { color: #7f90c8; font-size: clamp(11px, 1vw, 17px); }
.omfc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(310px, 100%), 1fr)); gap: clamp(14px, 1.7vw, 28px); text-align: left; }
.omfc-item { position: relative; padding: 1.3em 1.4em 1.15em; border-radius: 16px; background: linear-gradient(160deg, rgba(22,34,100,.6), rgba(7,9,32,.78));
  border: 1px solid rgba(80,120,255,.38); box-shadow: inset 0 0 34px rgba(47,91,255,.14); opacity: 0; transform: translateY(34px);
  transition: opacity .8s cubic-bezier(.2,.8,.2,1), transform .8s cubic-bezier(.2,.8,.2,1), box-shadow .3s, border-color .3s; }
.omfc-in .omfc-item { opacity: 1; transform: none; }
.omfc-item:hover { border-color: rgba(51,230,255,.85); box-shadow: 0 0 26px rgba(51,230,255,.35), inset 0 0 34px rgba(47,91,255,.22); }
.omfc-item h3 { margin: 0 0 .55em; font-weight: 800; font-size: clamp(15px, 1.45vw, 24px); color: #fff; letter-spacing: .05em; text-shadow: 0 0 12px rgba(100,150,255,.7); }
.omfc-item p { margin: 0 0 1em; text-align: left; font-size: clamp(12px, 1.08vw, 18px); color: #aebbef; line-height: 1.55; letter-spacing: .02em; }
.omfc-lic { display: inline-block; font-size: clamp(10px, .88vw, 15px); font-weight: 700; letter-spacing: .1em; color: #33e6ff;
  border: 1px solid rgba(51,230,255,.55); border-radius: 7px; padding: .3em .7em; background: rgba(51,230,255,.06); }
.omfc-reveal { opacity: 0; transform: translateY(50px) scale(.97); transition: opacity 1.1s cubic-bezier(.2,.8,.2,1), transform 1.1s cubic-bezier(.2,.8,.2,1); }
.omfc-reveal.omfc-in { opacity: 1; transform: none; }

.omfc-end { min-height: 92vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; margin: 0; }
.omfc-thanks { font-weight: 900; font-size: clamp(36px, 6.4vw, 118px); letter-spacing: .08em; line-height: 1.1;
  background: linear-gradient(180deg, #ffffff 10%, #ffd84a 55%, #ff7a3d 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 24px rgba(255,170,60,.65)); animation: omfc-beat 3.6s ease-in-out infinite; }
@keyframes omfc-beat { 50% { transform: scale(1.035) } }
.omfc-tagline { margin-top: 1.6em; letter-spacing: .7em; margin-right: -.7em; color: #a9bcff; font-size: clamp(12px, 1.35vw, 23px); text-shadow: 0 0 12px rgba(80,120,255,.8); }

.omfc-back { position: absolute; top: clamp(12px, 2.2vh, 30px); right: clamp(12px, 2vw, 34px); z-index: 4; display: flex; align-items: center; gap: .7em;
  font: 700 clamp(12px, 1vw, 17px)/1 ${UI_FONT}; letter-spacing: .25em; color: #d3e2ff; cursor: pointer;
  background: rgba(10,16,52,.62); border: 1px solid rgba(80,120,255,.55); border-radius: 999px; padding: .8em 1.4em; backdrop-filter: blur(6px);
  transition: color .2s, border-color .2s, box-shadow .2s; }
.omfc-back:hover { color: #fff; border-color: #33e6ff; box-shadow: 0 0 20px rgba(51,230,255,.55); }
.omfc-back svg { width: 1.15em; height: 1.15em; }
.omfc-hint { position: absolute; bottom: clamp(10px, 2.2vh, 26px); left: 0; right: 0; z-index: 4; text-align: center; pointer-events: none;
  font-weight: 600; font-size: clamp(10px, .9vw, 15px); letter-spacing: .3em; color: rgba(195,210,255,.75); transition: opacity .9s; }
.omfc-hint.omfc-quiet { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .omfc, .omfc *, .omfc::after { animation: none !important; transition: none !important; }
  .omfc-reveal, .omfc-item { opacity: 1 !important; transform: none !important; }
  .omfc-rule { transform: none; }
}
`;

function markup(links: boolean): string {
  const link = links
    ? `<a class="omfc-link" href="${GITHUB}" target="_blank" rel="noopener noreferrer">github.com/Jared-woodruff</a>`
    : '<span class="omfc-link">github.com/Jared-woodruff</span>';
  const items = BUILT_WITH.map(([name, what, lic], i) => `<div class="omfc-item" style="transition-delay: ${0.08 * i}s">
    <h3>${name}</h3><p>${what}</p><span class="omfc-lic">${lic}</span></div>`).join('');
  return `<canvas class="omfc-bg"></canvas>
<div class="omfc-scroller"><div class="omfc-content">
  <section class="omfc-hero">
    <div class="omfc-kicker">ONE MUST FALL</div>
    <div class="omfc-title" data-text="2097">2097</div>
    <div class="omfc-remastered">REMASTERED</div>
    <div class="omfc-rule"></div>
    <div class="omfc-sub">THE CREDITS</div>
  </section>
  <section class="omfc-lead">
    <article class="omfc-card omfc-human omfc-reveal" data-burst="2">
      <div class="omfc-role">HUMAN CODER</div>
      <div class="omfc-avatar"><div class="omfc-glow"></div><div class="omfc-orbit"><i></i><i></i><i></i></div><div class="omfc-ring"></div>
        <img alt="Jared Woodruff" src="${AVATAR}" draggable="false"><div class="omfc-holo"></div></div>
      <div class="omfc-name">JARED <span class="omfc-nb">WOODRUFF</span></div>
      ${link}
    </article>
    <div class="omfc-duo">
      <article class="omfc-card omfc-reveal" data-burst="1">
        <div class="omfc-role">AI CODER</div>
        <div class="omfc-emblem">${CHIP_SVG}</div>
        <div class="omfc-name">CLAUDE<br><span class="omfc-nb">OPUS 5.5</span></div>
        <div class="omfc-badge">MAX MODE</div>
      </article>
      <article class="omfc-card omfc-reveal" data-burst="1">
        <div class="omfc-role">AI IMAGE RENDERING</div>
        <div class="omfc-emblem">${PRISM_SVG}</div>
        <div class="omfc-name">OPENAI<br><span class="omfc-nb">GPT6-ASTRA</span></div>
        <div class="omfc-badge omfc-badge-alt">ULTRA MODE</div>
      </article>
    </div>
  </section>
  <section class="omfc-section omfc-reveal">
    <h2><span>THE ORIGINAL GAME</span></h2>
    <div class="omfc-original">ONE MUST FALL 2097</div>
    <p><span class="omfc-nb">© 1994 Diversions Entertainment</span> &nbsp;·&nbsp; <span class="omfc-nb">Published by Epic MegaGames</span> &nbsp;·&nbsp;
      <span class="omfc-nb">Freeware since 1999</span></p>
    <p class="omfc-note">An unofficial fan remaster, not affiliated with or endorsed by the original authors. All trademarks belong to their owners.</p>
  </section>
  <section class="omfc-section omfc-reveal">
    <h2><span>BUILT WITH</span></h2>
    <div class="omfc-grid">${items}</div>
  </section>
  <section class="omfc-section omfc-reveal">
    <h2><span>THE REMASTER'S CODE</span></h2>
    <p>Released under the MIT License. It contains no game data or artwork of the original game: you bring your own copy.</p>
  </section>
  <section class="omfc-end omfc-reveal" data-burst="3">
    <div class="omfc-thanks">THANKS FOR PLAYING</div>
    <div class="omfc-tagline">ONE MUST FALL</div>
  </section>
</div></div>
<button class="omfc-back" type="button">${X_SVG}<span>BACK</span></button>
<div class="omfc-hint">UP / DOWN &nbsp;SCROLL &nbsp;&nbsp;·&nbsp;&nbsp; ENTER &nbsp;PAUSE &nbsp;&nbsp;·&nbsp;&nbsp; ESC / B &nbsp;BACK</div>`;
}

// ---- the backdrop --------------------------------------------------------------------------------------------------

interface Star { x: number; y: number; z: number; t: number; warm: boolean }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; sprite: HTMLCanvasElement; g: number }
interface Streak { x: number; y: number; vx: number; vy: number; life: number }
interface Ring { x: number; y: number; r: number; life: number }

const SPARK_COLORS = ['#33e6ff', '#ff9a3d', '#ff3df2', '#ffd84a', '#7f95ff'];

/** A soft round light of a color (drawn additively). */
function glowSprite(color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.18, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

class Backdrop {
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  /** Canvas pixels per CSS pixel. */
  k = 1;
  private stars: Star[] = [];
  private sparks: Spark[] = [];
  private streaks: Streak[] = [];
  private rings: Ring[] = [];
  private sprites = SPARK_COLORS.map(glowSprite);
  private nebula: HTMLCanvasElement;
  private spawn = 0;
  private nextStreak = 2;
  /** Pointer position (-1..1) for a little parallax. */
  px = 0;
  py = 0;

  constructor(private canvas: HTMLCanvasElement, private calm: boolean) {
    this.ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 420; i++) {
      this.stars.push({ x: Math.random(), y: Math.random(), z: 0.15 + Math.random() * 0.85, t: Math.random() * 10, warm: Math.random() < 0.12 });
    }
    this.nebula = this.makeNebula();
    this.resize();
  }

  /** The nebula, painted once small (it is soft) and drawn stretched. */
  private makeNebula(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = 300;
    const g = c.getContext('2d')!;
    g.fillStyle = '#02030a';
    g.fillRect(0, 0, 480, 300);
    g.globalCompositeOperation = 'lighter';
    const blobs: [number, number, number, string][] = [
      [110, 90, 170, 'rgba(70,20,140,.55)'], [330, 70, 190, 'rgba(20,50,170,.5)'], [250, 170, 150, 'rgba(120,20,110,.35)'],
      [420, 200, 140, 'rgba(10,90,140,.35)'], [60, 220, 130, 'rgba(30,40,150,.35)'], [240, 40, 110, 'rgba(160,60,200,.22)'],
    ];
    for (const [x, y, r, col] of blobs) {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, col);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 480, 300);
    }
    return c;
  }

  resize(): void {
    // (soft content: at most 1.5 canvas pixels per CSS pixel, and not beyond 2560 wide)
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.k = Math.min(dpr, 2560 / Math.max(1, window.innerWidth));
    this.w = this.canvas.width = Math.max(1, Math.round(window.innerWidth * this.k));
    this.h = this.canvas.height = Math.max(1, Math.round(window.innerHeight * this.k));
  }

  /** Sparks flying out of a point (CSS pixels). */
  burst(x: number, y: number, n: number): void {
    if (this.calm) return;
    const k = this.k;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (90 + Math.random() * 320) * k;
      const max = 0.7 + Math.random() * 0.9;
      this.sparks.push({
        x: x * k, y: y * k, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60 * k, life: max, max, size: (10 + Math.random() * 16) * k,
        sprite: this.sprites[Math.floor(Math.random() * this.sprites.length)], g: 260 * k,
      });
    }
  }

  /** A shockwave ring from a point (CSS pixels). */
  shock(x: number, y: number): void {
    if (!this.calm) this.rings.push({ x: x * this.k, y: y * this.k, r: 0, life: 1 });
  }

  frame(dt: number, t: number, scroll: number): void {
    const { ctx, w, h, k } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // The nebula, drifting and a little behind the titles.
    const drift = Math.sin(t * 0.03) * 0.04;
    const ny = -(scroll * k * 0.04) % (h * 0.5);
    ctx.drawImage(this.nebula, -w * (0.1 + drift) + this.px * 14 * k, -h * 0.1 + ny + this.py * 10 * k, w * 1.25, h * 1.35);
    // Stars: deeper ones move less with the titles and the pointer; they twinkle.
    const horizon = h * 0.72;
    for (const s of this.stars) {
      const y = ((s.y * h * 1.4 - scroll * k * s.z * 0.35 - t * 4 * k * s.z) % (h * 1.4) + h * 1.4) % (h * 1.4) + this.py * 16 * k * s.z;
      if (y > horizon + 4 * k || y < -4 * k) continue;
      const x = s.x * w + this.px * 22 * k * s.z;
      const a = 0.35 + 0.65 * s.z * (0.55 + 0.45 * Math.sin(t * (1.5 + s.z * 3) + s.t));
      const r = (0.45 + s.z * 1.35) * k;
      ctx.globalAlpha = a;
      ctx.fillStyle = s.warm ? '#ffe2b0' : '#dfe8ff';
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    // Shooting stars.
    this.nextStreak -= dt;
    if (this.nextStreak <= 0 && !this.calm) {
      this.nextStreak = 2.5 + Math.random() * 4.5;
      this.streaks.push({ x: w * (0.2 + Math.random() * 0.9), y: horizon * Math.random() * 0.5, vx: -(700 + Math.random() * 500) * k, vy: (220 + Math.random() * 200) * k, life: 1 });
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const st of this.streaks) {
      st.x += st.vx * dt;
      st.y += st.vy * dt;
      st.life -= dt * 1.1;
      const tail = 0.14;
      const grad = ctx.createLinearGradient(st.x, st.y, st.x - st.vx * tail, st.y - st.vy * tail);
      grad.addColorStop(0, `rgba(220,235,255,${Math.max(0, st.life)})`);
      grad.addColorStop(1, 'rgba(120,160,255,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      ctx.moveTo(st.x, st.y);
      ctx.lineTo(st.x - st.vx * tail, st.y - st.vy * tail);
      ctx.stroke();
    }
    this.streaks = this.streaks.filter((s) => s.life > 0 && s.y < horizon);
    ctx.globalCompositeOperation = 'source-over';
    // The floor: dark, under a neon grid running toward the viewer, and a glowing horizon.
    const floor = ctx.createLinearGradient(0, horizon, 0, h);
    floor.addColorStop(0, '#060a26');
    floor.addColorStop(1, '#010208');
    ctx.fillStyle = floor;
    ctx.fillRect(0, horizon, w, h - horizon);
    const haze = ctx.createLinearGradient(0, horizon - h * 0.16, 0, horizon);
    haze.addColorStop(0, 'rgba(255,60,220,0)');
    haze.addColorStop(1, 'rgba(255,60,220,.22)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, horizon - h * 0.16, w, h * 0.16);
    const cx = w / 2 + this.px * 30 * k;
    const phase = (t * 0.45) % 1;
    ctx.globalCompositeOperation = 'lighter';
    for (let pass = 0; pass < 2; pass++) {
      ctx.lineWidth = (pass ? 1.3 : 5) * k;
      for (let i = 0; i < 26; i++) {
        const z = i + 1 - phase;
        const y = horizon + ((h - horizon) * 0.9) / z;
        if (y > h + 10) continue;
        const a = Math.min(1, 1.3 / z) * (pass ? 0.8 : 0.14);
        ctx.strokeStyle = `rgba(60,100,255,${a})`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      for (let j = -16; j <= 16; j++) {
        const x0 = cx + j * w * 0.025, x1 = cx + j * w * 0.34;
        ctx.strokeStyle = `rgba(60,100,255,${pass ? 0.5 : 0.1})`;
        ctx.beginPath();
        ctx.moveTo(x0, horizon);
        ctx.lineTo(x1, h);
        ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(120,240,255,.9)';
    ctx.fillRect(0, horizon - 1 * k, w, 2 * k);
    const glow = ctx.createLinearGradient(0, horizon - 14 * k, 0, horizon + 14 * k);
    glow.addColorStop(0, 'rgba(51,230,255,0)');
    glow.addColorStop(0.5, 'rgba(51,230,255,.35)');
    glow.addColorStop(1, 'rgba(51,230,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, horizon - 14 * k, w, 28 * k);
    // Sparks rising from the floor, and the bursts.
    if (!this.calm) {
      this.spawn += dt * 24;
      while (this.spawn >= 1) {
        this.spawn--;
        const y = horizon + Math.random() * (h - horizon);
        const depth = (y - horizon) / (h - horizon);
        const max = 2 + Math.random() * 2.5;
        this.sparks.push({
          x: Math.random() * w, y, vx: (Math.random() - 0.5) * 30 * k, vy: -(30 + Math.random() * 90) * k * (0.4 + depth), life: max, max,
          size: (5 + depth * 14) * k, sprite: this.sprites[Math.floor(Math.random() * this.sprites.length)], g: -10 * k,
        });
      }
    }
    for (const p of this.sparks) {
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      const f = Math.max(0, p.life / p.max);
      ctx.globalAlpha = Math.min(1, f * 1.6);
      const s = p.size * (0.5 + f * 0.5);
      ctx.drawImage(p.sprite, p.x - s / 2, p.y - s / 2, s, s);
    }
    this.sparks = this.sparks.filter((p) => p.life > 0);
    for (const r of this.rings) {
      r.r += dt * 900 * k;
      r.life -= dt * 1.4;
      ctx.globalAlpha = Math.max(0, r.life);
      ctx.strokeStyle = 'rgba(120,220,255,.9)';
      ctx.lineWidth = 3 * k * Math.max(0.2, r.life);
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.rings = this.rings.filter((r) => r.life > 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

// ---- the page ------------------------------------------------------------------------------------------------------

export function openCreditsView(opts: CreditsOptions): CreditsView {
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
  const scroller = root.querySelector<HTMLElement>('.omfc-scroller')!;
  const hint = root.querySelector<HTMLElement>('.omfc-hint')!;
  const backdrop = new Backdrop(root.querySelector('canvas')!, calm);
  requestAnimationFrame(() => root.classList.add('omfc-on'));

  // The ending theme while the credits run.
  const music = audio.music;
  audio.playMusic('END.PSM');

  // Scrolling: the titles move up by themselves (after the title's entrance); input takes over for a few seconds.
  let pos = 0;
  let target = 0;
  let auto = !calm;
  let hold = 3.4;
  const startAt = opts.start ? root.querySelectorAll<HTMLElement>('.omfc-reveal')[opts.start - 1] : undefined;
  if (startAt) {
    // (the card's section in the middle of the screen)
    const at = startAt.closest<HTMLElement>('.omfc-lead') ?? startAt;
    pos = target = Math.max(0, at.offsetTop + at.offsetHeight / 2 - window.innerHeight / 2);
    scroller.scrollTop = pos;
    auto = false;
  }
  let quietIn = 6;
  const speed = () => window.innerHeight * 0.06;
  const max = () => Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const wake = () => {
    hint.classList.remove('omfc-quiet');
    quietIn = 5;
  };
  const takeOver = () => {
    hold = Math.max(hold, 4);
    wake();
  };

  // Cards come in as they scroll into view, with a burst of sparks.
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting || e.target.classList.contains('omfc-in')) continue;
      e.target.classList.add('omfc-in');
      const n = Number((e.target as HTMLElement).dataset.burst ?? 0);
      if (n) {
        const r = e.boundingClientRect;
        backdrop.burst(r.left + r.width / 2, r.top + Math.min(r.height / 2, window.innerHeight * 0.4), 26 * n);
        if (n > 1) backdrop.shock(r.left + r.width / 2, r.top + Math.min(r.height / 2, window.innerHeight * 0.4));
      }
    }
  }, { threshold: 0.2 });
  root.querySelectorAll('.omfc-reveal').forEach((el) => observer.observe(el));

  // The title lands with a shockwave.
  const landing = window.setTimeout(() => {
    const title = root.querySelector<HTMLElement>('.omfc-title')!.getBoundingClientRect();
    backdrop.shock(title.left + title.width / 2, title.top + title.height / 2);
    backdrop.burst(title.left + title.width / 2, title.top + title.height / 2, 60);
  }, 1300);

  const onResize = () => backdrop.resize();
  const onWheel = () => {
    target = pos = scroller.scrollTop;
    takeOver();
  };
  const onPointer = (e: PointerEvent) => {
    backdrop.px = (e.clientX / window.innerWidth) * 2 - 1;
    backdrop.py = (e.clientY / window.innerHeight) * 2 - 1;
    wake();
  };
  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    opts.onExit();
  };
  window.addEventListener('resize', onResize);
  scroller.addEventListener('wheel', onWheel, { passive: true });
  scroller.addEventListener('touchmove', onWheel, { passive: true });
  root.addEventListener('pointermove', onPointer);
  root.addEventListener('contextmenu', onContext);
  root.querySelector('.omfc-back')!.addEventListener('click', () => opts.onExit());

  // Gamepad sticks scroll smoothly while held (presses step through the page's actions).
  const padScroll = (): number => {
    let v = 0;
    for (const p of navigator.getGamepads?.() ?? []) {
      if (!p) continue;
      const y = p.axes[1] ?? 0;
      if (Math.abs(y) > 0.3) v = y;
    }
    return v;
  };

  let last = performance.now();
  const start = last;
  let raf = 0;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // (sticks and held arrow keys scroll smoothly; a press also steps, through the page's actions)
    const held = (isDown('ArrowDown') || isDown('Numpad2') ? 1 : 0) - (isDown('ArrowUp') || isDown('Numpad8') ? 1 : 0);
    const stick = padScroll() || held;
    if (stick && now - start > 250) {
      target += stick * speed() * 6 * dt;
      takeOver();
    }
    if (hold > 0) hold -= dt;
    else if (auto) target += speed() * dt;
    target = Math.max(0, Math.min(max(), target));
    // (the user scrolled the page natively: follow)
    if (Math.abs(scroller.scrollTop - Math.round(pos)) > 2) target = pos = scroller.scrollTop;
    pos += (target - pos) * Math.min(1, dt * 7);
    scroller.scrollTop = pos;
    if ((quietIn -= dt) <= 0) hint.classList.add('omfc-quiet');
    backdrop.frame(dt, (now - start) / 1000, pos);
  };
  raf = requestAnimationFrame(tick);

  return {
    step(dir: number): void {
      target = Math.max(0, Math.min(max(), target + dir * scroller.clientHeight * 0.22));
      takeOver();
    },
    jump(dir: number): void {
      target = dir < 0 ? 0 : max();
      takeOver();
    },
    toggleAuto(): void {
      auto = !auto;
      if (auto) hold = 0;
      wake();
    },
    dispose(): void {
      cancelAnimationFrame(raf);
      window.clearTimeout(landing);
      observer.disconnect();
      window.removeEventListener('resize', onResize);
      root.remove();
      if (music) audio.playMusic(music);
      else audio.stopMusic();
    },
  };
}
