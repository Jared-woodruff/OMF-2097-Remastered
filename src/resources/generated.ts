// Content made for the remaster and shipped with it (served from `gen/` next to the app): the new robots' fighter
// files and the new arenas' scene files, made by `npm run gen` from the definitions in src/gen. Kept apart from the
// original game files, which the player provides.

/** The files, by upper-case name: the new robots, the new arenas and their widescreen backgrounds. */
export const GENERATED_FILES = [
  ...[11, 12, 13, 14].map((id) => `FIGHTR${id}.AF`),
  ...[5, 6, 7, 8].flatMap((id) => [`ARENA${id}.BK`, `ARENA${id}.WID`]),
];

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

/** Loads the generated files; missing ones are skipped (the content that needs them is then left out). */
export async function loadGenerated(baseUrl = 'gen/'): Promise<void> {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  await Promise.all(
    GENERATED_FILES.map(async (name) => {
      if (files.has(name)) return;
      try {
        const res = await fetch(base + name);
        if (!res.ok) return;
        const data = new Uint8Array(await res.arrayBuffer());
        // Hosts with a single-page-app fallback answer missing files with index.html (the content type cannot tell:
        // some servers, like the desktop app's, call these binary files text/html).
        if (looksLikeHtml(data)) return;
        files.set(name, data);
      } catch {
        // Offline without a cached copy, or not deployed: play without it.
      }
    }),
  );
}

function looksLikeHtml(d: Uint8Array): boolean {
  let i = 0;
  while (i < d.length && i < 64 && (d[i] === 0x20 || d[i] === 0x0a || d[i] === 0x0d || d[i] === 0x09 || d[i] === 0xef || d[i] === 0xbb || d[i] === 0xbf)) i++;
  if (d[i] !== 0x3c) return false; // '<'
  const head = String.fromCharCode(...d.subarray(i, i + 15)).toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html');
}
