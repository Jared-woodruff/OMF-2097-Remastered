// Art direction and per-asset descriptions for the HD asset pack prompts.

export const GAME_CONTEXT =
  'One Must Fall 2097 (1994, Diversions Entertainment / Epic MegaGames) is a futuristic fighting game: human pilots ' +
  'control 90-foot-tall combat robots called HARs (Human Assisted Robots) in high-tech arenas run by the W.A.R. ' +
  'corporation. Its art is early-1990s pre-rendered 3D CGI (hard-surface robots with metallic and painted-plastic ' +
  'materials, dramatic studio lighting) plus rendered and painted backgrounds, all reduced to 256 colors at 320x200.';

/** Shared positive style block appended to every prompt. */
export const STYLE =
  'Faithful high-resolution remaster of the original artwork: identical design, composition, pose, proportions, ' +
  'camera angle and color scheme, re-rendered with modern high-end 3D CGI quality — crisp clean edges, detailed ' +
  'hard-surface panels and bolts, physically based metal and painted-plastic materials with subtle wear, smooth ' +
  'gradients (no dithering or banding), soft realistic lighting and reflections consistent with the original light ' +
  'direction, sharp focus, 1990s sci-fi arcade aesthetic.';

/** Shared negative prompt. */
export const NEGATIVE =
  'pixel art, pixelated, dithering, color banding, jpeg artifacts, blurry, soft focus, lowres, noise, grain, ' +
  'text, letters, numbers, logo, watermark, signature, UI, frame, border, cropped subject, extra limbs, extra ' +
  'objects, changed pose, different design, redesigned character, different colors, cartoon, anime, cel shading, ' +
  'sketch, painterly brush strokes, photo of a toy, plastic toy look, deformed, distorted perspective';

export const NEGATIVE_SPRITE = `${NEGATIVE}, background, scenery, floor, ground shadow, backdrop, vignette, drop shadow`;

/** Negative prompt for backgrounds that contain interface boxes or lettering. */
export const NEGATIVE_BG_UI = NEGATIVE.replace('text, letters, numbers, logo, ', '').replace('UI, frame, border, ', '') +
  ', misspelled lettering, extra text, extra boxes';

export interface SceneInfo {
  title: string;
  description: string;
  /** Extra notes for the background plate (interface boxes, lettering...). */
  bgNotes?: string[];
  /** The background contains lettering or interface boxes that must be kept exactly. */
  bgUi?: boolean;
}

const TEXT_BOX = 'The colored rectangle frame near the bottom is a text box of the game: keep it exactly (same position, ' +
  'thickness and color, crisp straight lines) and keep its inside plain black; the game prints text there.';

/** Scene (BK) descriptions: backgrounds and the scene's own animations. */
export const SCENES: Record<string, SceneInfo> = {
  ARENA0: {
    title: 'Arena: The Stadium',
    description:
      'The Stadium, where the W.A.R. machines get their first public testing: a square fighting pit seen from the ' +
      'front, tall pale steel wall panels with rivets and scuffs, a deep blue floor; above the walls, packed ' +
      'spectator stands behind a large wire-mesh cage net, a teal grid ceiling, and rows of bright floodlights in ' +
      'the upper corners.',
  },
  ARENA1: {
    title: 'Arena: The Danger Room',
    description:
      "The Danger Room, W.A.R.'s first danger arena where combatants must avoid deadly spikes: a long gloomy hall " +
      'seen down its length, angled dark brick walls converging toward a pitch-black far end, a sand-colored stone ' +
      'tile floor, and a heavy dark blue ribbed ceiling structure with curved vents on the left; moody cold lighting.',
  },
  ARENA2: {
    title: 'Arena: The Power Plant',
    description:
      'The Power Plant, built inside a 21st-century lightning-receptive power plant whose walls deliver electric ' +
      'shocks: a blue industrial hall with rows of tall blue metal pylons and poles linked by hanging cables, steel ' +
      'lattice towers in the background, a blue tiled floor and dark night-blue walls; cold electric lighting.',
  },
  ARENA3: {
    title: 'Arena: The Fire Pit',
    description:
      'The Fire Pit, the ultimate test where holographic spheres ignite fireballs under the fighters: a hexagonal ' +
      'chamber of polished brown marble wall panels, three deep red columns, black cone-shaped wall braziers, a dark ' +
      'ribbed dome ceiling, and a black metal grate floor over glowing red-orange lava.',
  },
  ARENA4: {
    title: 'Arena: The Desert',
    description:
      'The Desert, where fighters dodge the attacks of fighter jets: rolling golden sand dunes at sunset under a ' +
      'fiery orange and red sky with the bright sun low on the horizon, and segmented grey metal spike barriers ' +
      'reaching in from the bottom corners.',
  },
  MAIN: {
    title: 'Main menu',
    description:
      'Night-time futuristic city: tall stepped skyscrapers against a deep blue cloudy night sky, a giant battle ' +
      'robot on a stage raising its arm in triumph, dark silhouettes of a cheering crowd in the foreground.',
    bgNotes: ['The main menu box is drawn by the game over the right side: keep that area as in the source.'],
  },
  MELEE: {
    title: 'Pilot and robot selection',
    description:
      'Character selection screen: polished pink-grey marble frames and a 5 x 2 grid of empty black portrait slots, ' +
      'a deep blue textured stone panel in the upper area.',
    bgNotes: ['The black squares are portrait slots filled by the game: keep them plain black, same size and position.'],
    bgUi: true,
  },
  VS: {
    title: 'Holding bay (versus screen)',
    description:
      'The holding bay where the robots are prepared before a fight: a dark industrial hangar with yellow and black ' +
      'hazard-striped walls, steel catwalks and gantries (left half), and green-outlined black information boxes ' +
      '(right half).',
    bgNotes: ['The green-outlined black boxes are interface panels filled by the game: keep them exactly (crisp lines, same color, black inside).'],
    bgUi: true,
  },
  NEWSROOM: {
    title: 'WRDE news studio',
    description:
      'Television news studio: a news anchor woman with short brown hair, green eyes and a turquoise high-collar ' +
      'jacket, in front of a cream wall covered with a repeating tilted "WRDE NEWS" logo pattern in red and blue, ' +
      'with a black picture box for the news photo.',
    bgNotes: ['The black box is where the game shows the fight photo: keep it plain black, same position.', 'Reproduce the "WRDE NEWS" pattern lettering exactly.'],
    bgUi: true,
  },
  MECHLAB: {
    title: 'Tournament mech lab',
    description:
      'Tournament command center: a dark stone-walled room with a blue holographic projector platform and a cyan ' +
      'metal control console with buttons along the bottom.',
  },
  INTRO: { title: 'Intro sequence', description: 'the opening sequence: company logos, lightning and the One Must Fall 2097 emblem on black' },
  END: {
    title: 'Ending',
    description: 'Ending sequence: a robot head seen from above resting on a glowing blue holographic grid floor.',
  },
  END1: {
    title: 'Ending: the pilot leaves the robot',
    description: 'A dark blue chamber where a black robot helmet opens, lit from above, with a blue-framed text box at the bottom.',
    bgNotes: [TEXT_BOX],
    bgUi: true,
  },
  END2: {
    title: 'Ending: epilogue',
    description: 'A black starfield backdrop with a blue-framed text box at the bottom.',
    bgNotes: [TEXT_BOX],
    bgUi: true,
  },
  CREDITS: {
    title: 'Credits',
    description: 'A crouching blue armored robot rendered against black, used behind the credits.',
  },
  NORTH_AM: {
    title: 'Tournament: North American Open',
    description: 'A dark grey industrial hangar corridor with stacked rack shelves, seen head-on, with a gold-framed text box at the bottom.',
    bgNotes: [TEXT_BOX],
    bgUi: true,
  },
  KATUSHAI: {
    title: 'Tournament: Katushai Challenge',
    description: 'A deep blue sky with streaked clouds and the curved blue girders of a giant structure, with a red-framed text box at the bottom.',
    bgNotes: [TEXT_BOX],
    bgUi: true,
  },
  WAR: {
    title: 'Tournament: W.A.R. Invitational',
    description: 'A dark purple night sky with swirling clouds, with a red-framed text box at the bottom.',
    bgNotes: [TEXT_BOX],
    bgUi: true,
  },
  WORLD: {
    title: 'Tournament: World Championship',
    description: 'A dark stage with three bright spotlight beams shining down onto a metal podium bearing a gold "WORLD CHAMPIONSHIP" plaque.',
    bgNotes: ['Reproduce the "WORLD CHAMPIONSHIP" plaque lettering exactly.'],
    bgUi: true,
  },
};

export interface FighterInfo {
  name: string;
  description: string;
  specials: string[];
}

export const FIGHTERS: Record<string, FighterInfo> = {
  JAGUAR: {
    name: 'Jaguar',
    description: 'a tall, athletic humanoid combat robot with boxy angular limbs, a pointed crest and swept fins on its head and shoulders, gold ball joints and belt, and a red jaguar-face emblem on its chest',
    specials: ['Jaguar Leap', 'Concussion Cannon', 'Overhead Throw'],
  },
  SHADOW: {
    name: 'Shadow',
    description: 'a lean ninja-like combat robot with a smooth hooded head, a wide trapezoid torso studded with red rivets, gold ribbed coil forearms and shins, and red pointed feet; it can project translucent shadow copies of itself',
    specials: ['Shadow Dive', 'Shadow Punch', 'Shadow Slide', 'Shadow Grab'],
  },
  THORN: {
    name: 'Thorn',
    description: 'a hunched, spindly combat robot with a bell-shaped hooded head with red eyes, a gold triangular cape-like chest plate, thin limbs, clawed feet and long curved red spikes sprouting from its elbows, knees and arm',
    specials: ['Speed-Kick', 'Off-Wall Attack', 'Spike-Charge'],
  },
  PYROS: {
    name: 'Pyros',
    description: 'a broad-shouldered combat robot whose lower body is a flared thruster skirt with gold flame patterns, a small head with red eyes, red arms with heavy gold block fists, and jet boosters that shoot flames',
    specials: ['Fire Spin', 'Super Thrust Attack', 'Jet Swoop'],
  },
  ELECTRA: {
    name: 'Electra',
    description: 'a slender, spiky combat robot with a red pointed crown, a blue diamond-shaped crystalline torso, red angular shoulder and hip plates, gold spiky legs with claw feet, and crackling light-blue lightning in its hands',
    specials: ['Ball Lightning', 'Rolling Thunder', 'Electric Shards'],
  },
  KATANA: {
    name: 'Katana',
    description: 'a samurai-like combat robot with a horned red crest, gold chest armor, blue ribbed segmented arms and legs, red boots, and long red sword blades mounted along its forearms',
    specials: ['Rising Blade', 'Head Stomp', 'Razor Spin'],
  },
  SHREDDER: {
    name: 'Shredder',
    description: 'a lean, agile combat robot with a blue head topped by a red horned crest, gold-striped limbs and red clawed hands and feet; its hands can detach and fly',
    specials: ['Head-Butt', 'Flip Kick', 'Flying Hands'],
  },
  FLAIL: {
    name: 'Flail',
    description: 'a top-heavy combat robot with a wide blue armored head-body with red eyes, riding on a gold coiled spring column above a big spiked wheel, swinging chains with spiked balls and a hammer from its arms',
    specials: ['Spinning Throw', 'Charging Punch', 'Swinging Chains'],
  },
  GARGOYLE: {
    name: 'Gargoyle',
    description: 'a winged, demonic combat robot with large bat-like mechanical wings (gold membranes on blue ribs), a long-necked horned head, red talons, spikes and bird-like legs',
    specials: ['Diving Claw', 'Flying Talon', 'Wing Charge'],
  },
  CHRONOS: {
    name: 'Chronos',
    description: 'a sleek, tall humanoid combat robot with smooth blue limbs, round gold joints, a small head with red eyes and a red inverted-triangle emblem on its chest; it teleports, phases through matter and freezes enemies in stasis',
    specials: ['Small-Scale Teleportation', 'Matter Phasing', 'Stasis Activator'],
  },
  NOVA: {
    name: 'Nova',
    description: "Major Kreissack's massive super-robot: bulky angular blue armor blocks, a wide swept gold horn crest across its head and shoulders, red accents, and gold square grenade-launcher fists and missile launchers",
    specials: ['Mini Grenade', 'Missile Launcher', 'Earthquake Smash'],
  },
};

/** Readable description of a fighter animation folder name (e.g. 'm11_idle' -> 'idle fighting stance'). */
export function describeMove(name: string): string {
  const base = name.replace(/^m\d+_/, '');
  const known: Record<string, string> = {
    idle: 'idle fighting stance (breathing loop)',
    walk: 'walking cycle',
    jump: 'jumping',
    crouch: 'crouching',
    block: 'standing block (guard)',
    crouch_block: 'crouching block',
    block_spark: 'white spark burst (shown when an attack is blocked)',
    hit_reaction: 'getting hit (damage reaction)',
    stand_up: 'getting up from the floor',
    stunned: 'stunned and dizzy',
    victory: 'victory pose',
    defeat: 'defeated, collapsing',
    burning_oil: 'burning oil splash effect',
    scrap_metal: 'flying scrap metal debris',
    bolt: 'flying bolt debris',
    screw: 'flying screw debris',
    blast_1: 'fiery explosion burst',
    blast_2: 'fiery explosion burst',
    blast_3: 'fiery explosion burst',
  };
  if (known[base]) return known[base];
  if (base.startsWith('projectile')) return 'projectile / special move effect';
  if (base.startsWith('scrap_finisher')) return 'scrap finishing move (after winning the fight)';
  if (base.startsWith('destruction_finisher')) return 'destruction finishing move (after winning the fight)';
  const m = /^(close|low|medium|high|jump)_attack/.exec(base);
  if (m) return `${m[1] === 'jump' ? 'jumping' : m[1]} attack`;
  return base.replace(/_/g, ' ');
}
