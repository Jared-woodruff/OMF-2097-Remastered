// Builds the HD asset pack (see tools/hd-pack/README in the generated folder).
// Usage: npm run hd:export [-- [<output folder>] [--force]]      (default: ./hd-pack)
// The export empties the folder first: it refuses to run over delivered paintings (*.hd.png) unless given --force.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { deliveredRefusal } from './delivered.mjs';

const argv = process.argv.slice(2);
const force = argv.includes('--force');
const out = path.resolve(argv.find((a) => !a.startsWith('--')) ?? 'hd-pack');
const refusal = force ? null : deliveredRefusal(out, 'hd:export');
if (refusal) {
  console.error(refusal);
  process.exit(1);
}
const r = spawnSync('npx', ['vitest', 'run', 'tools/hd-pack/export.test.ts'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, OMF_HDPACK_OUT: out, OMF_HDPACK_FORCE: force ? '1' : '0' },
});
process.exit(r.status ?? 1);
