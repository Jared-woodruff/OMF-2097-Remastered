// Imports a delivered consistency rework pack into the game:
//   npm run rework:import [-- <pack folder>] [--robots GARGOYLE,FLAIL] [--no-survey]     (default pack ./rework-pack)
//   npm run rework:import -- --restore [--robots GARGOYLE]       (puts the replaced paintings back)
// 1) the delivered frames replace the robots' paintings in the HD asset pack, the replaced ones are backed up in
// hd-pack/rework-backup (tools/rework/import.py, needs Python 3 with numpy and Pillow), 2) the HD import rebuilds those
// robots' bundles in public/hd (tools/hd-pack/import.mjs --bundles), 3) the consistency survey measures the robots
// again (tools/rework/survey.py into .captures/consistency/after-rework) and compares with the last survey.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
let pack = 'rework-pack';
let robots = '';
const flags = new Set();
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--robots') robots = argv[++i] ?? '';
  else if (argv[i].startsWith('--')) flags.add(argv[i]);
  else pack = argv[i];
}
const python = process.platform === 'win32' ? 'python' : 'python3';
// (one command line: paths with spaces are quoted by the callers)
const run = (cmd, args) => {
  const r = spawnSync([cmd, ...args].join(' '), { stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const result = path.join(os.tmpdir(), `omf-rework-import-${process.pid}.json`);
run(python, ['tools/rework/import.py', `"${path.resolve(pack)}"`, '--result', `"${result}"`,
  ...(robots ? ['--robots', robots] : []), ...(flags.has('--restore') ? ['--restore'] : [])]);
const done = JSON.parse(fs.readFileSync(result, 'utf8'));
fs.rmSync(result, { force: true });
if (done.bundles.length) run('node', ['tools/hd-pack/import.mjs', 'hd-pack', 'public/hd', '--bundles', done.bundles.join(',')]);

if (done.robots.length && !flags.has('--restore') && !flags.has('--no-survey')) {
  const after = path.join('.captures', 'consistency', 'after-rework');
  run(python, ['tools/rework/survey.py', '--robots', done.robots.join(','), '--out', `"${after}"`, '--no-pictures']);
  const scores = (file) => fs.existsSync(file)
    ? Object.fromEntries(JSON.parse(fs.readFileSync(file, 'utf8')).robots.map((r) => [r.robot, r.all.score])) : {};
  const before = scores(path.join('.captures', 'consistency', 'survey.json'));
  const now = scores(path.join(after, 'survey.json'));
  console.log('\nInconsistency (tools/rework/survey.py; the most consistent original robot scores about 0.04):');
  for (const r of done.robots) console.log(`  ${r.padEnd(10)} ${before[r]?.toFixed(3) ?? '  -  '} -> ${now[r]?.toFixed(3) ?? '-'}`);
}
