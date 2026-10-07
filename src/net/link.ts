// A connection between two games: text messages arrive in the order they were sent, until it closes. The LAN games'
// is a TCP connection of the desktop app (net/lan.ts); the tests use a pair of loopback links.

export interface NetLink {
  /** Where the other end is (an address to show). */
  readonly peer: string;
  send(text: string): void;
  /** Closes the connection (the other end hears of it). */
  close(): void;
  /** Messages and the end of the connection; what arrives before they are set waits for them. */
  setHandlers(onMessage: (text: string) => void, onClose: (reason: string) => void): void;
  /** Takes the handlers away: what arrives waits for the next ones. */
  detach(): void;
}

/**
 * The common part of a link: messages and a close that arrive before the handlers are set are kept for them (the
 * lobby hands the link over to the game, and a message must not fall between the two).
 */
export abstract class QueuedLink implements NetLink {
  private queue: string[] = [];
  private closedWith: string | null = null;
  private onMessage: ((text: string) => void) | null = null;
  private onClose: ((reason: string) => void) | null = null;
  closed = false;

  constructor(readonly peer: string) {}

  abstract send(text: string): void;
  protected abstract shut(): void;

  setHandlers(onMessage: (text: string) => void, onClose: (reason: string) => void): void {
    this.onMessage = onMessage;
    this.onClose = onClose;
    // (a handler may detach itself on the way: the rest waits for the next one)
    while (this.queue.length && this.onMessage) this.onMessage(this.queue.shift()!);
    if (this.closedWith !== null && !this.queue.length) this.onClose?.(this.closedWith);
  }

  detach(): void {
    this.onMessage = null;
    this.onClose = null;
  }

  /** A message came in. */
  deliver(text: string): void {
    if (this.closedWith !== null) return;
    if (this.onMessage) this.onMessage(text);
    else this.queue.push(text);
  }

  /** The other end closed (or the connection broke). */
  ended(reason: string): void {
    if (this.closedWith !== null) return;
    this.closedWith = reason;
    this.closed = true;
    // (a close that comes while nobody listens is told to the next handlers, after the messages before it)
    this.onClose?.(reason);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.closedWith = 'closed';
    this.shut();
  }
}

/** One end of an in-memory connection (tests): messages reach the other end after `latency` of the pair's clock. */
export class LoopbackLink extends QueuedLink {
  other!: LoopbackLink;
  constructor(private pair: LoopbackPair, peer: string) {
    super(peer);
  }

  send(text: string): void {
    if (this.closed) return;
    this.pair.post(this.other, text);
  }

  protected shut(): void {
    this.pair.post(this.other, null);
  }
}

/** Two linked loopback ends and their clock: `run(now)` delivers what has arrived by then. */
export class LoopbackPair {
  readonly a: LoopbackLink;
  readonly b: LoopbackLink;
  private inFlight: { at: number; to: LoopbackLink; text: string | null }[] = [];
  now = 0;

  constructor(public latency = 0) {
    this.a = new LoopbackLink(this, 'loopback b');
    this.b = new LoopbackLink(this, 'loopback a');
    this.a.other = this.b;
    this.b.other = this.a;
  }

  post(to: LoopbackLink, text: string | null): void {
    this.inFlight.push({ at: this.now + this.latency, to, text });
  }

  /** Delivers the messages due by `now`, in the order they were sent. */
  run(now = this.now): void {
    this.now = now;
    while (this.inFlight.length && this.inFlight[0].at <= now) {
      const m = this.inFlight.shift()!;
      if (m.text === null) m.to.ended('the other game left');
      else m.to.deliver(m.text);
    }
  }
}
