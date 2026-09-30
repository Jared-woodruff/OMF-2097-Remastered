// Controls screen: a keyboard showing both players' keys and an Xbox controller showing its buttons, with the layout
// choices (keyboard: classic / modern; controller: modern / classic). Opened from OPTIONS > CONTROLS > KEYS AND BUTTONS and the
// pause menu; shown by the help overlay (helpOverlay.ts) on the main menu backdrop.
import { connectedPads, getPadLayout, padName } from '../../controller/input';
import type { PointerKind } from '../../controller/mouse';
import { video } from '../../video/draw';
import type { Surface } from '../../video/surface';
import { vga } from '../../video/vga';
import { ACT_DOWN, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, ACT_UP, CtrlType } from '../constants';
import { applyKeyLayout, applyPadSettings, detectKeyLayout } from '../controls';
import { keyName } from '../scenes/mainmenu/keyNames';
import { saveSettings, settings, type KeyBindings } from '../settings';
import { drawDir } from './inputIcons';
import { Painter } from './painter';
import { FontSize, GLYPH_SHADOW_BOTTOM, GLYPH_SHADOW_RIGHT, HAlign, Text } from './text';
import { Menu, MenuBackgroundStyle, menuBackground, menuShade, playMenuSound } from './widgets';

/** Palette entries the screen sets while it is open (unused by the main menu's backdrop and its shading). */
const C = {
  bodyDark: 0x60, body: 0x61, bodyLight: 0x62, outline: 0x63, stickDark: 0x64, stick: 0x65,
  a: 0x66, b: 0x67, x: 0x68, y: 0x69, white: 0x6a, lightGrey: 0x6b, grey: 0x6c,
  keyP1: 0x6d, keyP2: 0x6e, keyFace: 0x6f, keyEdge: 0x70, keyTop: 0x71, punch: 0x72, kick: 0x73, dim: 0x74,
  bright: 0x75, p1: 0x76, p2: 0x77, shadow: 0x78, special: 0x79,
};
const COLORS: [number, number, number, number][] = [
  [C.bodyDark, 0x1c, 0x1f, 0x25], [C.body, 0x31, 0x36, 0x40], [C.bodyLight, 0x4a, 0x51, 0x5e], [C.outline, 0x08, 0x09, 0x0c],
  [C.stickDark, 0x13, 0x15, 0x19], [C.stick, 0x2a, 0x2e, 0x36], [C.a, 0x45, 0xbe, 0x3c], [C.b, 0xe2, 0x3d, 0x3d],
  [C.x, 0x3c, 0x7c, 0xe6], [C.y, 0xee, 0xbd, 0x2a], [C.white, 0xf2, 0xf4, 0xf7], [C.lightGrey, 0xaa, 0xb2, 0xbd],
  [C.grey, 0x6b, 0x73, 0x7f], [C.keyP1, 0x23, 0x5e, 0xa3], [C.keyP2, 0xb0, 0x5a, 0x1c], [C.keyFace, 0x2c, 0x30, 0x38],
  [C.keyEdge, 0x12, 0x14, 0x18], [C.keyTop, 0x3d, 0x42, 0x4c], [C.punch, 0xff, 0xb0, 0x30], [C.kick, 0x55, 0xdc, 0xff],
  [C.dim, 0x7c, 0x86, 0x94], [C.bright, 0xdd, 0xe9, 0xff], [C.p1, 0x7c, 0xbe, 0xff], [C.p2, 0xff, 0xa8, 0x5c],
  [C.shadow, 0x05, 0x06, 0x08], [C.special, 0x6e, 0xe8, 0x74],
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
      keys.push({ code, label, x, row: r, w, h: 1 });
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

const KB_UNIT = 12;
const KB_X = 22;
const KB_Y = 38;
/** Painter pixels per native pixel (sharp at 1440p; the classic renderer samples them down). */
const S = 8;
/** Where a label's glyphs sit in the small font: the visible center is this far below the drawing position. */
const GLYPH_MID_Y = 2.95;

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
  private keyboardLayoutKey = '';
  private texts = new Map<string, Text>();
  private caps = keyboardKeys();

  private t(key: string, str: string, font = FontSize.SMALL, color = C.white, shadow = true): Text {
    const k = `${key}|${str}|${font}|${color}|${shadow}`;
    let v = this.texts.get(k);
    if (!v) {
      v = text(str, font, color, shadow);
      this.texts.set(k, v);
    }
    return v;
  }

  private drawCentered(key: string, str: string, cx: number, y: number, font = FontSize.SMALL, color = C.white, shadow = true): void {
    const t = this.t(key, str, font, color, shadow);
    // (the glyphs' advance includes a column of space after the last one)
    t.draw(Math.round(cx - (t.width() - 1) / 2), y);
  }

  // ---- keyboard page ----

  private buildKeyboard(): void {
    const k = settings().keys;
    const sig = JSON.stringify([k.p1, k.p2]);
    if (this.keyboard && sig === this.keyboardLayoutKey) return;
    this.keyboardLayoutKey = sig;
    this.keyboardUses.clear();
    [k.p1, k.p2].forEach((b, player) => {
      for (const [act, icon] of ACTIONS) {
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
      if (use && (use.icon === 'P' || use.icon === 'K' || use.icon === 'S')) {
        const color = use.icon === 'P' ? C.punch : use.icon === 'K' ? C.kick : C.special;
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
    const names = (codes: string[]) => codes.slice(0, 2).map((c) => (c === 'Slash' ? 'SLASH' : short(c))).join(' / ') || '-';
    const rows: [string, (b: KeyBindings) => string][] = [
      ['JUMP', (b) => names(b.jumpUp)],
      ['WALK', (b) => `${short(b.walkBack[0])}  ${short(b.walkRight[0])}`],
      ['DUCK', (b) => names(b.duck)],
      ['DIAGONALS', (b) => (b.jumpLeft.length ? [b.jumpLeft, b.jumpRight, b.duckBack, b.duckForward].map((c) => short(c[0])).join(' ')
        : 'TWO KEYS AT ONCE')],
      ['PUNCH', (b) => names(b.punch)],
      ['KICK', (b) => names(b.kick)],
      ['SPECIAL', (b) => (settings().keys.specialButton ? names(b.special ?? []) : 'OFF')],
    ];
    const y0 = 104;
    this.t('h', 'PLAYER 1', FontSize.SMALL, C.p1).draw(84, y0);
    this.t('h', 'PLAYER 2', FontSize.SMALL, C.p2).draw(200, y0);
    rows.forEach(([label, f], i) => {
      const y = y0 + 10 + i * 8;
      const color = label === 'PUNCH' ? C.punch : label === 'KICK' ? C.kick : label === 'SPECIAL' ? C.special : C.lightGrey;
      this.t('l', label, FontSize.SMALL, color).draw(22, y);
      this.t('v', f(k.p1).slice(0, 18), FontSize.SMALL, C.white).draw(84, y);
      this.t('v', f(k.p2).slice(0, 16), FontSize.SMALL, C.white).draw(200, y);
    });
  }

  // ---- controller page ----

  private buildController(): void {
    const layout = getPadLayout();
    if (this.controller && this.controllerLayout === layout) return;
    this.controllerLayout = layout;
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
    stick(PAD.leftStick);
    stick(PAD.rightStick);
    const [dx, dy] = PAD.dpad;
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
    }
    this.controller = p.toSurface('controls/controller');
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
    const colors: Record<string, number> = { A: C.a, B: C.b, X: C.x, Y: C.y };
    for (const [btn, x, y] of PAD.face) label(btn, x, y, colors[btn]);
    PAD.bumpers.forEach(([x, y], i) => label(i ? 'RB' : 'LB', x, y, C.lightGrey));
    PAD.triggers.forEach(([x, y], i) => label(i ? 'RT' : 'LT', x, y, C.lightGrey));
    const modern = getPadLayout() === 'modern';
    const rows: [string, string, number][] = [
      ['MOVE', 'D-PAD / LEFT STICK', C.lightGrey],
      ['PUNCH', modern ? 'X  Y  RB' : 'A  X  LB', C.punch],
      ['KICK', modern ? 'A  B  RT' : 'B  Y  RB', C.kick],
      ['SPECIAL', settings().keys.specialButton ? (modern ? 'LT  LB' : 'LT  RT') : 'OFF', C.special],
      ['PAUSE', 'MENU BUTTON', C.lightGrey],
      ['MENUS', 'A SELECT  B BACK', C.lightGrey],
    ];
    rows.forEach(([label, value, color], i) => {
      const y = 50 + i * 16;
      this.t('cl', label, FontSize.SMALL, color).draw(172, y);
      this.t('cv', value, FontSize.SMALL, C.white).draw(172, y + 7);
    });
    // Connected controllers and who plays with them.
    const pads = connectedPads();
    const k = settings().keys;
    let y = 146;
    if (pads.length === 0) {
      this.drawCentered('st', 'NO CONTROLLER: CONNECT ONE AND PRESS A BUTTON', 160, y, FontSize.SMALL, C.dim);
    } else {
      pads.slice(0, 2).forEach((pad, i) => {
        const assigned = k.ctrlType1 === CtrlType.GAMEPAD && k.gamepad1 === pad ? 1 : k.ctrlType2 === CtrlType.GAMEPAD && k.gamepad2 === pad ? 2
          : k.autoPads ? i + 1 : 0;
        const who = assigned ? `PLAYER ${assigned}` : 'MENUS ONLY';
        const name = padName(pad).toUpperCase().slice(0, 30) || `CONTROLLER ${i + 1}`;
        this.drawCentered('st', `${name}: ${who}`, 160, y + i * 8, FontSize.SMALL, assigned === 2 ? C.p2 : C.p1);
      });
    }
  }

  // ---- common ----

  override render(): void {
    video.drawRemap(this.shade, 8, 5, 4, 1, 0);
    video.draw(this.grid, 8, 5);
    this.drawCentered('title', 'CONTROLS', 160, 9, FontSize.BIG, TEXT_TITLE);
    // Tabs.
    const tabs = ['KEYBOARD', 'CONTROLLER'];
    tabs.forEach((name, i) => {
      const x = i === 0 ? 108 : 212;
      this.drawCentered('tab', name, x, 22, FontSize.BIG, i === this.page ? TEXT_ACTIVE : TEXT_NORMAL);
    });
    drawDir('4', 52, 22, TEXT_TITLE);
    drawDir('6', 262, 22, TEXT_TITLE);
    if (this.page === 0) this.renderKeyboardPage();
    else this.renderControllerPage();
    // Layout choice and hints.
    const choice = this.page === 0
      ? `LAYOUT: ${detectKeyLayout() === 'custom' ? 'CUSTOM' : detectKeyLayout() === 'modern' ? 'MODERN (WASD)' : 'CLASSIC'}`
      : `BUTTONS: ${getPadLayout() === 'modern' ? 'MODERN (X PUNCH, A KICK)' : 'CLASSIC (A PUNCH, B KICK)'}`;
    this.drawCentered('choice', choice, 160, 170, FontSize.BIG, TEXT_ACTIVE);
    this.drawCentered('hint', 'ENTER/A CHANGE   LEFT/RIGHT PAGE   ESC/B BACK', 160, 184, FontSize.SMALL, C.dim);
  }

  /** Switches the layout shown on the current page. */
  private cycleLayout(): void {
    if (this.page === 0) {
      applyKeyLayout(detectKeyLayout() === 'classic' ? 'modern' : 'classic');
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
