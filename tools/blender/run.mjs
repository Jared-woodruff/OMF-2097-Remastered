// The generated robots in Blender (docs/BLENDER_SPRITES.md):
//   npm run blender:export [-- [<robot>] [<out folder>] [--moves 11,10]]
//       the robot as glTF: <out>/<robot>.glb (its parts as objects, one keyframe per sprite) and <out>/<robot>/sprites/*.png
//   npm run blender:render [-- [<robot>] [<out folder>] [render_frames.py options, e.g. --moves 11 --scale 3] [--no-grade]]
//       HD pictures of its sprites and their zone masks in <out>/<robot>/hd (exports it first when needed), graded along
//       the robot's color ramps (grade.py; not with --no-masks or --no-grade)
//   npm run blender:originals [-- [<robot>] [<out folder>] [--mode fit|refine|export] [--moves 11,10]]
//       an original robot as a 3D model fitted to its sprites (tools/blender/originals, a starting point: JAGUAR only,
//       and not yet as good as its paintings); --mode export writes <out>/<robot>.glb for blender:render
// Defaults: HELIX (originals: JAGUAR), .captures/blender (originals: .captures/originals). Blender: BLENDER=<blender executable>, else Blender 5.2's default place on
// Windows, else `blender` on the PATH. Python (for the grading): PYTHON, else `python`.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [command, ...args] = process.argv.slice(2);
const firstFlag = args.findIndex((a) => a.startsWith('--'));
const positional = firstFlag < 0 ? args : args.slice(0, firstFlag);
const options = firstFlag < 0 ? [] : args.slice(firstFlag);
const robot = (positional[0] ?? (command === 'originals' ? 'JAGUAR' : 'HELIX')).toUpperCase();
const out = path.resolve(positional[1] ?? path.join('.captures', command === 'originals' ? 'originals' : 'blender'));
const glb = path.join(out, `${robot.toLowerCase()}.glb`);

function exportGlb(moves) {
  const r = spawnSync('npx', ['vitest', 'run', 'tools/blender/export.test.ts'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, OMF_BLENDER_OUT: out, OMF_BLENDER_ROBOT: robot, OMF_BLENDER_MOVES: moves ?? '' },
  });
  return r.status ?? 1;
}

function blender() {
  if (process.env.BLENDER) return process.env.BLENDER;
  const win = 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe';
  return process.platform === 'win32' && fs.existsSync(win) ? win : 'blender';
}

if (command === 'export') {
  const i = options.indexOf('--moves');
  process.exit(exportGlb(i >= 0 ? options[i + 1] : undefined));
} else if (command === 'render') {
  if (!fs.existsSync(glb) && exportGlb() !== 0) process.exit(1);
  const script = path.resolve('tools', 'blender', 'render_frames.py');
  const grade = !options.includes('--no-grade') && !options.includes('--no-masks');
  const pass = options.filter((o) => o !== '--no-grade');
  const i = pass.indexOf('--out');
  const hd = i >= 0 ? pass[i + 1] : path.join(out, robot.toLowerCase(), 'hd');
  const r = spawnSync(blender(), ['-b', '--factory-startup', '-P', script, '--', '--glb', glb, ...(i >= 0 ? [] : ['--out', hd]), ...pass], {
    stdio: 'inherit',
  });
  if (r.status !== 0 || !grade) process.exit(r.status ?? 1);
  const g = spawnSync(process.env.PYTHON ?? 'python', [path.resolve('tools', 'blender', 'grade.py'), '--glb', glb, '--renders', hd], { stdio: 'inherit' });
  process.exit(g.status ?? 1);
} else if (command === 'originals') {
  const option = (name, fallback) => (options.indexOf(name) >= 0 ? options[options.indexOf(name) + 1] : fallback);
  const r = spawnSync('npx', ['vitest', 'run', 'tools/blender/originals/originals.test.ts'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, OMF_ORIG_OUT: out, OMF_ORIG_ROBOT: robot, OMF_ORIG_MODE: option('--mode', 'fit'), OMF_ORIG_MOVES: option('--moves', '') },
  });
  process.exit(r.status ?? 1);
} else {
  console.error('usage: node tools/blender/run.mjs export|render|originals [<robot>] [<out folder>] [options]');
  process.exit(1);
}
