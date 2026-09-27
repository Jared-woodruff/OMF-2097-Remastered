// Imports the finished HD asset pack into the game: `npm run hd:import [-- <pack folder>]` (default ./hd-pack).
// 1) game-side metadata (tools/hd-pack/intake-meta.test.ts), 2) image processing and bundles (tools/hd-pack/intake.py,
// needs Python 3 with numpy and Pillow). Output: public/hd/ (served by the web build, embedded in the desktop app).
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const pack = path.resolve(process.argv[2] ?? 'hd-pack');
const out = path.resolve(process.argv[3] ?? 'public/hd');
const extra = process.argv.slice(4);

const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('npx', ['vitest', 'run', 'tools/hd-pack/intake-meta.test.ts'], { OMF_HDPACK_DIR: pack });
run(process.platform === 'win32' ? 'python' : 'python3', ['tools/hd-pack/intake.py', `"${pack}"`, `"${out}"`, ...extra]);
