import { Tag, TAG_TABLE, tagLookup } from './tags';

export interface ScriptTag {
  key: number;
  hasParam: boolean;
  value: number;
}

export class ScriptFrame {
  sprite: number;
  tickLen: number;
  tags: ScriptTag[] = [];
  /** Last value per tag key (later tags override earlier ones, like the reference reverse search). */
  private map = new Map<number, number>();

  constructor(sprite: number, tickLen: number) {
    this.sprite = sprite;
    this.tickLen = tickLen;
  }

  addTag(t: ScriptTag): void {
    this.tags.push(t);
    this.map.set(t.key, t.value);
  }

  has(tag: Tag): boolean {
    return this.map.has(tag);
  }

  get(tag: Tag): number {
    return this.map.get(tag) ?? 0;
  }
}

/** A decoded animation string: a sequence of frames, each with a sprite, duration and tags. */
export class Script {
  readonly frames: ScriptFrame[] = [];
  readonly source: string;
  private starts: number[] = [];
  totalTicks = 0;

  constructor(source: string) {
    this.source = source;
  }

  finalize(): void {
    this.starts = [];
    let pos = 0;
    for (const f of this.frames) {
      this.starts.push(pos);
      pos += f.tickLen;
    }
    this.totalTicks = pos;
  }

  frameCount(): number {
    return this.frames.length;
  }

  frame(i: number): ScriptFrame | null {
    return i >= 0 && i < this.frames.length ? this.frames[i] : null;
  }

  /** Tick position where frame `i` begins (i may equal frameCount for the total). */
  tickPosAtFrame(i: number): number {
    let len = 0;
    for (let k = 0; k < i && k < this.frames.length; k++) len += this.frames[k].tickLen;
    return len;
  }

  frameIndexAt(ticks: number): number {
    if (ticks < 0) return -1;
    let pos = 0;
    for (let i = 0; i < this.frames.length; i++) {
      const next = pos + this.frames[i].tickLen;
      if (pos <= ticks && ticks < next) return i;
      pos = next;
    }
    return -1;
  }

  frameAt(ticks: number): ScriptFrame | null {
    const i = this.frameIndexAt(ticks);
    return i < 0 ? null : this.frames[i];
  }

  isLastFrame(frame: ScriptFrame | null): boolean {
    return frame !== null && frame === this.frames[this.frames.length - 1];
  }

  isFirstFrame(frame: ScriptFrame | null): boolean {
    return frame !== null && frame === this.frames[0];
  }

  /** Index of the next frame (starting strictly after `currentTick`) whose sprite is `sprite`. */
  nextFrameWithSprite(sprite: number, currentTick: number): number {
    if (sprite < 0 || currentTick > this.totalTicks) return -1;
    let pos = 0;
    for (let i = 0; i < this.frames.length; i++) {
      if (currentTick < pos && this.frames[i].sprite === sprite) return i;
      pos += this.frames[i].tickLen;
    }
    return -1;
  }

  nextFrameWithTag(tag: Tag, currentTick: number): number {
    if (currentTick > this.totalTicks) return -1;
    let pos = 0;
    for (let i = 0; i < this.frames.length; i++) {
      if (currentTick < pos && this.frames[i].has(tag)) return i;
      pos += this.frames[i].tickLen;
    }
    return -1;
  }

  frameChanged(tickStart: number, tickStop: number): boolean {
    if (tickStart === tickStop) return false;
    return this.frameAt(tickStart) !== this.frameAt(tickStop);
  }

  lastFrameSprite(): number {
    return this.frameAt(this.totalTicks - 1)?.sprite ?? 0;
  }
}

// ---------------------------------------------------------------------------
// Decoder (mirrors the reference string parser, including its error recovery)

class Stream {
  pos = 0;
  constructor(readonly s: string) {}
  eof(): boolean {
    return this.pos >= this.s.length;
  }
  peek(at = 0): string {
    return this.s[this.pos + at] ?? '\0';
  }
  skip(n: number): void {
    this.pos += n;
  }
  left(): number {
    return this.s.length - this.pos;
  }
  /** Optional sign then digits; clamps to int16. Returns 0 when no digits (sign is still consumed). */
  readLong(): number {
    let sign = 1;
    const c = this.peek();
    if (c === '-') {
      sign = -1;
      this.skip(1);
    } else if (c === '+') {
      this.skip(1);
    }
    let acc = 0;
    let found = false;
    let d = this.peek();
    while (d >= '0' && d <= '9') {
      acc = acc * 10 + (d.charCodeAt(0) - 48);
      this.skip(1);
      found = true;
      d = this.peek();
    }
    if (!found) return 0;
    const v = sign * acc;
    return v < -32768 ? -32768 : v > 32767 ? 32767 : v;
  }
}

const isFrameId = (c: string) => c >= 'A' && c <= 'Z';
const isTagLetter = (c: string) => c >= 'a' && c <= 'z';
const isValueStart = (c: string) => (c >= '0' && c <= '9') || c === '-' || c === '+';

function parseTag(frame: ScriptFrame, s: Stream): boolean {
  if (!isTagLetter(s.peek())) return false;
  const maxLen = Math.min(s.left(), 3);
  for (let len = maxLen; len > 0; len--) {
    const id = tagLookup(s.s.substr(s.pos, len));
    if (id === undefined) continue;
    const hasParam = TAG_TABLE[id][1];
    if (!hasParam && isValueStart(s.peek(len))) continue;
    s.skip(len);
    const value = hasParam ? s.readLong() : 0;
    frame.addTag({ key: id, hasParam, value });
    return true;
  }
  return false;
}

function parseInvalidTag(frame: ScriptFrame, s: Stream): boolean {
  const ch = s.peek();
  if (ch !== 'c' && ch !== 'o' && ch !== 'p' && ch !== 'z') return false;
  frame.addTag({ key: Tag.INVALID, hasParam: false, value: ch.charCodeAt(0) });
  s.skip(1);
  return true;
}

function parseFrame(frame: ScriptFrame, s: Stream): boolean {
  const c = s.peek();
  if (!isFrameId(c)) return false;
  s.skip(1);
  frame.sprite = c.charCodeAt(0) - 65;
  frame.tickLen = s.readLong();
  s.skip(1);
  return true;
}

function decodeNextFrame(frame: ScriptFrame, s: Stream): boolean {
  while (!s.eof()) {
    if (parseFrame(frame, s)) return true;
    if (parseTag(frame, s)) continue;
    if (parseInvalidTag(frame, s)) continue;
    // Skip to the next frame separator.
    while (!s.eof() && s.peek() !== '-') s.skip(1);
    s.skip(1);
    return false;
  }
  return false;
}

export function decodeScript(str: string): Script {
  const script = new Script(str);
  const s = new Stream(str);
  let prev = s.pos;
  while (!s.eof()) {
    const frame = new ScriptFrame(0, 0);
    if (decodeNextFrame(frame, s)) script.frames.push(frame);
    if (prev === s.pos) throw new Error(`Failed to decode animation string '${str}' at ${s.pos}`);
    prev = s.pos;
  }
  script.finalize();
  return script;
}

const cache = new Map<string, Script>();

/** Decoded scripts are immutable, so they are shared through a cache keyed by source string. */
export function getScript(str: string): Script {
  let s = cache.get(str);
  if (!s) {
    s = decodeScript(str);
    cache.set(str, s);
  }
  return s;
}

/** Tick cursor over a script, with previous-tick tracking to detect frame changes. */
export class ScriptReader {
  script: Script | null = null;
  tick = 0;
  previousTick = 0xffffffff;

  load(script: Script | null): void {
    this.script = script;
    this.reset();
  }

  reset(): void {
    this.tick = 0;
    this.previousTick = 0xffffffff;
  }

  seek(tick: number): void {
    this.tick = tick >>> 0;
  }

  advance(n: number): void {
    this.tick = (this.tick + n) >>> 0;
  }

  markPrevious(): void {
    this.previousTick = this.tick;
  }

  markEntered(): void {
    this.previousTick = (this.tick - 1) >>> 0;
  }

  frame(): ScriptFrame | null {
    if (!this.script) return null;
    // Ticks are unsigned in the reference; huge values resolve to "no frame".
    return this.tick >= 0x80000000 ? null : this.script.frameAt(this.tick);
  }

  isSet(tag: Tag): boolean {
    return this.frame()?.has(tag) ?? false;
  }

  get(tag: Tag): number {
    return this.frame()?.get(tag) ?? 0;
  }

  frameChanged(): boolean {
    if (!this.script) return false;
    if (this.previousTick === this.tick) return false;
    const a = this.previousTick >= 0x80000000 ? null : this.script.frameAt(this.previousTick);
    return a !== this.frame();
  }
}
