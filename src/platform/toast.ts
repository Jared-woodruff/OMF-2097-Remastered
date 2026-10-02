// Short notices over the game (a song starting, songs added to the music library), outside the game's own rendering.
import { ensureUiFont, UI_FONT } from './uiFont';

let el: HTMLDivElement | null = null;
let timer = 0;

export function toast(message: string, ms = 3200): void {
  if (typeof document === 'undefined') return;
  if (!el) {
    ensureUiFont();
    el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed', left: '50%', bottom: '5%', transform: 'translateX(-50%)', maxWidth: '80vw', padding: '9px 18px',
      font: `600 clamp(13px, 0.85vw, 18px)/1.4 ${UI_FONT}`, letterSpacing: '0.05em', color: '#e8f1ff', background: 'rgba(6, 10, 30, 0.85)',
      border: '1px solid rgba(90, 140, 255, 0.55)', borderRadius: '10px',
      boxShadow: '0 4px 18px rgba(0,0,0,0.55), 0 0 18px rgba(60,110,255,0.3)', textShadow: '0 0 8px rgba(90,150,255,0.6)',
      pointerEvents: 'none', zIndex: '20', opacity: '0', transition: 'opacity 0.35s', whiteSpace: 'nowrap', overflow: 'hidden',
      textOverflow: 'ellipsis',
    });
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.opacity = '1';
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (el) el.style.opacity = '0';
  }, ms);
}
