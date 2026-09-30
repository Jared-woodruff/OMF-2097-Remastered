// Move list of the fight pause menu: the special moves, throws and finishing moves of both robots, read from their
// move tables. The original game data has no move names, so their moves are listed by kind with their inputs, as if
// facing right (the directions of the move strings are relative to the robot's facing); the remaster's robots name
// their special moves.
import { ACT_ESC, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, CAT_CLOSE, CAT_DESTRUCTION, CAT_HIGH, CAT_JUMPING, CAT_LOW, CAT_MEDIUM,
  CAT_SCRAP, CtrlType } from '../constants';
import type { Af } from '../../resources/resources';
import { specialNames } from '../roster';
import { drawDir, ICON_SIZE } from './inputIcons';
import { settings } from '../settings';
import { SPECIAL_SLOTS } from '../../controller/special';
import { FontSize, GLYPH_SHADOW_BOTTOM, GLYPH_SHADOW_RIGHT, Text } from './text';
import { Component, Label, Menu, playMenuSound } from './widgets';

export interface MoveListEntry {
  /** What is shown: the move's name, or its kind. */
  label: string;
  /** Kind of move (THROW, SPECIAL, AIR, SCRAP, DESTRUCT). */
  kind: string;
  /** Directions in the order they are entered ('5' = back to neutral). */
  inputs: string[];
  button: 'P' | 'K';
  category: number;
  /** The move table's input string (button, then the directions most recent first). */
  moveString: string;
}

const KINDS: [number[], string][] = [
  [[CAT_CLOSE], 'THROW'],
  [[CAT_LOW, CAT_MEDIUM, CAT_HIGH], 'SPECIAL'],
  [[CAT_JUMPING], 'AIR'],
  [[CAT_SCRAP], 'SCRAP'],
  [[CAT_DESTRUCTION], 'DESTRUCT'],
];

/** Plain attacks (a button, possibly with one direction): only listed when they are throws. */
const BASIC = /^[PK][1-46]?$/;

/**
 * The inputs of a move string, in the order they are entered. Move strings hold a button, then the directions most
 * recent first; the input buffer drops repeats, so a return to neutral ('5') separates two taps of the same direction
 * (implied here) and is shown where it separates different directions or precedes the button.
 */
export function moveNotation(moveString: string): { inputs: string[]; button: 'P' | 'K' } | null {
  if (!/^[PK][1-9]*$/.test(moveString)) return null;
  const dirs = [...moveString.slice(1)].reverse();
  if (dirs[0] === '5') dirs.shift();
  const inputs = dirs.filter((d, i) => d !== '5' || i === dirs.length - 1 || dirs[i - 1] !== dirs[i + 1]);
  return { inputs, button: moveString[0] as 'P' | 'K' };
}

/** The moves of a robot worth listing, by kind. */
export function harMoveList(af: Af): MoveListEntry[] {
  const out: MoveListEntry[] = [];
  // (the remaster's robots name their specials in their definitions, mods in their robot.json)
  const names = specialNames(af.id);
  for (const [cats, kind] of KINDS) {
    for (const m of af.moves) {
      // Moves that only chain from others (position constraint bit 2) cannot be entered on their own.
      if (!m || !cats.includes(m.category) || m.posConstraints & 0x2) continue;
      const name = names[m.id];
      if (BASIC.test(m.moveString) && m.category !== CAT_CLOSE && !name) continue;
      const n = moveNotation(m.moveString);
      if (!n) continue;
      if (out.some((e) => e.kind === kind && e.button === n.button && e.inputs.join() === n.inputs.join())) continue;
      out.push({ label: name ?? kind, kind, ...n, category: m.category, moveString: m.moveString });
    }
  }
  return out;
}

const ROW_H = 9;
const LABEL_W = 50;
const STEP = ICON_SIZE + 1;
const COLOR_ARROW = 0xdf;
const COLOR_NEUTRAL = 0xd8;
const COLOR_SHADOW = 0xd1;
const COLOR_PUNCH = 0xf2;
const COLOR_KICK = 0xe7;
const COLOR_SPECIAL = 0xa6;
const KIND_COLORS: Record<string, number> = { THROW: 0xc7, SPECIAL: 0xe6, AIR: 0xe4, SCRAP: 0xf2, DESTRUCT: 0xf0 };

/** The list itself (one selectable component: left/right switch robots, punch/kick/esc go back). */
class MoveListView extends Component {
  private labels = new Map<string, Text>();
  private buttons = new Map<string, Text>();
  entries: MoveListEntry[] = [];

  constructor(private onSwitch: () => void, private onDone: () => void) {
    super();
    this.setHelp('Directions as if facing right: enter them in order, then punch (P) or kick (K); a dot means releasing ' +
      'the direction. S: the special button does it in one press. Left or right shows the other robot.');
  }

  private label(e: MoveListEntry): Text {
    return this.text(this.labels, e.label, FontSize.SMALL, KIND_COLORS[e.kind] ?? 0xe6);
  }

  private text(map: Map<string, Text>, s: string, font: FontSize, color: number): Text {
    let t = map.get(s);
    if (!t) {
      t = new Text(font, 0xffff, 0xffff, s).setColor(color).setShadowColor(COLOR_SHADOW).setShadow(GLYPH_SHADOW_RIGHT | GLYPH_SHADOW_BOTTOM);
      map.set(s, t);
    }
    return t;
  }

  /** The special button's direction for an entry (SPECIAL_SLOTS, or '' in the air), or null when it has none. */
  private specialSlot(e: MoveListEntry): string | null {
    if (!settings().keys.specialButton) return null;
    if (e.kind === 'AIR') return this.entries.find((x) => x.kind === 'AIR') === e ? '' : null;
    if (e.kind !== 'SPECIAL') return null;
    const i = this.entries.filter((x) => x.kind === 'SPECIAL').indexOf(e);
    return i >= 0 && i < SPECIAL_SLOTS.length ? SPECIAL_SLOTS[i] : null;
  }

  override render(): void {
    const widest = Math.max(1, ...this.entries.map((e) => e.inputs.length));
    const labelW = Math.max(LABEL_W, ...this.entries.map((e) => this.label(e).width() + 6));
    const spW = settings().keys.specialButton ? STEP + 14 : 0;
    const x0 = this.x + Math.max(4, (this.w - (labelW + widest * STEP + 10 + spW)) >> 1);
    const spX = x0 + labelW + widest * STEP + 14;
    this.entries.forEach((e, i) => {
      const y = this.y + i * ROW_H;
      this.label(e).draw(x0, y + 1);
      let x = x0 + labelW;
      for (const d of e.inputs) {
        drawDir(d, x, y, d === '5' ? COLOR_NEUTRAL : COLOR_ARROW, COLOR_SHADOW);
        x += STEP;
      }
      this.text(this.buttons, e.button, FontSize.BIG, e.button === 'P' ? COLOR_PUNCH : COLOR_KICK).draw(x + 1, y);
      // The special button: its direction (none in the air) and S.
      const slot = this.specialSlot(e);
      if (slot !== null) {
        if (slot && slot !== '5') drawDir(slot, spX, y, COLOR_ARROW, COLOR_SHADOW);
        this.text(this.buttons, 'S', FontSize.BIG, COLOR_SPECIAL).draw(spX + STEP + 1, y);
      }
    });
  }

  override action(action: number, _source: CtrlType): number {
    if (action === ACT_LEFT || action === ACT_RIGHT) {
      this.onSwitch();
      playMenuSound(19);
      return 0;
    }
    if (action === ACT_PUNCH || action === ACT_KICK || action === ACT_ESC) {
      this.onDone();
      return 0;
    }
    return 1;
  }
}

export interface MoveListSource {
  /** The robot of a player (0 or 1) and its name. */
  robot(player: number): { af: Af; name: string } | null;
}

/** The move list as a submenu of the pause menu, starting with player `player`'s robot. */
export function moveListMenu(src: MoveListSource, player: number): Menu {
  const menu = new Menu();
  const title = Label.title('');
  let current = player;
  const show = (p: number) => {
    const r = src.robot(p);
    current = p;
    title.setText(`${p + 1}P ${r?.name.toUpperCase() ?? ''}`);
    view.entries = r ? harMoveList(r.af) : [];
    view.setSizeHints(-1, Math.max(1, view.entries.length) * ROW_H);
  };
  // Two players: left and right both switch to the other one (the frame is laid out again for its list).
  const view = new MoveListView(() => {
    const other = 1 - current;
    if (!src.robot(other)) return;
    show(other);
    menu.layout(menu.x, menu.y, menu.w, menu.h);
  }, () => (menu.finished = true));
  show(player);
  menu.attach(title);
  menu.attach(view);
  return menu;
}
