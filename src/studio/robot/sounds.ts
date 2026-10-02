// A sound table in OMF Studio (a robot's or an arena's): an animation's `s n` tag plays entry n, which names one of
// the game's sound effects (SOUNDS.DAT; 0: none).
import { soundSampleRate } from '../../audio/soundOpts';
import { soundBank } from '../../resources/resources';
import { parseAnim } from '../anim';
import { h } from '../dom';
import { foldCard } from '../ui';

let ctx: AudioContext | null = null;

/** Plays one of the game's sound effects (1-based, like the tables' entries). */
export function playSound(n: number): void {
  const e = soundBank()[n - 1];
  if (!e || !e.data.length) return;
  ctx ??= new AudioContext();
  const rate = Math.max(3000, Math.min(96000, soundSampleRate(e.freqKey)));
  const buf = ctx.createBuffer(1, e.data.length, rate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < e.data.length; i++) ch[i] = (e.data[i] - 128) / 128;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = 0.6;
  src.connect(gain).connect(ctx.destination);
  src.start();
}

/** How many frames of the animation strings play each entry. */
function uses(strings: string[]): number[] {
  const n = new Array<number>(30).fill(0);
  for (const s of strings) {
    for (const f of parseAnim(s).frames) for (const t of f.tags) if (t.name === 's' && t.value !== null && t.value >= 0 && t.value < 30) n[t.value]++;
  }
  return n;
}

export interface SoundsCardOptions {
  /** The animation strings that play the table's entries (to count their uses). */
  strings: string[];
  /** Entries that are the same for every robot or arena. */
  shared: (i: number) => boolean;
  help: string;
  /** What an entry left at 0 plays instead (an arena's: the original game's first arena's), if anything. */
  fallback?: Uint8Array;
}

export function soundsCard(table: Uint8Array, changed: () => void, o: SoundsCardOptions): HTMLElement {
  const bank = soundBank();
  const options = [h('option', { value: '0' }, o.fallback ? 'The original\'s' : 'None'), ...bank.map((e, i) => (e.data.length ? h('option', { value: String(i + 1) }, `Sound ${i + 1}`) : null))];
  const used = uses(o.strings);
  const row = (i: number) => {
    const sel = h('select', { style: { width: '120px' } }, options.map((opt) => opt?.cloneNode(true) ?? null));
    sel.value = String(table[i]);
    sel.addEventListener('change', () => {
      table[i] = Number(sel.value);
      changed();
    });
    const playing = () => table[i] || o.fallback?.[i] || 0;
    const notes = [used[i] ? `${used[i]} frame${used[i] === 1 ? '' : 's'}` : '', o.shared(i) ? 'shared' : '',
      !table[i] && o.fallback?.[i] ? `plays sound ${o.fallback[i]}` : ''].filter(Boolean).join(' · ');
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
      h('code', { style: { width: '32px', color: 'var(--accent)' } }, `s${i}`),
      sel,
      h('button', { class: 'btn small icon', title: 'Play it', onclick: () => playSound(playing()) }, '▶'),
      h('span', { class: 'faint', style: { fontSize: '11px' } }, notes));
  };
  const played = used.filter((n) => n).length;
  return foldCard('sounds', 'SOUNDS', `${played || 'none'} played by its animations`,
    h('p', { class: 'muted', style: { marginTop: '0' } }, o.help),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '4px 16px' } },
      Array.from({ length: 30 }, (_, i) => row(i)))).el;
}
