// MULTIPLAYER > LAN: network games on the local network (net/lan.ts). The player's name, hosting a game (it waits for a
// player to join, the page showing this computer's address to tell them; the game starts as soon as one does), joining
// one by its address, and the games found on the network, looked for again every few seconds while the page is open.
// Once the two games have agreed, both show who plays whom and on which side for a moment, then the page closes and
// both go to the robot select screen (net/netplay.ts).
import type { PointerKind } from '../controller/mouse';
import { ACT_DOWN, ACT_KICK, ACT_PUNCH, ACT_UP, type CtrlType } from '../game/constants';
import type { GameState } from '../game/gameState';
import { Page, PAGE_TITLE, PC } from '../game/gui/page';
import { FontSize, HAlign, Text, VAlign } from '../game/gui/text';
import { playMenuSound } from '../game/gui/widgets';
import { typedChar, type TypedKey } from '../game/scenes/mainmenu/keyNames';
import { saveSettings, settings } from '../game/settings';
import { APP_VERSION } from '../platform/versionLabel';
import { video } from '../video/draw';
import { Surface } from '../video/surface';
import { guestHandshake, hostHandshake } from './handshake';
import { lanBackend, type LanBackend, type LanGame, type LanHosting } from './lan';
import type { NetLink } from './link';
import { hostRules, netContent, startNetGame } from './netplay';
import { cleanName, LAN_PORT, type NetContent, type NetMessage, type NetRules } from './protocol';
import { NetSession } from './session';
import { clip, langInfo, tr } from '../i18n/i18n';

type State = 'menu' | 'hosting' | 'joining' | 'starting';

/** A game both sides have agreed to, shown for a moment before it starts. */
interface Match {
  link: NetLink;
  localPlayer: 0 | 1;
  names: [string, string];
  rules: NetRules;
  seed: number;
  /** When it starts (performance.now()). */
  at: number;
}

const ROW_NAME = 0;
const ROW_HOST = 1;
const ROW_ADDRESS = 2;
/** The rows' tops (native pixels) and height. */
const ROW_Y = 46;
const ROW_H = 16;
/** The found games' list: its first row's top, row height, and how many show. */
const GAMES_Y = 112;
const GAME_H = 13;
const GAMES_SHOWN = 4;
/** How often the network is searched (ms). */
const SCAN_EVERY_MS = 2500;
const ADDRESS_MAX = 40;
/** How long both games show the match before it starts (ms). */
const MATCH_MS = 2200;

function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).toUpperCase();
}

/**
 * What the computer's system may ask before the game can use the network, or what to open for it (the desktop app's
 * system: LanBackend.info; '' when it is not known).
 */
export function networkHint(os: string): string {
  switch (os) {
    case 'windows': return tr('If Windows asks, let the game use private networks.');
    // (macOS asks for the local network once, from macOS 15 on; turned down, the game finds nothing; its firewall, when on,
    // asks for the incoming connections)
    case 'macos': return tr('If your Mac asks, allow the game to use the local network and incoming connections.');
    case 'linux': return tr('If a firewall is on, open port {port} (TCP and UDP) for the game.', { port: LAN_PORT });
    default: return '';
  }
}

/** The found games in a steady order (the answers come in any order): by name, then by address. */
function byName(a: LanGame, b: LanGame): number {
  const x = a.name.toUpperCase(), y = b.name.toUpperCase();
  if (x !== y) return x < y ? -1 : 1;
  return a.address < b.address ? -1 : a.address > b.address ? 1 : 0;
}

/** What a failed join says (the desktop app's errors are the system's). */
function joinError(e: unknown, address: string): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/refused|10061|ECONNREFUSED/i.test(m)) return tr('NO GAME IS HOSTED AT {address}.', { address: address.toUpperCase() });
  if (/timed out|10060|ETIMEDOUT|unreachable|10065|10051/i.test(m)) {
    return tr('{address} DID NOT ANSWER: IS IT ON THIS NETWORK, AND THE GAME ALLOWED THROUGH ITS FIREWALL?', { address: address.toUpperCase() });
  }
  if (/no computer by that name|not known|11001|failed to lookup/i.test(m)) return tr('NO COMPUTER IS CALLED {address}.', { address: address.toUpperCase() });
  return errorText(e);
}

export class LanPage extends Page {
  private readonly backend: LanBackend | null = lanBackend();
  private state: State = 'menu';
  private row = ROW_HOST;
  private games: LanGame[] = [];
  private gamesTop = 0;
  private status = '';
  private statusColor = PC.dim;
  private addresses: string[] = [];
  private port = LAN_PORT;
  private hosting: LanHosting | null = null;
  /** The game being joined (its name, or its address), and whether its computer has answered. */
  private joining = '';
  private connected = false;
  /** The game agreed, about to start. */
  private match: Match | null = null;
  /** A guest is being greeted (one at a time). */
  private greeting = false;
  /** Bumped when what is under way is cancelled: what it was waiting for is dropped when it comes. */
  private attempt = 0;
  private isOpen = false;
  private scanning = false;
  private lastScan = -Infinity;
  /** The last search could not go out (no network, or the system did not let the game use it). */
  private scanFailed = false;
  /** This computer's system ('windows', 'macos', 'linux'; '' when not known). */
  private os = '';
  private content: NetContent | null = null;
  private dot: Surface | null = null;
  private wrapped = new Map<string, Text>();

  constructor(private gs: GameState) {
    super();
  }

  /** The player's name in the game (PLAYER when they have emptied it). */
  private get name(): string {
    // (a name is sent in the letters A-Z, 0-9: protocol.ts cleanName; so is this one, untranslated)
    return cleanName(settings().lan.name) || 'PLAYER';
  }

  override onOpen(): void {
    this.isOpen = true;
    this.state = 'menu';
    this.row = ROW_HOST;
    this.games = [];
    this.scanFailed = false;
    this.lastScan = -Infinity;
    this.setStatus('');
    const b = this.backend;
    if (!b) return;
    // (the computer's user name, until the player types one; PLAYER when it has none)
    const nameDefault = (name: string) => {
      if (settings().lan.name) return;
      settings().lan.name = cleanName(name) || 'PLAYER';
      saveSettings();
    };
    void b.info().then((info) => {
      this.addresses = info.addresses;
      this.os = info.os ?? '';
      nameDefault(info.name);
    }).catch(() => nameDefault(''));
  }

  override onClose(): void {
    this.isOpen = false;
    this.attempt++;
    this.stopHosting();
    this.dropMatch();
    this.state = 'menu';
  }

  override back(): boolean {
    if (this.state === 'menu') return false;
    this.attempt++;
    this.stopHosting();
    this.dropMatch();
    this.state = 'menu';
    this.setStatus('');
    playMenuSound(20);
    return true;
  }

  /** Calls off the game about to start (the other player hears that this one left). */
  private dropMatch(): void {
    const m = this.match;
    this.match = null;
    if (!m) return;
    m.link.send(JSON.stringify({ t: 'bye', reason: 'left' } satisfies NetMessage));
    m.link.close();
  }

  private setStatus(text: string, color = PC.dim): void {
    this.status = text;
    this.statusColor = color;
  }

  /** What this game can play (worked out once: it reads the robots' and arenas' files). */
  private netContent(): NetContent {
    this.content ??= netContent();
    return this.content;
  }

  // ---- hosting and joining -------------------------------------------------------------------------------------

  private async host(): Promise<void> {
    const b = this.backend;
    if (!b) return;
    const attempt = ++this.attempt;
    const name = this.name;
    this.state = 'hosting';
    this.setStatus('');
    try {
      const hosting = await b.host(name, APP_VERSION, (link) => void this.guestArrived(link, attempt));
      if (attempt !== this.attempt) {
        hosting.stop();
        return;
      }
      this.hosting = hosting;
      this.port = hosting.port;
    } catch (e) {
      if (attempt !== this.attempt) return;
      this.state = 'menu';
      this.setStatus(tr('THE GAME COULD NOT BE HOSTED: {error}', { error: errorText(e) }), PC.red);
    }
  }

  private stopHosting(): void {
    this.hosting?.stop();
    this.hosting = null;
  }

  private async guestArrived(link: NetLink, attempt: number): Promise<void> {
    if (attempt !== this.attempt || this.state !== 'hosting' || this.greeting || this.gs.net) {
      link.close();
      return;
    }
    this.greeting = true;
    this.setStatus(tr('A PLAYER IS JOINING FROM {peer}...', { peer: link.peer.toUpperCase() }), PC.gold);
    const name = this.name;
    try {
      const rules = hostRules(this.gs);
      const seed = (Math.random() * 0x100000000) >>> 0;
      const guest = await hostHandshake(link, { name, version: APP_VERSION, content: this.netContent(), rules, seed });
      if (attempt !== this.attempt) {
        link.close();
        return;
      }
      this.stopHosting();
      this.matched({ link, localPlayer: 0, names: [name, guest], rules, seed, at: performance.now() + MATCH_MS });
    } catch (e) {
      link.close();
      // (the game goes on waiting for a player who can join)
      if (attempt === this.attempt) this.setStatus(tr('A PLAYER COULD NOT JOIN: {error}', { error: errorText(e) }), PC.red);
    } finally {
      this.greeting = false;
    }
  }

  /** Joins the game at an address (`label`: what to call it meanwhile, its name when it was found). */
  private async join(address: string, label = address): Promise<void> {
    const b = this.backend;
    if (!b) return;
    const attempt = ++this.attempt;
    const name = this.name;
    this.state = 'joining';
    this.joining = label;
    this.connected = false;
    this.setStatus('');
    let link: NetLink | null = null;
    try {
      link = await b.join(address);
      if (attempt !== this.attempt) {
        link.close();
        return;
      }
      this.connected = true;
      const joined = await guestHandshake(link, name, APP_VERSION, this.netContent());
      if (attempt !== this.attempt) {
        link.close();
        return;
      }
      this.matched({ link, localPlayer: 1, names: [joined.hostName, joined.name], rules: joined.rules, seed: joined.seed,
        at: performance.now() + MATCH_MS });
    } catch (e) {
      link?.close();
      if (attempt !== this.attempt) return;
      this.state = 'menu';
      this.setStatus(joinError(e, address), PC.red);
    }
  }

  /** Both games agreed: who plays whom shows for a moment (the other game's messages wait in the link meanwhile). */
  private matched(m: Match): void {
    this.match = m;
    this.state = 'starting';
    playMenuSound(20);
  }

  /** The game starts: the page closes and the robot select screen opens in both games. */
  private start(): void {
    const m = this.match;
    if (!m) return;
    this.match = null;
    this.state = 'menu';
    const session = new NetSession({ link: m.link, localPlayer: m.localPlayer, names: m.names, rules: m.rules, seed: m.seed });
    // (the other player called it off meanwhile: their goodbye was waiting in the link. The page stays, saying so)
    if (session.ended) {
      this.setStatus(session.ended.message.toUpperCase(), PC.red);
      return;
    }
    startNetGame(this.gs, session);
    this.finished = true;
  }

  /** Now and then, drawn or not (a hidden window draws nothing): the match found starts when its moment comes. */
  override update(): void {
    if (this.state === 'starting' && this.match && performance.now() >= this.match.at) this.start();
  }

  private scan(): void {
    const b = this.backend;
    if (!b || this.scanning || !this.isOpen || this.state !== 'menu' || performance.now() - this.lastScan < SCAN_EVERY_MS) return;
    this.scanning = true;
    void b.scan().then((games) => {
      // (in a steady order, and the highlighted game stays highlighted where it goes: ENTER joins the game it shows)
      const picked = this.games[this.row - ROW_ADDRESS - 1]?.address;
      this.games = [...games].sort(byName);
      const at = picked === undefined ? -1 : this.games.findIndex((g) => g.address === picked);
      if (at >= 0) this.row = ROW_ADDRESS + 1 + at;
      this.row = Math.min(this.row, ROW_ADDRESS + this.games.length);
      this.gamesTop = Math.max(0, Math.min(this.gamesTop, this.games.length - GAMES_SHOWN));
      const g = this.row - ROW_ADDRESS - 1;
      if (g >= 0) this.gamesTop = Math.max(Math.min(this.gamesTop, g), g - GAMES_SHOWN + 1);
      this.scanFailed = false;
    }).catch(() => {
      this.games = [];
      this.row = Math.min(this.row, ROW_ADDRESS);
      this.scanFailed = true;
    }).finally(() => {
      this.scanning = false;
      this.lastScan = performance.now();
    });
  }

  // ---- input ---------------------------------------------------------------------------------------------------

  private rows(): number {
    return ROW_ADDRESS + 1 + this.games.length;
  }

  private pick(row: number): void {
    this.row = (row + this.rows()) % this.rows();
    const g = this.row - ROW_ADDRESS - 1;
    if (g >= 0) this.gamesTop = Math.max(Math.min(this.gamesTop, g), g - GAMES_SHOWN + 1);
    playMenuSound(19);
  }

  private activate(): void {
    if (this.row === ROW_HOST) {
      void this.host();
    } else if (this.row === ROW_ADDRESS) {
      const a = settings().lan.address.trim();
      if (!a) {
        this.setStatus(tr("TYPE THE ADDRESS OF THE HOST'S COMPUTER (ITS LAN PAGE SHOWS IT)"), PC.gold);
        return;
      }
      void this.join(a);
    } else if (this.row > ROW_ADDRESS) {
      const g = this.games[this.row - ROW_ADDRESS - 1];
      if (!g) return;
      if (g.busy) {
        this.setStatus(tr('THAT GAME IS ALREADY BEING PLAYED.'), PC.gold);
        return;
      }
      void this.join(g.address, tr('{name}\'S GAME', { name: g.name.toUpperCase() }));
    } else {
      return;
    }
    playMenuSound(20);
  }

  override action(action: number, _source: CtrlType): number {
    if (!this.backend || this.state !== 'menu') return 1;
    if (action & ACT_UP) this.pick(this.row - 1);
    else if (action & ACT_DOWN) this.pick(this.row + 1);
    else if (action & (ACT_PUNCH | ACT_KICK)) this.activate();
    return 1;
  }

  override key(code: string, e?: TypedKey): boolean {
    if (!this.backend || this.state !== 'menu') return false;
    const lan = settings().lan;
    if (this.row === ROW_NAME) {
      // (what the player's keyboard types: a French one types A where a US one types Q)
      const ch = typedChar(code, e, (c) => /^[A-Z0-9-]$/.test(c));
      if (code === 'Backspace') lan.name = lan.name.slice(0, -1);
      else if (ch) lan.name = cleanName(lan.name + ch);
      else return false;
    } else if (this.row === ROW_ADDRESS) {
      // (the keypad's decimal key types a dot whatever its label; the US semicolon key a colon)
      const ch = code === 'NumpadDecimal' ? '.' : typedChar(code, e, (c) => /^[A-Z0-9.:-]$/.test(c)) ?? (code === 'Semicolon' ? ':' : null);
      if (code === 'Backspace') lan.address = lan.address.slice(0, -1);
      else if (code === 'Delete') lan.address = '';
      else if (ch) lan.address = (lan.address + ch).slice(0, ADDRESS_MAX);
      else return false;
    } else {
      return false;
    }
    saveSettings();
    return true;
  }

  override pointer(x: number, y: number, kind: PointerKind): boolean {
    if (!this.backend || this.state !== 'menu' || kind !== 'click' || x < 14 || x > 306) return false;
    let row = -1;
    if (y >= ROW_Y - 3 && y < ROW_Y - 3 + 3 * ROW_H) row = Math.floor((y - ROW_Y + 3) / ROW_H);
    else if (y >= GAMES_Y - 2 && y < GAMES_Y - 2 + GAMES_SHOWN * GAME_H) {
      const g = this.gamesTop + Math.floor((y - GAMES_Y + 2) / GAME_H);
      if (g < this.games.length) row = ROW_ADDRESS + 1 + g;
    }
    if (row < 0) return false;
    if (row === this.row) this.activate();
    else this.pick(row);
    return true;
  }

  // ---- drawing -------------------------------------------------------------------------------------------------

  private box(x: number, y: number, w: number, h: number, color: number): void {
    this.dot ??= new Surface(1, 1, new Uint8Array([1]), 0);
    video.drawFull(this.dot, x, y, w, h, 0, 0, color - 1, 255, 255, 0, 0);
  }

  /** A text wrapped over lines, centered. */
  private drawWrapped(key: string, str: string, y: number, color: number, w = 280, h = 26): void {
    const k = `${key}|${str}|${color}`;
    let t = this.wrapped.get(k);
    if (!t) {
      t = new Text(FontSize.SMALL, w, h, str).setColor(color).setHAlign(HAlign.CENTER).setVAlign(VAlign.TOP);
      if (this.wrapped.size > 40) this.wrapped.clear();
      this.wrapped.set(k, t);
    }
    t.draw(160 - w / 2, y);
  }

  /**
   * A text in one of the page's columns (x: where it starts, or ends with RIGHT), mirrored when the game speaks a
   * right-to-left language: in Arabic the labels are at the right, what they name to their left.
   */
  private drawCol(key: string, str: string, x: number, y: number, color: number, align = HAlign.LEFT): void {
    if (langInfo().rtl !== true) return this.drawText(key, str, x, y, FontSize.SMALL, color, align);
    this.drawText(key, str, 320 - x, y, FontSize.SMALL, color, align === HAlign.LEFT ? HAlign.RIGHT : align === HAlign.RIGHT ? HAlign.LEFT : align);
  }

  /** A few dots, coming and going (something is under way). */
  private dots(): string {
    return '.'.repeat(1 + (Math.floor(performance.now() / 400) % 3));
  }

  private address(): string {
    const a = this.addresses[0];
    if (!a) return '';
    return (this.port === LAN_PORT || this.backend?.kind === 'dev' ? a : `${a}:${this.port}`).toUpperCase();
  }

  override render(): void {
    this.drawFrame(tr('LAN GAME'));
    if (!this.backend) {
      this.drawWrapped('web1', tr('LAN GAMES NEED THE DESKTOP APP'), 60, PC.gold);
      this.drawWrapped('web2', tr('A browser cannot reach the other computers of your network by itself. Download the desktop app from the GitHub page to host and join LAN games. Two players on this computer: MULTIPLAYER > LOCAL.'), 82, PC.grey, 260, 60);
      this.drawText('h', tr('ESC BACK'), 160, 182, FontSize.SMALL, PC.dim, HAlign.CENTER);
      return;
    }
    if (this.state === 'starting') this.renderMatch();
    else if (this.state === 'hosting') this.renderHosting();
    else if (this.state === 'joining') this.renderJoining();
    else this.renderMenu();
  }

  private renderHosting(): void {
    this.drawText('hn', tr('{name}\'S GAME', { name: this.name }), 160, 34, FontSize.BIG, PAGE_TITLE, HAlign.CENTER);
    this.drawText('hw', tr('WAITING FOR A PLAYER TO JOIN{dots}', { dots: this.dots() }), 160, 50, FontSize.SMALL, PC.gold, HAlign.CENTER);
    this.drawWrapped('hg', tr('The game starts by itself as soon as someone joins.'), 62, PC.white);
    this.drawWrapped('hj', tr("On the other computer: MULTIPLAYER > LAN, then pick {name}'S GAME from the list, or join this address:", { name: this.name }),
      80, PC.grey);
    const a = this.address();
    if (a) this.drawText('hv', a, 160, 100, FontSize.BIG, PC.white, HAlign.CENTER);
    this.drawWrapped('hr', tr('Your gameplay options are used (speed, rounds, power and the advanced ones).'), 120, PC.grey);
    if (this.status) this.drawWrapped('hs', this.status, 142, this.statusColor);
    else this.drawWrapped('hf', networkHint(this.os), 142, PC.dim);
    this.drawText('h', tr('ESC STOP HOSTING'), 160, 182, FontSize.SMALL, PC.dim, HAlign.CENTER);
  }

  private renderJoining(): void {
    this.drawText('jn', tr('JOINING'), 160, 50, FontSize.BIG, PAGE_TITLE, HAlign.CENTER);
    this.drawText('ja', this.joining.toUpperCase(), 160, 68, FontSize.BIG, PC.white, HAlign.CENTER);
    this.drawText('jc', this.connected ? tr('CONNECTED: CHECKING BOTH GAMES MATCH{dots}', { dots: this.dots() }) : tr('CONNECTING{dots}', { dots: this.dots() }), 160, 90,
      FontSize.SMALL, PC.gold, HAlign.CENTER);
    this.drawWrapped('jr', tr("The host's gameplay options are used."), 112, PC.grey);
    this.drawText('h', tr('ESC CANCEL'), 160, 182, FontSize.SMALL, PC.dim, HAlign.CENTER);
  }

  /** The game agreed: who plays whom, which side this player is, what comes next (it starts in update()). */
  private renderMatch(): void {
    const m = this.match;
    if (!m) return;
    const [p1, p2] = m.names;
    const me = m.localPlayer;
    this.drawText('mf', tr('MATCH FOUND!'), 160, 34, FontSize.BIG, PC.gold, HAlign.CENTER);
    // (in the colors of their cursors on the select screen)
    this.drawText('m1', p1, 150, 56, FontSize.BIG, PC.red, HAlign.RIGHT);
    this.drawText('mv', tr('VS'), 160, 56, FontSize.SMALL, PC.white, HAlign.CENTER);
    this.drawText('m2', p2, 170, 56, FontSize.BIG, PC.blue, HAlign.LEFT);
    this.drawText('my', me === 0 ? tr('YOU') : '', 150, 68, FontSize.SMALL, PC.red, HAlign.RIGHT);
    this.drawText('mz', me === 1 ? tr('YOU') : '', 170, 68, FontSize.SMALL, PC.blue, HAlign.LEFT);
    this.drawWrapped('ms', me === 0 ? tr('You are player 1: your cursor is the red one, on the left.') : tr('You are player 2: your cursor is the blue one, on the right.'), 86, PC.white);
    this.drawWrapped('mn', tr('Both of you pick a pilot and a robot. Then {p1} picks the arena, and the fight starts when you have both pressed PUNCH. The bar at the bottom of the screen always says whose move it is.', { p1 }), 104, PC.grey, 280, 40);
    this.drawText('mg', tr('STARTING{dots}', { dots: this.dots() }), 160, 150, FontSize.SMALL, PC.gold, HAlign.CENTER);
    this.drawText('h', tr('ESC CANCEL'), 160, 182, FontSize.SMALL, PC.dim, HAlign.CENTER);
  }

  private renderMenu(): void {
    this.scan();
    const typing = Math.floor(performance.now() / 500) % 2 === 0 ? '_' : ' ';
    const lan = settings().lan;
    if (this.status) this.drawWrapped('st', this.status, 22, this.statusColor);
    else this.drawWrapped('st', tr('One of you hosts a game; the other picks it from the games on your network below.'), 22, PC.dim);
    const rows: [string, string][] = [
      [tr('YOUR NAME'), lan.name + (this.row === ROW_NAME ? typing : '')],
      [tr('HOST A GAME'), ''],
      [tr('JOIN BY ADDRESS'), lan.address + (this.row === ROW_ADDRESS ? typing : '')],
    ];
    rows.forEach(([label, value], i) => {
      const y = ROW_Y + i * ROW_H;
      const sel = i === this.row;
      if (sel) this.box(14, y - 3, 292, 13, PC.select);
      this.drawCol(`l${i}`, label, 22, y, sel ? PC.white : PC.grey);
      if (value) this.drawCol(`v${i}`, value, 120, y, sel ? PC.gold : PC.white);
    });
    this.drawCol('gt', tr('GAMES ON YOUR NETWORK') + (this.scanning ? this.dots() : ''), 22, GAMES_Y - 13, PC.dim);
    if (!this.games.length && this.scanFailed) {
      // (not "none found": the search did not go out. What the system may want, under it)
      this.drawWrapped('gf', tr('THE NETWORK COULD NOT BE SEARCHED.'), GAMES_Y, PC.red, 280, 16);
      this.drawWrapped('gh', networkHint(this.os), GAMES_Y + 16, PC.dim, 280, 34);
    } else if (!this.games.length) {
      this.drawCol('g0', tr('NONE FOUND YET'), 30, GAMES_Y, PC.dark);
    }
    for (let i = 0; i < GAMES_SHOWN; i++) {
      const g = this.games[this.gamesTop + i];
      if (!g) break;
      const y = GAMES_Y + i * GAME_H;
      const sel = this.row === ROW_ADDRESS + 1 + this.gamesTop + i;
      if (sel) this.box(14, y - 2, 292, 11, PC.select);
      const other = g.version !== APP_VERSION;
      // (up to the address column)
      this.drawCol(`gn${i}`, clip(tr('{name}\'S GAME', { name: g.name.toUpperCase() }), 19), 30, y, sel ? PC.white : PC.grey);
      this.drawCol(`ga${i}`, g.address.toUpperCase(), 150, y, sel ? PC.gold : PC.white);
      this.drawCol(`gv${i}`, g.busy ? tr('PLAYING') : other ? `V${g.version}` : tr('OPEN'), 298, y,
        g.busy ? PC.orange : other ? PC.red : PC.green, HAlign.RIGHT);
    }
    const a = this.address();
    const hint = this.row === ROW_NAME ? tr('TYPE YOUR NAME') : this.row === ROW_ADDRESS ? tr('TYPE AN ADDRESS, ENTER JOINS')
      : this.row === ROW_HOST ? tr('ENTER HOSTS A GAME') : tr('ENTER JOINS THIS GAME');
    if (a) this.drawText('ya', tr('YOUR ADDRESS: {a}', { a }), 160, 170, FontSize.SMALL, PC.dim, HAlign.CENTER);
    this.drawText('h', tr('{hint}   ESC BACK', { hint }), 160, 182, FontSize.SMALL, PC.dim, HAlign.CENTER);
  }
}
