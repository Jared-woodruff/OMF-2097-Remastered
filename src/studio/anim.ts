// Animation strings for editing (OMF Studio). The engine's decoder (script/script.ts) keeps what it plays; Studio needs
// every character back when it writes a string it did not change, and a structure to edit: frames (a sprite letter
// and a duration) with their tags. The tokens below keep the source text of everything, including what the engine
// skips (stray characters: the original files have a couple of hundred), so an unedited string is written back as it
// was, and an edited one changes only where it was edited.
import { Tag, TAG_TABLE, tagLookup } from '../script/tags';

export interface AnimTag {
  /** The tag's name ("s", "x+", "bpd"); '' for text the engine skips. */
  name: string;
  /** Its number (tags that take one), else null. */
  value: number | null;
  /** The source text. */
  raw: string;
}

export interface AnimFrame {
  tags: AnimTag[];
  /** Sprite index (0 = A .. 25 = Z). */
  sprite: number;
  /** Duration in ticks. */
  ticks: number;
  /** The source text of the sprite letter, the duration and the separator after it ("A3-"). */
  raw: string;
}

export interface AnimTokens {
  frames: AnimFrame[];
  /** Text after the last frame (the engine ignores it). */
  trailing: AnimTag[];
}

const isUpper = (c: string) => c >= 'A' && c <= 'Z';
const isLower = (c: string) => c >= 'a' && c <= 'z';
const isValueStart = (c: string | undefined) => c !== undefined && ((c >= '0' && c <= '9') || c === '-' || c === '+');

/** Reads a number like the engine (optional sign, digits; clamped to 16 bits); returns [value, length]. */
function readLong(s: string, at: number): [number, number] {
  let i = at, sign = 1;
  if (s[i] === '-') {
    sign = -1;
    i++;
  } else if (s[i] === '+') {
    i++;
  }
  let acc = 0, found = false;
  while (i < s.length && s[i] >= '0' && s[i] <= '9') {
    acc = acc * 10 + (s.charCodeAt(i) - 48);
    i++;
    found = true;
  }
  const v = found ? Math.max(-32768, Math.min(32767, sign * acc)) : 0;
  return [v, i - at];
}

/** Splits an animation string into frames and tags, keeping every character. */
export function parseAnim(src: string): AnimTokens {
  const frames: AnimFrame[] = [];
  let tags: AnimTag[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (isUpper(c)) {
      const [ticks, n] = readLong(src, i + 1);
      // (the engine skips one character after the duration: the '-')
      const end = Math.min(src.length, i + 1 + n + 1);
      frames.push({ tags, sprite: c.charCodeAt(0) - 65, ticks, raw: src.slice(i, end) });
      tags = [];
      i = end;
      continue;
    }
    if (isLower(c)) {
      let matched = false;
      for (let len = Math.min(3, src.length - i); len > 0 && !matched; len--) {
        const name = src.substr(i, len);
        const id = tagLookup(name);
        if (id === undefined) continue;
        const hasParam = TAG_TABLE[id][1];
        if (!hasParam && isValueStart(src[i + len])) continue;
        let n = len, value: number | null = null;
        if (hasParam) {
          const [v, m] = readLong(src, i + len);
          value = v;
          n += m;
        }
        tags.push({ name, value, raw: src.slice(i, i + n) });
        i += n;
        matched = true;
      }
      if (matched) continue;
      if (c === 'c' || c === 'o' || c === 'p' || c === 'z') {
        // (a stray letter the engine reads as an invalid tag)
        tags.push({ name: '', value: null, raw: c });
        i++;
        continue;
      }
    }
    // Text the engine skips, up to and with the next '-': it drops the frame it was reading with the tags so far, so
    // they become skipped text too.
    let j = i;
    while (j < src.length && src[j] !== '-') j++;
    j = Math.min(src.length, j + 1);
    tags = [{ name: '', value: null, raw: tags.map((g) => g.raw).join('') + src.slice(i, j) }];
    i = j;
  }
  return { frames, trailing: tags };
}

/** The text of a tag with a (new) value. */
export function tagText(name: string, value: number | null): string {
  return value === null ? name : `${name}${value}`;
}

/** Writes tokens back as an animation string. */
export function formatAnim(t: AnimTokens): string {
  let out = '';
  for (const f of t.frames) {
    for (const g of f.tags) out += g.raw;
    out += f.raw;
  }
  for (const g of t.trailing) out += g.raw;
  return out;
}

/** A frame's source text for a sprite and a duration (with the separator unless it is the last frame). */
export function frameText(sprite: number, ticks: number, last: boolean): string {
  return `${String.fromCharCode(65 + sprite)}${ticks}${last ? '' : '-'}`;
}

/** A new frame. */
export function newFrame(sprite: number, ticks: number, tags: AnimTag[] = [], last = false): AnimFrame {
  return { tags, sprite, ticks, raw: frameText(sprite, ticks, last) };
}

/**
 * Whether a frame's tags read back as written: the file has nothing between them, so a tag without a value can run
 * into the next one and read as a longer tag ("u" then "br" reads as "ub" then "r").
 */
export function tagsReadBack(tags: AnimTag[]): boolean {
  const back = parseAnim(`${tags.map((g) => g.raw).join('')}A1`).frames[0]?.tags ?? [];
  return back.length === tags.length && back.every((g, i) => g.name === tags[i].name && g.value === tags[i].value);
}

/** Adds a tag to a frame where it reads back as itself (last if it can); false when there is no such place. */
export function addTag(f: AnimFrame, tag: AnimTag): boolean {
  for (let at = f.tags.length; at >= 0; at--) {
    const tags = [...f.tags.slice(0, at), tag, ...f.tags.slice(at)];
    if (tagsReadBack(tags)) {
      f.tags = tags;
      return true;
    }
  }
  return false;
}

/** A new tag (its value clamped to what the engine reads). */
export function newTag(name: string, value: number | null): AnimTag {
  const v = value === null ? null : Math.max(-32768, Math.min(32767, Math.round(value)));
  return { name, value: v, raw: tagText(name, v) };
}

/** Sets a frame's sprite and duration (its text rewritten, keeping its separator). */
export function setFrame(f: AnimFrame, sprite: number, ticks: number): void {
  const sep = f.raw.endsWith('-') ? '-' : '';
  f.sprite = sprite;
  f.ticks = Math.max(0, Math.min(32767, Math.round(ticks)));
  f.raw = `${String.fromCharCode(65 + sprite)}${f.ticks}${sep}`;
}

/** Makes every frame but the last end with the separator (after frames were added, removed or moved). */
export function fixSeparators(t: AnimTokens): void {
  t.frames.forEach((f, i) => {
    const last = i === t.frames.length - 1 && t.trailing.length === 0;
    const has = f.raw.endsWith('-');
    if (!last && !has) f.raw += '-';
    // (a last frame keeps a separator it had: the engine does not mind either way)
  });
}

/** The total duration in ticks. */
export function totalTicks(t: AnimTokens): number {
  return t.frames.reduce((a, f) => a + f.ticks, 0);
}

/** The frame playing at a tick (the last one after the end). */
export function frameAtTick(t: AnimTokens, tick: number): number {
  let pos = 0;
  for (let i = 0; i < t.frames.length; i++) {
    pos += t.frames[i].ticks;
    if (tick < pos) return i;
  }
  return t.frames.length - 1;
}

/** Whether a tag name is one the engine knows. */
export function knownTag(name: string): boolean {
  return tagLookup(name) !== undefined;
}

/** Whether a tag takes a number. */
export function tagHasValue(name: string): boolean {
  const id = tagLookup(name);
  return id !== undefined && TAG_TABLE[id][1];
}

/** The engine's tag id of a name (for descriptions), or -1. */
export function tagId(name: string): number {
  return tagLookup(name) ?? -1;
}

export { Tag };
