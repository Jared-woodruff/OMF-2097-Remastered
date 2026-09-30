// Testing a mod in OMF Studio: the game itself, over Studio, playing the project (put in the game's storage as the mod
// being tested, see mods/store.ts setTestMod): a fight against the computer, the computer against itself, training, or
// the one-player game (from its pilot select screen, its VS screen against an original pilot, or its ending). Content
// of the project is named "mod:<its folder name>" in the game's address; the game's own by number.
import { HAR_NAMES, PILOT_NAMES } from '../game/constants';
import { GEN_ARENAS } from '../gen/scene/arenas';
import { GEN_ROBOTS } from '../gen/roster';
import type { StudioApp } from './app';
import { field, h, modal, select } from './dom';
import type { Project } from './project';

type Mode = 'fight' | 'watch' | 'training' | 'select' | 'vs' | 'ending';

const MODES: [Mode, string][] = [
  ['fight', 'A fight against the computer'], ['watch', 'The computer fighting itself'], ['training', 'Training (a dummy)'],
  ['select', 'One-player game: the pilot select screen'], ['vs', 'One-player game: the VS screen, then the fight'],
  ['ending', 'One-player game: the ending'],
];

interface TestSetup {
  mode: Mode;
  robot: string;
  opponent: string;
  arena: string;
  pilot: string;
  /** The opponent on the VS screen (an original pilot). */
  opponentPilot: string;
}

let last: TestSetup | null = null;

export async function testFight(app: StudioApp, p: Project): Promise<void> {
  const robots: [string, string][] = [
    ...p.robots.map((r) => [`mod:${r.id}`, `${r.info.name} (this mod)`] as [string, string]),
    ...HAR_NAMES.slice(0, 10).map((n, i) => [String(i), n] as [string, string]),
    ...GEN_ROBOTS.map((r) => [String(r.id), `${r.name} (if it is on in the game)`] as [string, string]),
  ];
  const arenas: [string, string][] = [
    ...p.arenas.map((a) => [`mod:${a.id}`, `${a.info.name} (this mod)`] as [string, string]),
    ...['STADIUM', 'DANGER ROOM', 'POWER PLANT', 'FIRE PIT', 'DESERT'].map((n, i) => [String(i), n] as [string, string]),
    ...GEN_ARENAS.map((a) => [String(a.index), a.name] as [string, string]),
  ];
  const pilots: [string, string][] = [
    ...p.pilots.map((pl) => [`mod:${pl.id}`, `${pl.info.name} (this mod)`] as [string, string]),
    ...PILOT_NAMES.slice(0, 10).map((n, i) => [String(i), n] as [string, string]),
  ];
  const keep = (v: string | undefined, list: [string, string][]) => (v && list.some(([k]) => k === v) ? v : list[0][0]);
  const s: TestSetup = {
    mode: last?.mode ?? 'fight',
    robot: keep(last?.robot, robots),
    opponent: keep(last?.opponent, robots.filter(([k]) => !k.startsWith('mod:')).concat(robots)),
    arena: keep(last?.arena, arenas),
    pilot: keep(last?.pilot, pilots),
    opponentPilot: last?.opponentPilot ?? '0',
  };
  if (s.opponent === s.robot && robots.length > 1) s.opponent = robots.find(([k]) => k !== s.robot && !k.startsWith('mod:'))?.[0] ?? s.opponent;
  const ok = await modal<boolean>((close) => h('div', { class: 'modal', style: { width: '560px' } },
    h('h2', null, 'Test in the game'),
    h('p', { class: 'muted' }, 'The game opens over Studio with this mod (as it is now) and the fight starts right away. Close it to come back.'),
    h('div', { class: 'grid2' },
      field('Play', select<Mode>(MODES, () => s.mode, (v) => (s.mode = v))),
      field('Arena', select<string>(arenas, () => s.arena, (v) => (s.arena = v))),
      field('Robot', select<string>(robots, () => s.robot, (v) => (s.robot = v))),
      field('Opponent', select<string>(robots, () => s.opponent, (v) => (s.opponent = v))),
      field('Pilot', select<string>(pilots, () => s.pilot, (v) => (s.pilot = v))),
      field('Opponent pilot', select<string>(PILOT_NAMES.map((n, i) => [String(i), n] as [string, string]), () => s.opponentPilot, (v) => (s.opponentPilot = v)),
        'on the VS screen')),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
      h('button', { class: 'btn go', onclick: () => close(true) }, '▶ Play'))));
  if (!ok) return;
  last = s;
  const q = new URLSearchParams({ modtest: '', nosetup: '', t: s.mode, h1: s.robot, h2: s.opponent, arena: s.arena, p1: s.pilot, p2: s.opponentPilot });
  const frame = h('iframe', { src: `./index.html?${q.toString()}`, allow: 'autoplay; fullscreen; gamepad' });
  const back = h('div', { class: 'test-back' },
    h('div', { class: 'bar' },
      h('b', { style: { font: '700 12px var(--title)', letterSpacing: '.12em' } }, 'TEST'),
      h('span', { class: 'muted' }, `${p.manifest.name}: ${s.mode === 'select' || s.mode === 'ending' ? MODES.find(([m]) => m === s.mode)?.[1] :
        `${robots.find(([k]) => k === s.robot)?.[1]} vs ${robots.find(([k]) => k === s.opponent)?.[1]}, ${arenas.find(([k]) => k === s.arena)?.[1]}`}`),
      h('span', { style: { flex: '1' } }),
      h('span', { class: 'faint' }, 'Click the game to play; the keys are the game\'s'),
      h('button', { class: 'btn', onclick: () => {
        frame.src = frame.src;
        frame.focus();
      } }, 'Again'),
      h('button', { class: 'btn primary', onclick: () => close() }, 'Close')),
    frame);
  const close = () => {
    back.remove();
    app.refresh();
  };
  frame.addEventListener('load', () => frame.focus());
  document.body.append(back);
}
