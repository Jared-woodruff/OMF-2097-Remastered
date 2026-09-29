// Imports the new-art pack's deliveries into the game: `npm run newart:import [-- <pack folder>]` (default ./newart-pack).
// 1) the arenas' paintings and the robots' frames (tools/newart/import.py, needs Python 3 with numpy and Pillow),
// 2) the painted arenas' scene files rebuilt from their paintings (npm run gen, those arenas only), 3) the robots'
// frames imported with the HD asset pack into public/hd (tools/hd-pack/import.mjs, only their bundles).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const pack = path.resolve(process.argv[2] ?? 'newart-pack');
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run(process.platform === 'win32' ? 'python' : 'python3', ['tools/newart/import.py', `"${pack}"`]);
const done = JSON.parse(fs.readFileSync(path.join(pack, 'import.json'), 'utf8'));
if (done.arenas.length) run('node', ['tools/gen-content.mjs'], { SKIP_ROBOTS: '1', ARENA: done.arenas.join(',') });
if (done.bundles.length) run('node', ['tools/hd-pack/import.mjs', 'hd-pack', 'public/hd', '--bundles', done.bundles.join(',')]);
