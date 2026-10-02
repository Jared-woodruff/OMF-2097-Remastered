// The recording plan of the newsroom's newsreader (see src/audio/newsVoice.ts) for tools/make-news.py (written by
// src/gen/dev/newsPlan.test.ts; npm run news:voice). Every news text (language strings 77..79, 87..134) in each of its
// pronoun versions, with stand-in names filled in and the character ranges of its fixed pieces (kept) and names (cut
// out); and every name the reports can be filled with (the pilots of single player and of the tournaments, the robots,
// the arenas, the stand-ins for typed names) in a carrier sentence for each place a name takes in the texts, with the
// range of the name (kept).
import { getFile } from '../../resources/files';
import { langGet } from '../../resources/resources';
import { parseTournament } from '../../formats/tournament';
import { arenaNewsName } from '../../game/roster';
import {
  nameId, type NameKind, type NamePosition, normName, pieceId, pronounUse, pronounVersion, slotKind, splitNews, standIn,
  withPronouns,
} from '../../audio/newsVoice';

const TEMPLATES = [77, 78, 79, ...Array.from({ length: 48 }, (_, i) => 87 + i)];
const TOURNAMENTS = ['NORTH_AM.TRN', 'KATUSHAI.TRN', 'WAR.TRN', 'WORLD.TRN'];

/** Names the reader would otherwise mispronounce (the screen keeps showing them as they are). */
const SPOKEN: Record<string, string> = {
  iceman: 'Iceman', drlynnyarr: 'Doctor Lynn Yarr', jaqouline: 'Jacqueline', jahrod: 'Jarrod',
};

/**
 * The names filled in while recording a text (cut out again): by pilot and sex, then robots and arena. Words run
 * together in speech, and cuts are clean only in a gap: these begin and end with a stop (p, t, k, b, d), whose closure
 * is a short silence, so the words around them come apart cleanly.
 */
const FILL = { 1: ['Pat', 'Kate'], 2: ['Dirk', 'Bridget'], 3: 'Tank', 4: 'Kodiak', 5: 'Pit' } as const;

/**
 * Carrier sentences of a name in each place ({} is the name, with its 's when possessive). The words next to the
 * name end and begin with stops, for the same reason.
 */
const CARRIER: Record<NameKind, Record<string, string>> = {
  pilot: {
    start: '{} took the arena by storm tonight.',
    mid: 'Everyone knows that {} came to fight tonight.',
    end: 'Tonight the crowd watched {}.',
    'start-s': '{} corner took a beating tonight.',
    'mid-s': 'We saw that {} comeback tonight.',
    'end-s': 'The best fight tonight was {}.',
  },
  robot: {
    start: '{} parts were everywhere tonight.',
    mid: 'They say that {} can take a beating.',
    end: 'Nobody could stop that {}.',
    'start-s': '{} plating took a beating tonight.',
    'mid-s': 'They saw that {} plating crack tonight.',
    'end-s': 'The best armor tonight was that {}.',
  },
  arena: {
    start: '{} crowds packed the stands tonight.',
    mid: 'They packed that {} to capacity tonight.',
    end: 'Tonight they packed that {}.',
  },
};
/**
 * Alternative carriers with a pause before the name, for names that run into the word before them in the carriers
 * above (make-news.py --alt: "watched Shirro" has no quiet moment between the "ch" and the "Sh").
 */
const ALT_CARRIER: Record<NameKind, Record<string, string>> = {
  pilot: {
    mid: 'Tonight, {} came to fight.',
    'mid-s': 'Tonight, {} comeback stunned the crowd.',
    end: "And tonight's winner: {}. What a fight!",
  },
  robot: {
    mid: 'Tonight, {} can take a beating.',
    end: 'The robot of the night: {}. What a machine!',
  },
  arena: {
    mid: 'Tonight, {} was packed to capacity.',
    end: "And tonight's venue: {}. What a crowd!",
  },
};

/** Stand-ins spoken to ("Nice try, challenger."). */
const VOCATIVE_CARRIER: Record<string, string> = {
  mid: 'Not bad {}, keep trying.',
  end: 'Nice try, {}.',
};

export interface Segment {
  /** A kept piece's recording, or none for a name cut out. */
  id?: string;
  from: number;
  to: number;
}

export interface NewsPlan {
  /** The news texts to record: filled in, with the ranges of the pieces kept (id) and of the names cut out. */
  texts: { id: string; text: string; segments: Segment[] }[];
  /** The names to record: a carrier sentence and the range of the name in it. */
  names: { id: string; text: string; from: number; to: number; alt?: { text: string; from: number; to: number } }[];
}

/** The recording plan (needs the game's data: its texts and the tournaments' pilots). */
export function buildNewsPlan(): NewsPlan {
  const texts: { id: string; text: string; segments: Segment[] }[] = [];
  /** The places names take: kind -> 'position' or 'position-s'; stand-ins with whether they are spoken to. */
  const places = new Map<NameKind, Set<string>>([['pilot', new Set()], ['robot', new Set()], ['arena', new Set()]]);
  const standIns = new Map<string, { kind: NameKind; text: string; vocative: boolean; places: Set<string> }>();

  for (const id of TEMPLATES) {
    const template = langGet(id);
    const use = pronounUse(template);
    const sexes = [[0, 0], [1, 0], [0, 1], [1, 1]].filter(([a, b]) => (use & 1 || a === 0) && (use & 2 || b === 0));
    for (const [sex1, sex2] of sexes) {
      const version = pronounVersion(template, sex1, sex2);
      let text = '';
      const segments: Segment[] = [];
      let k = 0;
      for (const p of splitNews(withPronouns(template, sex1, sex2))) {
        if (typeof p === 'string') {
          if (p.trim()) segments.push({ id: pieceId(id, version, k), from: text.length, to: text.length + p.length });
          text += p;
          k++;
          continue;
        }
        const fill = p.key <= 2 ? FILL[p.key as 1 | 2][p.key === 1 ? sex1 : sex2] : FILL[p.key as 3 | 4 | 5];
        const name = fill + (p.possessive ? "'s" : '');
        segments.push({ from: text.length, to: text.length + name.length });
        text += name;
        const kind = slotKind(p.key);
        const place = p.position + (p.possessive ? '-s' : '');
        places.get(kind)!.add(place);
        const si = standIn(p.key, p.vocative);
        if (!standIns.has(`${kind}/${si}`)) standIns.set(`${kind}/${si}`, { kind, text: si, vocative: p.vocative, places: new Set() });
        standIns.get(`${kind}/${si}`)!.places.add(place);
      }
      texts.push({ id: `t${id}${version}`, text, segments });
    }
  }

  // The names: single player's pilots and the tournaments', the robots, the arenas.
  const values = new Map<NameKind, Map<string, string>>([['pilot', new Map()], ['robot', new Map()], ['arena', new Map()]]);
  const add = (kind: NameKind, name: string) => {
    const norm = normName(name);
    if (norm && !values.get(kind)!.has(norm)) values.get(kind)!.set(norm, SPOKEN[norm] ?? name.trim());
  };
  for (let i = 20; i <= 30; i++) add('pilot', langGet(i));
  for (const f of TOURNAMENTS) for (const p of parseTournament(getFile(f), f).enemies) add('pilot', p.name);
  for (let i = 31; i <= 45; i++) add('robot', langGet(i).replace(/\n+$/, ''));
  for (let a = 0; a < 9; a++) add('arena', arenaNewsName(a));

  const names: NewsPlan['names'] = [];
  const carry = (kind: NameKind, norm: string, spoken: string, place: string, vocative: boolean) => {
    const [position, s] = place.split('-');
    const carrier = (vocative ? VOCATIVE_CARRIER[position] : undefined) ?? CARRIER[kind][place];
    if (!carrier) throw new Error(`no carrier for a ${kind} at ${place}`);
    let name = spoken + (s ? "'s" : '');
    if (carrier.startsWith('{}')) name = name[0].toUpperCase() + name.slice(1);
    const from = carrier.indexOf('{}');
    const rec: NewsPlan['names'][number] = { id: nameId(kind, norm, position as NamePosition, !!s), text: carrier.replace('{}', name), from, to: from + name.length };
    const alt = vocative ? undefined : ALT_CARRIER[kind][place];
    if (alt) rec.alt = { text: alt.replace('{}', name), from: alt.indexOf('{}'), to: alt.indexOf('{}') + name.length };
    names.push(rec);
  };
  for (const [kind, map] of values) for (const [norm, spoken] of map) for (const place of places.get(kind)!) carry(kind, norm, spoken, place, false);
  for (const si of standIns.values()) for (const place of si.places) carry(si.kind, normName(si.text), si.text, place, si.vocative);

  return { texts, names };
}
