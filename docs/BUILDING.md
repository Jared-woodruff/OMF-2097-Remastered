# Building OMF 2097 Remastered

## Prerequisites

- **Node.js 22.12+** (developed on Node 24) and npm.
- **The original game.** The data files are not in this repository. You need the One Must Fall 2097 CD's
  `OMF/OMF21.EXE` (a PKZIP self-extractor) or an installed copy of the game.
- **Desktop build only (Windows):**
  - Rust stable with the MSVC toolchain (`x86_64-pc-windows-msvc`), via [rustup](https://rustup.rs).
  - Visual Studio 2022 Build Tools with the "Desktop development with C++" workload (MSVC linker and Windows SDK).
  - The Microsoft Edge WebView2 runtime. It comes with Windows 11 and current Windows 10.
  - Network access for the first build. Cargo downloads crates, and the Tauri CLI downloads NSIS.

  See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for details.

## Setup

```sh
npm install
npm run extract                       # reads omf21cd/OMF/OMF21.EXE (falls back to gamedata/)
npm run extract -- path/to/OMF21.EXE  # or pass OMF21.EXE, a .zip, or an installed game directory
```

`extract` copies the original game data into `public/gamedata/`, which is git-ignored.

### Optional: HD artwork

With a finished HD asset pack (see the README), import it before building:

```sh
npm run hd:import                     # reads hd-pack/, writes public/hd/ (needs Python 3 with numpy and Pillow)
npm run hd:import -- path/to/pack     # or another pack folder
```

The web and desktop builds include `public/hd/` when it exists; without it, the remastered mode upscales the
original images procedurally.

### Generated content: the new robots and arenas

The new robots and arenas are generated from `src/gen` into `public/gen/` (committed, so a fresh checkout does not need
this). After changing their definitions:

```sh
npm run gen                           # robots (FIGHTR11-14.AF) and arenas (ARENA5-8.BK/.WID); the arenas need public/gamedata
SKIP_ARENAS=1 npm run gen             # only the robots (ROBOT=glacier for one); SKIP_ROBOTS=1 / ARENA=ORBITAL likewise
```

The arenas' HD backgrounds are rendered on the GPU in the browser: start `npm run dev`, open
http://localhost:5173/?genarenahd (or `?genarenahd=ARENA6.BK` for one arena), wait for "done", then run
`npm run gen:hd` (Python 3 with Pillow) to pack `.captures/ARENAn-HD.png` / `-WIDE.png` into `public/gen/*.webp`.
The robots' HD artwork needs no files: the game renders it on the GPU while it runs. The HD asset pack
(`npm run hd:export`) also includes the new robots' sprites when `public/gen` has them, so they can go through the same
image model; imported artwork is used instead of the rendered one.

### Other generated data

- **Combo trials** (`src/game/training/trialData.ts`, committed): `COMBO_SEARCH=1 npx vitest run
  src/gen/dev/comboSearch.test.ts` searches every robot's combos (about 15 minutes), then `COMBO_VERIFY=1 npx vitest run
  src/gen/dev/trialVerify.test.ts` checks them against every robot and writes the file.
- **Announcer** (`public/audio/announcer/*.mp3`, committed): `python tools/make-announcer.py` speaks the lines with
  [eSpeak NG](https://github.com/espeak-ng/espeak-ng) (set `ESPEAK_NG` to its `espeak-ng.exe` when it is not on the
  PATH) and processes them with ffmpeg. Any line can be replaced by a recording of the same name.

## Web

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on http://localhost:5173 (strict port). |
| `npm run build` | Typechecks (`tsc --noEmit`), then builds the static site into `dist/`. `npm run preview` serves it. |

The build uses relative URLs (`base: './'`), so `dist/` works from any path.

### Hosting the web version without the game data

| Command | What it does |
| --- | --- |
| `npm run build:web` | `npm run build`, then removes `dist/gamedata/` and `dist/hd/` (`node tools/web-dist.mjs --with-hd` keeps the HD artwork). |

A site built this way asks for the game on its first visit: players drop or pick the freeware `OMF21.EXE`, a zip
that contains the game or its installer, or the folder of an installed copy. `src/platform/gameData.ts` unpacks it in
the browser (the installer is a PKZIP self-extractor; deflate goes through `DecompressionStream`) and keeps the files
in IndexedDB, so later visits start right away. Nothing is uploaded. A service worker (`public/sw.js`) caches the
site for offline play, and `public/manifest.webmanifest` makes it installable. Serve it over HTTPS (or localhost):
browsers only run service workers there.

## Desktop (Tauri 2, Windows)

| Command | What it does |
| --- | --- |
| `npm run desktop:dev` | Runs `npm run dev` and opens the game in a native window with hot reload. This is a debug build, so DevTools are available (F12 or right-click > Inspect). Port 5173 must be free. |
| `npm run desktop:build` | Runs `npx vite build` (no typecheck), compiles the release exe with `dist/` embedded, and builds the installer. |

`desktop:build` outputs:

- `src-tauri/target/release/omf2097-remastered.exe` is a standalone, portable exe. The game and its data are embedded, so it only needs the WebView2 runtime.
- `src-tauri/target/release/bundle/nsis/OMF 2097 Remastered_<version>_x64-setup.exe` is a per-user installer and needs no admin rights.

The first desktop build compiles all the Rust dependencies, which takes a few minutes. Later builds are incremental.

Release builds turn off WebView2's browser shortcuts (F5 and Ctrl+R reload, Ctrl+F find, Ctrl+P print, and so on) and its
right-click menu. The game still receives every key.

The desktop app keeps its web storage (localStorage, IndexedDB) in `%LOCALAPPDATA%\com.omf2097.remastered\EBWebView`.

The app version comes from `package.json`. Tauri settings are in `src-tauri/tauri.conf.json`, and window permissions are in
`src-tauri/capabilities/default.json`. Game code reaches native window features through `src/platform/desktop.ts`.

## App icon and installer artwork

The icon and the installer images are original vector artwork in `tools/brand/`: `icon.svg`, a simplified
`icon-small.svg` for 16 to 40 pixels, and the installer's `sidebar.html` (welcome and finish pages) and `header.html`.
To change them, edit those files and run:

```sh
npm run icons    # Python 3 with Pillow, and Microsoft Edge or Google Chrome
```

It renders everything at 1024 pixels (4x for the installer images) in a headless browser, scales it down with Lanczos
filtering, and writes `src-tauri/icons/*` (through `npx tauri icon`, plus an `icon.ico` with a separately rendered
image for every size from 16 to 256 pixels), `src-tauri/installer/sidebar.bmp` (164x314) and `header.bmp` (150x57),
`public/favicon.png` and the web app icons. `src-tauri/tauri.conf.json` points the installer at these files.
