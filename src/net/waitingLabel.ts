// "Waiting for <player>" at the top of the screen while a network game waits for the other game's inputs (HTML over the
// game, in the remaster's typeface like the notices).
import { ensureUiFont, UI_FONT } from '../platform/uiFont';

let label: HTMLDivElement | null = null;
let shown: string | null = null;

/** Shows the label for a player who is late (null hides it); called every frame, the page is touched on changes only. */
export function showNetWaiting(player: string | null): void {
  if (player === shown || typeof document === 'undefined' || !document.body) return;
  shown = player;
  if (!label) {
    ensureUiFont();
    label = document.createElement('div');
    label.id = 'omf-net-waiting';
    Object.assign(label.style, {
      position: 'fixed', left: '50%', top: '7%', transform: 'translateX(-50%)', padding: '8px 18px', zIndex: '20',
      font: `600 clamp(13px, 0.9vw, 19px)/1.4 ${UI_FONT}`, letterSpacing: '0.12em', textTransform: 'uppercase',
      color: '#ffd27a', background: 'rgba(6, 10, 30, 0.85)', border: '1px solid rgba(255, 190, 90, 0.55)', borderRadius: '10px',
      boxShadow: '0 4px 18px rgba(0,0,0,0.55)', pointerEvents: 'none', opacity: '0', transition: 'opacity 0.25s', whiteSpace: 'nowrap',
    });
    document.body.appendChild(label);
  }
  if (player) label.textContent = `Waiting for ${player}...`;
  label.style.opacity = player ? '1' : '0';
}
