export interface SoundOpts {
  /** 0..127 */
  volume: number;
  /** -100 (left) .. 100 (right) */
  panning: number;
  panningEnd: number;
  /** Pitch adjustment (-20..128); see pitchedSampleRate. */
  pitch: number;
  fadeInMs: number;
  priority: number;
  /** Forced channel, or -1 for automatic. */
  channel: number;
  skipDuplicate: boolean;
  stopDuplicate: boolean;
  hasPanningSweep: boolean;
  followObjectId: number;
}

export function defaultSoundOpts(): SoundOpts {
  return {
    volume: 127,
    panning: 0,
    panningEnd: 0,
    pitch: 0,
    fadeInMs: 0,
    priority: 10,
    channel: -1,
    skipDuplicate: false,
    stopDuplicate: false,
    hasPanningSweep: false,
    followObjectId: 0,
  };
}

export const SOUND_CHANNEL_COUNT = 3;

/** Sample rate of a SOUNDS.DAT entry (Sound Blaster time constant). */
export function soundSampleRate(freqKey: number): number {
  return Math.trunc(1000000 / (256 - freqKey));
}

export function pitchedSampleRate(freq: number, pitch: number): number {
  if (pitch < -20) pitch = -20;
  if (pitch > 0) return freq + Math.trunc((freq * pitch * 3) / 100);
  if (pitch < 0) return freq + Math.trunc((freq * pitch * 2) / 100);
  return freq;
}
