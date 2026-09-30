// Generates the remaster's own content (src/gen): the new robots' fighter files FIGHTR11.AF .. FIGHTR14.AF and the new
// arenas' ARENA5.BK .. ARENA8.BK with their widescreen backgrounds (.WID), and puts them in their mod's package
// (public/mods, `npm run extras`: the HD pictures of sprites that did not change stay). The arenas need the original
// game data (npm run extract) for the colors and tables every arena shares.
// Usage: npm run gen [-- <output folder>]   (with a folder: only the files, there; ROBOT=<name> or ARENA=<name> for
// one; SKIP_ROBOTS=1 / SKIP_ARENAS=1)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const given = process.argv[2];
const out = given ? path.resolve(given) : fs.mkdtempSync(path.join(os.tmpdir(), 'omf-gen-'));
const run = (cmd, args, env = {}) => spawnSync(cmd, args, { stdio: 'inherit', shell: true, env: { ...process.env, ...env } }).status ?? 1;
let status = run('npx', ['vitest', 'run', 'src/gen/dev/build.test.ts'], { GEN_OUT: out });
if (status === 0 && !given) status = run('node', ['tools/extras-mod.mjs', '--gen', `"${out}"`]);
if (!given) fs.rmSync(out, { recursive: true, force: true });
process.exit(status);
