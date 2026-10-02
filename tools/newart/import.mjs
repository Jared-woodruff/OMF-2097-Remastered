// Imports the new-art pack's deliveries into the game: `npm run newart:import [-- <pack folder>]` (default ./newart-pack).
// 0) where the robots' spines need a core drawn in (src/gen/dev/spineCore.test.ts, into <pack>/spine_cores.json),
// 1) the arenas' paintings and the robots' frames (tools/newart/import.py, needs Python 3 with numpy and Pillow),
// 2) the painted arenas' scene files rebuilt from their paintings (npm run gen, those arenas only, into a work folder),
// 3) the robots' frames made into HD bundles with the HD asset pack (tools/hd-pack/import.mjs, only their bundles, into
// a work folder: they are not the game's own), 4) all of it put in the new robots and arenas' mod package (npm run
// extras: public/mods; what was not delivered stays as the package has it).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pack = path.resolve(process.argv[2] ?? 'newart-pack');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'omf-newart-'));
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
  if (r.status !== 0) {
    fs.rmSync(work, { recursive: true, force: true });
    process.exit(r.status ?? 1);
  }
};

run('npx', ['vitest', 'run', 'src/gen/dev/spineCore.test.ts'], { SPINE_CORES: path.join(pack, 'spine_cores.json') });
run(process.platform === 'win32' ? 'python' : 'python3', ['tools/newart/import.py', `"${pack}"`]);
const done = JSON.parse(fs.readFileSync(path.join(pack, 'import.json'), 'utf8'));
const extras = [];
if (done.arenas.length) {
  const gen = path.join(work, 'gen');
  run('node', ['tools/gen-content.mjs', `"${gen}"`], { SKIP_ROBOTS: '1', ARENA: done.arenas.join(',') });
  extras.push('--gen', `"${gen}"`, '--arena-hd', `"${path.join(pack, 'out', 'arenas')}"`);
}
if (done.bundles.length) {
  // (the importer rebuilds only the bundles named when the folder has the game's index: the same colors table)
  const hd = path.join(work, 'hd');
  fs.mkdirSync(hd);
  fs.copyFileSync('public/hd/index.json', path.join(hd, 'index.json'));
  run('node', ['tools/hd-pack/import.mjs', 'hd-pack', `"${hd}"`, '--bundles', done.bundles.join(',')]);
  extras.push('--hd', `"${hd}"`);
}
if (extras.length) run('node', ['tools/extras-mod.mjs', ...extras]);
fs.rmSync(work, { recursive: true, force: true });
