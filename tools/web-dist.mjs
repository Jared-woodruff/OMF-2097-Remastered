#!/usr/bin/env node
// Prepares dist/ for a public web deployment. By default the site is complete: the original game data (freeware, see
// NOTICE.md) and the HD artwork are included, so the game starts with one click. With --lean both are removed: players
// then import their own copy of the game in the browser (see src/platform/gameData.ts) and the artwork falls back to
// the procedural upscale.
//
// Usage: npm run build:web [-- --lean]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/ has no build; run vite build first.');
  process.exit(1);
}
const lean = process.argv.includes('--lean');
if (lean) {
  for (const dir of ['gamedata', 'hd']) {
    const p = path.join(dist, dir);
    if (fs.existsSync(p)) {
      fs.rmSync(p, { recursive: true, force: true });
      console.log(`removed dist/${dir}/`);
    }
  }
} else if (!fs.existsSync(path.join(dist, 'gamedata', 'manifest.json'))) {
  console.warn('warning: dist/ has no game data (public/gamedata/ is missing): players will be asked for their copy.');
}
let bytes = 0;
const walk = (d) => {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else bytes += fs.statSync(p).size;
  }
};
walk(dist);
console.log(lean
  ? `dist/ is ready for the web: ${(bytes / 1048576).toFixed(1)} MB. Players import the game data in their browser.`
  : `dist/ is ready for the web: ${(bytes / 1048576).toFixed(1)} MB, game data and artwork included.`);
