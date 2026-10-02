// Imports the finished HD asset pack into the game: `npm run hd:import [-- <pack folder>]` (default ./hd-pack).
// 1) game-side metadata (tools/hd-pack/intake-meta.test.ts), 2) image processing and bundles (tools/hd-pack/intake.py,
// needs Python 3 with numpy and Pillow). Output: public/hd/ (served by the web build, embedded in the desktop app).
// 3) The new robots' bundles are their mod's, not the game's: made into the game's folder, they go into the mod's
// package (npm run extras) and back out of the folder (tools/extras/strip-hd.mjs).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
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

if (out === path.resolve('public/hd')) {
  const bundles = JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8')).bundles;
  const mods = ['GLACIER', 'TEMPEST', 'HELIX', 'SPECTRE'].map((n) => `fighter-${n}`).filter((b) => b in bundles);
  if (mods.length) {
    run('node', ['tools/extras-mod.mjs', '--hd', `"${out}"`]);
    run('node', ['tools/extras/strip-hd.mjs', ...mods]);
  }
}
