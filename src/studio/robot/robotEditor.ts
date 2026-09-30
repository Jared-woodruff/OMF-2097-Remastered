// A robot in OMF Studio: its overview (name, stats, how the computer fights with it, its pictures, what it still
// needs) and its moves (moveEditor.ts).
import { PICTURE_MOVES, REQUIRED_MOVES } from '../../mods/types';
import type { Editor, StudioApp } from '../app';
import { MOVE_LABELS } from '../checks';
import { indexedCanvas, rampColor, robotPalette } from '../colors';
import { field, fill, h, numberInput, textInput, toast } from '../dom';
import type { RobotDoc } from '../project';
import { inputText, moveLabel } from './moves';
import { MoveEditor } from './moveEditor';
import { pictureFromIdle, setPicture } from './model';
import { soundsCard } from './sounds';

export function robotEditor(app: StudioApp, robot: RobotDoc, move?: number): Editor {
  let tab: 'overview' | 'moves' = move !== undefined ? 'moves' : 'overview';
  let moves: MoveEditor | null = null;
  const body = h('div', { style: { flex: '1', minHeight: '0' } });
  const tabs = h('div', { class: 'tabs', style: { padding: '0 22px', margin: '0' } });
  const el = h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
    h('div', { style: { padding: '14px 22px 0', display: 'flex', alignItems: 'center', gap: '12px' } },
      h('h1', { style: { margin: '0', font: '800 20px var(--title)', letterSpacing: '.06em' } }, robot.info.name || 'Robot'),
      h('span', { class: 'faint' }, `robots/${robot.id}`),
      h('span', { style: { flex: '1' } }),
      colorPicker(app)),
    tabs, body);
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
      }));
    }
  };
  show();
  return { el, close: () => moves?.destroy() };
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

function overview(app: StudioApp, robot: RobotDoc, openMove: (id: number) => void): HTMLElement {
  const af = robot.af, info = robot.info;
  const pal = robotPalette(app.colors);
  const stat = (label: string, get: () => number, set: (v: number) => void, min: number, max: number, step: number, hint: string) =>
    field(label, numberInput(get, (v) => ((set(v)), app.changed(false)), min, max, step), hint);
  const attacks = af.moves.map((m, id) => ({ m, id })).filter(({ m, id }) => m && id >= 15 && id !== 60 && id !== 61 && /^[PK]/.test(m.moveString));

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
      h('div', { style: { background: '#070a13', padding: '8px', borderRadius: '6px', minHeight: '60px' } }, img ?? h('span', { class: 'faint' }, 'No idle animation yet')),
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

  return h('div', { class: 'page' },
    h('p', { class: 'lead' }, 'The robot\'s fighter file holds everything the game plays: its animations (sprites, frames and hit points), its ' +
      'moves and its stats. Pilots choose its colors in the game: the three color ramps above show it in any of them.'),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h2', null, 'NAME'),
        h('div', { class: 'grid2' },
          field('Name', textInput(() => info.name, (v) => ((info.name = v.toUpperCase().slice(0, 12)), app.changed(true)), { maxLength: 12 }), 'up to 12 letters'),
          field('Folder', h('input', { type: 'text', value: robot.id, disabled: true }))),
        h('div', { style: { marginTop: '10px' } }, field('Description', (() => {
          const t = h('textarea', { rows: 3, maxLength: 200 }, info.description);
          t.addEventListener('input', () => ((info.description = t.value), app.changed(false)));
          return t;
        })(), 'the mech lab shows it'))),
      h('div', { class: 'card' }, h('h2', null, 'STATS'),
        h('div', { class: 'grid3' },
          stat('Health', () => af.health, (v) => (af.health = v), 1, 65535, 1, 'originals 200-230'),
          stat('Endurance', () => af.endurance, (v) => (af.endurance = v), 1, 1e7, 1, 'originals 14080'),
          stat('Walk forward', () => af.forwardSpeed, (v) => (af.forwardSpeed = v), 0, 20, 0.01, 'pixels a tick'),
          stat('Walk back', () => af.reverseSpeed, (v) => (af.reverseSpeed = v), 0, 20, 0.01, 'pixels a tick'),
          stat('Jump', () => af.jumpSpeed, (v) => (af.jumpSpeed = v), -40, 0, 0.01, 'upward speed'),
          stat('Fall', () => af.fallSpeed, (v) => (af.fallSpeed = v), 0, 5, 0.01, 'gravity')))),
    h('div', { class: 'card' }, h('h2', null, 'WHAT IT NEEDS'), checklist),
    h('div', { class: 'card' }, h('h2', null, 'PICTURES'),
      h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '30px' } }, picture('cell'), picture('vs'))),
    h('div', { class: 'card' }, h('h2', null, 'THE COMPUTER\'S TACTICS'),
      h('p', { class: 'muted', style: { marginTop: '0' } }, 'Which of its special moves the computer uses when it wants to shoot from afar, charge in, ' +
        'or push the other robot back. Without any, it fights with its moves in general.'),
      attacks.length ? h('table', { style: { borderCollapse: 'collapse', width: '100%' } },
        h('thead', null, h('tr', { class: 'faint', style: { textAlign: 'left' } }, h('th', null, '#'), h('th', null, 'Move'), h('th', null, 'Input'),
          h('th', null, 'Projectile'), h('th', null, 'Charge'), h('th', null, 'Push'), h('th', null, ''))),
        h('tbody', null, attacks.map(aiRow))) : h('p', { class: 'faint' }, 'No attacks yet.')),
    soundsCard(af, () => app.changed(false)),
    h('div', { class: 'card' }, h('h2', null, 'REMOVE'),
      h('button', { class: 'btn danger', onclick: () => void app.removeSelected() }, `Remove ${info.name || 'this robot'} from the mod`)));
}
