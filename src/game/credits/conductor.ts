// The credits' clock: the song's position (song.ts), which everything in the credits is timed by. With the song
// playing, it is the audio's own position, run on the page's clock between the audio's updates (they come in steps) and
// eased back onto it; without the song (no audio, the file missing, a song that never starts, the headless tests) the
// credits keep their own time instead, counting the game's static ticks, and "cut" to the song's ending by jumping.
import type { Track } from '../../audio/audio';

/** Further than this (s) from the audio's position, the clock jumps onto it instead of easing. */
const RESYNC = 0.06;

export class Conductor {
  /** The song's position (s). */
  time = 0;
  /** The credits' own time: no song (the time moves on with the game's ticks). */
  private own: boolean;
  private lastPerf = -1;

  constructor(private track: Track | null, private now: () => number = () => performance.now()) {
    this.own = !track;
  }

  /** The song is followed (not the credits' own time). */
  get following(): boolean {
    return !this.own;
  }

  /** The song cannot be played after all (it failed, or never started): the credits keep their own time from here on. */
  ownTime(): void {
    this.own = true;
    this.track = null;
    this.lastPerf = -1;
  }

  /** A static tick of the game (ms of its time): the credits' own time moves on with it. */
  tick(ms: number): void {
    if (this.own) this.time += ms / 1000;
  }

  /** Follows the song (each frame and each static tick). */
  sync(): void {
    if (this.own || !this.track) return;
    const pos = this.track.position();
    const now = this.now();
    if (pos === null) {
      // (not playing yet, or stopped: the clock waits)
      this.lastPerf = -1;
      return;
    }
    if (this.lastPerf < 0) {
      this.time = pos;
    } else {
      const predicted = this.time + (now - this.lastPerf) / 1000;
      this.time = Math.abs(predicted - pos) > RESYNC ? pos : predicted + (pos - predicted) * 0.12;
    }
    this.lastPerf = now;
  }

  /** Jumps to a position of the song (the credits' own time only: the song itself is moved by its track). */
  jump(pos: number): void {
    if (this.own) this.time = pos;
    else this.lastPerf = -1;
  }
}
