// Controls screen: a keyboard showing both players' keys and an Xbox controller showing its buttons, with the layout
// choices (keyboard: classic / modern; controller: modern / classic). Opened from OPTIONS > CONTROLS > KEYS AND BUTTONS and the
// pause menu; shown by the help overlay (helpOverlay.ts) on the main menu backdrop.
import { connectedPads, getPadLayout, padFamily, padName, type PadFamily } from '../../controller/input';
import type { PointerKind } from '../../controller/mouse';
import { video } from '../../video/draw';
import type { Surface } from '../../video/surface';
import { vga } from '../../video/vga';
import { ACT_DOWN, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_UP, CtrlType } from '../constants';
import { applyKeyLayout, applyPadSettings, autoPadSlot, detectKeyLayout } from '../controls';
import { keyName, printedKey } from '../scenes/mainmenu/keyNames';
import { saveSettings, settings, type KeyBindings } from '../settings';
import { isRtlParagraph } from './glyphs';
import { drawDir } from './inputIcons';
import { Painter } from './painter';
import { FontSize, GLYPH_SHADOW_BOTTOM, GLYPH_SHADOW_RIGHT, HAlign, Text } from './text';
import { Menu, MenuBackgroundStyle, menuBackground, menuShade, playMenuSound } from './widgets';
import { tr, clip } from '../../i18n/i18n';

/** Palette entries the screen sets while it is open (unused by the main menu's backdrop and its shading). */
const C = {
  bodyDark: 0x60, body: 0x61, bodyLight: 0x62, outline: 0x63, stickDark: 0x64, stick: 0x65,
  a: 0x66, b: 0x67, x: 0x68, y: 0x69, white: 0x6a, lightGrey: 0x6b, grey: 0x6c,
  keyP1: 0x6d, keyP2: 0x6e, keyFace: 0x6f, keyEdge: 0x70, keyTop: 0x71, punch: 0x72, kick: 0x73, dim: 0x74,
  bright: 0x75, p1: 0x76, p2: 0x77, shadow: 0x78, special: 0x79, square: 0x7a,
};
const COLORS: [number, number, number, number][] = [
  [C.bodyDark, 0x1c, 0x1f, 0x25], [C.body, 0x31, 0x36, 0x40], [C.bodyLight, 0x4a, 0x51, 0x5e], [C.outline, 0x08, 0x09, 0x0c],
  [C.stickDark, 0x13, 0x15, 0x19], [C.stick, 0x2a, 0x2e, 0x36], [C.a, 0x45, 0xbe, 0x3c], [C.b, 0xe2, 0x3d, 0x3d],
  [C.x, 0x3c, 0x7c, 0xe6], [C.y, 0xee, 0xbd, 0x2a], [C.white, 0xf2, 0xf4, 0xf7], [C.lightGrey, 0xaa, 0xb2, 0xbd],
  [C.grey, 0x6b, 0x73, 0x7f], [C.keyP1, 0x23, 0x5e, 0xa3], [C.keyP2, 0xb0, 0x5a, 0x1c], [C.keyFace, 0x2c, 0x30, 0x38],
  [C.keyEdge, 0x12, 0x14, 0x18], [C.keyTop, 0x3d, 0x42, 0x4c], [C.punch, 0xff, 0xb0, 0x30], [C.kick, 0x55, 0xdc, 0xff],
  [C.dim, 0x7c, 0x86, 0x94], [C.bright, 0xdd, 0xe9, 0xff], [C.p1, 0x7c, 0xbe, 0xff], [C.p2, 0xff, 0xa8, 0x5c],
  [C.shadow, 0x05, 0x06, 0x08], [C.special, 0x6e, 0xe8, 0x74], [C.square, 0xe0, 0x78, 0xd0],
];

const TEXT_TITLE = 0xfd;
const TEXT_ACTIVE = 0xff;
const TEXT_NORMAL = 0xfe;

/** The screen's palette entries (set when it opens; the scene's palette comes back when it closes). */
export function setControlsColors(): void {
  for (const [i, r, g, b] of COLORS) vga.setBaseIndex(i, r, g, b);
}

// ---- Keyboard ---------------------------------------------------------------------------------------------------------

/** A key: code, label when unused, position and width in key units (row 0 = number row). */
interface KeyCap {
  code: string;
  label: string;
  x: number;
  row: number;
  w: number;
  h: number;
}

function keyboardKeys(): KeyCap[] {
  const keys: KeyCap[] = [];
  const row = (r: number, x0: number, list: [string, string, number?][]) => {
    let x = x0;
    for (const [code, label, w = 1] of list) {
      // (the letters and signs the player's keyboard prints, a German one's Z where the US one has Y...)
      keys.push({ code, label: (label && !code.startsWith('Numpad') && !code.startsWith('Digit') && printedKey(code)) || label, x, row: r, w, h: 1 });
      x += w;
    }
  };
  const letters = (s: string) => [...s].map((c) => [`Key${c}`, c] as [string, string]);
  const digits = [...'1234567890'].map((c) => [`Digit${c}`, c] as [string, string]);
  row(0, 0, [['Backquote', '`'], ...digits, ['Minus', '-'], ['Equal', '='], ['Backspace', '', 2]]);
  row(1, 0, [['Tab', '', 1.5], ...letters('QWERTYUIOP'), ['BracketLeft', '['], ['BracketRight', ']'], ['Backslash', '', 1.5]]);
  row(2, 0, [['CapsLock', '', 1.75], ...letters('ASDFGHJKL'), ['Semicolon', ';'], ['Quote', "'"], ['Enter', '', 2.25]]);
  row(3, 0, [['ShiftLeft', '', 2.25], ...letters('ZXCVBNM'), ['Comma', ','], ['Period', '.'], ['Slash', '/'], ['ShiftRight', '', 2.75]]);
  row(4, 0, [['ControlLeft', '', 1.5], ['MetaLeft', '', 1.25], ['AltLeft', '', 1.25], ['Space', '', 6.5], ['AltRight', '', 1.25],
    ['MetaRight', '', 1.25], ['ControlRight', '', 1.5]]);
  // Navigation cluster and arrows.
  row(0, 15.5, [['Insert', ''], ['Home', ''], ['PageUp', '']]);
  row(1, 15.5, [['Delete', ''], ['End', ''], ['PageDown', '']]);
  row(3, 16.5, [['ArrowUp', '']]);
  row(4, 15.5, [['ArrowLeft', ''], ['ArrowDown', ''], ['ArrowRight', '']]);
  // Numeric keypad.
  row(0, 19, [['NumLock', ''], ['NumpadDivide', '/'], ['NumpadMultiply', '*'], ['NumpadSubtract', '-']]);
  row(1, 19, [['Numpad7', '7'], ['Numpad8', '8'], ['Numpad9', '9']]);
  row(2, 19, [['Numpad4', '4'], ['Numpad5', '5'], ['Numpad6', '6']]);
  row(3, 19, [['Numpad1', '1'], ['Numpad2', '2'], ['Numpad3', '3']]);
  row(4, 19, [['Numpad0', '0', 2], ['NumpadDecimal', '.']]);
  keys.push({ code: 'NumpadAdd', label: '+', x: 22, row: 1, w: 1, h: 2 });
  keys.push({ code: 'NumpadEnter', label: '', x: 22, row: 3, w: 1, h: 2 });
  return keys;
}

/** Actions and the icon a key shows for them: a direction (numpad notation, as seen facing right) or P / K. */
const ACTIONS: [keyof KeyBindings, string][] = [
  ['jumpUp', '8'], ['jumpRight', '9'], ['walkRight', '6'], ['duckForward', '3'], ['duck', '2'], ['duckBack', '1'],
  ['walkBack', '4'], ['jumpLeft', '7'], ['punch', 'P'], ['kick', 'K'], ['special', 'S'],
];
/** The finisher keys (shown when they are on): F. */
const FINISHER_ACTIONS: [keyof KeyBindings, string][] = [['scrap', 'F'], ['destruction', 'F'], ['fireIce', 'F']];

const KB_UNIT = 12;
const KB_X = 22;
const KB_Y = 38;
/** Painter pixels per native pixel (sharp at 1440p; the classic renderer samples them down). */
const S = 8;
/** Where a label's glyphs sit in the small font: the visible center is this far below the drawing position. */
const GLYPH_MID_Y = 2.95;
/** The widest a line across the screen may be (the panel's inside), and a row's value beside the controller. */
const LINE_W = 296;
const ROW_W = 138;

/** A key's face (the top of the cap, above its thicker front edge), in native pixels from the key's corner. */
function keyFace(cap: KeyCap): { x: number; y: number; w: number; h: number; cx: number; cy: number } {
  const w = cap.w * KB_UNIT - 1, h = cap.h * KB_UNIT - 1;
  const face = { x: 0.75, y: 0.5, w: w - 1.5, h: h - 2.25 };
  return { ...face, cx: face.x + face.w / 2, cy: face.y + face.h / 2 };
}

// ---- Controller (native pixels, from the image's corner) --------------------------------------------------------------

const PAD_X = 14;
const PAD_Y = 42;
const PAD_W = 150;
const PAD_H = 100;
/** An Xbox controller's outline, clockwise from the top middle (smoothed). */
const PAD_BODY: [number, number][] = (() => {
  const right: [number, number][] = [[96, 15.5], [116, 16.5], [131, 20], [140, 27], [145, 38], [147.5, 52], [148, 66], [146.5, 80],
    [142, 92], [134, 98], [124, 98.5], [116, 93], [110, 83], [103, 72], [92, 66.5]];
  const left = right.map(([x, y]) => [150 - x, y] as [number, number]).reverse();
  return [[75, 15.5], ...right, [75, 65], ...left];
})();
/** The lighter band along the top of the body. */
const PAD_BEVEL: [number, number][] = [[75, 18], [115, 19], [131, 23], [139.5, 31], [135, 38], [110, 39.5], [75, 40], [40, 39.5], [15, 38],
  [10.5, 31], [19, 23], [35, 19]];
const PAD = {
  leftStick: [33, 37] as [number, number],
  rightStick: [95, 55] as [number, number],
  dpad: [55, 55] as [number, number],
  view: [64.5, 37] as [number, number],
  menu: [85.5, 37] as [number, number],
  share: [75, 46] as [number, number],
  guide: [75, 27] as [number, number],
  /** The face buttons: name, center. */
  face: [['Y', 117, 27.7], ['X', 107.7, 37], ['B', 126.3, 37], ['A', 117, 46.3]] as [string, number, number][],
  /** Centers of the visible parts of the bumpers and the triggers (their labels). */
  bumpers: [[37, 12.5], [113, 12.5]] as [number, number][],
  triggers: [[37, 5], [113, 5]] as [number, number][],
};

/**
 * A PlayStation face button's symbol, on the button at (x, y) (native pixels): the triangle on top (green), the circle
 * on the right (red), the cross at the bottom (blue), the square on the left (pink). `btn` is the button's place, named
 * as on an Xbox pad (Y top, B right, A bottom, X left).
 */
function psSymbol(p: Painter, btn: string, x: number, y: number, k = 1, hole = C.stickDark): void {
  const pt = (px: number, py: number): [number, number] => [(x + px * k) * S, (y + py * k) * S];
  const line = (x0: number, y0: number, x1: number, y1: number, color: number) =>
    p.capsule((x + x0 * k) * S, (y + y0 * k) * S, (x + x1 * k) * S, (y + y1 * k) * S, 0.42 * k * S, color);
  if (btn === 'Y') {
    line(0, -2.4, 2.3, 1.6, C.a);
    line(2.3, 1.6, -2.3, 1.6, C.a);
    line(-2.3, 1.6, 0, -2.4, C.a);
  } else if (btn === 'B') {
    p.ring(x * S, y * S, 2.2 * k * S, 0.8 * k * S, C.b);
  } else if (btn === 'A') {
    line(-1.9, -1.9, 1.9, 1.9, C.x);
    line(-1.9, 1.9, 1.9, -1.9, C.x);
  } else {
    p.polygon([pt(-2, -2), pt(2, -2), pt(2, 2), pt(-2, 2)], C.square);
    p.polygon([pt(-1.2, -1.2), pt(1.2, -1.2), pt(1.2, 1.2), pt(-1.2, 1.2)], hole);
  }
}

/** A PlayStation symbol in a line of text: the face button at that place (named as on an Xbox pad), drawn as a glyph. */
type Sym = { sym: 'A' | 'B' | 'X' | 'Y' };
/** A part of a line of text: words, or a symbol. */
type Part = string | Sym;

/**
 * A translated text's parts, its {placeholders} filled in: with words, or with symbols. (tr() leaves the placeholders it
 * is not given in place.)
 */
function textParts(text: string, params: Record<string, Part>): Part[] {
  const out: Part[] = [];
  const push = (v: Part) => {
    const last = out[out.length - 1];
    if (typeof v === 'string' && typeof last === 'string') out[out.length - 1] = last + v;
    else if (v !== '') out.push(v);
  };
  let at = 0;
  for (const m of text.matchAll(/\{(\w+)\}/g)) {
    push(text.slice(at, m.index));
    push(m[1] in params ? params[m[1]] : m[0]);
    at = m.index + m[0].length;
  }
  push(text.slice(at));
  return out;
}

/** The parts with their runs of spaces made shorter (a line that is too wide, second try). */
function tighter(parts: Part[]): Part[] {
  return parts.map((v) => (typeof v === 'string' ? v.replace(/ {2,}/g, (sp) => sp.slice(1)) : v));
}

/** Letters written right to left (Hebrew's, Arabic's). */
const RTL_LETTERS = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/;
/** What touches a symbol at a part's start or end, no space between ("ENTER/" before one, the bracket of "(✕"). */
const TOUCHING_START = /^[^\s\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]*/;
const TOUCHING_END = /[^\s\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]*$/;

/**
 * A right-to-left line's parts in the order they are drawn from the left, each with whether it is laid out right to
 * left (Unicode's bidirectional algorithm simplified as glyphs.ts visualOrder does it): a symbol counts as a Latin
 * letter, and Latin text touching one reads with it ("ENTER/✕", left to right); the rest runs from the right. Keys
 * tell the pieces of a part apart (for the text cache).
 */
function rtlOrder(parts: Part[]): [Part, string, boolean][] {
  type Dir = 'l' | 'r' | 'n';
  const toks: { v: Part; k: string; dir: Dir }[] = [];
  const dirOf = (s: string): Dir => (RTL_LETTERS.test(s) ? 'r' : /[\p{L}\p{N}]/u.test(s) ? 'l' : 'n');
  parts.forEach((v, i) => {
    if (typeof v !== 'string') {
      toks.push({ v, k: `${i}`, dir: 'l' });
      return;
    }
    const head = i > 0 && typeof parts[i - 1] !== 'string' ? TOUCHING_START.exec(v)![0] : '';
    const rest = v.slice(head.length);
    const tail = i < parts.length - 1 && typeof parts[i + 1] !== 'string' ? TOUCHING_END.exec(rest)![0] : '';
    const mid = rest.slice(0, rest.length - tail.length);
    for (const [s, k] of [[head, 'h'], [mid, ''], [tail, 't']]) if (s) toks.push({ v: s, k: `${i}${k}`, dir: dirOf(s) });
  });
  // Neutral pieces (spaces, a bracket) between two of a direction take it; the others the line's.
  const dirs = toks.map((t) => t.dir);
  for (let i = 0; i < dirs.length; i++) {
    if (dirs[i] !== 'n') continue;
    let j = i;
    while (j < dirs.length && dirs[j] === 'n') j++;
    const before = i > 0 ? dirs[i - 1] : 'r', after = j < dirs.length ? dirs[j] : 'r';
    for (let k = i; k < j; k++) dirs[k] = before === after ? before : 'r';
    i = j - 1;
  }
  // From the right: all reversed, the left-to-right runs put back in their order.
  const order = toks.map((t, i) => ({ ...t, dir: dirs[i] })).reverse();
  const out: [Part, string, boolean][] = [];
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j < order.length && order[j].dir === 'l') j++;
    if (j > i) {
      for (let k = j - 1; k >= i; k--) out.push([order[k].v, order[k].k, false]);
      i = j;
    } else {
      out.push([order[i].v, order[i].k, true]);
      i++;
    }
  }
  return out;
}

/** What a family of pads calls its buttons, by their place in the standard layout (a PlayStation pad: its symbols). */
interface PadNames {
  south: Part;
  east: Part;
  west: Part;
  north: Part;
  lb: string;
  rb: string;
  lt: string;
  rt: string;
  menu: string;
}

function padNames(family: PadFamily): PadNames {
  if (family === 'playstation') {
    return { south: { sym: 'A' }, east: { sym: 'B' }, west: { sym: 'X' }, north: { sym: 'Y' }, lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', menu: tr('OPTIONS BUTTON') };
  }
  if (family === 'nintendo') return { south: 'B', east: 'A', west: 'Y', north: 'X', lb: 'L', rb: 'R', lt: 'ZL', rt: 'ZR', menu: tr('+ BUTTON') };
  return { south: 'A', east: 'B', west: 'X', north: 'Y', lb: tr('LB'), rb: tr('RB'), lt: tr('LT'), rt: tr('RT'), menu: tr('MENU BUTTON') };
}

/** The pad the screen shows: player 1's chosen pad, else the first connected one (an Xbox pad when there is none). */
function shownFamily(): PadFamily {
  const k = settings().keys;
  if (k.ctrlType1 === CtrlType.GAMEPAD && k.gamepad1 >= 0 && connectedPads().includes(k.gamepad1)) return padFamily(k.gamepad1);
  const first = connectedPads()[0];
  return first === undefined ? 'xbox' : padFamily(first);
}

/** An arrow (numpad notation: 6 right, 9 up and right...) as a polygon around (0, 0), in native pixels. */
function arrowPoints(dir: string): [number, number][] {
  const angle = { '6': 0, '9': -45, '8': -90, '7': -135, '4': 180, '1': 135, '2': 90, '3': 45 }[dir] ?? 0;
  const shape: [number, number][] = [[-3.1, -0.95], [0.15, -0.95], [0.15, -2.75], [3.2, 0], [0.15, 2.75], [0.15, 0.95], [-3.1, 0.95]];
  const a = (angle * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  return shape.map(([x, y]) => [x * c - y * sn, x * sn + y * c]);
}

// ---- Screen ------------------------------------------------------------------------------------------------------------

type Page = 0 | 1;

function text(str: string, font = FontSize.SMALL, color = C.white, shadow = true): Text {
  const t = new Text(font, 0xffff, 0xffff, str).setColor(color).setWordWrap(false);
  if (shadow) t.setShadowColor(C.shadow).setShadow(GLYPH_SHADOW_RIGHT | GLYPH_SHADOW_BOTTOM);
  return t;
}

export class ControlsMenu extends Menu {
  page: Page = 0;
  private readonly shade = menuShade(304, 190);
  private readonly grid = menuBackground(304, 190, MenuBackgroundStyle.MENU);
  private keyboard: Surface | null = null;
  private keyboardUses = new Map<string, { player: number; icon: string }>();
  private controller: Surface | null = null;
  private controllerLayout = '';
  private controllerFamily: PadFamily | '' = '';
  /** The keys the players rebound themselves (CUSTOM), kept in the cycle: one press of ENTER is not the end of them. */
  private custom: { p1: KeyBindings; p2: KeyBindings; layout: 'classic' | 'modern' | 'custom' } | null = null;
  private keyboardLayoutKey = '';
  private texts = new Map<string, Text>();
  private glyphs = new Map<string, Surface>();
  private caps = keyboardKeys();

  /** A text (cached); `rtl`: laid out right to left whatever its letters (null: as they say, see isRtlParagraph). */
  private t(key: string, str: string, font = FontSize.SMALL, color = C.white, shadow = true, rtl: boolean | null = null): Text {
    const k = `${key}|${str}|${font}|${color}|${shadow}|${rtl}`;
    let v = this.texts.get(k);
    if (!v) {
      v = text(str, font, color, shadow);
      v.rtl = rtl;
      this.texts.set(k, v);
    }
    return v;
  }

  private drawCentered(key: string, str: string, cx: number, y: number, font = FontSize.SMALL, color = C.white, shadow = true): void {
    const t = this.t(key, str, font, color, shadow);
    // (the glyphs' advance includes a column of space after the last one)
    t.draw(Math.round(cx - (t.width() - 1) / 2), y);
  }

  /** A PlayStation symbol as a glyph of the font's height. */
  private glyph(sym: Sym, font: FontSize): Surface {
    const px = font === FontSize.BIG ? 8 : 6;
    const key = `${sym.sym}${px}`;
    let g = this.glyphs.get(key);
    if (!g) {
      const p = new Painter(px * S, px * S);
      psSymbol(p, sym.sym, px / 2, px / 2, px / 5.4, C.outline);
      g = p.toSurface(`controls/ps-glyph/${key}`);
      g.renderW = g.renderH = px;
      this.glyphs.set(key, g);
    }
    return g;
  }

  private partsWidth(key: string, parts: Part[], font: FontSize, color: number): number {
    let w = 0;
    parts.forEach((v, i) => (w += typeof v === 'string' ? this.t(`${key}${i}`, v, font, color).width() : this.glyph(v, font).renderW + 1));
    return w;
  }

  /**
   * A line of words and symbols: the first of `tries` that fits `maxW` (else the last), from x (or centered on x),
   * right to left in a right-to-left language.
   */
  private drawParts(key: string, tries: Part[][], x: number, y: number, font: FontSize, color: number, maxW: number, center = false): void {
    let parts = tries[tries.length - 1];
    for (const t of tries) {
      if (this.partsWidth(key, t, font, color) <= maxW) {
        parts = t;
        break;
      }
    }
    const w = this.partsWidth(key, parts, font, color);
    // (a line runs right to left as a text would: with its letters, the symbols counting as Latin ones)
    const rtl = isRtlParagraph(parts.map((v) => (typeof v === 'string' ? v : 'A')).join(''));
    let at = center ? Math.round(x - (w - 1) / 2) : x;
    for (const [v, k, toLeft] of rtl ? rtlOrder(parts) : parts.map((v, i) => [v, `${i}`, null] as const)) {
      if (typeof v === 'string') {
        const t = this.t(`${key}${k}`, v, font, color, true, toLeft);
        t.draw(at, y);
        at += t.width();
      } else {
        const g = this.glyph(v, font);
        // (centered on the letters: their middle is a little below the drawing position)
        video.drawSize(g, at, Math.round(y + (font === FontSize.BIG ? 3.6 : GLYPH_MID_Y) - g.renderH / 2), g.renderW, g.renderH);
        at += g.renderW + 1;
      }
    }
  }

  // ---- keyboard page ----

  private buildKeyboard(): void {
    const k = settings().keys;
    const sig = JSON.stringify([k.p1, k.p2, k.finisherKeys]);
    if (this.keyboard && sig === this.keyboardLayoutKey) return;
    this.keyboardLayoutKey = sig;
    this.keyboardUses.clear();
    [k.p1, k.p2].forEach((b, player) => {
      for (const [act, icon] of k.finisherKeys ? [...ACTIONS, ...FINISHER_ACTIONS] : ACTIONS) {
        for (const code of b[act] ?? []) if (!this.keyboardUses.has(code)) this.keyboardUses.set(code, { player, icon });
      }
    });
    const w = 23 * KB_UNIT, h = 5 * KB_UNIT;
    const p = new Painter(w * S, h * S);
    for (const cap of this.caps) {
      const x = cap.x * KB_UNIT, y = cap.row * KB_UNIT;
      const f = keyFace(cap);
      const use = this.keyboardUses.get(cap.code);
      p.roundRect(x * S, y * S, (cap.w * KB_UNIT - 1) * S, (cap.h * KB_UNIT - 1) * S, 2.5 * S, C.keyEdge);
      p.roundRect((x + f.x) * S, (y + f.y) * S, f.w * S, f.h * S, 2 * S, use ? (use.player === 0 ? C.keyP1 : C.keyP2) : C.keyFace);
      if (!use) p.roundRect((x + f.x + 0.75) * S, (y + f.y + 0.5) * S, (f.w - 1.5) * S, 1.25 * S, 0.6 * S, C.keyTop);
      // A direction's arrow, with a soft drop shadow, in the middle of the face.
      if (use && /^[1-9]$/.test(use.icon)) {
        const at = (dx: number, dy: number) => arrowPoints(use.icon).map(([ax, ay]) => [(x + f.cx + ax + dx) * S, (y + f.cy + ay + dy) * S] as [number, number]);
        p.polygon(at(0.4, 0.5), C.shadow);
        p.polygon(at(0, 0), C.white);
      }
    }
    this.keyboard = p.toSurface('controls/keyboard');
    this.keyboard.renderW = w;
    this.keyboard.renderH = h;
  }

  private renderKeyboardPage(): void {
    this.buildKeyboard();
    video.drawSize(this.keyboard!, KB_X, KB_Y, this.keyboard!.renderW, this.keyboard!.renderH);
    for (const cap of this.caps) {
      const f = keyFace(cap);
      const cx = KB_X + cap.x * KB_UNIT + f.cx, y = Math.round(KB_Y + cap.row * KB_UNIT + f.cy - GLYPH_MID_Y);
      const use = this.keyboardUses.get(cap.code);
      // (the arrows are part of the keyboard's image)
      if (use && (use.icon === 'P' || use.icon === 'K' || use.icon === 'S' || use.icon === 'F')) {
        const color = use.icon === 'P' ? C.punch : use.icon === 'K' ? C.kick : use.icon === 'S' ? C.special : C.b;
        this.drawCentered('kb', use.icon, cx, y, FontSize.SMALL, color);
      } else if (!use && cap.label) {
        this.drawCentered('kbl', cap.label, cx, y, FontSize.SMALL, C.dim, false);
      }
    }
    // Legend: what each player's keys do.
    const k = settings().keys;
    const short = (code: string | undefined) => keyName(code).replace('PAGE UP', 'PGUP').replace('PAGE DOWN', 'PGDN')
      .replace('KEYPAD ', 'KP').replace('RIGHT ', 'R.').replace('LEFT ', 'L.');
    // (a key named "/" reads badly between the " / " separators)
    const names = (codes: string[]) => codes.slice(0, 2).map((c) => (c === 'Slash' ? tr('SLASH') : short(c))).join(' / ') || '-';
    const rows: [string, (b: KeyBindings) => string][] = [
      [tr('JUMP'), (b) => names(b.jumpUp)],
      [tr('WALK'), (b) => `${short(b.walkBack[0])}  ${short(b.walkRight[0])}`],
      [tr('DUCK'), (b) => names(b.duck)],
      [tr('DIAGONALS'), (b) => (b.jumpLeft.length ? [b.jumpLeft, b.jumpRight, b.duckBack, b.duckForward].map((c) => short(c[0])).join(' ')
        : tr('TWO KEYS AT ONCE'))],
      [tr('PUNCH'), (b) => names(b.punch)],
      [tr('KICK'), (b) => names(b.kick)],
      [tr('SPECIAL'), (b) => (settings().keys.specialButton ? names(b.special ?? []) : tr('OFF'))],
    ];
    // (the finisher keys when they are on: scrap, destruction, Fire & Ice; the rows a little closer)
    if (k.finisherKeys) rows.push([tr('FINISHERS'), (b) => [b.scrap, b.destruction, b.fireIce].map((c) => short(c?.[0])).join(' ')]);
    const step = rows.length > 7 ? 7 : 8;
    const y0 = 104;
    this.t('h', tr('PLAYER 1'), FontSize.SMALL, C.p1).draw(84, y0);
    this.t('h', tr('PLAYER 2'), FontSize.SMALL, C.p2).draw(200, y0);
    rows.forEach(([label, f], i) => {
      const y = y0 + 10 + i * step;
      const color = label === tr('PUNCH') ? C.punch : label === tr('KICK') ? C.kick : label === tr('SPECIAL') ? C.special
        : label === tr('FINISHERS') ? C.b : C.lightGrey;
      this.t('l', label, FontSize.SMALL, color).draw(22, y);
      this.t('v', clip(f(k.p1), 18), FontSize.SMALL, C.white).draw(84, y);
      this.t('v', clip(f(k.p2), 16), FontSize.SMALL, C.white).draw(200, y);
    });
  }

  // ---- controller page ----

  private buildController(): void {
    const layout = getPadLayout();
    const family = shownFamily();
    if (this.controller && this.controllerLayout === layout && this.controllerFamily === family) return;
    this.controllerLayout = layout;
    this.controllerFamily = family;
    const p = new Painter(PAD_W * S, PAD_H * S);
    // (all in native pixels)
    const rr = (x: number, y: number, w: number, h: number, r: number, c: number) => p.roundRect(x * S, y * S, w * S, h * S, r * S, c);
    const circle = (x: number, y: number, r: number, c: number) => p.circle(x * S, y * S, r * S, c);
    const shape = (pts: [number, number][], c: number) => p.smoothShape(pts.map(([x, y]) => [x * S, y * S] as [number, number]), c);
    // Triggers behind the bumpers, the bumpers along the top edge.
    for (const [x] of PAD.triggers) {
      rr(x - 13, 1, 26, 15, 5, C.outline);
      rr(x - 12, 2, 24, 14, 4.2, C.stick);
    }
    for (const [x] of PAD.bumpers) {
      rr(x - 21, 9, 42, 11, 5.5, C.outline);
      rr(x - 20, 10, 40, 9.5, 4.8, C.bodyDark);
    }
    // The body, outlined, with a lighter bevel along its top.
    shape(PAD_BODY, C.body);
    p.outline([C.body], C.outline, Math.round(0.9 * S));
    shape(PAD_BEVEL, C.bodyLight);
    // Sticks, the d-pad, the middle buttons and the guide button.
    const stick = ([x, y]: [number, number]) => {
      circle(x, y, 10.5, C.outline);
      circle(x, y, 9.6, C.stickDark);
      circle(x, y, 7, C.stick);
      p.ring(x * S, y * S, 7 * S, 0.9 * S, C.grey);
    };
    // (a PlayStation pad has its d-pad above its left stick)
    const ps = family === 'playstation';
    stick(ps ? PAD.dpad : PAD.leftStick);
    stick(PAD.rightStick);
    const [dx, dy] = ps ? PAD.leftStick : PAD.dpad;
    circle(dx, dy, 10.5, C.outline);
    circle(dx, dy, 9.6, C.stickDark);
    rr(dx - 2.7, dy - 8, 5.4, 16, 1.2, C.stick);
    rr(dx - 8, dy - 2.7, 16, 5.4, 1.2, C.stick);
    for (const [x, y] of [PAD.view, PAD.menu]) {
      circle(x, y, 3.3, C.outline);
      circle(x, y, 2.5, C.stick);
    }
    rr(PAD.share[0] - 2.6, PAD.share[1] - 1.5, 5.2, 3, 1.4, C.stick);
    circle(PAD.guide[0], PAD.guide[1], 6, C.outline);
    circle(PAD.guide[0], PAD.guide[1], 5.1, C.lightGrey);
    // Face buttons, ringed in the color of their action (their letters are drawn over them).
    const modern = layout === 'modern';
    const role = (btn: string) => (modern ? (btn === 'X' || btn === 'Y' ? 'P' : 'K') : (btn === 'A' || btn === 'X' ? 'P' : 'K'));
    for (const [btn, x, y] of PAD.face) {
      circle(x, y, 5.8, role(btn) === 'P' ? C.punch : C.kick);
      circle(x, y, 4.8, C.outline);
      circle(x, y, 4.2, C.stickDark);
      if (ps) psSymbol(p, btn, x, y);
    }
    this.controller = p.toSurface(`controls/controller/${family}`);
    this.controller.renderW = PAD_W;
    this.controller.renderH = PAD_H;
  }

  private renderControllerPage(): void {
    this.buildController();
    const ox = PAD_X, oy = PAD_Y;
    video.drawSize(this.controller!, ox, oy, PAD_W, PAD_H);
    // The face buttons' letters in their colors, the shoulder buttons' names on them.
    const label = (s: string, x: number, y: number, color: number) =>
      this.drawCentered('btn', s, ox + x, Math.round(oy + y - GLYPH_MID_Y), FontSize.SMALL, color);
    // (the letters an Xbox or a Nintendo pad has on its face buttons, by their place; a PlayStation pad's symbols are drawn)
    const family = this.controllerFamily || 'xbox';
    const names = padNames(family);
    const place: Record<string, keyof PadNames> = { A: 'south', B: 'east', X: 'west', Y: 'north' };
    const colors: Record<string, number> = { A: C.a, B: C.b, X: C.x, Y: C.y };
    if (family !== 'playstation') {
      for (const [btn, x, y] of PAD.face) label(String(names[place[btn]]), x, y, family === 'nintendo' ? C.lightGrey : colors[btn]);
    }
    PAD.bumpers.forEach(([x, y], i) => label(i ? names.rb : names.lb, x, y, C.lightGrey));
    PAD.triggers.forEach(([x, y], i) => label(i ? names.rt : names.lt, x, y, C.lightGrey));
    const modern = getPadLayout() === 'modern';
    const join = (...b: Part[]): Part[] => textParts(b.map((_, i) => `{${i}}`).join('  '), Object.fromEntries(b.map((v, i) => [String(i), v])));
    const rows: [string, Part[], number][] = [
      [tr('MOVE'), [tr('D-PAD / LEFT STICK')], C.lightGrey],
      [tr('PUNCH'), modern ? join(names.west, names.north, names.rb) : join(names.south, names.west, names.lb), C.punch],
      [tr('KICK'), modern ? join(names.south, names.east, names.rt) : join(names.east, names.north, names.rb), C.kick],
      [tr('SPECIAL'), settings().keys.specialButton ? (modern ? join(names.lt, names.lb) : join(names.lt, names.rt)) : [tr('OFF')], C.special],
      [tr('PAUSE'), [names.menu], C.lightGrey],
      [tr('MENUS'), textParts(tr('{a} SELECT  {b} BACK'), { a: names.south, b: names.east }), C.lightGrey],
    ];
    rows.forEach(([label, value, color], i) => {
      const y = 50 + i * 16;
      this.t('cl', label, FontSize.SMALL, color).draw(172, y);
      this.drawParts(`cv${i}`, [value, tighter(value)], 172, y + 7, FontSize.SMALL, C.white, ROW_W);
    });
    // Connected controllers and who plays with them.
    const pads = connectedPads();
    const k = settings().keys;
    let y = 146;
    if (pads.length === 0) {
      this.drawCentered('st', tr('NO CONTROLLER: CONNECT ONE AND PRESS A BUTTON'), 160, y, FontSize.SMALL, C.dim);
    } else {
      // (as the game hands them out: pads chosen for a player, then the free ones to the keyboard players in order)
      const chosen = [k.ctrlType1 === CtrlType.GAMEPAD ? k.gamepad1 : -1, k.ctrlType2 === CtrlType.GAMEPAD ? k.gamepad2 : -1];
      const free = pads.filter((p) => !chosen.includes(p));
      pads.slice(0, 2).forEach((pad, i) => {
        const auto = [0, 1].find((pl) => autoPadSlot(pl) >= 0 && free[autoPadSlot(pl)] === pad);
        const assigned = chosen[0] === pad ? 1 : chosen[1] === pad ? 2 : auto !== undefined ? auto + 1 : 0;
        const who = assigned ? tr('PLAYER {assigned}', { assigned }) : tr('MENUS ONLY');
        const name = padName(pad).toUpperCase().slice(0, 30) || tr('CONTROLLER {n}', { n: i + 1 });
        this.drawCentered('st', `${name}: ${who}`, 160, y + i * 8, FontSize.SMALL, assigned === 2 ? C.p2 : C.p1);
      });
    }
  }

  // ---- common ----

  override render(): void {
    video.drawRemap(this.shade, 8, 5, 4, 1, 0);
    video.draw(this.grid, 8, 5);
    this.drawCentered('title', tr('CONTROLS'), 160, 9, FontSize.BIG, TEXT_TITLE);
    // Tabs.
    const tabs = [tr('KEYBOARD'), tr('CONTROLLER')];
    tabs.forEach((name, i) => {
      const x = i === 0 ? 108 : 212;
      this.drawCentered('tab', name, x, 22, FontSize.BIG, i === this.page ? TEXT_ACTIVE : TEXT_NORMAL);
    });
    // (the arrows outside the tabs' names: Swedish HANDKONTROLL reaches the right one's place)
    const half = (i: number) => (this.t('tab', tabs[i], FontSize.BIG, i === this.page ? TEXT_ACTIVE : TEXT_NORMAL).width() - 1) / 2;
    drawDir('4', Math.min(52, Math.round(108 - half(0)) - 12), 22, TEXT_TITLE);
    drawDir('6', Math.max(262, Math.round(212 + half(1)) + 6), 22, TEXT_TITLE);
    if (this.page === 0) this.renderKeyboardPage();
    else this.renderControllerPage();
    // Layout choice and hints.
    const names = padNames(this.page === 0 ? 'xbox' : this.controllerFamily || 'xbox');
    if (this.page === 0) {
      const layout = detectKeyLayout() === 'custom' ? tr('CUSTOM') : detectKeyLayout() === 'modern' ? tr('MODERN (WASD)') : tr('CLASSIC');
      this.drawCentered('choice', tr('LAYOUT: {layout}', { layout }), 160, 170, FontSize.BIG, TEXT_ACTIVE);
    } else {
      // (the buttons in the layout's name; only its name when that is too long)
      const modern = getPadLayout() === 'modern';
      const full = modern
        ? textParts(tr('BUTTONS: {layout}', { layout: tr('MODERN ({punch} PUNCH, {kick} KICK)') }), { punch: names.west, kick: names.south })
        : textParts(tr('BUTTONS: {layout}', { layout: tr('CLASSIC ({punch} PUNCH, {kick} KICK)') }), { punch: names.south, kick: names.east });
      const short = [tr('BUTTONS: {layout}', { layout: modern ? tr('MODERN') : tr('CLASSIC') })];
      this.drawParts('choice', [full, short], 160, 170, FontSize.BIG, TEXT_ACTIVE, LINE_W, true);
    }
    const hint = textParts(tr('ENTER/{a} CHANGE   LEFT/RIGHT PAGE   ESC/{b} BACK'), { a: names.south, b: names.east });
    this.drawParts('hint', [hint, tighter(hint)], 160, 184, FontSize.SMALL, C.dim, LINE_W, true);
  }

  /** Switches the layout shown on the current page. */
  private cycleLayout(): void {
    if (this.page === 0) {
      // CUSTOM -> CLASSIC -> MODERN (WASD) -> CUSTOM again
      const k = settings().keys;
      const now = detectKeyLayout();
      if (now === 'custom') {
        this.custom = structuredClone({ p1: k.p1, p2: k.p2, layout: k.layout });
        applyKeyLayout('classic');
      } else if (now === 'classic' || !this.custom) {
        applyKeyLayout(now === 'classic' ? 'modern' : 'classic');
      } else {
        Object.assign(k.p1, structuredClone(this.custom.p1));
        Object.assign(k.p2, structuredClone(this.custom.p2));
        k.layout = this.custom.layout;
      }
    } else {
      settings().keys.padLayout = getPadLayout() === 'modern' ? 'classic' : 'modern';
      applyPadSettings();
    }
    saveSettings();
    playMenuSound(20);
  }

  override action(action: number, _source: CtrlType): number {
    if (action === ACT_LEFT || action === ACT_RIGHT || action === ACT_UP || action === ACT_DOWN) {
      this.page = this.page === 0 ? 1 : 0;
      playMenuSound(19);
      return 1;
    }
    if (action === ACT_PUNCH || action === ACT_KICK) {
      this.cycleLayout();
      return 1;
    }
    return 0;
  }

  /** Mouse: clicking a tab shows it, clicking the layout line changes it. */
  override pointer(x: number, y: number, kind: PointerKind): boolean {
    if (kind !== 'click') return false;
    if (y >= 20 && y < 32) {
      const page: Page = x < 160 ? 0 : 1;
      if (page !== this.page) {
        this.page = page;
        playMenuSound(19);
      }
      return true;
    }
    if (y >= 166 && y < 180) {
      this.cycleLayout();
      return true;
    }
    return false;
  }
}
