// The generated robots in Blender (docs/BLENDER_SPRITES.md):
//   npm run blender:export [-- [<robot>] [<out folder>] [--moves 11,10]]
//       the robot as glTF: <out>/<robot>.glb (mesh, skeleton, one keyframe per sprite) and <out>/<robot>/sprites/*.png
//   npm run blender:render [-- [<robot>] [<out folder>] [render_frames.py options, e.g. --moves 11 --scale 3]]
//       HD pictures of its sprites and their zone masks in <out>/<robot>/hd (exports it first when needed)
// Defaults: HELIX, .captures/blender. Blender: BLENDER=<blender executable>, else Blender 5.2's default place on
// Windows, else `blender` on the PATH.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [command, ...args] = process.argv.slice(2);
const firstFlag = args.findIndex((a) => a.startsWith('--'));
const positional = firstFlag < 0 ? args : args.slice(0, firstFlag);
const options = firstFlag < 0 ? [] : args.slice(firstFlag);
const robot = (positional[0] ?? 'HELIX').toUpperCase();
const out = path.resolve(positional[1] ?? path.join('.captures', 'blender'));
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
  const r = spawnSync(blender(), ['-b', '--factory-startup', '-P', script, '--', '--glb', glb, '--out', path.join(out, robot.toLowerCase(), 'hd'), ...options], {
    stdio: 'inherit',
  });
  process.exit(r.status ?? 1);
} else {
  console.error('usage: node tools/blender/run.mjs export|render [<robot>] [<out folder>] [options]');
  process.exit(1);
}
