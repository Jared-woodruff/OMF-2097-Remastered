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
}

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
    /** Remastered: text with the original font smoothed like the graphics, or kept as crisp pixels. */
    hdFont: 'smooth' | 'pixel';
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
  };
  gameplay: {
    speed: number; // 0..10
    fightMode: number; // 0 normal, 1 hyper
    power1: number; // 1..8 (reference range)
    power2: number;
    hazards: boolean;
    difficulty: number; // 0..6
    rounds: number; // 0..3
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
  };
  /** Language file of the original game (ENGLISH.DAT or GERMAN.DAT). */
  language: string;
}

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
      hdFont: 'smooth',
      fxParticles: true,
      fxLighting: true,
      fxImpact: true,
      fxAtmosphere: true,
    },
    sound: { soundVol: 7, musicVol: 6, enhancedMusic: true },
    gameplay: { speed: 5, fightMode: 0, power1: 5, power2: 5, hazards: true, difficulty: 1, rounds: 1 },
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
      },
    },
    tournament: { lastName: '' },
    training: { har: 0, pilot: 0, opponent: 5, arena: 0, dummy: 0 },
    language: 'ENGLISH.DAT',
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
    if (raw) current = merge(defaultSettings(), JSON.parse(raw));
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
