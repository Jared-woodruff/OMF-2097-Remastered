// Builds the main menu's layer pack for an image generation AI (see the README in the generated folder):
// npm run menu:export [-- <output folder>]      (default: ./menu-pack)
// 1) dumps MAIN.BK (tools/menu-pack/dump.test.ts), 2) masks, guides, prompts and docs (tools/menu-pack/export.py,
// needs Python 3 with numpy and Pillow).
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const out = path.resolve(process.argv[2] ?? 'menu-pack');
const work = path.join(out, '.work');
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('npx', ['vitest', 'run', 'tools/menu-pack/dump.test.ts'], { OMF_MENUPACK_WORK: work });
run(process.platform === 'win32' ? 'python' : 'python3', ['tools/menu-pack/export.py', `"${out}"`]);
