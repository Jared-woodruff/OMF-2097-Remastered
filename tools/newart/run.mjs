// Builds the new-art pack: the remaster's own robots and arenas, for an image generation AI to redraw at the level of
// the originals' HD artwork (see the README in the generated folder).
// Usage: npm run newart:export [-- [<output folder>] [--force]]      (default: ./newart-pack, zipped next to it)
// 1) the robots' jobs, prompts and docs (tools/hd-pack/export.test.ts in its new-art mode), 2) the arenas' guides, the
// reference sheets and the zip (tools/newart/prepare.py, needs Python 3 with Pillow; the originals' references come
// from the HD asset pack in ./hd-pack). The export empties the folder first: it refuses to run over deliveries
// (*.hd.png; npm run newart:import brings them into the game) unless given --force.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { deliveredRefusal } from '../hd-pack/delivered.mjs';

const argv = process.argv.slice(2);
const force = argv.includes('--force');
const out = path.resolve(argv.find((a) => !a.startsWith('--')) ?? 'newart-pack');
const refusal = force ? null : deliveredRefusal(out, 'newart:export');
if (refusal) {
  console.error(refusal);
  process.exit(1);
}
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('npx', ['vitest', 'run', 'tools/hd-pack/export.test.ts'],
  { OMF_HDPACK_OUT: out, OMF_HDPACK_NEWART: '1', OMF_HDPACK_FORCE: force ? '1' : '0' });
run(process.platform === 'win32' ? 'python' : 'python3', ['tools/newart/prepare.py', `"${out}"`]);
