// File name helpers matching the reference utils/path.c (save games and resource names).

function lastSlash(p: string): number {
  return p.lastIndexOf('/');
}

/** path_dossify_filename(): in the file name part, every character but '.' becomes an upper-case alphanumeric or '_'. */
export function dossifyFilename(p: string): string {
  const s = lastSlash(p);
  let out = p.slice(0, s + 1);
  for (const ch of p.slice(s + 1)) {
    if (ch === '.') out += ch;
    else out += /^[A-Za-z0-9]$/.test(ch) ? ch.toUpperCase() : '_'; // isalnum() in the C locale
  }
  return out;
}

/** Start index of the extension (the last '.' after the last '/'), or -1 (find_ext_start_end). */
function extStart(p: string): number {
  const s = lastSlash(p) + 1;
  const d = p.lastIndexOf('.');
  if (d < 0 || s >= d) return -1;
  return d;
}

/** path_set_ext(): replaces (or appends) the extension; `ext` includes the dot. */
export function pathSetExt(p: string, ext: string): string {
  const d = extStart(p);
  return (d >= 0 ? p.slice(0, d) : p) + ext;
}

/** path_stem(): the file name without directory and extension. */
export function pathStem(p: string): string {
  const start = lastSlash(p) + 1;
  let end = p.lastIndexOf('.');
  if (end < 0 || end <= start) end = p.length;
  return start < end ? p.slice(start, end) : '';
}
