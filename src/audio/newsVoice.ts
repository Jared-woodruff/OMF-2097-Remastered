// The newsroom's newsreader (not in the original game): reads each news report aloud in the announcer's voice
// (OPTIONS > SOUND > ANNOUNCER). A report is one of the game's text templates with the pilots', robots' and arena's
// names filled in, so the reading is stitched: every template is recorded once per pronoun version (he / she said in
// place) and cut where the names go, and every name is recorded in the intonation of its place in a sentence (starting
// it, inside it, ending it, possessive). tools/make-news.py makes the recordings (audio/news/<voice>/) from the plan
// that src/gen/dev/newsPlan.test.ts writes with the functions below. A name without a recording (one typed in by the
// player) is read as a stand-in: "the challenger", "the opponent", "robot".
import type { Settings } from '../game/settings';
import { settings } from '../game/settings';
import { langGet } from '../resources/resources';
import { audio } from './audio';

/** Language string of the pronouns: his, her, him, her, he, she (reference LANG_STR_PRONOUN). */
const LANG_PRONOUN = 81;

export type NamePosition = 'start' | 'mid' | 'end';
export type NameKind = 'pilot' | 'robot' | 'arena';

/** Where a name goes in a report's text. */
export interface NewsSlot {
  /** ~1 / ~2 the pilots, ~3 / ~4 their robots, ~5 the arena. */
  key: number;
  /** Said with a possessive 's. */
  possessive: boolean;
  position: NamePosition;
  /** The pilot is spoken to ("Nice try, ~1."): a stand-in drops its article. */
  vocative: boolean;
}

export type NewsPiece = string | NewsSlot;

export function slotKind(key: number): NameKind {
  return key <= 2 ? 'pilot' : key <= 4 ? 'robot' : 'arena';
}

/** A name as the recordings file it: lower case letters and digits ("Jean-Paul" and "Jean Paul" are one). */
export function normName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The pronoun versions a template has: which pilots' pronouns it uses (bit 0: pilot 1's ~6..~8, bit 1: ~9..~11). */
export function pronounUse(template: string): number {
  return (/~[678](?!\d)/.test(template) ? 1 : 0) | (/~(9|10|11)(?!\d)/.test(template) ? 2 : 0);
}

/** The pronoun version of a template for the pilots' sexes (0 male, 1 female): 'm' / 'f' per pilot, 'x' unused. */
export function pronounVersion(template: string, sex1: number, sex2: number): string {
  const use = pronounUse(template);
  return (use & 1 ? (sex1 ? 'f' : 'm') : 'x') + (use & 2 ? (sex2 ? 'f' : 'm') : 'x');
}

function pronoun(offset: number, sex: number): string {
  // (as the newsroom shows them: trailing newlines dropped, at most 8 characters)
  return langGet(LANG_PRONOUN + offset + sex).replace(/\n+$/, '').slice(0, 8);
}

/** The template in a pronoun version: the pronouns in place, the names left as ~1..~5. */
export function withPronouns(template: string, sex1: number, sex2: number): string {
  return template
    .replace(/~11/g, pronoun(4, sex2)).replace(/~10/g, pronoun(2, sex2)).replace(/~9/g, pronoun(0, sex2))
    .replace(/~8/g, pronoun(4, sex1)).replace(/~7/g, pronoun(2, sex1)).replace(/~6/g, pronoun(0, sex1))
    .trim();
}

/** A report's text (pronouns in place) as the reader says it: fixed texts and the names' slots, in order. */
export function splitNews(text: string): NewsPiece[] {
  const out: NewsPiece[] = [];
  const re = /~([1-5])/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let end = m.index + m[0].length;
    const possessive = text.startsWith("'s", end);
    if (possessive) end += 2;
    const before = text.slice(0, m.index).trimEnd();
    const after = text.slice(end);
    const start = before === '' || /[.!?]$/.test(before);
    const ends = /^\s*([.!?]|$)/.test(after);
    const vocative = !start && /(,|\btry|\bWell)$/.test(before) && /^[.!,]/.test(after);
    out.push(text.slice(last, m.index));
    out.push({ key: Number(m[1]), possessive, position: start ? 'start' : ends ? 'end' : 'mid', vocative });
    last = end;
  }
  out.push(text.slice(last));
  return out;
}

/** The recording of a report's k-th fixed text. */
export function pieceId(templateId: number, version: string, k: number): string {
  return `t${templateId}${version}-${k}`;
}

/** The recording of a name in a place. */
export function nameId(kind: NameKind, norm: string, position: NamePosition, possessive: boolean): string {
  return `${kind}-${norm}-${position}${possessive ? '-s' : ''}`;
}

/** What is said for a name without a recording (typed in by the player; every arena has one). */
export function standIn(key: number, vocative: boolean): string {
  if (key === 1) return vocative ? 'challenger' : 'the challenger';
  if (key === 2) return vocative ? 'opponent' : 'the opponent';
  return key === 5 ? 'arena' : 'robot';
}

/** The names a report is filled in with, as the newsroom shows them. */
export interface NewsReadNames {
  pilot1: string;
  pilot2: string;
  /** The robots' and the arena's names as shown. */
  robot1: string;
  robot2: string;
  arena: string;
  sex1: number;
  sex2: number;
}

/** The recordings (in order) that read a report, or null when a piece of it was not recorded. */
export function newsRecordings(templateId: number, template: string, n: NewsReadNames, have: (id: string) => boolean): string[] | null {
  const version = pronounVersion(template, n.sex1, n.sex2);
  const pieces = splitNews(withPronouns(template, n.sex1, n.sex2));
  const names: Record<number, string> = { 1: n.pilot1, 2: n.pilot2, 3: n.robot1, 4: n.robot2, 5: n.arena };
  const out: string[] = [];
  let k = 0;
  for (const p of pieces) {
    if (typeof p === 'string') {
      if (p.trim()) {
        const id = pieceId(templateId, version, k);
        if (!have(id)) return null;
        out.push(id);
      }
      k++;
      continue;
    }
    const kind = slotKind(p.key);
    let id = nameId(kind, normName(names[p.key]), p.position, p.possessive);
    if (!have(id)) id = nameId(kind, normName(standIn(p.key, p.vocative)), p.position, p.possessive);
    if (!have(id)) return null;
    out.push(id);
  }
  return out;
}

type Voice = Exclude<Settings['sound']['announcer'], 'off'>;

/** The recordings a voice has (audio/news/<voice>/index.json), and the decoded ones. */
const indexes = new Map<Voice, Promise<Set<string> | null>>();
const buffers = new Map<string, Promise<AudioBuffer | null>>();

function indexOf(voice: Voice): Promise<Set<string> | null> {
  let p = indexes.get(voice);
  if (!p) {
    p = fetch(`audio/news/${voice}/index.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((j: { recordings: string[] }) => new Set(j.recordings))
      .catch(() => null); // no recordings: the news is not read
    indexes.set(voice, p);
  }
  return p;
}

function recording(voice: Voice, id: string): Promise<AudioBuffer | null> {
  const key = `${voice}/${id}`;
  let p = buffers.get(key);
  if (!p) {
    p = fetch(`audio/news/${key}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
      .then((data) => audio.decode(data))
      .catch(() => null);
    buffers.set(key, p);
  }
  return p;
}

/** Seconds of silence before a report is read, and between the recordings of one (they carry their own pauses). */
const LEAD_IN = 0.35;
const JOIN = 0.015;

/** Reads the newsroom's reports; one at a time. */
class NewsReader {
  /** Bumped by every say / stop: a report still loading when it changes is not read. */
  private token = 0;

  /** Reads a report (the news text `templateId` = its language string, filled with `names`) in the chosen voice. */
  say(templateId: number, names: NewsReadNames): void {
    this.stop();
    const voice = settings().sound.announcer;
    if (voice === 'off' || typeof fetch === 'undefined') return;
    const token = this.token;
    const template = langGet(templateId);
    void (async () => {
      const have = await indexOf(voice);
      if (!have || token !== this.token) return;
      const ids = newsRecordings(templateId, template, names, (id) => have.has(id));
      if (!ids) return;
      const bufs = await Promise.all(ids.map((id) => recording(voice, id)));
      if (token !== this.token || bufs.some((b) => !b)) return;
      audio.playSequence(bufs as AudioBuffer[], (settings().sound.soundVol / 10) * 0.95, LEAD_IN, JOIN);
    })();
  }

  /** Stops the report being read (fading out). */
  stop(): void {
    this.token++;
    audio.stopSequence();
  }
}

export const newsReader = new NewsReader();
