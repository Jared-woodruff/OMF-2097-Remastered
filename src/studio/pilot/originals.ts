// One of the game's pilots as a mod pilot, for OMF Studio to start from: the portrait and face the pilot select screen
// shows, their stats and colors, bio, VS screen words (theirs to every pilot, and every pilot's to them), victory lines,
// ending, and the personality the computer fights with.
import { parseBK } from '../../formats/bk';
import type { Sprite } from '../../formats/sprite';
import { modAi, storyPersonality } from '../../controller/personalities';
import { PILOT_INFO, PILOT_NAMES, PILOT_SEX_FEMALE } from '../../game/constants';
import { WIN_QUOTES } from '../../game/pilotWords';
import type { ModPilotInfo } from '../../mods/types';
import { getFile } from '../../resources/files';
import { langGet } from '../../resources/resources';
import { encodePng } from '../../util/png';
import { scenePalette } from './words';

/** The language file's entries: pilot names, bios, VS lines (what a says to b, b's answer) and endings. */
const NAME = 20, BIO = 135, VS_LINE = 749, VS_ANSWER = 870, END1 = 993, END2 = 1003;

/** A language entry without the line break some end with. */
function lang(id: number): string {
  return langGet(id).replace(/\n+$/, '');
}

/** An original pilot's name as the game's texts write it ("Crystal"). */
export function originalName(id: number): string {
  return lang(NAME + id) || PILOT_NAMES[id];
}

/** What original pilot `b` says on the VS screen to original pilot `a` when `a` is the player's (their answer). */
export function originalAnswer(b: number, a: number): string {
  return lang(VS_ANSWER + 11 * b + a);
}

/** A sprite of the pilot select screen as a PNG (index 0 see-through). */
async function selectPicture(s: Sprite | undefined): Promise<Uint8Array | null> {
  if (!s || s.isEmpty()) return null;
  const pal = scenePalette('MELEE.BK');
  const px = s.pixels();
  const rgba = new Uint8Array(s.width * s.height * 4);
  for (let i = 0; i < px.length; i++) {
    if (!px[i]) continue;
    rgba.set([pal.r(px[i]), pal.g(px[i]), pal.b(px[i]), 255], i * 4);
  }
  return encodePng(s.width, s.height, rgba);
}

/** What the game has for an original pilot (0 CRYSTAL .. 10 KREISSACK). */
export async function originalPilot(id: number): Promise<{ info: ModPilotInfo; portrait: Uint8Array | null; face: Uint8Array | null }> {
  const melee = parseBK(getFile('MELEE.BK'));
  const p = PILOT_INFO[id];
  const to: Record<number, string> = {}, from: Record<number, string> = {};
  for (let b = 0; b < PILOT_NAMES.length; b++) {
    to[b] = lang(VS_LINE + 11 * id + b);
    from[b] = lang(VS_ANSWER + 11 * b + id);
  }
  return {
    info: {
      name: lang(NAME + id) || PILOT_NAMES[id],
      sex: p.sex === PILOT_SEX_FEMALE ? 'female' : 'male',
      power: p.power,
      agility: p.agility,
      endurance: p.endurance,
      colors: [p.color1, p.color2, p.color3],
      bio: lang(BIO + id),
      personality: id,
      ai: modAi(storyPersonality(id)),
      vs: { line: '', to, from },
      quotes: (WIN_QUOTES[id] ?? []).slice(),
      // (Kreissack has no ending of his own: the player never plays him)
      ending: id < 10 ? [lang(END1 + id), lang(END2 + id)] : ['', ''],
    },
    // (the big portrait of the pilot select and VS screens, and the face in the grid: Kreissack has none there)
    portrait: await selectPicture(melee.anims[4]?.animation.sprites[id]),
    face: await selectPicture(melee.anims[3]?.animation.sprites[id]),
  };
}
