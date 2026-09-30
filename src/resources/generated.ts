// Files the game plays that are not the original game's, by the names the engine loads them by: the mods' fighter
// and scene files (FIGHTRn.AF, ARENAn.BK and .WID, registered by src/mods: the remaster's new robots and arenas are a
// mod too) and the robot workshop's robots (game/workshop). Kept apart from the original game files, which the player
// provides.

const files = new Map<string, Uint8Array>();

export function provideGenerated(name: string, data: Uint8Array): void {
  files.set(name.toUpperCase(), data);
}

export function getGenerated(name: string): Uint8Array | null {
  return files.get(name.toUpperCase()) ?? null;
}

export function hasGenerated(name: string): boolean {
  return files.has(name.toUpperCase());
}

/** Takes a file back (tests: a mod that is not there any more). */
export function forgetGenerated(name: string): void {
  files.delete(name.toUpperCase());
}

/** Whether a fetched file is a web page (a host's answer for a file it does not have). */
export function looksLikeHtml(d: Uint8Array): boolean {
  let i = 0;
  while (i < d.length && i < 64 && (d[i] === 0x20 || d[i] === 0x0a || d[i] === 0x0d || d[i] === 0x09 || d[i] === 0xef || d[i] === 0xbb || d[i] === 0xbf)) i++;
  if (d[i] !== 0x3c) return false; // '<'
  const head = String.fromCharCode(...d.subarray(i, i + 15)).toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html');
}
