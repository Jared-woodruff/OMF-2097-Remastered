// A robot in OMF Studio: its overview (name, stats, how the computer fights with it, its pictures, what it still
// needs) and its moves (moveEditor.ts).
import type { AfFile } from '../../formats/af';
import { HD_REFERENCE_COLORS, PICTURE_MOVES, REQUIRED_MOVES } from '../../mods/types';
import type { Editor, StudioApp } from '../app';
import { MOVE_LABELS } from '../checks';
import { hdSpritesCard } from '../hdCard';
import { indexedCanvas, rampColor, robotPalette } from '../colors';
import { field, fill, h, numberInput, textInput, toast } from '../dom';
import { originalAf } from '../gamePictures';
import type { RobotDoc } from '../project';
import { inputText, moveLabel } from './moves';
import { MoveEditor } from './moveEditor';
import { pictureFromIdle, setPicture } from './model';
import { soundsCard } from './sounds';
import { renderModelDialog } from './hdModel';
import { editorHead, foldCard } from '../ui';

export function robotEditor(app: StudioApp, robot: RobotDoc, move?: number): Editor {
  let tab: 'overview' | 'moves' = move !== undefined ? 'moves' : 'overview';
  let moves: MoveEditor | null = null;
  const index = app.project!.robots.indexOf(robot);
  const body = h('div', { class: 'ed-body' });
  const tabs = h('div', { class: 'tabs' });
  const picker = h('div');
  const title = h('h1', null, robot.info.name || 'Robot');
  const makeHead = () => editorHead(app, 'robot', index, title, `robots/${robot.id}`, picker);
  let head = makeHead();
  const el = h('div', { class: 'editor' }, head, tabs, body);
  const drawPicker = () => fill(picker, colorPicker(app));
  drawPicker();
  const show = () => {
    moves?.destroy();
    moves = null;
    fill(tabs,
      h('div', { class: `tab${tab === 'overview' ? ' sel' : ''}`, onclick: () => ((tab = 'overview'), show()) }, 'Overview'),
      h('div', { class: `tab${tab === 'moves' ? ' sel' : ''}`, onclick: () => ((tab = 'moves'), show()) }, 'Moves and animations'));
    if (tab === 'moves') {
      moves = new MoveEditor(app, robot, move ?? 11);
      body.style.overflow = 'hidden';
      fill(body, moves.el);
    } else {
      body.style.overflow = 'auto';
      fill(body, overview(app, robot, (id) => {
        move = id;
        tab = 'moves';
        show();
      }, () => fill(title, robot.info.name || 'Robot')));
    }
  };
  show();
  return {
    el,
    close: () => moves?.destroy(),
    where: () => (tab === 'moves' ? moves?.current : undefined),
    // (the moves tab keeps its move; the overview is drawn again)
    recolor: () => {
      drawPicker();
      const next = makeHead();
      head.replaceWith(next);
      head = next;
      if (moves) moves.recolor();
      else show();
    },
  };
}

/** The colors robots are shown in: the pilot's three color choices, like the game's (0-15 each). */
function colorPicker(app: StudioApp): HTMLElement {
  const row = (label: string, slot: 0 | 1 | 2) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '2px' } },
    h('span', { class: 'faint', style: { width: '64px', fontSize: '11px' } }, label),
    Array.from({ length: 16 }, (_, c) => h('div', {
      title: `Color ${c}`,
      style: { width: '12px', height: '12px', borderRadius: '2px', cursor: 'pointer', background: rampColor(c),
        outline: app.colors[slot] === c ? '2px solid #fff' : '1px solid rgba(0,0,0,.5)' },
      onclick: () => {
        const next = app.colors.slice() as [number, number, number];
        next[slot] = c;
        app.setColors(next);
      },
    })));
  return h('div', { title: 'The colors the robot is shown in (a pilot picks them in the game)' },
    row('Primary', 0), row('Secondary', 1), row('Tertiary', 2));
}

/** A stat of the fighter file, with what it means for the original robots. */
interface Stat {
  label: string;
  key: 'health' | 'endurance' | 'forwardSpeed' | 'reverseSpeed' | 'jumpSpeed' | 'fallSpeed';
  min: number;
  max: number;
  step: number;
  /** What it is (when the original robots cannot be read). */
  unit: string;
  /** Below, among and above the original robots'. */
  words: [string, string, string];
  /** Smaller numbers are more (the jump's upward speed). */
  flip?: boolean;
}

const STATS: Stat[] = [
  { label: 'Health', key: 'health', min: 1, max: 65535, step: 1, unit: 'hit points', words: ['less than any original', 'like the originals', 'more than any original'] },
  { label: 'Endurance', key: 'endurance', min: 1, max: 1e7, step: 1, unit: 'stun resistance',
    words: ['less than any original', 'like the originals', 'more than any original'] },
  { label: 'Walk forward', key: 'forwardSpeed', min: 0, max: 20, step: 0.01, unit: 'pixels a tick',
    words: ['slower than any original', 'like the originals', 'faster than any original'] },
  { label: 'Walk back', key: 'reverseSpeed', min: 0, max: 20, step: 0.01, unit: 'pixels a tick',
    words: ['slower than any original', 'like the originals', 'faster than any original'] },
  { label: 'Jump', key: 'jumpSpeed', min: -40, max: 0, step: 0.01, unit: 'upward speed', flip: true,
    words: ['jumps lower than any original', 'jumps like the originals', 'jumps higher than any original'] },
  { label: 'Fall', key: 'fallSpeed', min: 0, max: 5, step: 0.01, unit: 'gravity',
    words: ['floats more than any original', 'falls like the originals', 'falls faster than any original'] },
];

/** The original robots' lowest and highest of each stat, or null when their files cannot be read. */
let originalStats: Map<Stat['key'], [number, number]> | null | undefined;

function originalRange(key: Stat['key']): [number, number] | null {
  if (originalStats === undefined) {
    try {
      const afs: AfFile[] = Array.from({ length: 11 }, (_, i) => originalAf(i));
      originalStats = new Map(STATS.map((s) => {
        const v = afs.map((af) => af[s.key]);
        return [s.key, [Math.min(...v), Math.max(...v)]];
      }));
    } catch {
      originalStats = null;
    }
  }
  return originalStats?.get(key) ?? null;
}

/**
 * A stat's number, and a meter of where it stands among the original robots' (the green band: theirs, from the lowest
 * to the highest), in words under it; it follows the number as it is typed.
 */
function statField(s: Stat, af: AfFile, changed: () => void): HTMLElement {
  const input = numberInput(() => af[s.key], (v) => {
    af[s.key] = v;
    changed();
  }, s.min, s.max, s.step);
  const band = h('i', { class: 'band' }), mark = h('i', { class: 'mark' });
  const note = h('span', { class: 'hint' });
  const range = originalRange(s.key);
  const fmt = (v: number) => String(s.step === 1 ? v : Number(v.toFixed(2)));
  const update = (v: number) => {
    if (!range) {
      note.textContent = s.unit;
      return;
    }
    // (on the meter, more is to the right)
    const d = (x: number) => (s.flip ? -x : x);
    const [a, b] = [d(range[0]), d(range[1])].sort((x, y) => x - y);
    const x = d(v);
    const span = Math.max(b - a, Math.abs(b) * 0.1, 1e-6);
    const lo = Math.min(a - span * 1.5, x), hi = Math.max(b + span * 1.5, x);
    const pct = (t: number) => ((t - lo) / (hi - lo)) * 100;
    band.style.left = `${pct(a)}%`;
    band.style.width = `${Math.max(pct(b) - pct(a), 1)}%`;
    mark.style.left = `${pct(x)}%`;
    const where = x < a ? 0 : x > b ? 2 : 1;
    note.textContent = `${s.words[where]} (${range[0] === range[1] ? fmt(range[0]) : `${fmt(range[0])} to ${fmt(range[1])}`})`;
  };
  input.addEventListener('input', () => {
    const v = Number(input.value);
    if (input.value !== '' && Number.isFinite(v)) update(v);
  });
  input.addEventListener('change', () => update(af[s.key]));
  update(af[s.key]);
  return h('label', { class: 'field stat', title: `${s.label}: ${s.unit}` }, h('span', null, s.label), input, h('span', { class: 'meter' }, band, mark), note);
}

function overview(app: StudioApp, robot: RobotDoc, openMove: (id: number) => void, retitle: () => void): HTMLElement {
  const af = robot.af, info = robot.info;
  const pal = robotPalette(app.colors);
  const attacks = af.moves.map((m, id) => ({ m, id })).filter(({ m, id }) => m && id >= 15 && id !== 60 && id !== 61 && /^[PK]/.test(m.moveString));
  const tactics = new Set([...info.ai.projectile, ...info.ai.charge, ...info.ai.push]).size;

  // How the computer fights with it: which specials are projectiles, charges, pushes.
  const aiRow = ({ id }: { id: number }) => {
    const box = (kind: 'projectile' | 'charge' | 'push') => h('input', {
      type: 'checkbox', checked: info.ai[kind].includes(id), onchange: (e: Event) => {
        const on = (e.target as HTMLInputElement).checked;
        info.ai[kind] = on ? [...info.ai[kind], id] : info.ai[kind].filter((x) => x !== id);
        app.changed(false);
      },
    });
    return h('tr', null,
      h('td', { class: 'faint', style: { fontFamily: 'var(--mono)' } }, String(id)),
      h('td', null, info.moves[id] ?? moveLabel(id, af.moves[id])),
      h('td', { class: 'muted' }, inputText(af.moves[id]!.moveString)),
      h('td', { style: { textAlign: 'center' } }, box('projectile')),
      h('td', { style: { textAlign: 'center' } }, box('charge')),
      h('td', { style: { textAlign: 'center' } }, box('push')),
      h('td', null, h('button', { class: 'btn small', onclick: () => openMove(id) }, 'Open')));
  };

  const picture = (which: 'cell' | 'vs') => {
    const id = which === 'cell' ? PICTURE_MOVES.cell : PICTURE_MOVES.vs;
    const s = af.moves[id]?.animation.sprites.find((x) => !x.isEmpty()) ?? null;
    const shown = s ?? pictureFromIdle(af, which);
    const img = shown ? indexedCanvas(shown.pixels(), shown.width, shown.height, pal) : null;
    if (img) {
      img.className = 'pix';
      const k = which === 'cell' ? 3 : 1.2;
      img.style.width = `${shown!.width * k}px`;
      img.style.height = `${shown!.height * k}px`;
    }
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' } },
      h('b', null, which === 'cell' ? 'Robot select screen' : 'VS screen'),
      h('div', { class: 'screen', style: { minHeight: '60px' } }, img ?? h('span', { class: 'faint' }, 'No idle animation yet')),
      s ? h('span', { class: 'badge ok' }, 'Its own picture') : h('span', { class: 'badge warn' }, 'Made by the game from the idle frame'),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => openMove(id), disabled: !s }, 'Draw'),
        h('button', { class: 'btn small', onclick: () => {
          const p = pictureFromIdle(af, which);
          if (!p) {
            toast('The robot needs an idle animation first.', true);
            return;
          }
          setPicture(af, which, p);
          app.changed(true);
          app.refresh();
        } }, s ? 'Make again from the idle frame' : 'Make it from the idle frame')));
  };

  const checklist = h('ul', { class: 'checks' }, REQUIRED_MOVES.map((id) => h('li', {
    class: af.moves[id] ? '' : 'missing', style: { cursor: 'pointer' }, onclick: () => openMove(id),
  }, `${MOVE_LABELS[id]} (move ${id})`)));
  // (all there: folded away; something missing: open, the missing ones marked)
  const missing = REQUIRED_MOVES.filter((id) => !af.moves[id]).length;
  const needs = missing
    ? h('div', { class: 'card' }, h('h2', null, 'WHAT IT NEEDS'),
      h('p', { class: 'muted', style: { marginTop: '0' } }, `The game needs these animations: ${missing} ${missing === 1 ? 'is' : 'are'} missing (a click opens it).`),
      checklist)
    : foldCard('needs', 'WHAT IT NEEDS', `✓ all ${REQUIRED_MOVES.length} animations the game needs`, checklist).el;

  return h('div', { class: 'page' },
    h('p', { class: 'lead' }, 'Everything the game plays for this robot: its animations, its moves and its stats. Pilots choose its colors in the ' +
      'game: the color choices above show it in any of them.'),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h2', null, 'NAME'),
        h('div', { class: 'grid2' },
          field('Name', textInput(() => info.name, (v) => ((info.name = v.toUpperCase().slice(0, 12)), app.changed(true), retitle()), { maxLength: 12 }), 'up to 12 letters'),
          field('Folder', h('input', { type: 'text', value: robot.id, disabled: true }))),
        h('div', { style: { marginTop: '10px' } }, field('Description', (() => {
          const t = h('textarea', { rows: 3, maxLength: 200 }, info.description);
          t.addEventListener('input', () => ((info.description = t.value), app.changed(false)));
          return t;
        })(), 'the mech lab shows it'))),
      h('div', { class: 'card' }, h('h2', null, 'STATS'),
        h('div', { class: 'grid3' }, STATS.map((s) => statField(s, af, () => app.changed(false)))))),
    needs,
    h('div', { class: 'card' }, h('h2', null, 'PICTURES'),
      h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '30px' } }, picture('cell'), picture('vs'))),
    hdSpritesCard({
      app, prefix: 'm', anims: () => af.moves, get: () => robot.hd, set: (hd) => (robot.hd = hd),
      palette: () => robotPalette(robot.hd?.colors ?? HD_REFERENCE_COLORS), name: `${robot.id}-hd-templates.zip`, colors: true,
      changed: () => app.changed(false),
      actions: [{
        label: 'Render from the 3D model', available: () => !!robot.info.workshop,
        title: 'It was built from the robot workshop\'s parts: render its HD pictures from their 3D model, like the game renders the remaster\'s robots',
        run: () => renderModelDialog(app, robot),
        hint: 'its 3D model can render them',
      }],
    }),
    foldCard('tactics', 'THE COMPUTER\'S TACTICS', tactics ? `${tactics} of its moves chosen` : 'none chosen: it fights with its moves in general',
      h('p', { class: 'muted', style: { marginTop: '0' } }, 'Which of its special moves the computer uses when it wants to shoot from afar, charge in, ' +
        'or push the other robot back. Without any, it fights with its moves in general.'),
      attacks.length ? h('table', { class: 'list' },
        h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Move'), h('th', null, 'Input'),
          h('th', null, 'Projectile'), h('th', null, 'Charge'), h('th', null, 'Push'), h('th', null, ''))),
        h('tbody', null, attacks.map(aiRow))) : h('p', { class: 'faint' }, 'No attacks yet.')).el,
    soundsCard(af.soundTable, () => app.changed(false), {
      strings: af.moves.flatMap((m) => (m ? [m.animation.animString, ...m.animation.extraStrings] : [])),
      shared: (i) => i < 10 || i >= 25,
      help: `A frame's "s n" tag plays entry n: one of the game's sound effects. Entries 0-9 and 25-29 are the same for every robot (hits, ` +
        'blocks, steps: the game sets some itself).',
    }),
    h('div', { class: 'card danger-zone' }, h('h2', null, 'REMOVE'),
      h('button', { class: 'btn danger', onclick: () => void app.removeSelected() }, `Remove ${info.name || 'this robot'} from the mod`)));
}
