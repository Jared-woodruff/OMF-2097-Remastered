// The image model's deliveries in a pack folder (*.hd.png). npm run hd:export and newart:export empty their folder
// before writing the pack, and the pack folders are not in git, so they refuse to run over deliveries unless given
// --force (tools/hd-pack/run.mjs, tools/newart/run.mjs, and tools/hd-pack/export.test.ts for a direct run).
import fs from 'node:fs';

/** The delivered paintings in `dir` (paths relative to it); none when there is no such folder. */
export function deliveredFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true }).filter((p) => /\.hd\.png$/i.test(p));
}

/** Why `npm run <command>` must not empty `dir` (the message to show), or null when it may. */
export function deliveredRefusal(dir, command) {
  const found = deliveredFiles(dir);
  if (!found.length) return null;
  return [
    `${dir} holds ${found.length} delivered painting${found.length === 1 ? '' : 's'} (${found[0]}${found.length > 1 ? ', ...' : ''}).`,
    `The export empties its folder first, so ${found.length === 1 ? 'it' : 'they'} would be deleted (the pack folders are not in git).`,
    `Export to another folder instead:  npm run ${command} -- <folder>`,
    `or delete them and export:         npm run ${command} -- --force`,
  ].join('\n');
}
