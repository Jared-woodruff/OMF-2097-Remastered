// Testing a mod in OMF Studio: the game itself, over Studio, playing the project (put in the game's storage as the mod
// being tested, see mods/store.ts setTestMod): a fight against the computer, the computer against itself, training, or
// the one-player game (from its pilot select screen, its VS screen against an original pilot, or its ending). Content
// of the project is named "mod:<its folder name>" in the game's address; the game's own by number. The dialog shows
// what the test starts with: the robots in their pilots' colors where the fight starts, or the pilot.
import { HAR_NAMES, PILOT_INFO, PILOT_NAMES } from '../game/constants';
import type { StudioApp } from './app';
import { indexedCanvas, robotPalette } from './colors';
import { field, fill, h, icon, modal, select, type IconName } from './dom';
import { EXTRAS_ARENAS, EXTRAS_ROBOTS } from './extras';
import { gameAf, gameBk, gamePortrait } from './gamePictures';
import { stopSong } from './music';
import type { Project } from './project';
import { bkPicture, pilotPicture } from './ui';
import type { AfFile } from '../formats/af';
import type { BkFile } from '../formats/bk';

type Mode = 'fight' | 'watch' | 'training' | 'select' | 'vs' | 'ending';
type Choice = 'robot' | 'opponent' | 'arena' | 'pilot' | 'opponentPilot';

/** The ways to test: their card, and what each lets the author choose. */
const MODES: { mode: Mode; title: string; text: string; icon: IconName; uses: Choice[] }[] = [
  { mode: 'fight', title: 'Fight', text: 'You against the computer', icon: 'fight', uses: ['pilot', 'robot', 'opponentPilot', 'opponent', 'arena'] },
  { mode: 'watch', title: 'Watch', text: 'The computer against itself', icon: 'watch', uses: ['pilot', 'robot', 'opponentPilot', 'opponent', 'arena'] },
  { mode: 'training', title: 'Training', text: 'A dummy to practice on', icon: 'hit', uses: ['pilot', 'robot', 'opponent', 'arena'] },
  { mode: 'select', title: 'Pilot select', text: 'The one-player game from its start', icon: 'grid', uses: ['pilot'] },
  { mode: 'vs', title: 'VS screen', text: 'The pilots\' words, then the fight', icon: 'vs', uses: ['pilot', 'robot', 'opponentPilot', 'opponent', 'arena'] },
  { mode: 'ending', title: 'Ending', text: 'The one-player game\'s ending', icon: 'trophy', uses: ['pilot'] },
];

interface TestSetup {
  mode: Mode;
  robot: string;
  opponent: string;
  arena: string;
  pilot: string;
  /** The computer's pilot (on the VS screen: one of the original pilots). */
  opponentPilot: string;
}

let last: TestSetup | null = null;

/** Where the robots stand when a fight starts (arena.ts), on the floor. */
const START_X = [110, 210], FLOOR = 190;

/** The pilot the computer fights as: the one chosen, unless it is the player's (then another, as the game picks). */
function opponentPilotOf(s: TestSetup): string {
  if (s.opponentPilot !== s.pilot) return s.opponentPilot;
  return s.pilot === '3' ? '4' : '3';
}

/** Tests the project in the game, after asking how; `prefer` chooses some of the project's content ("mod:<folder>"). */
export async function testFight(app: StudioApp, p: Project, prefer: Partial<Record<'robot' | 'arena' | 'pilot', string>> = {}): Promise<void> {
  // (the game plays its own music)
  stopSong();
  const robots: [string, string][] = [
    ...p.robots.map((r) => [`mod:${r.id}`, `${r.info.name} (this mod)`] as [string, string]),
    ...HAR_NAMES.slice(0, 11).map((n, i) => [String(i), n] as [string, string]),
    ...EXTRAS_ROBOTS.map(([n, name]) => [String(n), `${name} (the new robots)`] as [string, string]),
  ];
  const arenas: [string, string][] = [
    ...p.arenas.map((a) => [`mod:${a.id}`, `${a.info.name} (this mod)`] as [string, string]),
    ...['STADIUM', 'DANGER ROOM', 'POWER PLANT', 'FIRE PIT', 'DESERT'].map((n, i) => [String(i), n] as [string, string]),
    ...EXTRAS_ARENAS.map(([n, name]) => [String(n), `${name} (the new arenas)`] as [string, string]),
  ];
  const originals = PILOT_NAMES.map((n, i) => [String(i), n] as [string, string]);
  const modPilots = p.pilots.map((pl) => [`mod:${pl.id}`, `${pl.info.name} (this mod)`] as [string, string]);
  const pilots: [string, string][] = [...modPilots, ...originals.slice(0, 10)];
  // (the computer's pilot: any in a fight; one of the original ones on the VS screen, who answer the player's)
  const opponentPilots = (mode: Mode): [string, string][] => (mode === 'vs' ? originals : [...modPilots, ...originals]);
  const keep = (v: string | undefined, list: [string, string][]) => (v && list.some(([k]) => k === v) ? v : list[0][0]);
  const s: TestSetup = {
    mode: last?.mode ?? 'fight',
    robot: keep(prefer.robot ?? last?.robot, robots),
    opponent: keep(last?.opponent, robots.filter(([k]) => !k.startsWith('mod:')).concat(robots)),
    arena: keep(prefer.arena ?? last?.arena, arenas),
    pilot: keep(prefer.pilot ?? last?.pilot, pilots),
    opponentPilot: last?.opponentPilot ?? '3',
  };
  if (s.opponent === s.robot && robots.length > 1) s.opponent = robots.find(([k]) => k !== s.robot && !k.startsWith('mod:'))?.[0] ?? s.opponent;
  // (the two pilots differ: choosing one side's pilot for the other side moves the other side's on)
  const apart = (changed: 'pilot' | 'opponentPilot'): boolean => {
    if (s.pilot !== s.opponentPilot) return false;
    if (changed === 'pilot') s.opponentPilot = s.pilot === '3' ? '4' : '3';
    else s.pilot = pilots.find(([k]) => k !== s.opponentPilot)?.[0] ?? s.pilot;
    return true;
  };
  apart('pilot');
  const name = (list: [string, string][], v: string) => (list.find(([k]) => k === v)?.[1] ?? '').replace(/ \(.*\)$/, '');

  const modes = h('div', { class: 'test-modes' });
  const fields = h('div', { class: 'test-fields' });
  const preview = h('div', { class: 'fight-card' });
  let drawn = 0;
  const drawPreview = async () => {
    const mine = ++drawn;
    const card = await testPreview(p, s, name(pilots, s.pilot), name(opponentPilots(s.mode), opponentPilotOf(s)), name(robots, s.robot),
      name(robots, s.opponent), name(arenas, s.arena)).catch(() => null);
    if (mine !== drawn || !card) return;
    preview.className = card.className;
    fill(preview, ...card.children);
  };
  const render = () => {
    const mode = MODES.find((m) => m.mode === s.mode)!;
    if (mode.uses.includes('opponentPilot')) {
      s.opponentPilot = keep(s.opponentPilot, opponentPilots(s.mode));
      apart('pilot');
    }
    fill(modes, MODES.map((m) => h('div', { class: `choice${m.mode === s.mode ? ' sel' : ''}`, title: m.text, onclick: () => ((s.mode = m.mode), render()) },
      icon(m.icon), h('b', null, m.title), h('span', null, m.text))));
    const choose = (c: Choice, label: string, list: [string, string][], hint = '') => (mode.uses.includes(c) ? field(label, select<string>(list, () => s[c], (v) => {
      s[c] = v;
      if ((c === 'pilot' || c === 'opponentPilot') && mode.uses.includes('opponentPilot') && apart(c)) render();
      else void drawPreview();
    }), hint) : null);
    fill(fields,
      choose('pilot', s.mode === 'watch' ? 'Pilot (the computer)' : 'Your pilot', pilots, s.mode === 'select' ? 'picked first on the pilot select screen' : ''),
      choose('robot', s.mode === 'watch' ? 'Robot' : 'Your robot', robots),
      choose('opponentPilot', 'The computer\'s pilot', opponentPilots(s.mode), s.mode === 'vs' ? 'one of the original pilots, who answer yours' : ''),
      choose('opponent', s.mode === 'training' ? 'The dummy\'s robot' : 'The computer\'s robot', robots),
      choose('arena', 'Arena', arenas));
    void drawPreview();
  };
  render();
  const ok = await modal<boolean>((close) => h('div', { class: 'modal test-modal', style: { width: '900px' } },
    h('h2', null, 'Test in the game'),
    h('p', { class: 'muted' }, 'The game opens over Studio with the mod as it is now, and starts right away. Close it to come back to Studio.'),
    modes,
    h('div', { class: 'test-body' }, preview, fields),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
      h('button', { class: 'btn go', onclick: () => close(true) }, '▶ Play'))));
  if (!ok) return;
  last = s;
  const q = new URLSearchParams({ modtest: '', nosetup: '', t: s.mode, h1: s.robot, h2: s.opponent, arena: s.arena, p1: s.pilot, p2: opponentPilotOf(s) });
  const frame = h('iframe', { src: `./index.html?${q.toString()}`, allow: 'autoplay; fullscreen; gamepad' });
  const what = s.mode === 'select' || s.mode === 'ending' ? `${MODES.find((m) => m.mode === s.mode)!.title} as ${name(pilots, s.pilot)}`
    : `${name(robots, s.robot)} vs ${name(robots, s.opponent)} in ${name(arenas, s.arena)}`;
  const back = h('div', { class: 'test-back' },
    h('div', { class: 'bar' },
      h('span', { class: 'hazard' }),
      h('b', { class: 'omf', style: { fontSize: '13px', color: '#ffb431' } }, 'TEST'),
      h('span', { class: 'muted what' }, `${p.manifest.name}: ${what}`),
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
    // (the page comes back where it was: the move or animation that was being tried)
    app.reopen();
  };
  frame.addEventListener('load', () => frame.focus());
  document.body.append(back);
}

/** A robot's first idle frame drawn where it stands (`x`, the floor), facing the other robot. */
function drawFighter(ctx: CanvasRenderingContext2D, af: AfFile | null, colors: [number, number, number], x: number, faceLeft: boolean): void {
  const sp = af?.moves[11]?.animation.sprites.find((z) => !z.isEmpty() && z.width < 1000);
  if (!sp) return;
  const pic = indexedCanvas(sp.pixels(), sp.width, sp.height, robotPalette(colors));
  ctx.save();
  ctx.translate(x, FLOOR + sp.posY);
  if (faceLeft) ctx.scale(-1, 1);
  ctx.drawImage(pic, sp.posX, 0);
  ctx.restore();
}

/**
 * What a test starts with: in a fight, the arena with both robots in their pilots' colors where they start, the
 * pilots' and robots' names over them like the fight's; on the pilot select screen or the ending, the pilot.
 */
async function testPreview(p: Project, s: TestSetup, pilot: string, opponentPilot: string, robot: string, opponent: string, arena: string): Promise<HTMLElement> {
  const byId = <T extends { id: string }>(list: T[], ref: string) => (ref.startsWith('mod:') ? list.find((x) => x.id === ref.slice(4)) ?? null : null);
  if (s.mode === 'select' || s.mode === 'ending') {
    const mine = byId(p.pilots, s.pilot);
    const pic = mine ? pilotPicture(mine, true) : gamePortrait(Number(s.pilot));
    return h('div', { class: 'fight-card portrait' }, pic ?? icon('pilot'), h('div', { class: 'caption' }, h('b', null, pilot),
      h('span', null, s.mode === 'select' ? 'on the pilot select screen' : 'the ending')));
  }
  const colorsOf = (ref: string): [number, number, number] => {
    const mine = byId(p.pilots, ref);
    if (mine) return mine.info.colors;
    const info = PILOT_INFO[Number(ref)] ?? PILOT_INFO[0];
    return [info.color1, info.color2, info.color3];
  };
  const afOf = async (ref: string): Promise<AfFile | null> => byId(p.robots, ref)?.af ?? (ref.startsWith('mod:') ? null : gameAf(Number(ref)));
  const bkOf = async (ref: string): Promise<BkFile | null> => byId(p.arenas, ref)?.bk ?? (ref.startsWith('mod:') ? null : gameBk(Number(ref)));
  const [bk, af1, af2] = await Promise.all([bkOf(s.arena), afOf(s.robot), afOf(s.opponent)]);
  const c = h('canvas', { class: 'pix', width: 320, height: 200 });
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#01020c';
  ctx.fillRect(0, 0, 320, 200);
  if (bk) ctx.drawImage(bkPicture(bk), 0, 0);
  drawFighter(ctx, af1, colorsOf(s.pilot), START_X[0], false);
  drawFighter(ctx, af2, colorsOf(s.mode === 'training' ? '3' : opponentPilotOf(s)), START_X[1], true);
  const side = (cls: string, top: string, bottom: string) => h('div', { class: `side ${cls}` }, h('b', null, top), h('span', null, bottom));
  return h('div', { class: 'fight-card' }, c,
    side('left', pilot, robot),
    s.mode === 'training' ? side('right', 'DUMMY', opponent) : side('right', opponentPilot, opponent),
    h('div', { class: 'where' }, arena));
}
