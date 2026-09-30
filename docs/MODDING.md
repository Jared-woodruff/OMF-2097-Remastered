# Mods and OMF Studio

Mods add robots, arenas and pilots to One Must Fall 2097 Remastered. They are made with **OMF Studio**, the game's
modding tool, and shared as `.omfmod` files. A mod's content plays like the game's own: every animation, move and hit
point of a robot, every hazard of an arena, in classic and remastered graphics, in one and two player games, training,
the modes, replays and the move list.

- **Install a mod**: drop its `.omfmod` file on the game, or open **Extras › Mods** and press **I**. Mods are on once
  installed; **Extras › Mods** turns them on and off, saves them as files and removes them. Changes play from the next
  start (**R** restarts the game).
- **Make one**: open **Extras › OMF Studio** (the desktop app opens it in its own window; the installer can also add
  its shortcuts), or `studio.html` next to the web version.

## OMF Studio

Studio makes content in the game's own formats, pixel for pixel, and tests it in the game itself.

- **Robots** start as a copy of one of the game's robots, from the robot workshop's parts (a 3D model posed and drawn
  into every frame, like the remaster's own robots), or as a blank figure to draw over. The editor has:
  - the robot's name, stats (health, endurance, speeds) and the special moves the computer uses for its tactics;
  - its moves: all 70 slots of its fighter file, each with its animation (a preview at the game's pace with the hit
    points, the frames and their tags, the raw animation string), its input (a builder: directions as they are
    entered, then the button), kind, damage, block stun, points, and the victim's reaction when it hits;
  - its sprites, drawn in the **pixel editor** in the game's palette (the pilot's three color ramps and the effect
    colors), with the frame before it as an onion skin, the floor line, and its hit points; pictures come in and out
    as PNG files (an indexed PNG exported by Studio keeps its colors exactly after editing it in another program);
  - its pictures on the robot select and VS screens (made from its idle frame, or drawn);
  - a list of what it still needs.
- **Arenas** start as a copy of one of the game's arenas, or from a picture (576 × 200 with the widescreen sides, or
  320 × 200): Studio picks the arena's 64 colors and makes the shading tables the game needs. An arena names its music
  (one of the game's songs), its ambience (the remastered effects and echo of one of the game's arenas) and, if any,
  the original arena whose built-in rules it follows.
- **Pilots** have a name, stats, colors, the original pilot whose fighting style the computer uses, a bio, lines for
  the VS and victory screens, an ending for the one-player game, and a portrait (the game draws it in each screen's
  colors).
- **Test** plays the mod in the game over Studio: a fight against the computer, the computer against itself, or
  training, in any arena. **Build file** saves the `.omfmod` file to share; **Install in game** installs it on this
  computer. Projects save themselves as they change and are listed on Studio's start screen.

## The package format

A `.omfmod` file is a zip archive:

```
mod.json                         the manifest
robots/<id>/robot.json           a robot's name, texts and tactics
robots/<id>/fighter.af           its fighter file (the original AF format)
arenas/<id>/arena.json           an arena's name, texts, music, ambience and behavior
arenas/<id>/arena.bk             its scene file (the original BK format)
arenas/<id>/arena.wid            optional: its widescreen background
pilots/<id>/pilot.json           a pilot's name, stats, colors, style, words and ending
pilots/<id>/portrait.png         optional: its portrait
pilots/<id>/face.png             optional: its face in the pilot select grid
```

`<id>` is a folder name: lower case letters, digits, `-` and `_` (32 characters at most).

### mod.json

| Field | |
|---|---|
| `format` | `1` (the package format; a game refuses formats newer than it reads) |
| `id` | the mod's id: lower case letters, digits, `.`, `-` and `_`, like `jane.steel-pack`. An update keeps it. |
| `name`, `version`, `author`, `description` | shown on the Mods page (40, 16, 40 and 400 characters at most) |
| `game` | the oldest game version it works with (`"0.2.0"`) |
| `robots`, `arenas`, `pilots` | the folder names of its content |

### robot.json

| Field | |
|---|---|
| `name` | up to 12 letters (upper case) |
| `description` | shown in the mech lab |
| `moves` | names of the special moves by move id, e.g. `{ "15": "DRILL RUSH" }` (the move list shows them) |
| `ai` | `{ "projectile": [...], "charge": [...], "push": [...] }`: move ids the computer uses for those tactics |

The fighter file must have the animations the engine plays: 1 jump, 2 stand up, 3 stunned, 4 crouch, 5 and 6 blocks,
9 the damage sheet, 10 walk, 11 idle, 48 victory and 49 defeat. Move 60 is the robot select screen's picture (51 × 36,
color `0xD0` see-through) and move 61 the VS screen's; without them the game makes them from the idle frame. The
effect moves every robot shares (7, 8, 12-14, 55-57) may be left out: the game uses the original game's. The file's
robot number is set by the game.

Sprites use the pilot's color ramps (entries 1-15, 16-31 and 32-47: its tertiary, secondary and primary colors) and
the effect colors every fight has (`0xA0`-`0xF9`); 0 is see-through. Attacks are matched by their input string
(`P` or `K`, then the directions newest first, numpad style: `"P632"` is ↓ ↘ → Punch) in slot order, 15 to 69.

### arena.json

| Field | |
|---|---|
| `name`, `description`, `newsName` | the arena's name (16 letters), the VS screen's text, the news report's name |
| `music` | `ARENA0.PSM` … `ARENA4.PSM`, `MENU.PSM` or `END.PSM` |
| `ambience` | `none`, `stadium`, `danger room`, `power plant`, `fire pit`, `desert`, `orbital`, `ice cave`, `rooftop` or `abyss` |
| `base` | an original arena (0-4) whose built-in rules it follows (the Stadium's light, the Power Plant's walls, the Fire Pit's fire, the Desert's palette for each round), or `-1` |

The scene file's background is 320 × 200; the arena's own colors are palette entries `0x60`-`0x9F` (the rest, the
round announcements and dust, and the sound table when it is empty, come from the original game's first arena). The
widescreen file is the 576 × 200 picture (the middle 320 columns the classic screen): width and height (16 bits each),
then the pixels encoded like sprites.

### pilot.json

| Field | |
|---|---|
| `name` | as the game writes names (`"Crystal"`), 16 characters at most |
| `sex` | `male` or `female` (the news report's words) |
| `power`, `agility`, `endurance` | 1-20 each |
| `colors` | the robot's colors: primary, secondary, tertiary (0-15, the game's color choices) |
| `bio` | the pilot select screen's text |
| `personality` | the original pilot (0 Crystal … 10 Kreissack) whose fighting style the computer uses |
| `quotes` | up to 10 lines: the first on the VS screen, all after winning |
| `ending` | the one-player game's ending: the story, and the last line |

`portrait.png` is up to 160 × 160 (up to 88 × 69 shows as it is); `face.png` is 51 × 36, see-through around the head.

## How the game loads mods

At start-up the game reads every installed mod that is on and checks it like OMF Studio does (the manifest, every
file's format, the animations a robot needs). Each robot, arena and pilot gets a number the engine knows it by, and
keeps it (saved replays, records and the training setup name it): robots 24-63, arenas 9-31, pilots 16-63. A mod that
cannot be loaded is left out, with its reason on the Mods page. A replay of a fight with content of a mod that is off
says so instead of playing.

The code is in `src/mods` (the package format, the store, the registry, the Mods page) and `src/studio` (OMF Studio).
