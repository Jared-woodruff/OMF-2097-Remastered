// Controls screen: a keyboard showing both players' keys and an Xbox controller showing its buttons, with the layout
// choices (keyboard: classic / modern; controller: modern / classic). Opened from CONFIGURATION > CONTROLS and the
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
const S = 4;

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

  private drawCentered(key: string, str: string, cx: number, y: number, font = FontSize.SMALL, color = C.white): void {
    const t = this.t(key, str, font, color);
    t.draw(Math.round(cx - t.width() / 2), y);
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
      const x = cap.x * KB_UNIT * S, y = cap.row * KB_UNIT * S;
      const cw = cap.w * KB_UNIT * S - S, ch = cap.h * KB_UNIT * S - S;
      const use = this.keyboardUses.get(cap.code);
      p.roundRect(x, y, cw, ch, 2.5 * S, C.keyEdge);
      p.roundRect(x + S * 0.75, y + S * 0.5, cw - S * 1.5, ch - S * 1.75, 2 * S,
        use ? (use.player === 0 ? C.keyP1 : C.keyP2) : C.keyFace);
      if (!use) p.roundRect(x + S * 1.5, y + S * 1.0, cw - S * 3, S * 1.5, S, C.keyTop);
    }
    this.keyboard = p.toSurface('controls/keyboard');
    this.keyboard.renderW = w;
    this.keyboard.renderH = h;
  }

  private renderKeyboardPage(): void {
    this.buildKeyboard();
    video.drawSize(this.keyboard!, KB_X, KB_Y, this.keyboard!.renderW, this.keyboard!.renderH);
    for (const cap of this.caps) {
      const x = KB_X + cap.x * KB_UNIT, y = KB_Y + cap.row * KB_UNIT;
      const cx = x + (cap.w * KB_UNIT - 1) / 2, cy = y + (cap.h * KB_UNIT - 1) / 2;
      const use = this.keyboardUses.get(cap.code);
      if (use) {
        if (use.icon === 'P' || use.icon === 'K' || use.icon === 'S') {
          const color = use.icon === 'P' ? C.punch : use.icon === 'K' ? C.kick : C.special;
          this.drawCentered('kb', use.icon, cx, Math.round(cy - 3), FontSize.SMALL, color);
        } else {
          drawDir(use.icon, Math.round(cx - 3.5), Math.round(cy - 3.5), C.white, C.shadow);
        }
      } else if (cap.label) {
        this.drawCentered('kb', cap.label, cx, Math.round(cy - 3), FontSize.SMALL, C.dim);
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
    const W = 150, H = 100;
    const p = new Painter(W * S, H * S);
    const body = (grow: number, color: number) => {
      p.roundRect(90 - grow, 44 - grow, 420 + 2 * grow, 180 + 2 * grow, 72 + grow, color);
      p.capsule(165, 170, 100, 330, 70 + grow, color);
      p.capsule(435, 170, 500, 330, 70 + grow, color);
    };
    // Triggers and bumpers behind the body.
    p.roundRect(142, 0, 76, 34, 14, C.outline);
    p.roundRect(146, 4, 68, 30, 11, C.stick);
    p.roundRect(382, 0, 76, 34, 14, C.outline);
    p.roundRect(386, 4, 68, 30, 11, C.stick);
    p.roundRect(112, 28, 130, 36, 16, C.outline);
    p.roundRect(116, 32, 122, 30, 13, C.bodyDark);
    p.roundRect(358, 28, 130, 36, 16, C.outline);
    p.roundRect(362, 32, 122, 30, 13, C.bodyDark);
    body(6, C.outline);
    body(0, C.body);
    // A lighter upper face.
    p.roundRect(118, 56, 364, 96, 60, C.bodyLight);
    p.roundRect(118, 84, 364, 120, 60, C.body);
    // Sticks, d-pad, middle buttons.
    const stick = (x: number, y: number) => {
      p.circle(x, y, 46, C.outline);
      p.circle(x, y, 42, C.stickDark);
      p.circle(x, y, 32, C.stick);
      p.ring(x, y, 32, 4, C.grey);
    };
    stick(190, 118);
    stick(388, 214);
    p.circle(238, 214, 46, C.outline);
    p.circle(238, 214, 42, C.stickDark);
    p.roundRect(226, 180, 24, 68, 6, C.stick);
    p.roundRect(204, 202, 68, 24, 6, C.stick);
    p.circle(262, 122, 13, C.outline);
    p.circle(262, 122, 10, C.stick);
    p.circle(338, 122, 13, C.outline);
    p.circle(338, 122, 10, C.stick);
    p.circle(300, 78, 22, C.outline);
    p.circle(300, 78, 18, C.lightGrey);
    // Face buttons, ringed in the color of their action.
    const modern = layout === 'modern';
    const role = (btn: string) => (modern ? (btn === 'X' || btn === 'Y' ? 'P' : 'K') : (btn === 'A' || btn === 'X' ? 'P' : 'K'));
    const face: [string, number, number, number][] = [['Y', 420, 88, C.y], ['X', 378, 130, C.x], ['B', 462, 130, C.b], ['A', 420, 172, C.a]];
    for (const [btn, x, y, color] of face) {
      p.circle(x, y, 27, role(btn) === 'P' ? C.punch : C.kick);
      p.circle(x, y, 22, C.outline);
      p.circle(x, y, 19, color);
    }
    this.controller = p.toSurface('controls/controller');
    this.controller.renderW = W;
    this.controller.renderH = H;
  }

  private renderControllerPage(): void {
    this.buildController();
    const ox = 14, oy = 42;
    video.drawSize(this.controller!, ox, oy, 150, 100);
    // Button letters, and the shoulder buttons' names.
    const letter = (s: string, x: number, y: number) => this.drawCentered('btn', s, ox + x / S, Math.round(oy + y / S - 3), FontSize.SMALL, C.white);
    letter('Y', 420, 88);
    letter('X', 378, 130);
    letter('B', 462, 130);
    letter('A', 420, 172);
    letter('LB', 177, 50);
    letter('RB', 423, 50);
    this.drawCentered('btn', 'LT', ox + 180 / S, oy - 8, FontSize.SMALL, C.lightGrey);
    this.drawCentered('btn', 'RT', ox + 420 / S, oy - 8, FontSize.SMALL, C.lightGrey);
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
