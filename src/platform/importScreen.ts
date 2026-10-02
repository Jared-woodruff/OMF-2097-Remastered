// First-run screen of the web version: asks for the original game files (OMF21.EXE, a zip or an installed folder),
// unpacks them in the browser and keeps them for later visits. Nothing is uploaded anywhere.
import { extractGameFiles, GameDataError, storeGameFiles } from './gameData';

const CSS = `
#omf-import { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px;
  box-sizing: border-box; background: radial-gradient(ellipse at 50% 30%, #16223f 0%, #070a12 65%); color: #c9d6ea;
  font: 15px/1.5 "Segoe UI", system-ui, -apple-system, sans-serif; z-index: 10; overflow: auto; }
#omf-import::before { content: ""; position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,.18) 0 1px, transparent 1px 3px); }
#omf-import .panel { position: relative; width: min(640px, 100%); text-align: center; }
#omf-import h1 { margin: 0; font: 700 clamp(40px, 9vw, 76px)/0.95 Bahnschrift, "DIN Condensed", "Arial Narrow", sans-serif;
  letter-spacing: .04em; font-stretch: condensed; background: linear-gradient(#fff 0%, #cfd8e6 45%, #fff 50%, #3c4760 53%,
  #9aa6bb 72%, #eef2f8 92%); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 14px rgba(60,110,255,.45)); }
#omf-import .year { font: 700 clamp(44px, 10vw, 88px)/1 Bahnschrift, "DIN Condensed", "Arial Narrow", sans-serif;
  letter-spacing: .12em; background: linear-gradient(#fff6c8, #ffd25a 35%, #ff7a1e 62%, #c81e0a); -webkit-background-clip: text;
  background-clip: text; color: transparent; filter: drop-shadow(0 0 18px rgba(255,80,20,.6)); }
#omf-import .sub { margin: 6px 0 22px; letter-spacing: .6em; color: #eaf3ff; font-weight: 600; text-shadow: 0 0 12px #3a8cff; }
#omf-import p { margin: 0 0 14px; }
#omf-import .drop { margin: 22px 0 14px; padding: 26px 18px; border: 2px dashed #3b5a8c; border-radius: 10px;
  background: rgba(20, 34, 64, .55); transition: border-color .15s, background .15s; }
#omf-import .drop.over { border-color: #ffb040; background: rgba(60, 40, 20, .55); }
#omf-import .drop strong { display: block; font-size: 18px; color: #fff; margin-bottom: 12px; }
#omf-import button { font: 600 15px/1 "Segoe UI", system-ui, sans-serif; color: #10141c; background: linear-gradient(#ffd25a, #ff9a2a);
  border: 0; border-radius: 6px; padding: 11px 18px; margin: 4px 6px; cursor: pointer; box-shadow: 0 0 16px rgba(255,140,40,.35); }
#omf-import button.alt { background: linear-gradient(#dfe8f6, #a9b8d0); box-shadow: none; }
#omf-import button:focus-visible { outline: 3px solid #7fb4ff; outline-offset: 2px; }
#omf-import .status { min-height: 1.5em; font-weight: 600; color: #ffd25a; }
#omf-import .status.error { color: #ff7a6a; }
#omf-import .fine { font-size: 13px; color: #8a98b0; }
#omf-import code { color: #fff; }
`;

/** Reads every file below dropped folders (drag and drop of a directory). */
async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const out: File[] = [];
  const entries = Array.from(dt.items ?? [])
    .map((i) => (typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => !!e);
  if (entries.length === 0) return Array.from(dt.files ?? []);
  const walk = async (entry: FileSystemEntry, depth: number): Promise<void> => {
    if (entry.isFile) {
      out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)));
    } else if (entry.isDirectory && depth < 4) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (batch.length === 0) break;
        for (const e of batch) await walk(e, depth + 1);
      }
    }
  };
  for (const e of entries) await walk(e, 0);
  return out;
}

/** Shows the import screen; resolves with the game files once the player supplied them (they are stored too). */
export function showImportScreen(): Promise<Map<string, Uint8Array>> {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'omf-import';
  root.innerHTML = `
    <div class="panel">
      <h1>ONE MUST FALL</h1>
      <div class="year">2097</div>
      <div class="sub">REMASTERED</div>
      <p>This web version plays the original game's data, which it does not include. <i>One Must Fall 2097</i> has been
        freeware since 1999: give it the installer <code>OMF21.EXE</code> of the freeware release, a zip of the game, or
        the folder of an installed copy.</p>
      <div class="drop" tabindex="-1">
        <strong>Drop OMF21.EXE, a zip or the game folder here</strong>
        <button type="button" data-pick="file">Choose a file…</button>
        <button type="button" class="alt" data-pick="folder">Choose a folder…</button>
      </div>
      <div class="status" role="status" aria-live="polite"></div>
      <p class="fine">Nothing is uploaded: the files are unpacked in your browser and kept there for your next visit.</p>
    </div>`;
  document.body.appendChild(root);
  const drop = root.querySelector('.drop') as HTMLElement;
  const status = root.querySelector('.status') as HTMLElement;
  const fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.exe,.zip,.af,.bk,.dat', multiple: true });
  const dirInput = Object.assign(document.createElement('input'), { type: 'file', multiple: true });
  dirInput.setAttribute('webkitdirectory', '');

  return new Promise((resolve) => {
    let busy = false;
    const setStatus = (text: string, error = false) => {
      status.textContent = text;
      status.classList.toggle('error', error);
    };
    const handle = async (files: File[]) => {
      if (busy || files.length === 0) return;
      busy = true;
      try {
        setStatus('Reading the game files…');
        const found = await extractGameFiles(files, (t) => setStatus(t));
        setStatus(`Found ${found.size} game files. Saving them in this browser…`);
        try {
          await storeGameFiles(found);
        } catch {
          // Private browsing can refuse storage: play anyway, the files are just not kept.
        }
        setStatus('Ready!');
        root.remove();
        style.remove();
        resolve(found);
      } catch (err) {
        setStatus(err instanceof GameDataError ? err.message : `Could not read the files: ${(err as Error)?.message ?? err}`, true);
      } finally {
        busy = false;
      }
    };
    root.querySelector('[data-pick="file"]')!.addEventListener('click', () => fileInput.click());
    root.querySelector('[data-pick="folder"]')!.addEventListener('click', () => dirInput.click());
    fileInput.addEventListener('change', () => void handle(Array.from(fileInput.files ?? [])));
    dirInput.addEventListener('change', () => void handle(Array.from(dirInput.files ?? [])));
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    root.addEventListener('dragenter', (e) => {
      stop(e);
      drop.classList.add('over');
    });
    root.addEventListener('dragover', stop);
    root.addEventListener('dragleave', (e) => {
      if (e.target === root) drop.classList.remove('over');
    });
    root.addEventListener('drop', (e) => {
      stop(e);
      drop.classList.remove('over');
      const dt = (e as DragEvent).dataTransfer;
      if (dt) void filesFromDrop(dt).then(handle);
    });
    (root.querySelector('[data-pick="file"]') as HTMLButtonElement).focus();
  });
}
