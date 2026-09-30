// Makes the new robots and arenas' mod package (public/mods/omf2097r.extras.omfmod) and the list of the mods that come
// with the game (public/mods/index.json): src/gen/dev/extras.test.ts. Each part comes from the package already there
// unless given (the builder's comment says more):
//   npm run extras [-- --gen <folder>] [--hd <HD asset folder>] [--arena-hd <folder>] [--quality <WebP quality, 0 lossless>]
// --gen: the fighter and scene files (`npm run gen` writes them and runs this); --hd: the robots' HD pictures, cut out
// of that folder's fighter-GLACIER... bundles; --arena-hd: the arenas' HD backgrounds (ARENAn-WIDE.webp). Needs the
// original game data (npm run extract); cutting pictures needs Python 3 with Pillow.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? path.resolve(args[i + 1]) : undefined;
};
const env = { ...process.env, EXTRAS_OUT: path.resolve(opt('--out') ?? 'public/mods') };
for (const [flag, key] of [['--gen', 'EXTRAS_GEN'], ['--hd', 'EXTRAS_HD'], ['--arena-hd', 'EXTRAS_ARENA_HD']]) {
  const v = opt(flag);
  if (v) env[key] = v;
}
const q = args.indexOf('--quality');
if (q >= 0) env.EXTRAS_QUALITY = args[q + 1];
const r = spawnSync('npx', ['vitest', 'run', 'src/gen/dev/extras.test.ts', '--silent=false', '--reporter=verbose'], { stdio: 'inherit', shell: true, env });
process.exit(r.status ?? 1);
