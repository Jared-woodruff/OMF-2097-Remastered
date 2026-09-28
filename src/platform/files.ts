// Files the player exchanges with the game: saving a file (a download on the web; on the desktop the file goes to
// Downloads\OMF 2097 Remastered) and picking files to load.
import { isDesktop, saveDesktopFile } from './desktop';

/**
 * Saves a file: a download on the web (some browsers want this to follow a key press or click), the Downloads folder
 * on the desktop. Resolves to where it went (the desktop path, or the name), or rejects when it could not be saved.
 */
export async function saveFile(name: string, data: Uint8Array | Blob, type = 'application/octet-stream'): Promise<string> {
  if (isDesktop) {
    const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
    return saveDesktopFile(name, bytes);
  }
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return name;
}

/** Opens the system's file picker (must follow a key press or click). Resolves to the chosen files, or none. */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', multiple, accept });
    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}
