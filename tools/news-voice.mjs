// Makes the newsroom newsreader's recordings (see tools/make-news.py): npm run news:voice [-- <make-news options>]
// 1) the recording plan (src/gen/dev/newsPlan.test.ts, from the game's texts and names), 2) the recordings
// (tools/make-news.py: ElevenLabs, needs ELEVENLABS_API_KEY, Python 3 with numpy, and ffmpeg).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const plan = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'news-')), 'plan.json');
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('npx', ['vitest', 'run', 'src/gen/dev/newsPlan.test.ts'], { NEWS_PLAN: plan });
run(process.platform === 'win32' ? 'python' : 'python3', ['tools/make-news.py', `"${plan}"`, ...process.argv.slice(2)]);
