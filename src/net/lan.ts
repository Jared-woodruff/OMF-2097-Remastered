// LAN games: hosting a game, finding the games on the local network and joining one. The desktop app does the
// networking (src-tauri/src/lan.rs: TCP connections, UDP searches on port 2097); browsers cannot reach other
// computers by themselves, so the web version has no LAN games. The development server stands in for the network
// (vite.config.ts): two tabs of `npm run dev` can play each other.
import { QueuedLink, type NetLink } from './link';
import { LAN_PORT } from './protocol';

/** A game found on the network. */
export interface LanGame {
  name: string;
  /** Its computer's address (with the port when it is not the game's). */
  address: string;
  version: string;
  /** Already being played. */
  busy: boolean;
}

export interface LanHosting {
  /** The port the game waits on. */
  port: number;
  /** Stops waiting for guests (and answering searches); a guest already connected stays. */
  stop(): void;
}

export interface LanBackend {
  /** Where the games are: the network (the desktop app), or the development server. */
  readonly kind: 'network' | 'dev';
  /** This computer's user name and network addresses. */
  info(): Promise<{ name: string; addresses: string[] }>;
  /** Hosts a game: each guest that connects is handed over (the host's game refuses a second one itself). */
  host(name: string, version: string, onGuest: (link: NetLink) => void): Promise<LanHosting>;
  /** Looks for games (about a second). */
  scan(): Promise<LanGame[]>;
  /** Joins the game at an address ("192.168.1.20", with ":port" when it is not the game's). */
  join(address: string): Promise<NetLink>;
}

// ---- the desktop app ---------------------------------------------------------------------------------------------

interface TauriApi {
  core: { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> };
  event: { listen<T>(event: string, cb: (e: { payload: T }) => void): Promise<() => void> };
}

/** A connection of the desktop app: messages go out in batches, one call at a time, so they keep their order. */
class DesktopLink extends QueuedLink {
  private out: string[] = [];
  private sending = false;
  private closing = false;

  constructor(private api: TauriApi, readonly id: number, peer: string) {
    super(peer);
  }

  send(text: string): void {
    if (this.closed) return;
    this.out.push(text);
    this.flush();
  }

  private flush(): void {
    if (this.sending) return;
    if (!this.out.length) {
      if (this.closing) {
        this.closing = false;
        void this.api.core.invoke('lan_close', { id: this.id }).catch(() => undefined);
      }
      return;
    }
    const texts = this.out;
    this.out = [];
    this.sending = true;
    this.api.core.invoke('lan_send', { id: this.id, texts })
      .catch(() => undefined)
      .finally(() => {
        this.sending = false;
        this.flush();
      });
  }

  protected shut(): void {
    // (after what was sent: a goodbye goes out first)
    this.closing = true;
    this.flush();
  }
}

class DesktopLan implements LanBackend {
  readonly kind = 'network';
  private links = new Map<number, DesktopLink>();
  /** Messages for a connection the game has not been handed yet (a join's answer can come first). */
  private early = new Map<number, ({ data: string } | { close: string })[]>();
  private onGuest: ((link: NetLink) => void) | null = null;
  private listening: Promise<void> | null = null;

  constructor(private api: TauriApi) {}

  private listen(): Promise<void> {
    this.listening ??= (async () => {
      const ev = this.api.event;
      await ev.listen<{ id: number; peer: string }>('lan:open', ({ payload }) => {
        const link = this.adopt(payload.id, payload.peer);
        if (this.onGuest) this.onGuest(link);
        else link.close();
      });
      await ev.listen<{ id: number; text: string }>('lan:data', ({ payload }) => {
        const link = this.links.get(payload.id);
        if (link) link.deliver(payload.text);
        else this.hold(payload.id, { data: payload.text });
      });
      await ev.listen<{ id: number; reason: string }>('lan:close', ({ payload }) => {
        const link = this.links.get(payload.id);
        this.links.delete(payload.id);
        if (link) link.ended(payload.reason);
        else this.hold(payload.id, { close: payload.reason });
      });
    })();
    return this.listening;
  }

  private hold(id: number, e: { data: string } | { close: string }): void {
    let list = this.early.get(id);
    if (!list) {
      // (not many: they are a join's first messages)
      if (this.early.size > 16) this.early.clear();
      this.early.set(id, (list = []));
    }
    if (list.length < 64) list.push(e);
  }

  private adopt(id: number, peer: string): DesktopLink {
    const link = new DesktopLink(this.api, id, peer);
    this.links.set(id, link);
    for (const e of this.early.get(id) ?? []) {
      if ('data' in e) link.deliver(e.data);
      else {
        this.links.delete(id);
        link.ended(e.close);
      }
    }
    this.early.delete(id);
    return link;
  }

  async info(): Promise<{ name: string; addresses: string[] }> {
    return this.api.core.invoke('lan_info');
  }

  async host(name: string, version: string, onGuest: (link: NetLink) => void): Promise<LanHosting> {
    await this.listen();
    this.onGuest = onGuest;
    const port = await this.api.core.invoke<number>('lan_host', { name, version });
    return {
      port,
      stop: () => {
        if (this.onGuest === onGuest) this.onGuest = null;
        void this.api.core.invoke('lan_unhost').catch(() => undefined);
      },
    };
  }

  async scan(): Promise<LanGame[]> {
    const games = await this.api.core.invoke<{ name: string; address: string; port: number; version: string; busy: boolean }[]>('lan_scan');
    return games.map((g) => ({ name: g.name, address: g.port === LAN_PORT ? g.address : `${g.address}:${g.port}`, version: g.version, busy: g.busy }));
  }

  async join(address: string): Promise<NetLink> {
    await this.listen();
    const j = await this.api.core.invoke<{ id: number; peer: string }>('lan_join', { address });
    return this.adopt(j.id, j.peer);
  }
}

// ---- the development server ----------------------------------------------------------------------------------------

/** What the development server's relay says (vite.config.ts, lanRelay). */
type RelayEvent =
  | { op: 'games'; req: number; games: LanGame[] }
  | { op: 'hosted'; req: number }
  | { op: 'joined'; req: number; id: number }
  | { op: 'error'; req: number; reason: string }
  | { op: 'open'; id: number }
  | { op: 'data'; id: number; text: string }
  | { op: 'close'; id: number; reason: string };

class DevLink extends QueuedLink {
  constructor(private relay: DevLan, readonly id: number) {
    super('dev server');
  }
  send(text: string): void {
    if (!this.closed) this.relay.post({ op: 'send', id: this.id, text });
  }
  protected shut(): void {
    this.relay.post({ op: 'close', id: this.id });
  }
}

class DevLan implements LanBackend {
  readonly kind = 'dev';
  private req = 0;
  private waiting = new Map<number, (e: RelayEvent) => void>();
  private links = new Map<number, DevLink>();
  private onGuest: ((link: NetLink) => void) | null = null;

  constructor(private hot: NonNullable<ImportMeta['hot']>) {
    hot.on('omf:lan', (e: RelayEvent) => this.event(e));
  }

  post(m: Record<string, unknown>): void {
    this.hot.send('omf:lan', m);
  }

  private ask(m: Record<string, unknown>): Promise<RelayEvent> {
    const req = ++this.req;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(req);
        reject(new Error('The development server did not answer.'));
      }, 5000);
      this.waiting.set(req, (e) => {
        clearTimeout(timer);
        if (e.op === 'error') reject(new Error(e.reason));
        else resolve(e);
      });
      this.post({ ...m, req });
    });
  }

  private event(e: RelayEvent): void {
    if ('req' in e) {
      const w = this.waiting.get(e.req);
      this.waiting.delete(e.req);
      w?.(e);
      return;
    }
    if (e.op === 'open') {
      const link = new DevLink(this, e.id);
      this.links.set(e.id, link);
      if (this.onGuest) this.onGuest(link);
      else link.close();
    } else if (e.op === 'data') {
      this.links.get(e.id)?.deliver(e.text);
    } else if (e.op === 'close') {
      this.links.get(e.id)?.ended(e.reason);
      this.links.delete(e.id);
    }
  }

  async info(): Promise<{ name: string; addresses: string[] }> {
    return { name: '', addresses: ['dev server'] };
  }

  async host(name: string, version: string, onGuest: (link: NetLink) => void): Promise<LanHosting> {
    this.onGuest = onGuest;
    await this.ask({ op: 'host', name, version });
    return {
      port: 0,
      stop: () => {
        if (this.onGuest === onGuest) this.onGuest = null;
        this.post({ op: 'unhost' });
      },
    };
  }

  async scan(): Promise<LanGame[]> {
    const e = await this.ask({ op: 'scan' });
    return e.op === 'games' ? e.games : [];
  }

  async join(address: string): Promise<NetLink> {
    const e = await this.ask({ op: 'join', address });
    if (e.op !== 'joined') throw new Error('The development server did not answer.');
    const link = new DevLink(this, e.id);
    this.links.set(e.id, link);
    return link;
  }
}

let backend: LanBackend | null | undefined;

/** The LAN games' backend here: the desktop app's, the development server's, or none (the web version). */
export function lanBackend(): LanBackend | null {
  if (backend !== undefined) return backend;
  const tauri = typeof window === 'undefined' ? undefined : (window as Window & { __TAURI__?: TauriApi }).__TAURI__;
  if (tauri?.core && tauri.event) backend = new DesktopLan(tauri);
  else if (import.meta.hot) backend = new DevLan(import.meta.hot);
  else backend = null;
  return backend;
}
