// Persistent user settings (localStorage; also works inside the desktop shell).
import { CtrlType, KnockDownMode } from './constants';

export interface KeyBindings {
  jumpUp: string[];
  jumpRight: string[];
  walkRight: string[];
  duckForward: string[];
  duck: string[];
  duckBack: string[];
  walkBack: string[];
  jumpLeft: string[];
  punch: string[];
  kick: string[];
  /** The one-button special (CONFIGURATION > SPECIAL BUTTON; not in the original game). */
  special: string[];
}

/** The special button of the modern keyboard layout (controls.ts), for settings saved before it existed. */
export const MODERN_SPECIAL_KEYS = { p1: ['KeyL', 'KeyH'], p2: ['Slash', 'Numpad3'] };

export type GraphicsMode = 'classic' | 'remastered';

export interface Settings {
  video: {
    /** Classic = pixel-exact 320x200; remastered = HD, widescreen, effects. */
    graphics: GraphicsMode;
    /** Classic mode scaling filter. */
    classicFilter: 'sharp' | 'smooth' | 'crt';
    /** Show extended widescreen backgrounds in classic mode instead of black bars. */
    classicWidescreen: boolean;
    crossfade: boolean;
    screenShake: boolean;
    fullscreen: boolean;
    /** Remastered: bloom/glow post effects. */
    bloom: boolean;
    /** Remastered: smooth motion interpolation between game ticks. */
    motionSmoothing: boolean;
    /** Remastered: 'auto' lowers the internal resolution when the GPU is too slow; 'full' never does. */
    hdResolution: 'auto' | 'full';
    /** Remastered: use the HD artwork (backgrounds, robots, portraits...) where it is installed. */
    hdArtwork: boolean;
    /**
     * Remastered: text in a high-resolution typeface in the style of the original fonts ('type'), the original font as
     * clean HD shapes ('smooth'), or kept as crisp pixels.
     */
    hdFont: 'type' | 'smooth' | 'pixel';
    /** Remastered: health, endurance and stat bars drawn as smooth vector graphics (else the original bars). */
    hdHud: boolean;
    /** Remastered fights: sparks, dust and debris. */
    fxParticles: boolean;
    /** Remastered fights: light from impacts, fire and energy effects; arena light on the robots. */
    fxLighting: boolean;
    /** Remastered fights: shockwaves, flashes and the knockout camera. */
    fxImpact: boolean;
    /** Remastered fights: arena ambience (embers, sand, dust motes, crowd flashes, heat haze, light shafts). */
    fxAtmosphere: boolean;
  };
  sound: {
    soundVol: number; // 0..10
    musicVol: number; // 0..10
    enhancedMusic: boolean;
    /** Arena reverb on the sound effects. */
    acoustics: boolean;
    /** A low thump under heavy impacts. */
    impactBass: boolean;
    /** Where the player's own music replaces the soundtrack: nowhere, in fights, or everywhere. */
    myMusic: 'off' | 'fights' | 'always';
    /** The announcer's voice (audio/announcer.ts). */
    announcer: boolean;
  };
  gameplay: {
    speed: number; // 0..10
    fightMode: number; // 0 normal, 1 hyper
    power1: number; // 1..8 (reference range)
    power2: number;
    hazards: boolean;
    difficulty: number; // 0..6
    rounds: number; // 0..3
    /** The remaster's four new robots (GLACIER, TEMPEST, HELIX, SPECTRE) can be picked (opt-in). */
    extraRobots: boolean;
    /** The remaster's four new arenas are part of the arena rotation (opt-in). */
    extraArenas: boolean;
    /** Every fight is recorded and kept in the replay list. */
    saveReplays: boolean;
    /** The winner's portrait and a line of theirs after one and two player fights (scenes/victory.ts). */
    victoryScreens: boolean;
    /** Remastered graphics: the view follows the fight, closer when the robots are close (video/camera.ts). */
    fightCamera: boolean;
  };
  advanced: {
    rehitMode: boolean;
    defensiveThrows: boolean;
    throwRange: number;
    jumpHeight: number;
    hitPause: number;
    vitality: number;
    knockDown: KnockDownMode;
    blockDamage: number;
  };
  keys: {
    ctrlType1: CtrlType;
    ctrlType2: CtrlType;
    gamepad1: number; // gamepad index or -1
    gamepad2: number;
    /** Gamepad vibration on hits and screen shakes. */
    rumble: boolean;
    /** Keyboard players also play with a free gamepad (player 1 the first, player 2 the second). */
    autoPads: boolean;
    /** Keyboard layout of both players: the original's, a modern one (WASD), or keys rebound by the player. */
    layout: 'classic' | 'modern' | 'custom';
    /** Gamepad buttons: 'modern' (X/Y punch, A/B kick) or 'classic' (A/X punch, B/Y kick). */
    padLayout: 'modern' | 'classic';
    /** The special button does special moves in one press (see controller/special.ts). */
    specialButton: boolean;
    /** Touch controls (platform/touch.ts): shown on touch screens once touched, always, or never. */
    touch: 'auto' | 'on' | 'off';
    p1: KeyBindings;
    p2: KeyBindings;
  };
  tournament: {
    lastName: string;
  };
  /** Training mode setup (last used). */
  training: {
    har: number;
    pilot: number;
    opponent: number;
    arena: number;
    /** DummyMode */
    dummy: number;
    /** Show the player's recent inputs. */
    inputDisplay: boolean;
    /** Training lab: the frame meter and frame data, the hitbox view. */
    frameData: boolean;
    hitboxes: boolean;
    /** The dummy's reversal: 'off', 'jump', 'tape' or 'move:<move string>'. */
    reversal: string;
    /** Combo trials completed, as '<robot id>:<trial index>'. */
    trialsDone: string[];
    /** The dummy's recording (see controller/dummy.ts DummyTape), kept between sessions. */
    tape: { frames: number[][]; facing: number } | null;
  };
  /** Language file of the original game (ENGLISH.DAT or GERMAN.DAT). */
  language: string;
  /** Format revision of saved settings (see loadSettings). */
  revision: number;
}

/**
 * Current settings revision. 2: the new robots and arenas became opt-in; settings saved before could only hold the old
 * default (on), so loading them turns both off. 3: the remastered typeface became the default font; the smooth letters
 * saved before were the old default.
 */
const REVISION = 3;

export function defaultSettings(): Settings {
  return {
    video: {
      graphics: 'remastered',
      classicFilter: 'sharp',
      classicWidescreen: false,
      crossfade: true,
      screenShake: true,
      fullscreen: false,
      bloom: true,
      motionSmoothing: true,
      hdResolution: 'auto',
      hdArtwork: true,
      hdFont: 'type',
      hdHud: true,
      fxParticles: true,
      fxLighting: true,
      fxImpact: true,
      fxAtmosphere: true,
    },
    sound: { soundVol: 7, musicVol: 6, enhancedMusic: true, acoustics: true, impactBass: true, myMusic: 'fights', announcer: true },
    gameplay: { speed: 5, fightMode: 0, power1: 5, power2: 5, hazards: true, difficulty: 1, rounds: 1, extraRobots: false, extraArenas: false, saveReplays: true, victoryScreens: true, fightCamera: false },
    advanced: {
      rehitMode: false,
      defensiveThrows: false,
      throwRange: 100,
      jumpHeight: 100,
      hitPause: 4,
      vitality: 100,
      knockDown: KnockDownMode.NONE,
      blockDamage: 0,
    },
    keys: {
      ctrlType1: CtrlType.KEYBOARD,
      ctrlType2: CtrlType.KEYBOARD,
      gamepad1: -1,
      gamepad2: -1,
      rumble: true,
      autoPads: true,
      layout: 'classic',
      padLayout: 'modern',
      specialButton: true,
      touch: 'auto',
      // KeyboardEvent.code values. Player 1: arrows / numpad, Enter + Right Shift (like the reference defaults).
      p1: {
        jumpUp: ['ArrowUp', 'Numpad8'],
        jumpRight: ['PageUp', 'Numpad9'],
        walkRight: ['ArrowRight', 'Numpad6'],
        duckForward: ['PageDown', 'Numpad3'],
        duck: ['ArrowDown', 'Numpad2', 'Numpad5'],
        duckBack: ['End', 'Numpad1'],
        walkBack: ['ArrowLeft', 'Numpad4'],
        jumpLeft: ['Home', 'Numpad7'],
        punch: ['Enter', 'NumpadEnter', 'Numpad0'],
        kick: ['ShiftRight', 'NumpadDecimal', 'NumpadAdd'],
        special: ['Slash', 'NumpadSubtract'],
      },
      // Player 2: QWE/AD/ZXC block, Left Ctrl + Left Shift.
      p2: {
        jumpUp: ['KeyW'],
        jumpRight: ['KeyE'],
        walkRight: ['KeyD'],
        duckForward: ['KeyC'],
        duck: ['KeyX', 'KeyS'],
        duckBack: ['KeyZ'],
        walkBack: ['KeyA'],
        jumpLeft: ['KeyQ'],
        punch: ['ControlLeft', 'KeyF'],
        kick: ['ShiftLeft', 'KeyG'],
        special: ['KeyH'],
      },
    },
    tournament: { lastName: '' },
    training: {
      har: 0, pilot: 0, opponent: 5, arena: 0, dummy: 0, inputDisplay: true, frameData: true, hitboxes: false, reversal: 'off',
      trialsDone: [], tape: null,
    },
    language: 'ENGLISH.DAT',
    revision: REVISION,
  };
}

const STORAGE_KEY = 'omf2097r.settings';

function merge<T>(base: T, over: unknown): T {
  if (typeof base !== 'object' || base === null || Array.isArray(base)) {
    return (over === undefined ? base : (over as T));
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  if (over && typeof over === 'object') {
    for (const k of Object.keys(out)) {
      out[k] = merge(out[k], (over as Record<string, unknown>)[k]);
    }
  }
  return out as T;
}

let current: Settings = defaultSettings();

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings> | null;
      current = merge(defaultSettings(), saved);
      // Saved before the special button: the modern layout gets its own special keys (else the classic ones).
      if (saved?.keys && !saved.keys.p1?.special && saved.keys.layout === 'modern') {
        current.keys.p1.special = [...MODERN_SPECIAL_KEYS.p1];
        current.keys.p2.special = [...MODERN_SPECIAL_KEYS.p2];
      }
      if (!((saved?.revision ?? 0) >= 2)) {
        current.gameplay.extraRobots = false;
        current.gameplay.extraArenas = false;
      }
      if (!((saved?.revision ?? 0) >= 3) && current.video.hdFont === 'smooth') current.video.hdFont = 'type';
      current.revision = REVISION;
    }
  } catch {
    current = defaultSettings();
  }
  return current;
}

export function saveSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable (private mode) — settings stay in memory */
  }
}

export function settings(): Settings {
  return current;
}
