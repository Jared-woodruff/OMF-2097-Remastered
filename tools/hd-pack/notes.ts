// Descriptions of notable scene animations for the HD asset pack prompts.
import { NEGATIVE_SPRITE } from './prompts';

/** Negative prompt for images whose source contains lettering (logos, announcements, captions). */
export const NEGATIVE_TEXT_SPRITE = NEGATIVE_SPRITE.replace('text, letters, numbers, logo, ', '') +
  ', misspelled lettering, different font, extra text, missing letters';

export interface AnimNote {
  desc: string;
  /** The image contains lettering that must be reproduced exactly. */
  text?: boolean;
}

const CHROME = 'in heavy chrome metal block letters with a red horizontal stripe (fight announcement graphic)';
const SPIKE = "one of the Danger Room's deadly metal spikes shooting out of the wall, with its dark shadow (hazard)";
const ERUPTION = 'a fireball erupting from the floor grate: tall flames, then smoke and debris falling back (hazard)';
const JET = 'a fighter jet attacking over the desert: it approaches, banks, fires its engines and leaves (hazard)';

/** Notes keyed "SCENE:anim" ("ARENA*" = every arena). */
export const ANIM_NOTES: Record<string, AnimNote> = {
  'ARENA*:6': { desc: `the word "ROUND" ${CHROME}`, text: true },
  'ARENA*:7': { desc: `the round-number digits 1 to 7, one digit per frame, ${CHROME}`, text: true },
  'ARENA*:8': { desc: `"YOU LOSE" on two lines ${CHROME}`, text: true },
  'ARENA*:9': { desc: `"YOU WIN" on two lines ${CHROME}`, text: true },
  'ARENA*:10': { desc: `the word "FIGHT" ${CHROME}`, text: true },
  'ARENA*:11': { desc: `the word "READY" ${CHROME}`, text: true },
  'ARENA*:24': { desc: 'swirling dust / smoke puff effect (impacts and landings)' },
  'ARENA*:25': { desc: 'swirling dust / smoke puff effect (impacts and landings)' },
  'ARENA*:26': { desc: 'small swirling dust puff effect' },
  'ARENA*:27': { desc: 'round-win indicator lamp for the scoreboard: a glowing red lamp (round won) and an unlit dark grey lamp' },
  'ARENA0:0': { desc: 'a piece of the stadium structure (ceiling grid and stands) drawn over the background' },
  'ARENA1:0': { desc: 'floor tile pieces of the Danger Room' },
  'ARENA1:1': { desc: SPIKE },
  'ARENA1:2': { desc: SPIKE },
  'ARENA1:3': { desc: SPIKE },
  'ARENA1:4': { desc: SPIKE },
  'ARENA1:5': { desc: "one of the Danger Room's deadly metal spikes shooting down from the ceiling, with its dark shadow (hazard)" },
  'ARENA2:0': { desc: 'floor and wall pieces of the power plant' },
  'ARENA2:12': { desc: 'a blue plasma / electric energy burst' },
  'ARENA3:1': { desc: ERUPTION },
  'ARENA3:2': { desc: ERUPTION },
  'ARENA3:3': { desc: ERUPTION },
  'ARENA3:4': { desc: ERUPTION },
  'ARENA3:5': { desc: 'ceiling and floor edge pieces of the Fire Pit chamber (drawn over the background)' },
  'ARENA3:12': { desc: 'a strip of glowing lava and flames' },
  'ARENA3:15': { desc: 'the red holographic sphere that ignites a fireball when hit' },
  'ARENA3:16': { desc: 'the red holographic sphere that ignites a fireball when hit' },
  'ARENA3:17': { desc: 'a rising jet of flame' },
  'ARENA3:18': { desc: 'a fireball growing and bursting' },
  'ARENA4:12': { desc: JET },
  'ARENA4:16': { desc: JET },
  'ARENA4:17': { desc: JET },
  'ARENA4:18': { desc: JET },
  'INTRO:5': { desc: 'the "EPIC MEGAGAMES PRESENTS" company logo in white serif capital letters', text: true },
  'INTRO:6': { desc: 'the "A DIVERSIONS ENTERTAINMENT PRODUCTION" company logo in white serif capital letters', text: true },
  'INTRO:11': { desc: 'a glowing blue-white lightning beam writing the digit "2" of the year 2097 in glowing blue', text: true },
  'INTRO:12': { desc: 'a glowing blue-white lightning beam writing the digit "0" of the year 2097 in glowing blue', text: true },
  'INTRO:13': { desc: 'a glowing blue-white lightning beam writing the digit "9" of the year 2097 in glowing blue', text: true },
  'INTRO:14': { desc: 'a glowing blue-white lightning beam writing the digit "7" of the year 2097 in glowing blue', text: true },
  'INTRO:15': { desc: 'the One Must Fall 2097 emblem: a red riveted metal shield with gold circuit traces, glowing green eyes and chrome "ONE MUST FALL" lettering', text: true },
  'INTRO:25': { desc: 'glowing blue-white lightning beams' },
  'MELEE:1': { desc: 'sheet of the ten robots as selection-grid thumbnails (5 x 2 grid, each robot in its own cell)' },
  'MELEE:3': { desc: 'small head portraits of the ten pilots (selection grid), one pilot per frame' },
  'MELEE:4': { desc: 'large head portraits of the ten pilots and Major Kreissack, one per frame' },
  'MELEE:5': { desc: 'the One Must Fall 2097 emblem (red riveted metal shield with gold circuits, green eyes, chrome lettering) and an empty polished marble portrait frame', text: true },
  'VS:2': { desc: 'Plug, the old grey-haired mechanic, talking (head portrait)' },
  'VS:3': { desc: 'grayscale preview pictures of the five arenas, one per frame' },
  'VS:4': { desc: 'large head portraits of the ten pilots and Major Kreissack, one per frame' },
  'VS:5': { desc: 'the robots standing in the holding bay, one robot per frame' },
  'VS:7': { desc: 'scientists in blue lab coats working in the holding bay' },
  'VS:8': { desc: 'technicians and welders in white overalls working in the holding bay' },
  'VS:11': { desc: 'gantry catwalk rails with small moving figures' },
  'MECHLAB:1': { desc: 'buttons and panels of the mech lab control console, with small pictograms (robots, money, arrows)' },
  'MECHLAB:5': { desc: 'grey robot silhouettes for the training screens, one robot per frame' },
  'MECHLAB:13': { desc: 'pictures of the training courses (a pilot exercising) in grey metal frames' },
  'MECHLAB:14': { desc: 'pieces of the mech lab room: stone walls, the blue holographic projector platform and the cyan console frame' },
  'MECHLAB:29': { desc: 'the pointing hand cursor (a human hand with extended index finger)' },
  'NEWSROOM:4': { desc: 'the captions "UNRANKED CHALLENGER" and "NEW CHAMPION" in white serif capital letters', text: true },
  'NEWSROOM:5': { desc: "the news anchor's eyes (blink animation)" },
  'NEWSROOM:6': { desc: "the news anchor's mouth and chin (talking animation)" },
  'KATUSHAI:1': { desc: 'a jagged blue-white lightning bolt' },
  'KATUSHAI:2': { desc: 'a jagged blue-white lightning bolt' },
  'WORLD:2': { desc: 'thin red spark streaks' },
  'END:1': { desc: 'small blue light glints' },
  'END1:1': { desc: 'small blue light glints' },
  'END1:3': { desc: 'close-up faces of the pilots, one per frame' },
  'END2:1': { desc: 'a cratered moon or planet' },
  'END2:30': { desc: 'a cratered moon or planet' },
  'END2:3': { desc: 'small spaceships flying through space' },
  'END2:4': { desc: 'small spaceships flying through space' },
  'END2:5': { desc: 'small spaceships flying through space' },
  'END2:11': { desc: 'a spaceship flying away with bright engine flames' },
  'CREDITS:0': { desc: 'a small red swirl effect' },
};

for (let i = 10; i <= 20; i++) {
  ANIM_NOTES[`MECHLAB:${i + 5}`] = { desc: 'holographic rotating view of one robot (20 frames = one full turn) projected above the mech lab platform' };
  ANIM_NOTES[`NORTH_AM:${i}`] = { desc: "the player's robot standing in the hangar before the tournament (one robot per animation)" };
  ANIM_NOTES[`KATUSHAI:${i}`] = { desc: "the player's robot, dramatically lit against the sky, in the robot colors (one robot per animation)" };
  ANIM_NOTES[`WAR:${i}`] = { desc: "a waving gold banner showing the player's robot emblem in the robot colors (one per robot)" };
  ANIM_NOTES[`WORLD:${i}`] = { desc: "the champion's robot rendered in glowing red, celebrating (one robot per animation)" };
  ANIM_NOTES[`END1:${i}`] = { desc: "a pilot's face emerging as the pilot leaves the robot (one pilot per animation)" };
  ANIM_NOTES[`MELEE:${i + 8}`] = { desc: 'animation of the robot currently selected in the menu (one robot per animation)' };
}

export function animNote(scene: string, anim: number): AnimNote | null {
  return ANIM_NOTES[`${scene}:${anim}`] ?? (scene.startsWith('ARENA') ? ANIM_NOTES[`ARENA*:${anim}`] ?? null : null);
}
