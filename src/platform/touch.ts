// Touch controls for phones and tablets: a stick that appears where the left thumb lands, punch, kick and special
// buttons at the right, and a pause button. They show in fights and on the robot select screen (menus take taps like
// mouse clicks), on touch screens once they are touched (OPTIONS > CONTROLS > TOUCH PAD: AUTO), always (ON) or never.
// Player 1 plays with them: the keyboard controller reads touchPad() like a gamepad.
import { setKeyState } from '../controller/input';

export interface TouchPad {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  punch: boolean;
  kick: boolean;
  special: boolean;
}

const pad: TouchPad = { up: false, down: false, left: false, right: false, punch: false, kick: false, special: false };

/** Keeps a finger's events coming to this element (if the browser knows the pointer). */
function capture(e: HTMLElement, id: number): void {
  try {
    e.setPointerCapture(id);
  } catch {
    // an unknown pointer (e.g. a synthetic event): its events come here anyway
  }
}
let active = false;

/** The touch controls' state while they are shown (null otherwise). */
export function touchPad(): TouchPad | null {
  return active ? pad : null;
}

/** A touch screen was used (AUTO shows the controls from then on). */
let touched = false;
const STICK_RADIUS = 56;
const DEADZONE = 14;

function el(tag: string, style: Partial<CSSStyleDeclaration>, parent?: HTMLElement): HTMLElement {
  const e = document.createElement(tag);
  Object.assign(e.style, style);
  parent?.appendChild(e);
  return e;
}

export class TouchControls {
  private root: HTMLElement;
  private stickZone: HTMLElement;
  private base: HTMLElement;
  private knob: HTMLElement;
  private stickId = -1;
  private origin = { x: 0, y: 0 };
  private shown = false;

  constructor() {
    window.addEventListener('touchstart', () => (touched = true), { passive: true, capture: true });
    this.root = el('div', {
      position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '15', display: 'none', userSelect: 'none',
      touchAction: 'none', webkitUserSelect: 'none',
    });
    document.body.appendChild(this.root);
    // The stick: anywhere in the lower left part of the screen.
    this.stickZone = el('div', { position: 'absolute', left: '0', bottom: '0', width: '45%', height: '70%', pointerEvents: 'auto', touchAction: 'none' }, this.root);
    this.base = el('div', {
      position: 'absolute', width: `${STICK_RADIUS * 2}px`, height: `${STICK_RADIUS * 2}px`, borderRadius: '50%',
      border: '2px solid rgba(160, 200, 255, 0.35)', background: 'rgba(20, 30, 50, 0.25)', display: 'none', pointerEvents: 'none',
    }, this.stickZone);
    this.knob = el('div', {
      position: 'absolute', width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(180, 210, 255, 0.45)',
      border: '2px solid rgba(220, 235, 255, 0.6)', display: 'none', pointerEvents: 'none',
    }, this.stickZone);
    this.stickZone.addEventListener('pointerdown', (e) => this.stickDown(e));
    this.stickZone.addEventListener('pointermove', (e) => this.stickMove(e));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) this.stickZone.addEventListener(t, (e) => this.stickUp(e as PointerEvent));

    // Buttons: punch and kick side by side, special above them.
    const button = (label: string, key: keyof TouchPad, color: string, right: number, bottom: number, size: number) => {
      const b = el('div', {
        position: 'absolute', right: `${right}px`, bottom: `${bottom}px`, width: `${size}px`, height: `${size}px`, borderRadius: '50%',
        background: `${color}33`, border: `2px solid ${color}aa`, color: `${color}`, font: `700 ${Math.round(size * 0.36)}px/1 "Segoe UI", system-ui, sans-serif`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto', touchAction: 'none',
      }, this.root);
      b.textContent = label;
      const set = (on: boolean) => {
        pad[key] = on;
        b.style.background = `${color}${on ? '88' : '33'}`;
      };
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        capture(b, e.pointerId);
        set(true);
      });
      for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(t, () => set(false));
    };
    button('P', 'punch', '#ffb030', 116, 34, 76);
    button('K', 'kick', '#55dcff', 28, 64, 76);
    button('S', 'special', '#6ee874', 76, 128, 60);
    // Pause: the Escape key for a moment.
    const pause = el('div', {
      position: 'absolute', right: '14px', top: '12px', width: '44px', height: '44px', borderRadius: '10px',
      background: 'rgba(20, 30, 50, 0.35)', border: '2px solid rgba(160, 200, 255, 0.4)', color: 'rgba(220, 235, 255, 0.8)',
      font: '700 18px/44px "Segoe UI", system-ui, sans-serif', textAlign: 'center', pointerEvents: 'auto', touchAction: 'none',
    }, this.root);
    pause.textContent = 'II';
    pause.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      setKeyState('Escape', true);
      setTimeout(() => setKeyState('Escape', false), 120);
    });
  }

  private stickDown(e: PointerEvent): void {
    if (this.stickId >= 0) return;
    e.preventDefault();
    this.stickId = e.pointerId;
    capture(this.stickZone, e.pointerId);
    const r = this.stickZone.getBoundingClientRect();
    this.origin = { x: e.clientX - r.left, y: e.clientY - r.top };
    for (const [n, s] of [[this.base, STICK_RADIUS * 2], [this.knob, 48]] as const) {
      n.style.display = 'block';
      n.style.left = `${this.origin.x - s / 2}px`;
      n.style.top = `${this.origin.y - s / 2}px`;
    }
    this.stickMove(e);
  }

  private stickMove(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    const r = this.stickZone.getBoundingClientRect();
    let dx = e.clientX - r.left - this.origin.x;
    let dy = e.clientY - r.top - this.origin.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    this.knob.style.left = `${this.origin.x + dx - 24}px`;
    this.knob.style.top = `${this.origin.y + dy - 24}px`;
    // Eight directions of 45 degrees, like the gamepad stick.
    pad.up = pad.down = pad.left = pad.right = false;
    if (len < DEADZONE) return;
    const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
    pad.right = sector === 0 || sector === 1 || sector === -1;
    pad.left = sector === 4 || sector === -4 || sector === 3 || sector === -3;
    pad.down = sector >= 1 && sector <= 3;
    pad.up = sector <= -1 && sector >= -3;
  }

  private stickUp(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    this.stickId = -1;
    pad.up = pad.down = pad.left = pad.right = false;
    this.base.style.display = 'none';
    this.knob.style.display = 'none';
  }

  /** Per frame: shown where they are used (and allowed by the setting). */
  update(mode: 'auto' | 'on' | 'off', wanted: boolean): void {
    const show = wanted && (mode === 'on' || (mode === 'auto' && touched));
    if (show === this.shown) return;
    this.shown = show;
    active = show;
    this.root.style.display = show ? 'block' : 'none';
    if (!show) {
      for (const k of Object.keys(pad) as (keyof TouchPad)[]) pad[k] = false;
      this.stickId = -1;
      this.base.style.display = 'none';
      this.knob.style.display = 'none';
    }
  }
}
