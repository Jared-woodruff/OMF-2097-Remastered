// The mod's page in OMF Studio: what to do next (add something, fix what the checks find, or test it and share it),
// what the mod holds (its robots, arenas and pilots, a click away) and its details (name, id, version, author,
// description: how the game's MODS page shows it).
import { ID_PATTERN } from '../mods/types';
import type { StudioApp } from './app';
import { projectProblems, type Problem } from './checks';
import { field, fill, h, icon, textInput } from './dom';
import { A, contentPicture, type ContentKind } from './ui';

/** Problems as a list: a click on one goes there (after `picked`). */
export function problemList(app: StudioApp, list: Problem[], picked?: () => void): HTMLElement {
  return h('ul', { class: 'problems' }, list.map((x) => h('li', {
    class: x.level, title: 'Go there', onclick: () => {
      picked?.();
      app.select(x.target);
    },
  }, icon(x.level === 'error' ? 'alert' : 'info'), h('span', null, x.text), h('span', { class: 'go' }, icon('chevron')))));
}

export function modHome(app: StudioApp): HTMLElement {
  const m = app.project!.manifest;
  const title = h('h1');
  const sub = h('div', { class: 'sub' });
  const drawHead = () => {
    fill(title, m.name || '(no name)');
    fill(sub, h('span', { class: 'badge' }, m.id || 'no id'), h('span', null, `version ${m.version || '?'}`), m.author ? h('span', null, `· by ${m.author}`) : null);
  };
  drawHead();
  const next = h('div');
  app.onStatus((problems) => fill(next, nextCard(app, problems)));
  const changed = () => {
    drawHead();
    app.changed(false);
  };
  // (what is typed becomes an id the game takes: "My Mod" is my-mod; the mod keeps its last good id until then)
  const idInput = textInput(() => m.id, (v) => {
    const id = v.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '').replace(/^[^a-z0-9]+/, '').slice(0, 64);
    if (ID_PATTERN.test(id)) m.id = id;
    markId(id);
    changed();
  });
  const markId = (typed = m.id) => (idInput.style.borderColor = ID_PATTERN.test(typed) ? '' : 'var(--bad)');
  markId();
  const description = h('textarea', { rows: 3, maxLength: 400 }, m.description);
  description.addEventListener('input', () => ((m.description = description.value), app.changed(false)));
  return h('div', { class: 'page' },
    h('div', { class: 'home-head' }, title, sub),
    next,
    contentsCard(app),
    h('div', { class: 'card' }, h('h2', null, 'Details'),
      h('p', { class: 'muted', style: { marginTop: '0' } }, 'How the game\'s MODS page names the mod. Its id tells it apart from every other mod: ' +
        'an update keeps the id, and replaces the older version when it is installed.'),
      h('div', { class: 'grid2' },
        field('Name', textInput(() => m.name, (v) => ((m.name = v), changed()), { maxLength: 40 })),
        field('Id', idInput, 'yourname.mod-name: small letters, digits, ".", "-" and "_"'),
        field('Version', textInput(() => m.version, (v) => ((m.version = v), changed()), { maxLength: 16 })),
        field('Author', textInput(() => m.author, (v) => ((m.author = v), changed()), { maxLength: 40 }))),
      h('div', { style: { marginTop: '14px' } }, field('Description', description, 'up to 400 characters'))));
}

/** What to do next: add something to an empty mod, fix what the checks find, or test the mod and share it. */
function nextCard(app: StudioApp, problems: Problem[]): HTMLElement {
  const p = app.project!;
  const errors = problems.filter((x) => x.level === 'error');
  const notes = problems.filter((x) => x.level === 'warning');
  const card = (kind: 'ok' | 'bad' | 'begin', ic: 'check' | 'alert' | 'plus', headline: string, text: string, ...more: (HTMLElement | null)[]) =>
    h('div', { class: `card next ${kind}` }, h('div', { class: 'big-icon' }, icon(ic)), h('h2', { class: 'headline' }, headline), h('p', null, text), h('div', null, more));
  if (errors.some((x) => x.code === 'empty')) {
    const other = errors.filter((x) => x.code !== 'empty');
    return card('begin', 'plus', 'Add something to the mod', 'A mod holds robots, arenas and pilots: build one, or copy one of the game\'s and change it.',
      h('div', { class: 'actions-row' },
        h('button', { class: 'btn primary', onclick: () => void app.addRobot() }, icon('robot'), 'New robot'),
        h('button', { class: 'btn primary', onclick: () => void app.addArena() }, icon('arena'), 'New arena'),
        h('button', { class: 'btn primary', onclick: () => void app.addPilot() }, icon('pilot'), 'New pilot')),
      other.length ? problemList(app, other) : null);
  }
  if (errors.length) {
    return card('bad', 'alert', `${errors.length} thing${errors.length === 1 ? '' : 's'} to fix`,
      'The game cannot play the mod until they are fixed. Click one to go there.', problemList(app, [...errors, ...notes]));
  }
  return card('ok', 'check', 'Ready to play', `Try ${p.manifest.name || 'it'} in a fight, then install it in the game, or build its file to share.`,
    h('div', { class: 'actions-row' },
      h('button', { class: 'btn go', onclick: () => void app.test() }, '▶ Test in the game'),
      h('button', { class: 'btn primary', onclick: () => void app.install() }, icon('install'), 'Install in game'),
      h('button', { class: 'btn', onclick: () => void app.build() }, icon('box'), 'Build file')),
    notes.length ? h('details', { class: 'notes' }, h('summary', null, `${notes.length} note${notes.length === 1 ? '' : 's'}: the game makes up for ${notes.length === 1 ? 'it' : 'them'}`),
      problemList(app, notes)) : null);
}

/** The mod's robots, arenas and pilots as pictures, and a way to add more. */
function contentsCard(app: StudioApp): HTMLElement {
  const p = app.project!;
  const errors = new Set(projectProblems(p).filter((x) => x.level === 'error' && 'index' in x.target)
    .map((x) => `${x.target.kind}:${(x.target as { index: number }).index}`));
  const tile = (kind: ContentKind, index: number, name: string) => {
    const pic = contentPicture(app, kind, index, true);
    return h('button', { class: 'tile', title: `Open ${name}`, onclick: () => app.select({ kind, index }) },
      h('div', { class: `pic${pic.cover ? ' cover' : ''}` }, pic.el),
      h('div', { class: 'label' }, h('span', null, name), errors.has(`${kind}:${index}`) ? h('i', { class: 'dot', title: 'Something to fix' }) : null));
  };
  const add = (kind: ContentKind, run: () => void) => h('button', { class: 'tile add', title: `Add ${A[kind]} to the mod`, onclick: run },
    h('div', { class: 'pic' }, icon('plus')), h('div', { class: 'label' }, h('span', null, `New ${kind}`)));
  const kinds: [ContentKind, string, { id: string; info: { name: string } }[], () => void][] = [
    ['robot', 'Robots', p.robots, () => void app.addRobot()],
    ['arena', 'Arenas', p.arenas, () => void app.addArena()],
    ['pilot', 'Pilots', p.pilots, () => void app.addPilot()],
  ];
  return h('div', { class: 'card' }, h('h2', null, 'In the mod'),
    h('div', { class: 'kinds' }, kinds.map(([kind, label, list, run]) => h('div', null,
      h('div', { class: 'kind-head' }, icon(kind), label.toUpperCase(), h('span', { class: 'count' }, String(list.length))),
      h('div', { class: 'tiles' }, list.map((x, i) => tile(kind, i, x.info.name || x.id)), add(kind, run))))));
}
