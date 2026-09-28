// Short notices over the game (a song starting, songs added to the music library), outside the game's own rendering.

let el: HTMLDivElement | null = null;
let timer = 0;

export function toast(message: string, ms = 3200): void {
  if (typeof document === 'undefined') return;
  if (!el) {
    el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed', left: '50%', bottom: '5%', transform: 'translateX(-50%)', maxWidth: '80vw', padding: '8px 16px',
      font: '600 15px/1.35 "Segoe UI", system-ui, sans-serif', color: '#e8f1ff', background: 'rgba(8, 12, 24, 0.82)',
      border: '1px solid rgba(90, 140, 255, 0.45)', borderRadius: '8px', boxShadow: '0 4px 18px rgba(0,0,0,0.5)',
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
