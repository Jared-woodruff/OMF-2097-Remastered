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

/** What a failed join says (the desktop app's errors are the system's). */
function joinError(e: unknown, address: string): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/refused|10061|ECONNREFUSED/i.test(m)) return `NO GAME IS HOSTED AT ${address.toUpperCase()}.`;
  if (/timed out|10060|ETIMEDOUT|unreachable|10065|10051/i.test(m)) {
    return `${address.toUpperCase()} DID NOT ANSWER: IS IT ON THIS NETWORK, AND THE GAME ALLOWED THROUGH ITS FIREWALL?`;
  }
  if (/no computer by that name|not known|11001|failed to lookup/i.test(m)) return `NO COMPUTER IS CALLED ${address.toUpperCase()}.`;
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
  private content: NetContent | null = null;
  private dot: Surface | null = null;
  private wrapped = new Map<string, Text>();

  constructor(private gs: GameState) {
    super();
  }

  private get name(): string {
    return settings().lan.name;
  }

  override onOpen(): void {
    this.isOpen = true;
    this.state = 'menu';
    this.row = ROW_HOST;
    this.games = [];
    this.lastScan = -Infinity;
    this.setStatus('');
    const b = this.backend;
    if (!b) return;
    void b.info().then((info) => {
      this.addresses = info.addresses;
      // (the computer's user name, until the player types one)
      if (!settings().lan.name) {
        settings().lan.name = cleanName(info.name) || 'PLAYER';
        saveSettings();
      }
    }).catch(() => undefined);
    if (!settings().lan.name) settings().lan.name = 'PLAYER';
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
      this.setStatus(`THE GAME COULD NOT BE HOSTED: ${errorText(e)}`, PC.red);
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
    this.setStatus(`A PLAYER IS JOINING FROM ${link.peer.toUpperCase()}...`, PC.gold);
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
      if (attempt === this.attempt) this.setStatus(`A PLAYER COULD NOT JOIN: ${errorText(e)}`, PC.red);
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
    startNetGame(this.gs, new NetSession({ link: m.link, localPlayer: m.localPlayer, names: m.names, rules: m.rules, seed: m.seed }));
    this.finished = true;
  }

  private scan(): void {
    const b = this.backend;
    if (!b || this.scanning || !this.isOpen || this.state !== 'menu' || performance.now() - this.lastScan < SCAN_EVERY_MS) return;
    this.scanning = true;
    void b.scan().then((games) => {
      this.games = games;
      this.gamesTop = Math.max(0, Math.min(this.gamesTop, games.length - GAMES_SHOWN));
      this.row = Math.min(this.row, ROW_ADDRESS + games.length);
    }).catch(() => undefined).finally(() => {
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
        this.setStatus("TYPE THE ADDRESS OF THE HOST'S COMPUTER (ITS LAN PAGE SHOWS IT)", PC.gold);
        return;
      }
      void this.join(a);
    } else if (this.row > ROW_ADDRESS) {
      const g = this.games[this.row - ROW_ADDRESS - 1];
      if (!g) return;
      if (g.busy) {
        this.setStatus('THAT GAME IS ALREADY BEING PLAYED.', PC.gold);
        return;
      }
      void this.join(g.address, `${g.name.toUpperCase()}'S GAME`);
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

  override key(code: string): boolean {
    if (!this.backend || this.state !== 'menu') return false;
    const lan = settings().lan;
    const letter = /^Key([A-Z])$/.exec(code)?.[1] ?? /^(?:Digit|Numpad)([0-9])$/.exec(code)?.[1] ?? null;
    if (this.row === ROW_NAME) {
      if (code === 'Backspace') lan.name = lan.name.slice(0, -1);
      else if (code === 'Minus') lan.name = cleanName(`${lan.name}-`);
      else if (letter) lan.name = cleanName(lan.name + letter);
      else return false;
    } else if (this.row === ROW_ADDRESS) {
      const mark = code === 'Period' || code === 'NumpadDecimal' ? '.' : code === 'Semicolon' ? ':' : code === 'Minus' ? '-' : null;
      if (code === 'Backspace') lan.address = lan.address.slice(0, -1);
      else if (code === 'Delete') lan.address = '';
      else if (letter || mark) lan.address = (lan.address + (letter ?? mark)).slice(0, ADDRESS_MAX);
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
    this.drawFrame('LAN GAME');
    if (!this.backend) {
      this.drawWrapped('web1', 'LAN GAMES NEED THE DESKTOP APP', 60, PC.gold);
      this.drawWrapped('web2', 'A browser cannot reach the other computers of your network by itself. Download the desktop app ' +
        'for Windows from the GitHub page to host and join LAN games. Two players on this computer: MULTIPLAYER > LOCAL.', 82, PC.grey, 260, 60);
      this.drawText('h', 'ESC BACK', 160, 182, FontSize.SMALL, PC.dim, HAlign.CENTER);
      return;
    }
    if (this.state === 'starting') this.renderMatch();
    else if (this.state === 'hosting') this.renderHosting();
    else if (this.state === 'joining') this.renderJoining();
    else this.renderMenu();
  }

  private renderHosting(): void {
    this.drawText('hn', `${this.name}'S GAME`, 160, 34, FontSize.BIG, PAGE_TITLE, HAlign.CENTER);
    this.drawText('hw', `WAITING FOR A PLAYER TO JOIN${this.dots()}`, 160, 50, FontSize.SMALL, PC.gold, HAlign.CENTER);
    this.drawWrapped('hg', 'The game starts by itself as soon as someone joins.', 62, PC.white);
    this.drawWrapped('hj', `On the other computer: MULTIPLAYER > LAN, then pick ${this.name}'S GAME from the list, or join this address:`,
      80, PC.grey);
    const a = this.address();
    if (a) this.drawText('hv', a, 160, 100, FontSize.BIG, PC.white, HAlign.CENTER);
    this.drawWrapped('hr', 'Your gameplay options are used (speed, rounds, power and the advanced ones).', 120, PC.grey);
    if (this.status) this.drawWrapped('hs', this.status, 142, this.statusColor);
    else this.drawWrapped('hf', 'If Windows asks, let the game use private networks.', 142, PC.dim);
    this.drawText('h', 'ESC STOP HOSTING', 160, 182, FontSize.SMALL, PC.dim, HAlign.CENTER);
  }

  private renderJoining(): void {
    this.drawText('jn', 'JOINING', 160, 50, FontSize.BIG, PAGE_TITLE, HAlign.CENTER);
    this.drawText('ja', this.joining.toUpperCase(), 160, 68, FontSize.BIG, PC.white, HAlign.CENTER);
    this.drawText('jc', this.connected ? `CONNECTED: CHECKING BOTH GAMES MATCH${this.dots()}` : `CONNECTING${this.dots()}`, 160, 90,
      FontSize.SMALL, PC.gold, HAlign.CENTER);
    this.drawWrapped('jr', "The host's gameplay options are used.", 112, PC.grey);
    this.drawText('h', 'ESC CANCEL', 160, 182, FontSize.SMALL, PC.dim, HAlign.CENTER);
  }

  /** The game agreed: who plays whom, which side this player is, what comes next; then it starts. */
  private renderMatch(): void {
    const m = this.match;
    if (!m) return;
    const left = m.at - performance.now();
    const [p1, p2] = m.names;
    const me = m.localPlayer;
    this.drawText('mf', 'MATCH FOUND!', 160, 34, FontSize.BIG, PC.gold, HAlign.CENTER);
    // (in the colors of their cursors on the select screen)
    this.drawText('m1', p1, 150, 56, FontSize.BIG, PC.red, HAlign.RIGHT);
    this.drawText('mv', 'VS', 160, 56, FontSize.SMALL, PC.white, HAlign.CENTER);
    this.drawText('m2', p2, 170, 56, FontSize.BIG, PC.blue, HAlign.LEFT);
    this.drawText('my', me === 0 ? 'YOU' : '', 150, 68, FontSize.SMALL, PC.red, HAlign.RIGHT);
    this.drawText('mz', me === 1 ? 'YOU' : '', 170, 68, FontSize.SMALL, PC.blue, HAlign.LEFT);
    this.drawWrapped('ms', `You are player ${me + 1}: your cursor is the ${me === 0 ? 'red' : 'blue'} one, on the ` +
      `${me === 0 ? 'left' : 'right'}.`, 86, PC.white);
    this.drawWrapped('mn', `Both of you pick a pilot and a robot. Then ${p1} picks the arena, and the fight starts when you ` +
      'have both pressed PUNCH. The bar at the bottom of the screen always says whose move it is.', 104, PC.grey, 280, 40);
    this.drawText('mg', `STARTING${this.dots()}`, 160, 150, FontSize.SMALL, PC.gold, HAlign.CENTER);
    this.drawText('h', 'ESC CANCEL', 160, 182, FontSize.SMALL, PC.dim, HAlign.CENTER);
    if (left <= 0) this.start();
  }

  private renderMenu(): void {
    this.scan();
    const typing = Math.floor(performance.now() / 500) % 2 === 0 ? '_' : ' ';
    const lan = settings().lan;
    if (this.status) this.drawWrapped('st', this.status, 22, this.statusColor);
    else this.drawWrapped('st', 'One of you hosts a game; the other picks it from the games on your network below.', 22, PC.dim);
    const rows: [string, string][] = [
      ['YOUR NAME', lan.name + (this.row === ROW_NAME ? typing : '')],
      ['HOST A GAME', ''],
      ['JOIN BY ADDRESS', lan.address + (this.row === ROW_ADDRESS ? typing : '')],
    ];
    rows.forEach(([label, value], i) => {
      const y = ROW_Y + i * ROW_H;
      const sel = i === this.row;
      if (sel) this.box(14, y - 3, 292, 13, PC.select);
      this.drawText(`l${i}`, label, 22, y, FontSize.SMALL, sel ? PC.white : PC.grey);
      if (value) this.drawText(`v${i}`, value, 120, y, FontSize.SMALL, sel ? PC.gold : PC.white);
    });
    this.drawText('gt', `GAMES ON YOUR NETWORK${this.scanning ? this.dots() : ''}`, 22, GAMES_Y - 13, FontSize.SMALL, PC.dim);
    if (!this.games.length) {
      this.drawText('g0', 'NONE FOUND YET', 30, GAMES_Y, FontSize.SMALL, PC.dark);
    }
    for (let i = 0; i < GAMES_SHOWN; i++) {
      const g = this.games[this.gamesTop + i];
      if (!g) break;
      const y = GAMES_Y + i * GAME_H;
      const sel = this.row === ROW_ADDRESS + 1 + this.gamesTop + i;
      if (sel) this.box(14, y - 2, 292, 11, PC.select);
      const other = g.version !== APP_VERSION;
      this.drawText(`gn${i}`, `${g.name.toUpperCase()}'S GAME`, 30, y, FontSize.SMALL, sel ? PC.white : PC.grey);
      this.drawText(`ga${i}`, g.address.toUpperCase(), 150, y, FontSize.SMALL, sel ? PC.gold : PC.white);
      this.drawText(`gv${i}`, g.busy ? 'PLAYING' : other ? `V${g.version}` : 'OPEN', 298, y, FontSize.SMALL,
        g.busy ? PC.orange : other ? PC.red : PC.green, HAlign.RIGHT);
    }
    const a = this.address();
    const hint = this.row === ROW_NAME ? 'TYPE YOUR NAME' : this.row === ROW_ADDRESS ? 'TYPE AN ADDRESS, ENTER JOINS'
      : this.row === ROW_HOST ? 'ENTER HOSTS A GAME' : 'ENTER JOINS THIS GAME';
    if (a) this.drawText('ya', `YOUR ADDRESS: ${a}`, 160, 170, FontSize.SMALL, PC.dim, HAlign.CENTER);
    this.drawText('h', `${hint}   ESC BACK`, 160, 182, FontSize.SMALL, PC.dim, HAlign.CENTER);
  }
}
