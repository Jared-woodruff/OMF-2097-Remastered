// The product's name and version in the bottom left corner of the main menu (HTML over the game).
import { ensureUiFont, UI_FONT } from './uiFont';

export const PRODUCT_NAME = 'One Must Fall 2097 Remastered';
/** The app's version (package.json at build time). */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';

let label: HTMLDivElement | null = null;
let shown = false;

/** Shows or hides the label (called every frame: the page is only touched when that changes). */
export function showVersionLabel(visible: boolean): void {
  if (visible === shown || typeof document === 'undefined' || !document.body) return;
  shown = visible;
  if (!label) {
    ensureUiFont();
    label = document.createElement('div');
    label.id = 'omf-version';
    label.textContent = APP_VERSION ? `${PRODUCT_NAME} · v${APP_VERSION}` : PRODUCT_NAME;
    label.style.cssText = [
      'position: fixed', 'left: max(14px, 1.3vw)', 'bottom: max(10px, 1.3vh)', 'z-index: 5', 'pointer-events: none',
      `font: 600 clamp(9px, .68vw, 13px) ${UI_FONT}`, 'letter-spacing: .16em', 'text-transform: uppercase',
      'color: rgba(214, 226, 255, .6)', 'text-shadow: 0 1px 2px rgba(0, 0, 0, .95), 0 0 12px rgba(0, 0, 0, .7)',
      'transition: opacity .5s ease', 'opacity: 0', 'white-space: nowrap',
    ].join(';');
    document.body.appendChild(label);
    // (a frame later, so it fades in)
    void label.offsetWidth;
  }
  label.style.opacity = visible ? '1' : '0';
}
