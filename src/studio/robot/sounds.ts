// A robot's sound table in OMF Studio: an animation's `s n` tag plays entry n, which names one of the game's sound
// effects (SOUNDS.DAT; 0: none). Entries 0-9 and 25-29 are the same for every robot (hits, blocks, steps).
import type { AfFile } from '../../formats/af';
import { soundSampleRate } from '../../audio/soundOpts';
import { soundBank } from '../../resources/resources';
import { parseAnim } from '../anim';
import { h } from '../dom';

let ctx: AudioContext | null = null;

/** Plays one of the game's sound effects (1-based, like the table's entries). */
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

/** How many frames of the robot play each entry (by entry). */
function uses(af: AfFile): number[] {
  const n = new Array<number>(30).fill(0);
  for (const m of af.moves) {
    if (!m) continue;
    for (const s of [m.animation.animString, m.footerString]) {
      for (const f of parseAnim(s).frames) for (const t of f.tags) if (t.name === 's' && t.value !== null && t.value >= 0 && t.value < 30) n[t.value]++;
    }
  }
  return n;
}

export function soundsCard(af: AfFile, changed: () => void): HTMLElement {
  const bank = soundBank();
  const options = [h('option', { value: '0' }, 'None'), ...bank.map((e, i) => (e.data.length ? h('option', { value: String(i + 1) }, `Sound ${i + 1}`) : null))];
  const used = uses(af);
  const shared = (i: number) => i < 10 || i >= 25;
  const row = (i: number) => {
    const sel = h('select', { style: { width: '110px' } }, options.map((o) => o?.cloneNode(true) ?? null));
    sel.value = String(af.soundTable[i]);
    sel.addEventListener('change', () => {
      af.soundTable[i] = Number(sel.value);
      changed();
    });
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
      h('code', { style: { width: '32px', color: 'var(--accent)' } }, `s${i}`),
      sel,
      h('button', { class: 'btn small icon', title: 'Play it', onclick: () => playSound(af.soundTable[i]) }, '▶'),
      h('span', { class: 'faint', style: { fontSize: '11px' } }, [used[i] ? `${used[i]} frame${used[i] === 1 ? '' : 's'}` : '', shared(i) ? ' (every robot\'s)' : ''].join('')));
  };
  return h('div', { class: 'card' }, h('h2', null, 'SOUNDS'),
    h('p', { class: 'muted', style: { marginTop: '0' } }, 'A frame\'s "s n" tag plays entry n: one of the game\'s sound effects. Entries 0-9 and 25-29 ' +
      'are the same for every robot (hits, blocks, steps: the game sets some itself).'),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '4px 16px' } },
      Array.from({ length: 30 }, (_, i) => row(i))));
}
