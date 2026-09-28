#!/usr/bin/env node
// Prepares dist/ for a public web deployment: removes the original game data (players import their own copy in the
// browser, see src/platform/gameData.ts) and, unless --with-hd is given, the HD artwork derived from it.
//
// Usage: npm run build:web [-- --with-hd]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/ has no build; run vite build first.');
  process.exit(1);
}
const remove = ['gamedata'];
if (!process.argv.includes('--with-hd')) remove.push('hd');
for (const dir of remove) {
  const p = path.join(dist, dir);
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
    console.log(`removed dist/${dir}/`);
  }
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
console.log(`dist/ is ready for the web: ${(bytes / 1048576).toFixed(1)} MB. Players import the game data in their browser.`);
