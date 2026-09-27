// Builds the HD asset pack (see tools/hd-pack/README in the generated folder).
// Usage: npm run hd:export [-- <output folder>]      (default: ./hd-pack)
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const out = path.resolve(process.argv[2] ?? 'hd-pack');
const r = spawnSync('npx', ['vitest', 'run', 'tools/hd-pack/export.test.ts'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, OMF_HDPACK_OUT: out },
});
process.exit(r.status ?? 1);
