// A robot's moves in OMF Studio: the seventy slots of its fighter file, and for the selected one its animation (the
// animation panel: preview, frames, tags, sprites) and what it does in a fight (its input, kind, damage, the victim's
// reaction...).
import type { AfMoveData } from '../../formats/af';
import type { AnimationData } from '../../formats/animation';
import { decodeScript } from '../../script/script';
import { HD_REFERENCE_COLORS, REQUIRED_MOVES } from '../../mods/types';
import { parseAnim } from '../anim';
import { AnimPanel, type AnimPanelHost } from '../animPanel';
import { spriteStem } from '../hd';
import type { StudioApp } from '../app';
import { RAMP_ENTRIES, robotPalette, ROBOT_ENTRIES } from '../colors';
import { confirmDialog, field, fill, h, modal, numberInput, select, toast } from '../dom';
import type { RobotDoc } from '../project';
import { blankSprite, copySprite, detach } from '../sprites';
import { CATEGORIES, DIRECTIONS, EXTRA_SELECTORS, inputShort, inputText, moveLabel, REACTIONS, SHARED_MOVES } from './moves';
import { CELL_BACKGROUND, copyMove, newMove } from './model';

/** Where robots stand in the preview (the game's floor) and the preview's size. */
const STAGE_W = 320, STAGE_H = 210, FLOOR = 190;
/** Jump sprites are stored 60 pixels lower (the game moves them up when it loads the move). */
const JUMP_ADJUST = 60;

/** What the engine's own animations are for. */
const ENGINE_MOVES: Record<number, string> = {
  1: 'Played while the robot jumps. Its sprites are stored 60 pixels lower than they show (the game moves them up); the preview shows them where they play.',
  2: 'Getting up after being knocked down.',
  3: 'Stunned (dizzy) after too many hits.',
  4: 'Crouching.',
  5: 'Blocking standing.',
  6: 'Blocking crouched.',
  7: 'The burning oil effect (shared by every robot: the original game\'s is used when the robot has none).',
  8: 'The sparks of a blocked hit (shared).',
  9: 'The damage sheet: the frames other robots\' hits show. A hit\'s reaction string (in the move that hits) picks them: A-F standing, L-M knocked down, and so on.',
  10: 'Walking (played forwards and backwards).',
  11: 'Standing still.',
  12: 'Scrap metal flying off (shared).',
  13: 'A bolt flying off (shared).',
  14: 'A screw flying off (shared).',
  48: 'The victory pose after winning a round.',
  49: 'Knocked out.',
  55: 'A blast (shared).',
  56: 'A blast (shared).',
  57: 'A blast (shared).',
  60: 'The robot select screen\'s picture (51 x 36, its background color see-through there).',
  61: 'The VS screen\'s picture.',
};

export class MoveEditor {
  el: HTMLElement;
  private list = h('div', { style: { overflow: 'auto', borderRight: '1px solid var(--line)' } });
  private panel: AnimPanel;

  constructor(private app: StudioApp, private robot: RobotDoc, moveId = 11) {
    const robotRef = robot;
    const host: AnimPanelHost = {
      noun: 'move',
      all: () => robotRef.af.moves.map((m) => m?.animation),
      get: (id) => robotRef.af.moves[id]?.animation ?? null,
      palette: () => robotPalette(this.app.colors),
      stage: (id) => ({
        width: STAGE_W, height: STAGE_H, left: 0, origin: [160, FLOOR - (id === 1 ? JUMP_ADJUST : 0)], floor: FLOOR, backdrop: null,
        centred: id === 60 || id === 61, whole: false,
      }),
      pixel: (id) => ({
        entries: id === 60 ? [...ROBOT_ENTRIES, CELL_BACKGROUND] : ROBOT_ENTRIES,
        groups: [
          { label: 'Tertiary color (the pilot\'s third choice)', entries: RAMP_ENTRIES.slice(0, 15) },
          { label: 'Secondary color', entries: RAMP_ENTRIES.slice(15, 31) },
          { label: 'Primary color', entries: RAMP_ENTRIES.slice(31, 47) },
          { label: 'Effects (the same in every fight)', entries: ROBOT_ENTRIES.slice(47) },
        ],
        fixed: id === 60 ? { background: CELL_BACKGROUND } : undefined,
        hitPoints: id !== 60 && id !== 61,
        floorY: id === 60 || id === 61 ? null : id === 1 ? JUMP_ADJUST : 0,
      }),
      spriteTitle: (id, sprite) => `${robotRef.info.name}: move ${id}, sprite ${String.fromCharCode(65 + sprite)}`,
      spriteFile: (id, sprite) => `${robotRef.id}-move${id}-${String.fromCharCode(97 + sprite)}.png`,
      // (standing on the floor, centred on where the robot stands)
      importPosition: (_id, w, hh) => [-(w >> 1), -hh],
      cards: (id) => {
        const m = robotRef.af.moves[id]!;
        return [this.moveCard(id, m), ...(m.animation.extraStrings.length ? [this.variantsCard(m)] : []), ...(this.isAttack(id) ? [this.advancedCard(m)] : [])];
      },
      timelineEdited: (id) => {
        // (once a move: an edit the game does not show in fights is a surprise)
        const m = robotRef.af.moves[id];
        if (!m || this.toldVariants.has(id) || !replacedIn(m)) return;
        this.toldVariants.add(id);
        toast(`The game plays a variant of move ${id} ${replacedIn(m)}, not this timeline: VARIANTS (on the right) can follow it.`);
      },
      emptyCard: (id) => h('div', { class: 'card', style: { marginTop: '12px' } }, h('h2', null, `MOVE ${id}`),
        h('p', { class: 'muted' }, SHARED_MOVES.includes(id)
          ? 'The robot has none of its own: the game uses the original robots\' (an effect every robot shares). A move of its own here replaces it.'
          : 'This slot is empty.'),
        h('button', { class: 'btn primary', onclick: () => this.createHere(id) }, 'Make a move here')),
      changed: (structure) => {
        this.app.changed(structure);
        if (structure) this.renderList();
      },
      hd: {
        get: () => robotRef.hd,
        set: (hd) => (robotRef.hd = hd),
        palette: () => robotPalette(robotRef.hd?.colors ?? HD_REFERENCE_COLORS),
        stem: (id, sprite) => spriteStem('m', id, sprite),
      },
    };
    this.panel = new AnimPanel(host);
    this.el = h('div', { style: { display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)', height: '100%', minHeight: '0' } }, this.list, this.panel.el);
    this.load(moveId);
  }

  destroy(): void {
    this.panel.destroy();
  }

  /** The robot is shown in other colors. */
  recolor(): void {
    this.panel.refresh();
  }

  /** The move shown. */
  get current(): number {
    return this.panel.id;
  }

  private load(id: number): void {
    this.panel.load(id);
    this.renderList();
  }

  private isAttack(id: number): boolean {
    return id >= 15 && id !== 48 && id !== 49 && id !== 60 && id !== 61;
  }

  // ---- the move list ---------------------------------------------------------------------------------------------

  private renderList(): void {
    const af = this.robot.af;
    const row = (id: number) => {
      const m = af.moves[id];
      const required = REQUIRED_MOVES.includes(id);
      const shared = SHARED_MOVES.includes(id) && !m;
      return h('div', {
        class: `item${id === this.panel.id ? ' sel' : ''}`, style: { padding: '4px 10px', gap: '6px', opacity: m ? '1' : '.55' },
        onclick: () => this.load(id), title: shared ? 'The original game\'s is used when the robot has none' : '',
      },
      h('span', { class: 'faint', style: { width: '20px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px' } }, String(id)),
      // (a special by its name, then its input)
      h('span', { class: 'mv-label' }, this.robot.info.moves[id] && m
        ? [h('b', null, this.robot.info.moves[id]), inputShort(m.moveString) ? h('span', { class: 'faint' }, ` ${inputShort(m.moveString)}`) : null]
        : moveLabel(id, m) + (shared ? ' (shared)' : '')),
      required && !m ? h('span', { class: 'badge bad', style: { marginLeft: 'auto' } }, 'needed')
        : m && offInNormalFights(m) ? h('span', { class: 'badge warn', style: { marginLeft: 'auto' }, title: 'Normal fights play a one-frame variant of it: '
          + 'a tournament robot needs an enhancement for it (see its VARIANTS)' }, 'enh.') : null);
    };
    const used = [...Array(70).keys()].filter((id) => af.moves[id] || REQUIRED_MOVES.includes(id) || SHARED_MOVES.includes(id) || id === 60 || id === 61);
    const free = [...Array(70).keys()].filter((id) => id >= 15 && !af.moves[id] && !used.includes(id));
    fill(this.list,
      h('div', { style: { padding: '8px 10px', display: 'flex', gap: '6px' } },
        h('button', { class: 'btn small', onclick: () => void this.newMoveDialog(free) }, '+ New move')),
      used.map(row));
    this.list.querySelector('.item.sel')?.scrollIntoView({ block: 'nearest' });
  }

  // ---- the move's cards ------------------------------------------------------------------------------------------

  private moveCard(id: number, m: AfMoveData): HTMLElement {
    const deleteButton = !REQUIRED_MOVES.includes(id) ? h('button', { class: 'btn small danger', onclick: () => void this.deleteMove(id) }, 'Delete move') : null;
    if (!this.isAttack(id)) {
      return h('div', { class: 'card' },
        h('h2', null, `MOVE ${id}`, h('span', { class: 'spacer' }), deleteButton),
        h('p', { class: 'muted', style: { margin: '0' } }, ENGINE_MOVES[id] ?? 'An animation other moves start (their tags name it).'));
    }
    const input = h('div', { class: 'row', style: { alignItems: 'center', gap: '6px' } });
    const renderInput = () => {
      const text = inputText(m.moveString);
      fill(input, h('code', { style: { minWidth: '120px', fontSize: '14px' } }, text || (m.moveString ? `"${m.moveString}"` : 'none')));
    };
    renderInput();
    // The input builder: directions in the order they are entered, then the button.
    const dirs: string[] = /^[PK][1-9]*$/.test(m.moveString) ? [...m.moveString.slice(1)].reverse() : [];
    let button = m.moveString[0] === 'K' ? 'K' : 'P';
    const write = () => {
      m.moveString = button + [...dirs].reverse().join('');
      renderInput();
      this.app.changed(false);
      this.renderList();
    };
    const pad = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 30px)', gap: '3px' } },
      DIRECTIONS.map(([d, arrow]) => h('button', { class: 'btn small', style: { padding: '0', justifyContent: 'center' }, onclick: () => {
        dirs.push(d);
        write();
      } }, arrow)));
    const nameInput = h('input', { type: 'text', value: this.robot.info.moves[id] ?? '', maxLength: 24, placeholder: 'e.g. ICE LANCE' });
    nameInput.addEventListener('input', () => {
      const v = nameInput.value.trim().toUpperCase();
      if (v) this.robot.info.moves[id] = v;
      else delete this.robot.info.moves[id];
      this.app.changed(false);
    });
    return h('div', { class: 'card' },
      h('h2', null, `MOVE ${id}`, h('span', { class: 'spacer' }), deleteButton),
      field('Input', h('div', null, input, h('div', { class: 'row', style: { marginTop: '6px', alignItems: 'flex-start' } }, pad,
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          select<string>([['P', 'Punch'], ['K', 'Kick']], () => button, (v) => ((button = v), write())),
          h('button', { class: 'btn small', onclick: () => {
            dirs.length = 0;
            write();
          } }, 'Clear'),
          h('button', { class: 'btn small', onclick: () => {
            dirs.pop();
            write();
          } }, 'Back')))), 'facing right'),
      h('div', { style: { marginTop: '8px' } }, field('Special move name', nameInput, 'the move list shows it')),
      h('div', { class: 'grid2', style: { marginTop: '10px' } },
        field('Kind', select<number>(CATEGORIES, () => m.category, (v) => ((m.category = v), this.app.changed(false), this.renderList()))),
        field('Damage', numberInput(() => m.damageAmount, (v) => ((m.damageAmount = v), this.app.changed(false)), 0, 255)),
        field('Block stun', numberInput(() => m.blockStun, (v) => ((m.blockStun = v), this.app.changed(false)), 0, 255)),
        field('Points', numberInput(() => m.points, (v) => ((m.points = v), this.app.changed(false)), 0, 255), '× 400')),
      h('div', { style: { marginTop: '10px' } }, reactionField(m.footerString, (v) => ((m.footerString = v), this.app.changed(false)),
        'The victim\'s reaction when it hits')));
  }

  /** Moves already told that their variants play instead of the timeline. */
  private toldVariants = new Set<number>();

  /**
   * The move's variants: animation strings the game plays instead of the timeline (har.ts): in normal and hyper fights
   * and for a tournament robot's enhancements, or, for an arm or leg speed move, by the tournament pilot's speed.
   */
  private variantsCard(m: AfMoveData): HTMLElement {
    const a = m.animation;
    const speed = isSpeedVariant(m);
    const list = h('div');
    const note = h('span', { class: 'note' });
    const render = () => {
      const where = replacedIn(m);
      note.style.color = where ? 'var(--warn)' : '';
      fill(note, where ? `played ${where}, not the timeline` : 'the same as the timeline');
      fill(list, a.extraStrings.map((s, i) => {
        const t = h('textarea', { class: 'code', rows: 2 }, s);
        t.addEventListener('change', () => {
          try {
            if (t.value && t.value !== '!') decodeScript(t.value);
          } catch {
            toast('That is not an animation string the game reads.', true);
            t.value = a.extraStrings[i];
            return;
          }
          a.extraStrings[i] = t.value;
          this.app.changed(false);
          render();
        });
        // (the originals turn some moves off in normal fights with a one-frame variant: a robot needs an enhancement for them)
        const same = !s || s === '!' ? (speed ? ' (empty: the move shows nothing)' : ' (the timeline)') : s === a.animString ? ' (the same as the timeline)'
          : parseAnim(s).frames.length <= 1 && parseAnim(a.animString).frames.length > 1 ? ' (one frame: the move is turned off)' : '';
        return h('div', { style: { marginBottom: '6px' } }, h('div', { class: 'sublabel' }, `${variantWhen(m.extraStringSelector, i, a.extraStrings.length)}${same}`), t);
      }));
    };
    render();
    return h('details', { class: 'card' },
      h('summary', null, `VARIANTS (${a.extraStrings.length})`, note),
      h('p', { class: 'faint', style: { fontSize: '11px' } }, speed
        ? `In tournaments the game plays one of these instead of the timeline, by the pilot's ${m.extraStringSelector === 1 ? 'arm' : 'leg'} speed (the originals' are the same move, faster or slower). Other fights play the timeline.`
        : 'The game plays these instead of the timeline: the first in normal fights, the second in hyper fights, the others for a tournament robot\'s enhancements. "!" or nothing plays the timeline.'),
      list,
      h('div', { class: 'row', style: { gap: '6px', marginTop: '4px' } },
        h('button', { class: 'btn small', title: 'Every variant plays what the timeline does (upgrades no longer change the move)', onclick: () => {
          a.extraStrings = a.extraStrings.map((s) => (!speed && (!s || s === '!') ? s : a.animString));
          this.app.changed(false);
          render();
        } }, 'Follow the timeline'),
        h('button', { class: 'btn small', title: 'The move has only its timeline', onclick: () => {
          a.extraStrings = [];
          this.app.changed(false);
          this.panel.refresh();
        } }, 'Remove the variants')));
  }

  private advancedCard(m: AfMoveData): HTMLElement {
    const flag = (bit: number, label: string) => h('label', { class: 'muted', style: { display: 'block' } },
      h('input', { type: 'checkbox', checked: !!(m.posConstraint & bit), onchange: (e: Event) => {
        m.posConstraint = (e.target as HTMLInputElement).checked ? m.posConstraint | bit : m.posConstraint & ~bit;
        this.app.changed(false);
      } }), ` ${label}`);
    return h('details', { class: 'card' },
      h('summary', null, 'MORE'),
      h('div', { class: 'grid2', style: { marginTop: '10px' } },
        field('Next move on a hit', numberInput(() => m.playIfHit, (v) => ((m.playIfHit = v), this.app.changed(false)), 0, 69)),
        field('Successor / throw range', numberInput(() => m.successorId, (v) => ((m.successorId = v), this.app.changed(false)), 0, 255)),
        field('Throw duration', numberInput(() => m.throwDuration, (v) => ((m.throwDuration = v), this.app.changed(false)), 0, 255)),
        field('Variant by upgrades', select<number>(EXTRA_SELECTORS, () => m.extraStringSelector, (v) => ((m.extraStringSelector = v), this.app.changed(false))))),
      h('div', { style: { marginTop: '8px' } }, flag(0x01, 'Only at a wall'), flag(0x02, 'Only as a chain (not from standing)'), flag(0x40, 'Turned off')),
      h('p', { class: 'faint', style: { fontSize: '11px' } }, m.animation.extraStrings.length
        ? 'Which variant plays when: VARIANTS, above.' : 'The move has no variants: the timeline plays in every fight.'));
  }

  // ---- whole moves -----------------------------------------------------------------------------------------------

  private createHere(id: number): void {
    const idle = this.robot.af.moves[11];
    const s = idle?.animation.sprites.find((x) => !x.isEmpty());
    this.robot.af.moves[id] = newMove(id >= 15 ? 5 : 9, id >= 15 ? 'P' : '!', [s ? copySprite(s) : blankSprite(-20, -80)], 'A4');
    this.app.changed(true);
    this.load(id);
  }

  private async newMoveDialog(free: number[]): Promise<void> {
    if (!free.length) {
      toast('Every slot has a move.', true);
      return;
    }
    const af = this.robot.af;
    const sources: [number, string][] = [[-1, 'One frame of the idle animation'], ...af.moves.map((m, id) => (m ? [id, `A copy of move ${id}: ${moveLabel(id, m)}`] : null))
      .filter((x): x is [number, string] => !!x)];
    let slot = free[0], from = -1;
    const ok = await modal<boolean>((close) => h('div', { class: 'modal', style: { width: '520px' } },
      h('h2', null, 'New move'),
      h('p', { class: 'muted' }, 'Attacks take slots 15 to 69; the game tries their inputs in that order (an input that begins like another\'s ' +
        'should come first).'),
      h('div', { class: 'grid2' },
        field('Slot', select<number>(free.map((id) => [id, String(id)]), () => slot, (v) => (slot = v))),
        field('Start from', select<number>(sources, () => from, (v) => (from = v)))),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => close(true) }, 'Make it'))));
    if (!ok) return;
    if (from >= 0 && af.moves[from]) af.moves[slot] = copyMove(af.moves[from]!);
    else {
      const s = af.moves[11]?.animation.sprites.find((x) => !x.isEmpty());
      af.moves[slot] = newMove(5, 'P', [s ? copySprite(s) : blankSprite(-20, -80)], 'A4');
    }
    this.app.changed(true);
    this.load(slot);
  }

  private async deleteMove(id: number): Promise<void> {
    if (!(await confirmDialog('Delete move', `Delete move ${id}? Its sprites go with it.`, 'Delete', true))) return;
    const anims: (AnimationData | null | undefined)[] = this.robot.af.moves.map((x) => x?.animation);
    // (sprites of other moves that show its pictures keep them)
    for (const s of this.robot.af.moves[id]?.animation.sprites ?? []) detach(anims, s);
    this.robot.af.moves[id] = null;
    delete this.robot.info.moves[id];
    this.app.changed(true);
    this.load(id);
  }
}

/** The victim's reaction to a hit (an animation string over the victim's damage sheet), with the game's robots' as presets. */
export function reactionField(value: string, set: (v: string) => void, label: string): HTMLElement {
  let current = value;
  const react = h('textarea', { class: 'code', rows: 2 }, value);
  react.addEventListener('change', () => {
    try {
      decodeScript(react.value);
      current = react.value;
      set(current);
    } catch {
      toast('That is not an animation string the game reads.', true);
      react.value = current;
    }
  });
  return field(label, h('div', null, react,
    h('div', { class: 'row', style: { marginTop: '4px' } }, select<string>([['', 'Use a reaction of the game\'s robots…'], ...REACTIONS.map(([n, s]) => [s, n] as [string, string])],
      () => '', (v) => {
        if (!v) return;
        react.value = v;
        current = v;
        set(v);
      }))), 'frames of the victim\'s damage animation (its move 9)');
}

/** Whether a move's variants go by the tournament pilot's arm or leg speed (har.ts). */
function isSpeedVariant(m: AfMoveData): boolean {
  return m.extraStringSelector === 1 || m.extraStringSelector === 2;
}

/** When the game plays a move's variant `i` of `count` (har.ts). */
function variantWhen(selector: number, i: number, count: number): string {
  const up = i === count - 1 && count > 1 ? ' and up' : '';
  if (selector === 1 || selector === 2) return `Tournament, ${selector === 1 ? 'arm' : 'leg'} speed ${i}${up}`;
  if (i === 0) return 'Normal fights';
  if (i === 1) return 'Hyper fights';
  return `Tournament, enhancement ${i - 1}${up}`;
}

/** Where the game plays a variant of the move that is not its timeline ("in tournaments"), or '' when it never does. */
function replacedIn(m: AfMoveData): string {
  const a = m.animation;
  const differs = (s: string | undefined) => s !== undefined && s !== a.animString && (isSpeedVariant(m) || (!!s && s !== '!'));
  if (isSpeedVariant(m)) return a.extraStrings.some(differs) ? 'in tournaments' : '';
  if (differs(a.extraStrings[0])) return 'in normal fights';
  if (differs(a.extraStrings[1])) return 'in hyper fights';
  return a.extraStrings.slice(2).some(differs) ? 'for enhanced tournament robots' : '';
}

/** Whether normal fights play a one-frame variant of an attack instead of its timeline (the originals' moves that need an enhancement). */
function offInNormalFights(m: AfMoveData): boolean {
  const s = m.animation.extraStrings[0];
  return !isSpeedVariant(m) && !!s && s !== '!' && s !== m.animation.animString && parseAnim(s).frames.length <= 1;
}
