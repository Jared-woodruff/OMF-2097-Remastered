#!/usr/bin/env node
// Runs one of the repository's Python tools with the Python there is: $PYTHON if set, else `python` on Windows and
// `python3` elsewhere (where `python` is often missing). The npm scripts that are Python tools go through it.
//
// Usage: node tools/python.mjs <script.py> [args...]
import { spawnSync } from 'node:child_process';

const [script, ...args] = process.argv.slice(2);
if (!script) {
  console.error('usage: node tools/python.mjs <script.py> [args...]');
  process.exit(2);
}
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const r = spawnSync(python, [script, ...args], { stdio: 'inherit' });
if (r.error) {
  console.error(`${python} could not be started (${r.error.message}): install Python 3, or set PYTHON to it.`);
  process.exit(1);
}
process.exit(r.status ?? 1);
