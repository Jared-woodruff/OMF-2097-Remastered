// The newsroom's newsreader (src/audio/newsVoice.ts): its recording plan covers every report it can read. Each news
// text in each pronoun version is read from recordings the plan makes, whatever the names: every pilot of single
// player and of the tournaments, every robot and arena, and names the player typed in (read as stand-ins).
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { newsRecordings, splitNews, withPronouns, type NewsReadNames } from '../audio/newsVoice';
import { buildNewsPlan, type NewsPlan } from '../gen/dev/newsPlan';
import { getFile } from '../resources/files';
import { langGet } from '../resources/resources';
import { parseTournament } from '../formats/tournament';
import { arenaNewsName } from '../game/roster';
import { newsReadNames } from '../game/scenes/newsroom';
import { hasGameData, loadGameData } from './harness';

const TEMPLATES = [77, 78, 79, ...Array.from({ length: 48 }, (_, i) => 87 + i)];

describe.skipIf(!hasGameData)('newsreader', () => {
  let plan: NewsPlan;
  let have: (id: string) => boolean;
  beforeAll(() => {
    loadGameData();
    plan = buildNewsPlan();
    const ids = new Set([...plan.texts.flatMap((t) => t.segments.flatMap((s) => (s.id ? [s.id] : []))), ...plan.names.map((n) => n.id)]);
    have = (id) => ids.has(id);
  });

  it('splits a text into pieces and names with their places', () => {
    const pieces = splitNews(withPronouns(langGet(97), 0, 1));
    expect(pieces).toEqual([
      'The ', { key: 5, possessive: false, position: 'mid', vocative: false },
      ' was rocked tonight by the impressive ', { key: 1, possessive: false, position: 'end', vocative: false },
      '.  ', { key: 2, possessive: false, position: 'start', vocative: false },
      ' needs some more practice before she can beat the likes of him.',
    ]);
    expect(splitNews('Nice try ~1.')[1]).toMatchObject({ key: 1, position: 'end', vocative: true });
    expect(splitNews("after ~1's fight")[1]).toMatchObject({ key: 1, possessive: true, position: 'mid' });
  });

  it('reads every report whatever the names', () => {
    const pilots = [...Array.from({ length: 11 }, (_, i) => langGet(20 + i))];
    for (const f of ['NORTH_AM.TRN', 'KATUSHAI.TRN', 'WAR.TRN', 'WORLD.TRN']) pilots.push(...parseTournament(getFile(f), f).enemies.map((p) => p.name.trim()));
    pilots.push('Zyxxor the Typed');
    const robots = [...Array.from({ length: 15 }, (_, i) => langGet(31 + i).replace(/\n+$/, '')), 'Mecha Custom'];
    const arenas = Array.from({ length: 9 }, (_, a) => arenaNewsName(a));
    const base: NewsReadNames = { pilot1: 'Crystal', pilot2: 'Shirro', robot1: 'Jaguar', robot2: 'Katana', arena: 'Stadium', sex1: 1, sex2: 0 };
    let reads = 0;
    for (const id of TEMPLATES) {
      for (const [sex1, sex2] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
        // Each name in turn through all its values, the others as in `base`.
        const cases: NewsReadNames[] = [
          ...pilots.map((p) => ({ ...base, sex1, sex2, pilot1: p })),
          ...pilots.map((p) => ({ ...base, sex1, sex2, pilot2: p })),
          ...robots.map((r) => ({ ...base, sex1, sex2, robot1: r, robot2: r })),
          ...arenas.map((a) => ({ ...base, sex1, sex2, arena: a })),
        ];
        for (const n of cases) {
          const ids = newsRecordings(id, langGet(id), n, have);
          expect(ids, `text ${id} with ${JSON.stringify(n)}`).not.toBeNull();
          reads++;
        }
      }
    }
    expect(reads).toBeGreaterThan(10000);
  });

  it('has every recording of the plan in both voices', () => {
    // (public/audio/news/<voice>/index.json lists the recordings made; npm run news:voice makes the missing ones)
    const dir = path.resolve(__dirname, '../../public/audio/news');
    if (!fs.existsSync(dir)) return;
    const wanted = [...plan.texts.flatMap((t) => t.segments.flatMap((s) => (s.id ? [s.id] : []))), ...plan.names.map((n) => n.id)];
    for (const voice of ['male', 'female']) {
      const index = JSON.parse(fs.readFileSync(path.join(dir, voice, 'index.json'), 'utf8')) as { recordings: string[] };
      const have = new Set(index.recordings);
      expect(wanted.filter((id) => !have.has(id)), `${voice}: recordings missing (npm run news:voice)`).toEqual([]);
      for (const id of index.recordings) expect(fs.existsSync(path.join(dir, voice, `${id}.mp3`)), `${voice}/${id}.mp3`).toBe(true);
    }
  });

  it('reads the names the newsroom shows', () => {
    // (the newsroom's own names: a single player report with the new robots and arenas)
    const n = newsReadNames({ pilot1: 'Angel', pilot2: 'Major Kreissack', har1: 12, har2: 10, sex1: 1, sex2: 0, arena: 7 });
    expect(n).toMatchObject({ robot1: 'Tempest', robot2: 'Nova', arena: 'Rooftop Arena' });
    for (const id of TEMPLATES) expect(newsRecordings(id, langGet(id), n, have), `text ${id}`).not.toBeNull();
  });
});
