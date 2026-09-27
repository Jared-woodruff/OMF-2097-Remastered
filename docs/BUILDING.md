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

## Web

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on http://localhost:5173 (strict port). |
| `npm run build` | Typechecks (`tsc --noEmit`), then builds the static site into `dist/`. `npm run preview` serves it. |

The build uses relative URLs (`base: './'`), so `dist/` works from any path.

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

## App icon

The icons are made from the original game's `OMF.ICO`, so run `npm run extract` first:

```sh
node tools/make-icon.mjs                        # writes src-tauri/icons/source.png (1024x1024) and public/favicon.png (64x64)
npx tauri icon src-tauri/icons/source.png       # regenerates src-tauri/icons/*
```
