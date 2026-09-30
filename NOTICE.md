# Notice

**The remaster's source code** is released under the [MIT license](LICENSE).

**The original game's files** in [`public/gamedata/`](public/gamedata) are *One Must Fall 2097* © 1994 Diversions
Entertainment, published by Epic MegaGames. The game has been freeware since February 1999, and its owners invite
players to modify and distribute it as they please, as long as they do not charge for it
([confirmed by Epic Games in 2017](https://forums.unrealengine.com/t/who-owns-the-rights-to-one-must-fall-2097-and-is-it-freeware/405924)).
They are included here under those terms: free of charge, with this notice. They are not covered by the MIT license.

**The remastered artwork** in [`public/hd/`](public/hd) was made from the original game's images (with OpenAI
GPT6-ASTRA) and is shared on the same terms as the game: free of charge, never sold. The new robots' frames and the
new arenas' paintings, in their mod's package in [`public/mods/`](public/mods) and in
[`src/gen/scene/art/`](src/gen/scene/art), were painted by an image generation model over the remaster's own renders,
and are shared on the same terms.

**Never charge for this game** or for builds of it, in any form.

**Other parts:**

- [Orbitron](public/fonts/Orbitron-OFL.txt) (the remastered text) by Matt McInerney and The League of Moveable Type,
  under the SIL Open Font License 1.1.
- The announcers' voice lines in [`public/audio/announcer/`](public/audio/announcer) and the newsreader's recordings in
  [`public/audio/news/`](public/audio/news) were made with ElevenLabs text to speech (https://elevenlabs.io, Eleven v4;
  the voices Victor and Kristen from its voice library) and finished with FFmpeg
  ([`tools/make-announcer.py`](tools/make-announcer.py), [`tools/make-news.py`](tools/make-news.py)). They are shared
  with the game on its terms: free of charge.
- The trailer ([`docs/media/trailer.mp4`](docs/media/trailer.mp4)) is set to the game's own main menu theme and to the
  credits' song below, with the game's own sound effects.
- Hyllian's xBR-lv2 shader (MIT), adapted in `src/video/hd/shaders.ts`; see the notice there.
- The picture of the human coder in [`public/credits/`](public/credits) is Jared Woodruff's. The credits' title
  pictures in [`public/credits/title/`](public/credits/title) are the original intro's logo, lightning and digits, cut
  out of the remaster's HD artwork of them, and are shared on the game's terms like that artwork.
- The credits' song, [*Twenty Ninety-Seven (Remix)*](https://www.hadalstatic.com/releases/twenty-ninety-seven/) by
  Hadal Static ([`public/audio/credits/`](public/audio/credits): the song, and its ending as a file of its own, with its
  cover in [`public/credits/`](public/credits)), © Hadal Static, is included with the artist's permission. It is not
  covered by the MIT license.
- The game manual ([`docs/manual/`](docs/manual)) shows the game's texts and artwork on the game's terms, and embeds
  subsets of Orbitron and of the Windows fonts Georgia, Verdana, Arial Black and Courier New (as their licenses allow).

This is an unofficial fan project, not affiliated with or endorsed by the original authors. All trademarks belong to
their owners.
