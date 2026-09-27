# OMF 2097 Remastered — Engine Architecture

A TypeScript/WebGL2 reimplementation of One Must Fall 2097 that loads the original data files.
Game logic is a faithful port of the reverse-engineered behavior documented by the open-source
OpenOMF project (MIT, https://github.com/omf2097/openomf); rendering and platform layers are new.

## Layout

| Path | What |
| --- | --- |
| `src/formats/` | Binary parsers for the original files (AF, BK, sprites, palettes, PIC, TRN, pilots, fonts, sounds, language). |
| `src/script/` | Animation-string ("A20-B10-s3C5...") decoder and tag table. |
| `src/resources/` | Runtime resources built from parsed files: `loadAf`, `loadBk`, `langGet`, `fonts()`, `soundBank()`, `loadPic`, `loadTournament`. Loaded AF/BK objects are fresh mutable copies per scene. |
| `src/video/` | Draw list (`video.draw*`), VGA palette state (`vga`), indexed `Surface`, WebGL2 renderer. |
| `src/audio/` | Audio system (3 SFX channels + PSM music in an AudioWorklet). |
| `src/controller/` | Controllers: keyboard, gamepad, AI (`ai.ts`), menu polling. |
| `src/game/` | Game logic: `GameState`, `Scene`, `GameObject` (object+animation player), HAR/projectile/hazard/scrap objects, score, GUI, scenes. |
| `src/game/scenes/` | One module per scene family; each calls `registerScene(SceneId.X, gs => new XScene(gs))`. `index.ts` imports them all. |
| `src/game/gui/` | Text rendering (`text.ts`) and menu widgets (`widgets.ts`: `Menu`, `Button`, `TextSelector`, `TextSlider`, `Label`, `Filler`, `GuiFrame`), progress bars, pause menu. |
| `src/game/scenes/mechlab/`, `src/game/tournament/` | Tournament mode: mechlab menus and dashboards, HAR economy, CHR characters (`src/formats/chr.ts`). |
| `src/resources/sgmanager.ts`, `trnmanager.ts` | Save games (CHR files in localStorage through a small `SaveStorage` interface) and the tournament list. |

## Porting conventions (C reference → TypeScript)

- Keep the structure of the reference code: one TS function/method per C function, same control flow and
  constants, camelCase names (`har_set_ani` → `harSetAni`, `object_set_repeat(obj, 1)` → `obj.setRepeat(true)`).
  Faithfulness matters more than elegance: preserve integer truncation (`Math.trunc`), unsigned wraparound, order
  of RNG calls and quirks (comment them).
- C `object *` → `GameObject` (`src/game/object.ts`). Field names map directly (`pos.x` → `posX`, `vel.y` → `velY`,
  `cur_animation` → `curAnimation`, `animation_state` → `animationState`, `sprite_state` → `spriteState`).
  `object_get_userdata(obj)` → `obj.userdata` (a `Har` for HARs: `harData(obj)`).
- `game_state *gs` → `GameState` (`src/game/gameState.ts`): `gs.findObject(id)`, `gs.addObject(obj, layer, singleton, persistent)`,
  `gs.getPlayer(i)` (`GamePlayer`: `pilot`, `ctrl`, `harObjId`, `score`, `chr`, `selectable`, `spWins`),
  `gs.setNext(SceneId.X)`, `gs.playSound(id, opts)`, `gs.playMusic('MENU.PSM')`, `gs.stopMusic()`, `gs.rand` (simulation RNG),
  `gs.matchSettings`, `gs.fightStats`, `gs.isSingleplayer()/isTournament()/isDemoplay()/isTwoplayer()`, `gs.setupAi(i)`,
  `gs.setupKeyboard(player, keysetIndex)`, `gs.initDemo()`, `gs.arena`.
  `rand_int()/rand_float()` (the reference's *global* RNG) → `globalRandom.int()/float()` from `src/util/random.ts`.
- `scene *` → subclass of `Scene` (`src/game/scene.ts`). Override: `startup(id) → [load, repeat]`, `prioOverride(id)`,
  `staticTick(paused)`, `dynamicTick(paused)`, `inputPoll()`, `render()` (drawn after the BK background),
  `renderOverlay()`, `paletteTransform()`, `free()`, `keyEvent(code, e)` (raw key events for text entry).
  The constructor loads the BK (`this.bk`) and sets the palette; `init()` (called by the engine) spawns startup animations.
  Scene-local timers: `this.tickTimer.add(ticks, cb)`.
- Menu input: `const ev: CtrlEvent[] = []; gs.menuPoll(ev); for (const e of ev) if (e.type === 'action') ...`
  Player input: `gs.getPlayer(i).ctrl.poll(ev)`.
- Drawing: `video.draw(surface, x, y)`, `video.drawFull(...)`, `video.drawOffset(...)`, `video.drawRemap(...)` in native
  320x200 coordinates. Surfaces are 8-bit indexed (`Surface`); build them from sprites with `Surface.fromSprite`
  or use the runtime `Animation`/`RSprite` objects from resources. Text: `new Text(FontSize.BIG|SMALL, w, h, str)`,
  `.setColor().setShadow().setHAlign()...draw(x, y)`; formatted documents with `textDocument()`.
- Palette: `vga.setBasePalette(pal)`, `vga.setBasePaletteRange(src, dst, srcStart, count)`, `vga.setBaseIndex(i, r, g, b)`,
  per-frame transforms via `gs.enablePaletteTransform(fn)` from `paletteTransform()`. Player HAR colors:
  `setPilotColors(pilot, c1, c2, c3)` then `paletteLoadPlayerColors(pilot.palette, playerIndex)` (`src/game/pilotColors.ts`).
- Strings from ENGLISH.DAT: `langGet(id)` (same ids as the reference `lang_get`).
- Settings: `settings()` (`src/game/settings.ts`, persisted to localStorage with `saveSettings()`).
- Host/app hooks (graphics mode, fullscreen, quit): `app` from `src/app.ts`.

## Running

- `npm run dev` then open http://localhost:5173/ (boots to the intro/menu).
- Dev params: `?scene=MELEE` start at a scene; `?fight=0&h1=0&h2=5&p1=0&p2=1[&ai]` quick fight;
  `?noaudio`; `?viewer` asset viewer.
- Debug API in the page: `__omf.gs`, `__omf.step(ms)` (advance simulation; works when the tab is hidden),
  `__omf.key(code, down)` (simulate keys by `KeyboardEvent.code`), `await __omf.capture(name, w, h, crop?)` (renders a
  frame at w x h and saves `.captures/<name>.png` via the dev server — view it to check visuals),
  `__omf.renderer.options.mode = 'classic' | 'remastered'`, `__omf.drawList`, `__omf.audio`.
  Vite reloads the page whenever a source file changes, so do setup + stepping + capture in one script.
- Tests: `npx vitest run src/test` (headless game via `src/test/harness.ts`), `npx tsc --noEmit`.

## Rendering

Game code only fills the draw list (`src/video/draw.ts`); `GLRenderer` (`src/video/gl/renderer.ts`) turns it into
pixels in one of two ways, switchable at any time (F2, pause menu, VIDEO options):

- **Classic**: the original VGA pipeline on the GPU. Sprites are composited as palette indices into a 320x200
  indexed framebuffer (index, remap encoding, dark tint, index add), then resolved through the palette and the 19
  remap tables exactly like the original, and scaled to the screen (sharp pixels, smooth, or CRT scanlines).
  Optional widescreen shows the mirrored arena in fights; other screens are pillarboxed.
- **Remastered** (`src/video/hd/`): every sprite and background is reconstructed at display resolution from its
  indexed pixels and the live palette (xBR silhouettes + bilateral shading), so palette effects still work.
  Shadows use per-texel ratios of the original shadow remap tables; glows use a native-resolution delta computed
  with the classic pipeline (`DELTA_FS`), so both look like the original, only smooth. Fights extend the arena
  for widescreen (`hd/extend.ts`, mirrored and progressively blurred); other screens get an ambient fill.
  Objects are drawn between game ticks when SMOOTH MOTION is on (`GameObject.snapshotPosition`, `drawList.interpAlpha`).
  Bloom, vignette and a highlight shoulder are applied last.
- **Remastered effects** (fights): the fight logic reports cosmetic events (`src/game/fx.ts`: hits, blocks, slams,
  landings, knockouts). `src/fx/director.ts` turns them into particles (`src/fx/particles.ts`), lights and camera
  effects, adds each arena's ambience (`src/fx/arenas.ts`) and derives light from glowing objects (projectiles,
  torches). The renderer (`src/video/gl/fxPasses.ts`, `hd/fxShaders.ts`) draws the world (background, robots,
  particles), runs a world post pass (lighting with a robot mask and rim light, heat haze, shockwaves, zoom,
  chromatic aberration, flash), adds bloom and light shafts, and only then draws the overlay (TAG_HUD draws: HUD,
  announcements, pause menu), so the overlay is never distorted or lit. The effects never touch game state or the
  game's random generators (checked by `src/test/gameplay-options.test.ts`).
- **HD artwork** (`src/video/hd/assets.ts`, `artShaders.ts`): when imported artwork is installed (`public/hd/`,
  see `tools/hd-pack/`), remastered mode draws it instead of the procedural upscale. Surfaces are matched to their
  artwork by a fingerprint of their palette indices (`hd/pixelHash.ts`), so no game code changes are needed. Each HD
  pixel is mapped through the palette change of the native pixel it belongs to (artwork palette → live palette), which
  keeps player colors, fades, flashes and tints working. Bundles (per scene, per robot, shared effects/arena
  graphics/portraits) load on demand; scene changes preload what the next screens need.


## Menus, text and input additions

- Mouse (`src/controller/mouse.ts`): pointer events are converted to native coordinates (`GLRenderer.canvasToNative`)
  and dispatched once per frame in `main.ts`: to the GUI frames drawn that frame, topmost first (`renderedFrames`,
  `Component.pointer`: `Menu` hovers/clicks/scrolls entries, `TrnMenu` moves the mechlab hand), then to the scene
  (`Scene.pointer`, e.g. the MELEE portraits, VS "continue"), else a left click means continue and a right click
  back (queued on the menu controller). Fights ignore the mouse outside their pause menu.
- F1 (`src/game/gui/helpOverlay.ts`) shows the original help pages over the paused game, full screen with the main
  menu's palette (text colors are palette entries), restoring the scene's palette afterwards.
- Menus are audited by `src/test/menuLayout.test.ts` (entries fit their frame, help texts fit the help panel), and
  `TEXT_AUDIT=<file> npx vitest run src/test` records texts that get cut off or drawn off screen in any scene test.
- Training mode: `src/game/scenes/mainmenu/menuTraining.ts` (setup), `src/controller/dummy.ts` (the dummy),
  `GameState.training` (no knockouts in `har.ts`, refills and the damage readout in `arena.ts`).
