// "Achievement unlocked" over the game (records.ts earns them): a banner that slides in above the bottom of the screen
// with a trophy, the achievement and what it was for, then slides away; several in a row are shown one after another.
import { ensureUiFont, UI_FONT } from './uiFont';

const SHOW_MS = 4600;

const CSS = `
.omfa { position: fixed; left: 50%; bottom: 13%; z-index: 21; display: flex; align-items: center; gap: clamp(12px, 1vw, 22px);
  min-width: min(clamp(380px, 26vw, 620px), 86vw); max-width: 86vw; padding: clamp(12px, .9vw, 20px) clamp(20px, 1.5vw, 34px) clamp(12px, .9vw, 20px) clamp(14px, 1vw, 22px);
  border-radius: clamp(14px, 1vw, 22px); pointer-events: none; overflow: hidden; font-family: ${UI_FONT};
  color: #fff; border: 2px solid transparent; opacity: 0; transform: translate(-50%, 40px) scale(.94);
  transition: opacity .45s, transform .55s cubic-bezier(.2,.9,.25,1.2);
  background: linear-gradient(160deg, rgba(34,26,8,.92), rgba(10,8,24,.94)) padding-box,
    linear-gradient(100deg, #ffd84a, #ff8a3d, #ff3df2, #ffd84a) border-box;
  box-shadow: 0 0 34px rgba(255,190,60,.45), 0 10px 30px rgba(0,0,0,.6); }
.omfa.omfa-show { opacity: 1; transform: translate(-50%, 0) scale(1); }
.omfa::after { content: ''; position: absolute; inset: 0; background: linear-gradient(105deg, transparent 35%, rgba(255,255,255,.28) 50%, transparent 65%);
  transform: translateX(-120%); }
.omfa.omfa-show::after { animation: omfa-shine 1.3s .35s ease-out; }
@keyframes omfa-shine { to { transform: translateX(120%) } }
.omfa-icon { flex: none; width: clamp(46px, 3.3vw, 76px); height: clamp(46px, 3.3vw, 76px); filter: drop-shadow(0 0 10px rgba(255,200,70,.9)); animation: omfa-pop .7s .2s cubic-bezier(.2,.9,.3,1.6) both; }
@keyframes omfa-pop { from { transform: scale(.3) rotate(-20deg) } to { transform: none } }
.omfa-icon svg { width: 100%; height: 100%; }
.omfa-label { font-weight: 700; font-size: clamp(10px, .72vw, 15px); letter-spacing: .35em; color: #ffd84a; text-shadow: 0 0 8px rgba(255,200,60,.8); }
.omfa-title { margin-top: .2em; font-weight: 900; font-size: clamp(19px, 1.45vw, 32px); letter-spacing: .06em; text-shadow: 0 0 12px rgba(255,170,80,.75); }
.omfa-text { margin-top: .25em; font-weight: 500; font-size: clamp(12px, .85vw, 18px); letter-spacing: .03em; color: #e7dcc4; }
@media (prefers-reduced-motion: reduce) { .omfa, .omfa-icon, .omfa::after { transition: none !important; animation: none !important; } }
`;

const TROPHY = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="omfa-g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#fff6c8"/><stop offset=".45" stop-color="#ffd84a"/><stop offset="1" stop-color="#ff8a3d"/></linearGradient></defs>
<path d="M18 8h28v14c0 9-6 16-14 16s-14-7-14-16z" fill="url(#omfa-g)"/>
<path d="M18 12H8c0 9 4 14 11 15M46 12h10c0 9-4 14-11 15" fill="none" stroke="url(#omfa-g)" stroke-width="4" stroke-linecap="round"/>
<path d="M28 38h8v8h-8z" fill="#ffb640"/><path d="M20 50h24l3 8H17z" fill="url(#omfa-g)"/>
<path d="M32 14l2.4 5 5.5.8-4 3.9 1 5.4-4.9-2.6-4.9 2.6 1-5.4-4-3.9 5.5-.8z" fill="#fff" opacity=".9"/></svg>`;

const queue: [string, string][] = [];
let showing = false;

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function next(): void {
  const item = queue.shift();
  if (!item) {
    showing = false;
    return;
  }
  showing = true;
  const [title, text] = item;
  const el = document.createElement('div');
  el.className = 'omfa';
  el.innerHTML = `<div class="omfa-icon">${TROPHY}</div><div><div class="omfa-label">ACHIEVEMENT UNLOCKED</div>
    <div class="omfa-title">${escape(title)}</div><div class="omfa-text">${escape(text)}</div></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('omfa-show')));
  window.setTimeout(() => {
    el.classList.remove('omfa-show');
    window.setTimeout(() => {
      el.remove();
      next();
    }, 600);
  }, SHOW_MS);
}

/** Shows that an achievement was earned (after the ones already showing). */
export function showAchievement(title: string, text: string): void {
  if (typeof document === 'undefined') return;
  if (!document.getElementById('omfa-style')) {
    ensureUiFont();
    const style = document.createElement('style');
    style.id = 'omfa-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  queue.push([title, text]);
  if (!showing) next();
}
