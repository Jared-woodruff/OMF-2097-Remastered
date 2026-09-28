# Contributing

Thanks for helping keep the robots fighting. This page covers the development setup, the conventions the code
follows, and how to check your changes.

## Setup

You need Node.js 22.12+ and a copy of the original game (see the [README](README.md#get-started)):

```sh
npm install
npm run extract        # copies the original data files into public/gamedata/ (git-ignored)
npm run dev            # http://localhost:5173
```

The desktop app additionally needs the Rust and Tauri prerequisites listed in [docs/BUILDING.md](docs/BUILDING.md).

## Checking your changes

```sh
npm run typecheck      # tsc --noEmit
npm test               # vitest: the game logic runs headlessly against the original data
npm run build          # the web build
```

Tests that need the game data skip themselves when `public/gamedata/` is missing, which is what CI does. Run the full
suite locally before sending a change that touches game logic, rendering or menus.

The remaster's own robots and arenas are generated from `src/gen` into `public/gen/` (committed). After changing their
models, moves or scenes, run `npm run gen` (see [docs/BUILDING.md](docs/BUILDING.md)); a test fails when the robots'
files are out of date.

The dev server has a debug API for poking at the running game: `?fight=3&ai` starts a CPU fight in the Fire Pit,
`?scene=MELEE` opens a scene directly, and `window.__omf` offers `step(ms)`, `key(code, down)`, `pointer(kind, x, y)`
and `capture(name, w, h)` (writes a PNG to `.captures/`). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#running).

## Conventions

- **Faithfulness first.** Game logic is a port of the behavior documented by OpenOMF: one TypeScript function per C
  function, the same control flow and constants, integer truncation and the order of random number calls preserved.
  Keep reference quirks and comment them; deviations need a comment explaining why.
- **Cosmetics never touch the simulation.** Remastered effects observe the game through `src/game/fx.ts` events and
  must not change game state or draw from the game's random generators (`src/test/gameplay-options.test.ts` checks
  this).
- **Classic mode stays pixel-exact.** Changes to the remastered renderer must not alter the classic path.
- **Match the surrounding code**: naming, comment density and idioms. The layout of the code is described in
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What not to commit

The original game's data files and anything derived from its images (the HD asset pack in `hd-pack/` and the imported
artwork in `public/hd/`) are git-ignored and must stay out of the repository.
