// Builds the new-art pack: the remaster's own robots and arenas, for an image generation AI to redraw at the level of
// the originals' HD artwork (see the README in the generated folder).
// Usage: npm run newart:export [-- <output folder>]      (default: ./newart-pack, zipped next to it)
// 1) the robots' jobs, prompts and docs (tools/hd-pack/export.test.ts in its new-art mode), 2) the arenas' guides, the
// reference sheets and the zip (tools/newart/prepare.py, needs Python 3 with Pillow; the originals' references come
// from the HD asset pack in ./hd-pack). Deliveries already in the folder (*.hd.png) are left alone.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const out = path.resolve(process.argv[2] ?? 'newart-pack');
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('npx', ['vitest', 'run', 'tools/hd-pack/export.test.ts'], { OMF_HDPACK_OUT: out, OMF_HDPACK_NEWART: '1' });
run(process.platform === 'win32' ? 'python' : 'python3', ['tools/newart/prepare.py', `"${out}"`]);
