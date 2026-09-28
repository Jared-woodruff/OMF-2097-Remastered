// Generates the remaster's own content (src/gen) into public/gen: the new robots' fighter files FIGHTR11.AF ..
// FIGHTR14.AF and the new arenas' ARENA5.BK .. ARENA8.BK with their widescreen backgrounds (.WID). The arenas need the
// original game data (npm run extract) for the colors and tables every arena shares.
// Usage: npm run gen [-- <output folder>]   (ROBOT=<name> or ARENA=<name> for one; SKIP_ROBOTS=1 / SKIP_ARENAS=1)
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const out = path.resolve(process.argv[2] ?? 'public/gen');
const r = spawnSync('npx', ['vitest', 'run', 'src/gen/dev/build.test.ts'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, GEN_OUT: out },
});
process.exit(r.status ?? 1);
