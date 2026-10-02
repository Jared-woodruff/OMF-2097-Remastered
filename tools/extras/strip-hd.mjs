// Takes HD artwork bundles out of the game's HD asset folder (public/hd: index.json and the bundles' folders): a full
// import of the HD asset pack makes the new robots' bundles too, which belong in their mod's package instead
// (tools/hd-pack/import.mjs). Usage: node tools/extras/strip-hd.mjs <bundle> ... (e.g. fighter-GLACIER)
import fs from 'node:fs';
import path from 'node:path';

const HD = path.resolve('public/hd');
const gone = new Set(process.argv.slice(2));
const indexPath = path.join(HD, 'index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const before = index.entries.length;
index.entries = index.entries.filter((e) => !gone.has(e.bundle));
for (const b of gone) {
  delete index.bundles[b];
  fs.rmSync(path.join(HD, b), { recursive: true, force: true });
}
fs.writeFileSync(indexPath, JSON.stringify(index));
console.log(`public/hd: ${before - index.entries.length} pictures of ${[...gone].join(', ')} taken out`);
