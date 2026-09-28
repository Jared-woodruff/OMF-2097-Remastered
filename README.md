<p align="center">
  <img src="docs/media/hero.jpg" alt="One Must Fall 2097 Remastered" width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Windows%20%7C%20Web-0a84ff?style=for-the-badge" alt="Windows and Web">
  <img src="https://img.shields.io/badge/TypeScript-7-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript 7">
  <img src="https://img.shields.io/badge/WebGL2-990000?style=for-the-badge&logo=webgl&logoColor=white" alt="WebGL2">
  <img src="https://img.shields.io/badge/Tauri-2-24c8db?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri 2">
  <img src="https://img.shields.io/badge/tests-232%20passing-2ea44f?style=for-the-badge" alt="232 tests passing">
</p>

<p align="center">
  <a href="https://github.com/Jared-woodruff/OMF-2097-Remastered/releases/latest"><img src="https://img.shields.io/badge/%E2%AC%87%20Download%20for%20Windows-free-ff7a3d?style=for-the-badge" alt="Download for Windows (free)"></a>
</p>

<p align="center">
  <a href="#trailer"><b>Trailer</b></a> &nbsp;•&nbsp;
  <a href="#features"><b>Features</b></a> &nbsp;•&nbsp;
  <a href="#classic-remastered"><b>Classic / Remastered</b></a> &nbsp;•&nbsp;
  <a href="#effects"><b>Effects</b></a> &nbsp;•&nbsp;
  <a href="#gameplay"><b>Gameplay</b></a> &nbsp;•&nbsp;
  <a href="#screens"><b>Screens</b></a> &nbsp;•&nbsp;
  <a href="#artwork"><b>HD artwork</b></a> &nbsp;•&nbsp;
  <a href="#get-started"><b>Get started</b></a> &nbsp;•&nbsp;
  <a href="#under-the-hood"><b>Under the hood</b></a> &nbsp;•&nbsp;
  <a href="#credits"><b>Credits</b></a>
</p>

<br>

<a id="trailer"></a>

https://github.com/user-attachments/assets/390fdb80-a68d-480b-9558-e720a638652b

<p align="center">
  <sub>52 seconds of CPU fights in all five arenas, scored with the original <i>One Must Fall</i> menu theme played by
  this port's music engine (turn the sound on). <a href="docs/media/trailer.mp4">Download in 1080p60</a>.</sub>
</p>

<br>

**One Must Fall 2097** (Diversions Entertainment, 1994) is the robot fighting game that turned a generation of DOS
players into pilots of 90-foot war machines. This project rebuilds it for today: a faithful reimplementation of the
engine in TypeScript and WebGL2 that plays the **original game data**, runs in any modern browser and as a native
**Windows app**, and lets you flip between the **pixel-exact 1994 look** and a **remastered HD version** at any moment.

<table>
  <tr>
    <td width="33%" valign="top">
      <h3>🎯 Faithful</h3>
      Fight engine, AI, animation scripts, scenes and menus follow the reverse engineering of the
      <a href="https://github.com/omf2097/openomf">OpenOMF</a> project, quirks included. The soundtrack plays through an
      exact port of the game's own MASI music driver.
    </td>
    <td width="33%" valign="top">
      <h3>💎 Remastered</h3>
      3,200+ images redrawn in HD, every sprite rebuilt at your display resolution, widescreen arenas, dynamic
      lighting, particles, bloom and smooth motion for high refresh rate displays.
    </td>
    <td width="33%" valign="top">
      <h3>🕹️ Modern</h3>
      Replays and clips, a training lab with frame data and combo trials, a robot workshop, arcade, survival and time
      attack modes, custom tournaments, gamepads with rumble, touch controls, one-button specials, and a browser
      version that works offline.
    </td>
  </tr>
</table>

<br>

<a id="features"></a>
<p align="center"><a href="#features"><img src="docs/media/banner-features.jpg" alt="01 · The classic, rebuilt" width="100%"></a></p>

The whole game is here, playing the original data files:

- **All 11 robots** (HARs) with every move, special and throw, **10 pilots plus Major Kreissack**, and the CPU
  opponent's personalities and difficulty levels, plus **four new robots** you can turn on (below).
- **The five arenas and their hazards**: the Stadium, the spiked Danger Room, the Power Plant's electrified fences,
  the Fire Pit's fireballs and the Desert's strafing jets, plus **four new arenas** you can turn on (below).
- **Every mode**: one player, two players, demo, the full **tournament** career with the mechlab, upgrades, training
  and newsroom, the scoreboard, the intro and all endings.
- **The original music and sound**: the PSM soundtrack through a port of the MASI driver, the original samples, and
  an optional high quality resampler. Optional additions: **arena acoustics** (the sound effects echo like the
  stadium, the steel Danger Room, the power plant hall, the fire pit or the open desert) and an **impact bass**
  thump under heavy hits, wall slams and knockouts.

<p align="center">
  <img src="docs/media/arenas.jpg" alt="The five arenas: Stadium, Danger Room, Power Plant, Fire Pit and The Desert" width="100%">
</p>

### New for the remaster: four robots, four arenas

Built for this remaster in the spirit of the originals. They are **off by default**, so the game plays exactly like the
original until you opt in: turn them on in **Gameplay › New content** (robots and arenas separately).

<p align="center">
  <img src="docs/media/new-robots.jpg" alt="The new robots on the VS screen: GLACIER, TEMPEST, HELIX and SPECTRE" width="100%">
</p>

| Robot | Style | Special moves |
| --- | --- | --- |
| **GLACIER** | Heavy ice juggernaut: slow, strong, tough | **Ice Lance** ↓↘→ P, **Glacial Ram** ↓↙← K, **Frost Spikes** ↓↘→ K |
| **TEMPEST** | Light and fast wind robot, high floaty jumps | **Gale Blast** ↓↙← P, **Cyclone Kick** ↓↘→ K, **Sky Dive** ↓ K in the air |
| **HELIX** | Industrial driller with a spiral drill and a claw | **Drill Rush** ↓↘→ P, **Corkscrew** →↓↘ P, **Drill Bit** ↓↙← P |
| **SPECTRE** | Phantom with forearm lasers and a cloak of blades | **Photon Beam** ↓↘→ P, **Phase Shift** ↓↙← K, **Shadow Strike** ↓↘→ K |

They are built like the originals: faceted armor over slim, ribbed joints, in the player's three colors used the
original way (the armor, the joints, a few signature accents), and shaded like the originals' 1994 renders in the
classic sprites and as polished metal in the HD artwork, which is rendered from the same 3D models. Each has the full
basic move set, a throw, a scrap and a destruction finisher, CPU tactics for its specials and names in the pause
menu's move list. Turned on, they sit in a third row of the robot select screen (move down past the second row), join
the CPU opponents, and turn up among the robots Plug offers to trade in tournaments, with their own turning model and
select buttons in the mechlab.

<p align="center">
  <img src="docs/media/new-arenas.jpg" alt="The new arenas: Orbital, Ice Cave, Rooftop and Abyss" width="100%">
</p>

- **Orbital**: a space station's hangar deck with the Earth in the window. Dust floats, sparks drift in the low
  gravity and the stars twinkle.
- **Ice Cave**: a frozen cavern under the aurora. Snow blows in, frost mist creeps over the ice and the crystals
  sparkle.
- **Rooftop**: a skyscraper roof in the rain, above a neon city. Raindrops splash on the wet roof, lightning flashes
  over the skyline and the neon sign flickers.
- **Abyss**: a glass dome on the sea floor. Bubbles rise, caustics ripple over the floor and light falls from above.

Turned on, they join the arena rotation of one and two player games and tournaments. All four have true widescreen backgrounds (not
mirrored edges), HD versions, their own acoustics and music. The new
robots bring their own effects too: frost and ice shards, whirlwinds, drill sparks and shavings, laser glow and a
phase-shift shimmer. Everything new is original and generated from source code in [`src/gen`](src/gen): the robots
and arenas are 3D models ray traced into the game's own formats (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

<br>

<a id="classic-remastered"></a>
<p align="center"><a href="#classic-remastered"><img src="docs/media/banner-modes.jpg" alt="02 · Classic / Remastered" width="100%"></a></p>

<p align="center">
  <img src="docs/media/classic-vs-remastered.gif" alt="The same frame in classic and remastered graphics, with a divider sweeping between them" width="100%">
  <br>
  <sub>The same moment in both renderers. <b>F2</b> switches between them at any time, even mid-fight.</sub>
</p>

<table>
  <tr>
    <th width="50%">Classic</th>
    <th width="50%">Remastered</th>
  </tr>
  <tr>
    <td valign="top">
      <ul>
        <li>The original VGA pipeline on the GPU: sprites composited as palette indices into a 320 × 200 framebuffer,
          then resolved through the palette and all 19 remap tables exactly like 1994.</li>
        <li>Sharp pixels, smooth scaling or a CRT scanline filter.</li>
        <li>Optional widescreen for fights.</li>
      </ul>
    </td>
    <td valign="top">
      <ul>
        <li>HD artwork for backgrounds, robots, portraits and effects, or a procedural upscaler (xBR edges plus
          bilateral shading) for anything without it.</li>
        <li>Palette effects still work: player colors, fades, flashes and tints are mapped onto the HD pixels live.</li>
        <li>Widescreen arenas, ambient fill for menus, smooth motion between game ticks, bloom and dynamic resolution.</li>
        <li>A crisp fight HUD: the health and endurance bars drawn as vector graphics in their original colors, with a
          trail that shows the damage just taken and a pulse when health runs low.</li>
        <li>Sharp text at any resolution: a high-resolution typeface fitted into the original fonts' letter cells
          (every text keeps its layout), on frosted-glass panels.</li>
      </ul>
    </td>
  </tr>
</table>

<br>

<a id="effects"></a>
<p align="center"><a href="#effects"><img src="docs/media/banner-effects.jpg" alt="03 · Fight effects" width="100%"></a></p>

Remastered fights get a layer of modern effects, driven by what actually happens in the fight:

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/media/fx-firepit.gif" alt="Fire Pit: embers, torchlight and heat haze" width="100%">
      <br><b>Fire Pit</b>: rising embers, torchlight on the robots and heat haze over the grate.
    </td>
    <td width="50%" valign="top">
      <img src="docs/media/fx-desert.gif" alt="The Desert: sun shafts and blowing sand" width="100%">
      <br><b>The Desert</b>: backlight from the sunset, sun shafts and sand blowing over the dunes.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/media/fx-powerplant.gif" alt="Power Plant: an electrified fence lights up the arena" width="100%">
      <br><b>Power Plant</b>: the electrified fences throw blue light across the whole arena.
    </td>
    <td width="50%" valign="top">
      <img src="docs/media/fx-knockout.gif" alt="Knockout: flash, shockwave and camera zoom" width="100%">
      <br><b>Knockouts</b>: a flash, a shockwave, a burst of sparks and a slow-motion zoom on the final blow.
    </td>
  </tr>
</table>

| Group | What it adds |
| --- | --- |
| **Particles** | Sparks and impact flares on hits and blocks, dust from falls, throws and wall slams. |
| **Lighting** | Impacts, fire, energy and projectiles light up the arena and the robots; each arena lights the robots' edges. |
| **Impact FX** | Shockwaves on heavy hits, and the knockout camera with flash and chromatic aberration. |
| **Atmosphere** | Embers and heat haze, blowing sand, drifting dust, floodlight glow and camera flashes in the crowd; in the new arenas snow, frost mist, aurora light, rain and splashes, lightning, neon flicker, bubbles and caustics. |

> [!NOTE]
> The effects are purely cosmetic. They never touch the game state or its random number generators, so a fight
> plays out exactly the same with them on or off, and a test checks that. Each group can be switched off in
> **Configuration › Video › Remastered options**.

<br>

<a id="gameplay"></a>
<p align="center"><a href="#gameplay"><img src="docs/media/banner-gameplay.jpg" alt="04 · Gameplay additions" width="100%"></a></p>

<p align="center">
  <img src="docs/media/training.gif" alt="Training mode: hitting a dummy with a damage and combo readout" width="100%">
</p>

Everything below is new, and none of it changes how the original game plays unless you use it.

#### Training lab

**Training** (main menu, where network play used to be) puts you against a dummy with nobody getting knocked out and
health refilling after every combo. The pause menu's **Training lab** adds the tools of modern fighting games:

<p align="center">
  <img src="docs/media/lab-frames.jpg" alt="Training lab: the frame meter and frame data over a fight, hit points and outlines shown" width="49%">
  <img src="docs/media/lab-trials.jpg" alt="Combo trials: the moves of a trial in a row, the landed ones in green" width="49%">
</p>

- **Frame data**: a frame meter for both robots (startup, active, recovery, hit and block stun) and the startup,
  active and recovery frames of your last move with the advantage after it hit or was blocked. <kbd>F8</kbd>
- **Hitboxes**: what can be hit (outlined) and the hit points of attacks. Hits in this game are pixel exact: a hit
  lands where a hit point touches the other robot. <kbd>F9</kbd>
- **Record the dummy**: take control of the dummy and record what it should do (up to 25 seconds), then let it play
  it back over and over, or once. <kbd>F5</kbd> / <kbd>F6</kbd>
- **Reversals**: the dummy answers the moment it can act after a hit, a block or a knockdown, with a jump, your
  recording, or any of its special moves and throws, on the first possible frame.
- **Combo trials** for every robot: its special moves, then combos found by a search of the game itself (every timing
  of two and three moves tried against a standing dummy; each trial is checked against all eleven robots as the
  dummy, and a test replays them all). Each trial has a demo. <kbd>F4</kbd> resets.
- The **input display** lists your recent inputs with how long each was held.

#### Replays and clips

**Every fight is saved** (Extras › Replays keeps the last 40, plus any you mark to keep). Watch them again at any
speed from ¼ to 4×, pause, step one frame at a time, jump anywhere on the timeline, and share the fights as `.rec`
files (the original game's recording format). Mark a clip and save it as an **MP4 video** with the game's sound or
as an **animated GIF**.

<p align="center">
  <img src="docs/media/replay.jpg" alt="Watching a replay: the playback bar with the timeline and the clip marks" width="100%">
</p>

#### Arcade, survival, time attack

- **Arcade**: eight fights, the computer better and better, Kreissack last.
- **Survival**: one round against one opponent after another with the health you have left.
- **Time attack**: five fights against the clock.
- **Records**: statistics, the best results of each mode and 20 achievements (for bragging rights: nothing is
  locked behind them).

#### Robot workshop

Build your own robots from the new robots' parts: the frame of one, the head of another, the special moves and
finishers of a third, a size, a weight class and three colors, with a live picture as you go. The game builds a full
fighter from it on the spot (every sprite, move and hit point, and the HD artwork), ready to try in training or
against the computer. Robots are shared as small `.omfbot` files.

<p align="center">
  <img src="docs/media/workshop.jpg" alt="The robot workshop: a GLACIER frame with a SPECTRE head and TEMPEST's moves" width="100%">
</p>

#### Custom tournaments

Make your own tournaments from the installed ones: fewer opponents (spread over the ranks, the champion always among
them), their robots as they were or on the new robots, more or less prize money. They show up in **Tournament play**
like the others and are shared as `.omftrn` files. The new arenas join the tournament's arenas too when they are on.

#### Presentation

- **Announcer**: a synthesized robot voice calls the rounds, "Fight!", knockouts, perfects, scraps and destructions,
  and the winners. The lines are plain MP3 files in [`public/audio/announcer`](public/audio/announcer): replace any of
  them with your own recording.
- **Victory screens**: after one and two player fights, the winner's portrait and robot with a line of theirs and
  the fight in numbers (rounds, time, hits, accuracy, best combo, perfects and finishers).
- **Fight camera** (optional, remastered graphics): the view comes closer when the robots are close and follows the
  fight, while the HUD stays put.
- **Remaster credits** (Extras › Credits): the people and projects behind the remaster as animated end titles over a
  starfield and a neon grid, to the game's ending theme.
- **Achievements** announce themselves with a banner the moment they are earned.

<p align="center">
  <img src="docs/media/victory.jpg" alt="A victory screen: the winner's portrait, robot, a line of theirs and the fight's numbers" width="100%">
</p>

<p align="center">
  <img src="docs/media/credits-hero.jpg" alt="The remaster's credits: the chrome 2097 title over a starfield and a neon grid" width="49%">
  <img src="docs/media/credits.jpg" alt="The remaster's credits: the human coder, the AI coder and the AI image rendering" width="49%">
</p>

#### And also

- **Move lists** in the pause menu: the special moves, throws and finishing moves of both robots, read from the
  game's own move tables and shown with direction arrows.
- **The advanced options the original promised**: *Defensive throws*, *Knock down* and *Block damage* were listed in
  the 1994 menus but never implemented by OpenOMF. They now work as the original help text describes.
- **Gamepad rumble** on hits, blocks, throws, wall slams and knockouts.
- **Mouse support** in every menu: hover to select, click to activate, scroll to change values, right click to go back.
- **F1 help at any time**, as the original help pages promised, with the game paused behind it.
- **The German texts as written**: umlauts in the remastered typeface, the help pages' highlighted words in their
  colors on the same line, and pages longer than the screen continued over more pages.
- **Auto pause**: switching to another window or tab pauses a fight.

<br>

<a id="screens"></a>
<p align="center"><a href="#screens"><img src="docs/media/banner-screens.jpg" alt="05 · Every screen, every mode" width="100%"></a></p>

<p align="center">
  <img src="docs/media/menus.gif" alt="Main menu and training setup" width="49%">
  <img src="docs/media/select.gif" alt="Pilot and robot selection" width="49%">
</p>
<p align="center">
  <img src="docs/media/screen-vs.jpg" alt="The VS screen before a fight" width="49%">
  <img src="docs/media/screen-mechlab.jpg" alt="The tournament mechlab" width="49%">
</p>
<p align="center">
  <img src="docs/media/screen-pause.jpg" alt="The pause menu over a fight" width="49%">
  <img src="docs/media/screen-help.jpg" alt="The F1 help pages" width="49%">
</p>
<p align="center">
  <img src="docs/media/screen-controls-keyboard.jpg" alt="The controls screen: every action on the keyboard for both players" width="49%">
  <img src="docs/media/screen-controls-pad.jpg" alt="The controls screen: the Xbox controller layout" width="49%">
</p>

Every menu and text of the game was audited: a layout test checks that each entry fits its frame and each help text
fits its panel, and a text audit reports anything cut off or drawn off screen in every scene the tests visit.
Dialogs grow to fit their message. In remastered mode text is set in a high-resolution typeface in the style of
the original fonts (Orbitron, fitted into the originals' letter cells, so every line, menu and dialog keeps its layout,
and sharp even at 4K), with a soft shadow; **Remastered options › Font** switches to the original letters drawn as
clean shapes or as crisp pixels. Darkened panels such as menus, dialogs and the newsroom's report get a frosted-glass
background, so text stays readable over detailed HD artwork.

<br>

<a id="artwork"></a>
<p align="center"><a href="#artwork"><img src="docs/media/banner-artwork.jpg" alt="06 · HD artwork pipeline" width="100%"></a></p>

The HD artwork was produced with an image generation model from the original images, then imported into texture
atlases the game loads on demand:

```mermaid
flowchart LR
    A["Original game data"] -->|npm run extract| B["public/gamedata"]
    B -->|npm run hd:export| C["hd-pack/<br/>3,200+ images, prompts,<br/>guides and specs"]
    C -->|image model| D["*.hd.png"]
    D -->|npm run hd:import| E["public/hd/<br/>34 WebP atlas bundles"]
    E -->|runtime| F["Palette transfer shader:<br/>player colors, fades, flashes"]
```

- **No game code changes needed**: surfaces are matched to their artwork by a fingerprint of their palette indices.
- **Live colors**: each HD pixel is mapped through the palette change of the original pixel it belongs to, so the
  artwork follows player color choices, fades, flashes and tints exactly like the original sprites.
- **Streaming**: bundles per scene, robot and shared effects load on demand, and scene changes preload the next ones.

The imported artwork is part of this repository (`public/hd/`, shared on the game's freeware terms, see
[NOTICE.md](NOTICE.md)); the pack's working files are not. See [docs/BUILDING.md](docs/BUILDING.md) to make and import
a pack of your own.

<br>

<a id="get-started"></a>
<p align="center"><a href="#get-started"><img src="docs/media/banner-start.jpg" alt="07 · Get started" width="100%"></a></p>

**To play**, [download the Windows app](https://github.com/Jared-woodruff/OMF-2097-Remastered/releases/latest): the installer, or the portable
`omf2097-remastered.exe` that runs from anywhere. Everything is included and free: *One Must Fall 2097* has been
freeware since 1999, and its owners let everyone share it as long as nobody charges for it (see [NOTICE.md](NOTICE.md)).

**To build it yourself**, the game data and the HD artwork come with the repository:

```sh
git clone https://github.com/Jared-woodruff/OMF-2097-Remastered.git
cd OMF-2097-Remastered
npm install
npm run dev                      # play at http://localhost:5173
```

| Command | Result |
| --- | --- |
| `npm run build` | The web version in `dist/`: a static site you can host anywhere, even in a subfolder. The game starts with one click, and works offline as an installable app after the first visit. |
| `npm run build:web -- --lean` | The same site without the game data and the artwork (0.5 MB): on the first visit, players drop the freeware `OMF21.EXE` (or a zip, or their game folder) onto the page, and it is unpacked in the browser and kept there. |
| `npm run extract` | Replaces the game data with your own copy's (`omf21cd/` with the CD contents, or `npm run extract -- path/to/OMF21.EXE`). |
| `npm run desktop:build` | The Windows app: a portable `omf2097-remastered.exe` and an installer under `src-tauri/target/release/`. |
| `npm test` | The test suite (headless, against the game data). |

Prerequisites and details for every platform are in [docs/BUILDING.md](docs/BUILDING.md).

### Controls

| | Player 1 | Player 2 |
| --- | --- | --- |
| Move / jump / duck | Arrow keys, Home / PgUp / End / PgDn for diagonals (or the numpad) | Q W E / A D / Z X C |
| Punch | Enter | Left Ctrl or F |
| Kick | Right Shift | Left Shift or G |
| Special (one press) | / or numpad − | H |

<kbd>Esc</kbd> pause menu &nbsp;·&nbsp; <kbd>F1</kbd> help &nbsp;·&nbsp; <kbd>F2</kbd> classic / remastered &nbsp;·&nbsp;
<kbd>F3</kbd> next song (your own music) &nbsp;·&nbsp; <kbd>F11</kbd> or <kbd>Alt</kbd>+<kbd>Enter</kbd> fullscreen
&nbsp;·&nbsp; <kbd>Print Screen</kbd> (or <kbd>F12</kbd> in the desktop app) saves a screenshot at your display's
resolution.

- **Configuration › Controls** (also in the pause menu) shows the keyboard and the Xbox controller with every action
  on its key or button. The keyboard has the classic layout above and a **modern** one (WASD for player 1), and keys
  can be rebound in **Configuration › Input**.
- **Xbox controllers** (and other standard gamepads) work out of the box, even alongside the keyboard: X / Y / RB
  punch and A / B / RT kick in the modern layout, or the original's two-button scheme in the classic one.
- **One-button specials** (**Configuration › Special button**, on by default): the special button with no
  direction, forward, back, down or up does the robot's first to fifth special move, and its air special in a jump;
  the move list shows which is which. The original inputs work as always. On a controller it is LT (and LB or RT).
- **Touch controls** for phones and tablets: a stick that appears under your left thumb, punch, kick and special
  buttons and a pause button. They show up once the screen is touched (**Configuration › Touch pad**).
- **Training**: <kbd>F4</kbd> reset positions, <kbd>F5</kbd> record the dummy, <kbd>F6</kbd> play the recording (or a
  trial's demo), <kbd>F8</kbd> frame data, <kbd>F9</kbd> hitboxes.
- **Replays**: <kbd>Space</kbd> pause, <kbd>←</kbd> <kbd>→</kbd> step (or skip five seconds while playing),
  <kbd>↑</kbd> <kbd>↓</kbd> speed, <kbd>R</kbd> restart, <kbd>I</kbd> / <kbd>O</kbd> clip start and end, <kbd>V</kbd>
  save a video, <kbd>G</kbd> save a GIF, <kbd>K</kbd> keep, <kbd>H</kbd> hide the bar. The desktop app saves clips and
  files in *Downloads\OMF 2097 Remastered*.
- **Sound effects and music volume** are in **Configuration › Audio** and the pause menu, with the **announcer**.
  **My music** plays your own songs in fights or everywhere: drop audio files onto the window (or pick them in the
  Audio menu).

<br>

<a id="under-the-hood"></a>
<p align="center"><a href="#under-the-hood"><img src="docs/media/banner-tech.jpg" alt="08 · Under the hood" width="100%"></a></p>

```mermaid
flowchart LR
    subgraph sim["Game simulation (faithful port)"]
        S1["Scenes, HARs, AI"] --> S2["Animation scripts"] --> S3["Draw list"]
    end
    S3 --> CL["Classic renderer<br/>indexed 320 × 200, VGA resolve"]
    S3 --> RM["Remastered renderer<br/>HD artwork, xBR + bilateral"]
    sim -. "cosmetic events" .-> FX["Effects director<br/>particles, lights, camera"]
    FX --> WP["World pass<br/>lighting, haze, shockwaves"]
    RM --> WP --> PP["Bloom, light shafts,<br/>overlay, post"]
```

| Layer | Technology |
| --- | --- |
| Language and build | TypeScript 7, Vite 8 |
| Rendering | WebGL2: classic VGA pipeline, HD reconstruction, particle, lighting and post-processing passes |
| Audio | Web Audio with an AudioWorklet mixer and a port of the MASI PSM music driver |
| Desktop | Tauri 2 (WebView2), a portable exe and an installer |
| Tests | Vitest, 220+ tests running the real game logic headlessly against the original data |

- The remastered renderer measures its GPU time and lowers its internal resolution when a GPU can't keep up. With
  every effect on, a frame takes about 8 ms of GPU time at 1920 × 1200 on an RTX 4080.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the code is organized and how the C reference maps to it.
- `?fight=3&ai` in the dev server's URL starts a CPU fight in the Fire Pit and `?training` goes straight to training
  mode; `window.__omf` exposes a debug API for stepping, input and captures.

<br>

<a id="credits"></a>
<p align="center"><a href="#credits"><img src="docs/media/banner-credits.jpg" alt="09 · Credits and legal" width="100%"></a></p>

- **The remaster**: [Jared Woodruff](https://github.com/Jared-woodruff) (human coder), Claude Opus 5.5 in Max Mode (AI
  coder), OpenAI GPT6-ASTRA in Ultra Mode (AI image rendering of the HD artwork).
- ***One Must Fall 2097*** © 1994 Diversions Entertainment, published by Epic MegaGames, freeware since 1999. All
  trademarks belong to their owners. This is an unofficial fan project, not affiliated with or endorsed by the
  original authors.
- **[OpenOMF](https://github.com/omf2097/openomf)** (MIT license): the open-source reimplementation whose reverse
  engineering this port follows.
- **Hyllian's xBR-lv2 shader** (MIT license): adapted for the remastered sprite reconstruction.
- **[eSpeak NG](https://github.com/espeak-ng/espeak-ng)** (GPL-3.0) and **FFmpeg** (LGPL/GPL): used as tools to make the
  announcer's voice lines; neither is part of the game.
- **[Tauri](https://tauri.app)** (MIT / Apache-2.0): the desktop app. Built with Vite, TypeScript and Vitest.
- **[Orbitron](https://github.com/theleagueof/orbitron)** by Matt McInerney and The League of Moveable Type
  ([SIL Open Font License 1.1](public/fonts/Orbitron-OFL.txt)): the remastered text.
- The app icon and installer artwork are original designs; the HD artwork was generated from the original images.

The source code in this repository is released under the [MIT license](LICENSE). The original game's data files and
the remastered artwork made from them are included on the game's freeware terms, not under the MIT license: free of
charge, never sold. See [NOTICE.md](NOTICE.md).

<br>

<p align="center">
  <img src="docs/media/footer.jpg" alt="One Must Fall 2097 Remastered" width="100%">
</p>
