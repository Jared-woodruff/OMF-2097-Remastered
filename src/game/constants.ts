// Engine-wide constants (mirroring the original game / reference engine values).

export const STATIC_TICKS = 10; // ms per static tick
export const MS_PER_OMF_TICK_SLOWEST = 60;
export const FRAME_WAIT_TICKS = 30;

export const ARENA_LEFT_WALL = 20;
export const ARENA_RIGHT_WALL = 300;
export const ARENA_FLOOR = 190;
export const JUMP_COORD_ADJUSTMENT = 60;

export enum SceneId {
  NONE = 0,
  INTRO,
  OPENOMF, // unused (reference engine splash); kept for id parity
  MENU,
  END,
  END1,
  END2,
  CREDITS,
  MECHLAB,
  VS,
  MELEE,
  NEWSROOM,
  ARENA0,
  ARENA1,
  ARENA2,
  ARENA3,
  ARENA4,
  TRN_CUTSCENE,
  SCOREBOARD,
  LOBBY,
}

export const SCENE_BK: Record<number, string> = {
  [SceneId.INTRO]: 'INTRO.BK',
  [SceneId.MENU]: 'MAIN.BK',
  [SceneId.END]: 'END.BK',
  [SceneId.END1]: 'END1.BK',
  [SceneId.END2]: 'END2.BK',
  [SceneId.CREDITS]: 'CREDITS.BK',
  [SceneId.MECHLAB]: 'MECHLAB.BK',
  [SceneId.VS]: 'VS.BK',
  [SceneId.MELEE]: 'MELEE.BK',
  [SceneId.NEWSROOM]: 'NEWSROOM.BK',
  [SceneId.ARENA0]: 'ARENA0.BK',
  [SceneId.ARENA1]: 'ARENA1.BK',
  [SceneId.ARENA2]: 'ARENA2.BK',
  [SceneId.ARENA3]: 'ARENA3.BK',
  [SceneId.ARENA4]: 'ARENA4.BK',
  [SceneId.SCOREBOARD]: 'MAIN.BK',
};

export function isArenaScene(id: number): boolean {
  return id >= SceneId.ARENA0 && id <= SceneId.ARENA4;
}

export enum HarId {
  JAGUAR = 0,
  SHADOW,
  THORN,
  PYROS,
  ELECTRA,
  KATANA,
  SHREDDER,
  FLAIL,
  GARGOYLE,
  CHRONOS,
  NOVA,
}
export const NUMBER_OF_HAR_TYPES = 11;
export const HAR_NAMES = ['JAGUAR', 'SHADOW', 'THORN', 'PYROS', 'ELECTRA', 'KATANA', 'SHREDDER', 'FLAIL', 'GARGOYLE', 'CHRONOS', 'NOVA'];

export enum PilotId {
  CRYSTAL = 0,
  STEFFAN,
  MILANO,
  CHRISTIAN,
  SHIRRO,
  JEANPAUL,
  IBRAHIM,
  ANGEL,
  COSSETTE,
  RAVEN,
  KREISSACK,
}
export const NUMBER_OF_PILOT_TYPES = 11;
export const NUMBER_OF_PLAYABLE_PILOT_TYPES = 10;
export const PILOT_NAMES = ['CRYSTAL', 'STEFFAN', 'MILANO', 'CHRISTIAN', 'SHIRRO', 'JEAN-PAUL', 'IBRAHIM', 'ANGEL', 'COSSETTE', 'RAVEN', 'KREISSACK'];

export enum AiDifficulty {
  PUNCHING_BAG = 0,
  ROOKIE,
  VETERAN,
  WORLD_CLASS,
  CHAMPION,
  DEADLY,
  ULTIMATE,
}
export const AI_DIFFICULTY_NAMES = ['PUNCHING BAG', 'ROOKIE', 'VETERAN', 'WORLD CLASS', 'CHAMPION', 'DEADLY', 'ULTIMATE'];
export const ROUND_TYPE_NAMES = ['ONE ROUND', 'BEST 2 OF 3', 'BEST 3 OF 5', 'BEST 4 OF 7'];

// HAR animation ids
export const ANIM_JUMPING = 1;
export const ANIM_STANDUP = 2;
export const ANIM_STUNNED = 3;
export const ANIM_CROUCHING = 4;
export const ANIM_STANDING_BLOCK = 5;
export const ANIM_CROUCHING_BLOCK = 6;
export const ANIM_BURNING_OIL = 7;
export const ANIM_BLOCKING_SCRAPE = 8;
export const ANIM_DAMAGE = 9;
export const ANIM_WALKING = 10;
export const ANIM_IDLE = 11;
export const ANIM_SCRAP_METAL = 12;
export const ANIM_BOLT = 13;
export const ANIM_SCREW = 14;
export const ANIM_VICTORY = 48;
export const ANIM_DEFEAT = 49;
export const ANIM_BLAST1 = 55;
export const ANIM_BLAST2 = 56;
export const ANIM_BLAST3 = 57;

// Object groups
export const GROUP_UNKNOWN = 0x1;
export const GROUP_HAR = 0x2;
export const GROUP_SCRAP = 0x4;
export const GROUP_PROJECTILE = 0x8;
export const GROUP_HAZARD = 0x10;
export const GROUP_ANNOUNCEMENT = 0x20;

// Collision layers
export const OBJECT_DEFAULT_LAYER = 0x01;
export const LAYER_HAR = 0x02;
export const LAYER_HAR1 = 0x04;
export const LAYER_HAR2 = 0x08;
export const LAYER_SCRAP = 0x10;
export const LAYER_PROJECTILE = 0x20;
export const LAYER_HAZARD = 0x40;

// Render layers
export const RENDER_LAYER_BOTTOM = 0;
export const RENDER_LAYER_MIDDLE = 1;
export const RENDER_LAYER_TOP = 2;

// Visual effects
export const EFFECT_NONE = 0;
export const EFFECT_SHADOW = 0x1;
export const EFFECT_DARK_TINT = 0x2;
export const EFFECT_POSITIONAL_LIGHTING = 0x4;
export const EFFECT_STASIS = 0x8;
export const EFFECT_SATURATE = 0x10;
export const EFFECT_GLOW = 0x20;
export const EFFECT_TRAIL = 0x40;
export const EFFECT_ADD = 0x80;
export const EFFECT_HAR_QUIRKS = 0x100;

// Object flags
export const OBJECT_FLAGS_NEXT_ANIM_ON_OWNER_HIT = 0x1;
export const OBJECT_FLAGS_NEXT_ANIM_ON_ENEMY_HIT = 0x2;
export const OBJECT_FLAGS_MC = 0x4;

export const OBJECT_FACE_LEFT = -1;
export const OBJECT_FACE_NONE = 0;
export const OBJECT_FACE_RIGHT = 1;

export const PLAY_BACKWARDS = 0;
export const PLAY_FORWARDS = 1;

// Controller actions
export const ACT_NONE = 0x00;
export const ACT_STOP = 0x01;
export const ACT_KICK = 0x02;
export const ACT_PUNCH = 0x04;
export const ACT_UP = 0x08;
export const ACT_DOWN = 0x10;
export const ACT_LEFT = 0x20;
export const ACT_RIGHT = 0x40;
export const ACT_ESC = 0x80;
export const ACT_MASK_DIRS = ACT_UP | ACT_DOWN | ACT_LEFT | ACT_RIGHT;

export enum CtrlType {
  KEYBOARD,
  GAMEPAD,
  NETWORK,
  AI,
  REC,
  SPECTATOR,
}

// HAR move categories
export const CAT_MISC = 0;
export const CAT_CLOSE = 2;
export const CAT_LOW = 4;
export const CAT_MEDIUM = 5;
export const CAT_HIGH = 6;
export const CAT_JUMPING = 7;
export const CAT_PROJECTILE = 8;
export const CAT_BASIC = 9;
export const CAT_BK_HAZARD = 10;
export const CAT_VICTORY = 11;
export const CAT_SCRAP = 12;
export const CAT_DESTRUCTION = 13;

// HAR states
export enum HarState {
  NONE = 0,
  STANDING = 1,
  WALKTO,
  WALKFROM,
  CROUCHING,
  CROUCHBLOCK,
  JUMPING,
  RECOIL,
  STANDING_UP,
  STUNNED,
  BLOCKSTUN,
  VICTORY,
  DEFEAT,
  SCRAP,
  DESTRUCTION,
  WALLDAMAGE,
  DONE,
}

export enum HarEventType {
  JUMP,
  AIR_TURN,
  WALK,
  AIR_ATTACK_DONE,
  ATTACK,
  ENEMY_BLOCK,
  ENEMY_BLOCK_PROJECTILE,
  BLOCK,
  BLOCK_PROJECTILE,
  LAND_HIT,
  LAND_HIT_PROJECTILE,
  TAKE_HIT,
  TAKE_HIT_PROJECTILE,
  HAZARD_HIT,
  ENEMY_HAZARD_HIT,
  STUN,
  ENEMY_STUN,
  RECOVER,
  HIT_WALL,
  LAND,
  DEFEAT,
  SCRAP,
  DESTRUCTION,
  DONE,
}

// Move position constraints
export const POS_WALL = 0x0001;
export const POS_NO_DIST_CHECK = 0x0002;
export const POS_IN_ARENA3 = 0x0040;

// Extra string selectors
export const ESS_NONE = 0;
export const ESS_ARM_SPEED = 1;
export const ESS_LEG_SPEED = 2;
export const ESS_SPECIAL_ARM = 3;
export const ESS_SPECIAL_LEG = 4;
export const ESS_SPECIAL = 5;

export const HEIGHT_STANDING = 55;
export const HEIGHT_CROUCHING = 30;
export const INPUT_BUFFER_TICKS = 3;
export const STUN_RECOVERY_CONSTANT = Math.trunc((256 * 18) / 250);
export const STUN_RECOVERY_BLOCKING_CONSTANT = Math.trunc((256 * 27) / 250);

export enum KnockDownMode {
  NONE,
  KICKS,
  PUNCHES,
  BOTH,
}

export const PILOT_SEX_MALE = 0;
export const PILOT_SEX_FEMALE = 1;

/** Base stats and default colors of the story-mode pilots. */
export interface PilotInfo {
  power: number;
  agility: number;
  endurance: number;
  color1: number;
  color2: number;
  color3: number;
  sex: number;
}

export const PILOT_INFO: PilotInfo[] = [
  { power: 5, agility: 16, endurance: 9, color1: 5, color2: 11, color3: 8, sex: PILOT_SEX_FEMALE }, // Crystal
  { power: 13, agility: 9, endurance: 8, color1: 10, color2: 15, color3: 7, sex: PILOT_SEX_MALE }, // Steffan
  { power: 7, agility: 20, endurance: 4, color1: 11, color2: 12, color3: 7, sex: PILOT_SEX_MALE }, // Milano
  { power: 9, agility: 7, endurance: 15, color1: 8, color2: 15, color3: 6, sex: PILOT_SEX_MALE }, // Christian
  { power: 20, agility: 1, endurance: 8, color1: 4, color2: 7, color3: 14, sex: PILOT_SEX_MALE }, // Shirro
  { power: 9, agility: 10, endurance: 11, color1: 1, color2: 7, color3: 6, sex: PILOT_SEX_MALE }, // Jean-Paul
  { power: 10, agility: 1, endurance: 20, color1: 8, color2: 6, color3: 14, sex: PILOT_SEX_MALE }, // Ibrahim
  { power: 7, agility: 10, endurance: 13, color1: 0, color2: 15, color3: 7, sex: PILOT_SEX_FEMALE }, // Angel
  { power: 14, agility: 8, endurance: 8, color1: 0, color2: 8, color3: 2, sex: PILOT_SEX_FEMALE }, // Cossette
  { power: 14, agility: 4, endurance: 12, color1: 9, color2: 10, color3: 4, sex: PILOT_SEX_MALE }, // Raven
  { power: 16, agility: 15, endurance: 16, color1: 5, color2: 1, color3: 15, sex: PILOT_SEX_MALE }, // Kreissack
];

export const PSM_FILES = {
  END: 'END.PSM',
  MENU: 'MENU.PSM',
  ARENA0: 'ARENA0.PSM',
  ARENA1: 'ARENA1.PSM',
  ARENA2: 'ARENA2.PSM',
  ARENA3: 'ARENA3.PSM',
  ARENA4: 'ARENA4.PSM',
} as const;
/** Music track order used by the `smo` tag (PSM_END + n - 1). */
export const PSM_ORDER = ['END.PSM', 'MENU.PSM', 'ARENA0.PSM', 'ARENA1.PSM', 'ARENA2.PSM', 'ARENA3.PSM', 'ARENA4.PSM'];
