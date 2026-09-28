// The remaster's typeface (Orbitron, public/fonts) for the HTML shown over the game (notices, the credits), loaded once.

export const UI_FONT = "'OMF UI', 'Segoe UI', system-ui, sans-serif";

let added = false;

export function ensureUiFont(): void {
  if (added || typeof document === 'undefined') return;
  added = true;
  const style = document.createElement('style');
  style.textContent = "@font-face { font-family: 'OMF UI'; src: url('fonts/Orbitron.ttf') format('truetype'); font-weight: 400 900; font-display: swap; }";
  document.head.appendChild(style);
}
