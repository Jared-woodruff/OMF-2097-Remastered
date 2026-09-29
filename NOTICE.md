# Notice

**The remaster's source code** is released under the [MIT license](LICENSE).

**The original game's files** in [`public/gamedata/`](public/gamedata) are *One Must Fall 2097* © 1994 Diversions
Entertainment, published by Epic MegaGames. The game has been freeware since February 1999, and its owners invite
players to modify and distribute it as they please, as long as they do not charge for it
([confirmed by Epic Games in 2017](https://forums.unrealengine.com/t/who-owns-the-rights-to-one-must-fall-2097-and-is-it-freeware/405924)).
They are included here under those terms: free of charge, with this notice. They are not covered by the MIT license.

**The remastered artwork** in [`public/hd/`](public/hd) was made from the original game's images (with OpenAI
GPT6-ASTRA) and is shared on the same terms as the game: free of charge, never sold. The new robots' frames there,
like the new arenas' paintings in [`public/gen/`](public/gen) and [`src/gen/scene/art/`](src/gen/scene/art), were
painted by an image generation model over the remaster's own renders.

**Never charge for this game** or for builds of it, in any form.

**Other parts:**

- [Orbitron](public/fonts/Orbitron-OFL.txt) (the remastered text) by Matt McInerney and The League of Moveable Type,
  under the SIL Open Font License 1.1.
- The announcers' voice lines in [`public/audio/announcer/`](public/audio/announcer) were made with ElevenLabs text to
  speech (https://elevenlabs.io, Eleven v4; the voices Victor and Kristen from its voice library) and finished with FFmpeg
  ([`tools/make-announcer.py`](tools/make-announcer.py)). They are shared with the game on its terms: free of charge.
  The trailer's voice-over ([`docs/media/trailer.mp4`](docs/media/trailer.mp4)) was made the same way, over the game's
  own main menu theme.
- Hyllian's xBR-lv2 shader (MIT), adapted in `src/video/hd/shaders.ts`; see the notice there.
- The picture of the human coder in [`public/credits/`](public/credits) is Jared Woodruff's.
- The credits' song, [*Twenty Ninety-Seven (Remix)*](https://www.hadalstatic.com/releases/twenty-ninety-seven/) by
  Hadal Static ([`public/audio/credits/`](public/audio/credits), with its cover in [`public/credits/`](public/credits)),
  © Hadal Static, is included with the artist's permission. It is not covered by the MIT license.
- The game manual ([`docs/manual/`](docs/manual)) shows the game's texts and artwork on the game's terms, and embeds
  subsets of Orbitron and of the Windows fonts Georgia, Verdana, Arial Black and Courier New (as their licenses allow).

This is an unofficial fan project, not affiliated with or endorsed by the original authors. All trademarks belong to
their owners.
