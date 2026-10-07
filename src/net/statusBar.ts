// A network game's status bar at the bottom of the screen (HTML over the game, in the remaster's typeface like the
// notices): which player this one is, and on the screens both games play in step what they do now or wait for (the
// select screen, the VS screen: Scene.netStatus), or whom the game waits for when the other game is late.
import type { GameState } from '../game/gameState';
import { ensureUiFont, UI_FONT } from '../platform/uiFont';

/** A screen's line in a network game (Scene.netStatus). */
export interface NetStatus {
  /** What this player does now, or what they are waiting for. */
  text: string;
  /** They wait for the other player (else it is their move). */
  waiting?: boolean;
}

/** The players' colors: their cursors on the select screen. */
const SIDE_COLORS = ['#ff5a50', '#5b8cff'];

/** The other game is late by this much (ms): the bar says so. */
const LATE_MS = 400;

/** What the bar shows now (null: nothing). */
export function netStatusOf(gs: GameState): (NetStatus & { side: 0 | 1 }) | null {
  const net = gs.net;
  if (!net || net.ended) return null;
  const side = net.localPlayer;
  if (net.stalledMs() > LATE_MS) {
    // (the other game is not on this screen yet: still on the one before, the victory screen say)
    return { side, waiting: true, text: net.peerArrived() ? `WAITING FOR ${net.opponent}...` : `WAITING FOR ${net.opponent} TO GET HERE...` };
  }
  const s = net.synced && gs.thisId === gs.nextId ? gs.sc.netStatus(net) : null;
  return s ? { side, ...s } : null;
}

let bar: HTMLDivElement | null = null;
let tag: HTMLSpanElement | null = null;
let line: HTMLSpanElement | null = null;
let shown = '';

/** Shows the bar as the game is now (called every frame: the page is touched on changes only). */
export function showNetStatus(gs: GameState): void {
  if (typeof document === 'undefined' || !document.body) return;
  const s = netStatusOf(gs);
  const key = s ? `${s.side}|${s.waiting}|${s.text}` : '';
  if (key === shown) return;
  shown = key;
  if (!bar) {
    ensureUiFont();
    bar = document.createElement('div');
    bar.id = 'omf-net-status';
    Object.assign(bar.style, {
      position: 'fixed', left: '50%', bottom: '1%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center',
      gap: '0.8em', padding: '6px 16px 6px 6px', zIndex: '19', maxWidth: '92vw', whiteSpace: 'nowrap',
      font: `600 clamp(12px, 0.8vw, 17px)/1.3 ${UI_FONT}`, letterSpacing: '0.08em', color: '#e8f1ff',
      background: 'rgba(6, 10, 30, 0.86)', border: '1px solid rgba(90, 140, 255, 0.5)', borderRadius: '10px',
      boxShadow: '0 4px 18px rgba(0,0,0,0.55)', pointerEvents: 'none', opacity: '0', transition: 'opacity 0.25s',
    });
    tag = document.createElement('span');
    Object.assign(tag.style, { padding: '3px 9px', borderRadius: '6px', color: '#fff', fontWeight: '800', textShadow: '0 1px 2px rgba(0,0,0,0.6)' });
    line = document.createElement('span');
    Object.assign(line.style, { overflow: 'hidden', textOverflow: 'ellipsis' });
    bar.append(tag, line);
    document.body.appendChild(bar);
  }
  if (!s) {
    bar.style.opacity = '0';
    return;
  }
  tag!.textContent = `YOU · P${s.side + 1}`;
  tag!.style.background = SIDE_COLORS[s.side];
  line!.textContent = s.text;
  line!.style.color = s.waiting ? '#ffd27a' : '#e8f1ff';
  bar.style.borderColor = s.waiting ? 'rgba(255, 190, 90, 0.55)' : 'rgba(90, 140, 255, 0.5)';
  bar.style.opacity = '1';
}
