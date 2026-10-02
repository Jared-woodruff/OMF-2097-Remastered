// Saves a stretch of a replay as a video or an animated GIF. The replay plays at normal speed from the clip's start (the
// I mark, or the beginning) to its end (the O mark, or the end of the fight) while the game area of every rendered frame
// is copied from the canvas: to a video recorder (the browser's MediaRecorder: MP4 where it can, else WebM, with the
// game's sound) or to a GIF encoder in a worker (gif.ts). The replay controls are hidden meanwhile; SPACE pauses the
// recording along with the replay, ESC cancels it.
import { HAR_NAMES } from '../game/constants';
import { formatTicks } from '../game/replay/hud';
import type { ReplaySession } from '../game/replay/playback';
import { replayFileName } from '../game/replay/store';
import { saveFile } from './files';
import GifWorker from './gifWorker.ts?worker';
import { toast } from './toast';
import { recordClip } from '../game/records/records';

export type ClipKind = 'video' | 'gif';

export interface ClipHost {
  canvas: HTMLCanvasElement;
  /** Where the game image is on the canvas (GL coordinates: y from the bottom). */
  viewport(): { x: number; y: number; w: number; h: number };
  /** The game's sound as a stream (null without audio), and the end of it. */
  audioStream(): MediaStream | null;
  releaseAudio(): void;
}

const VIDEO_TYPES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.4d0028,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4',
  'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm',
];
const GIF_HEIGHT = 360;
const GIF_FRAME_MS = 40;
/** GIFs get big quickly: longer clips are cut to this. */
const GIF_MAX_MS = 30000;

export function videoType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

function megabytes(n: number): string {
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Tells where a saved clip went. */
function saved(where: Promise<string>, size: number): void {
  where.then(
    (path) => {
      toast(`Saved ${path} (${megabytes(size)})`, 6000);
      recordClip();
    },
    (err) => {
      console.warn('[clip] not saved:', err);
      toast('The clip could not be saved.', 4000);
    },
  );
}

export class ClipExporter {
  private session: ReplaySession | null = null;
  private kind: ClipKind | null = null;
  private out: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private to = 0;
  private name = '';
  private saved = { speed: 1, hud: true };
  // Video
  private recorder: MediaRecorder | null = null;
  private track: CanvasCaptureMediaStreamTrack | null = null;
  private chunks: Blob[] = [];
  private mime = '';
  // GIF
  private worker: Worker | null = null;
  /** Time into the clip (ms, not counting pauses), the time of the next GIF frame, and the last frame's clock. */
  private elapsed = 0;
  private nextGifFrame = 0;
  private lastNow = 0;
  private lastToast = 0;

  constructor(private host: ClipHost) {}

  get active(): boolean {
    return this.kind !== null;
  }

  /** Starts saving the replay's clip (or all of it) as a video or a GIF. */
  start(s: ReplaySession, kind: ClipKind): void {
    if (this.kind) return;
    const gs = s.gs;
    const mime = kind === 'video' ? videoType() : '';
    if (mime === null) {
      toast('This browser cannot record video. G saves a GIF instead.', 4000);
      return;
    }
    let from = s.markIn >= 0 ? s.markIn : 0;
    let to = s.markOut >= 0 ? s.markOut : s.endTick;
    if (to < from) [from, to] = [to, from];
    if (to - from < 10) {
      toast('The clip is too short.');
      return;
    }
    this.session = s;
    this.kind = kind;
    this.to = to;
    this.mime = mime;
    const ext = kind === 'gif' ? 'gif' : mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    this.name = replayFileName(s.record.meta, (id) => HAR_NAMES[id] ?? '?').replace(/\.rec$/, `.${ext}`);

    // The output: the game area at a fixed size (1080 or 720 rows for video, 360 for GIFs).
    const vp = this.host.viewport();
    const h = kind === 'gif' ? GIF_HEIGHT : vp.h > 760 ? 1080 : 720;
    const w = Math.round((h * vp.w) / vp.h / 2) * 2;
    this.out = Object.assign(document.createElement('canvas'), { width: w, height: h });
    this.ctx = this.out.getContext('2d', { alpha: false, willReadFrequently: kind === 'gif' })!;
    this.ctx.imageSmoothingQuality = 'high';

    this.saved = { speed: s.speed, hud: s.hud };
    s.speed = 1;
    s.hud = false;
    s.exporting = kind;
    s.seek(from);
    s.setPaused(false);
    this.elapsed = 0;
    this.nextGifFrame = 0;
    this.lastNow = performance.now();
    this.lastToast = 0;

    if (kind === 'video') {
      const stream = this.out.captureStream(0);
      this.track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
      for (const t of this.host.audioStream()?.getAudioTracks() ?? []) stream.addTrack(t);
      const chunks: Blob[] = [];
      this.chunks = chunks;
      this.recorder = new MediaRecorder(stream, {
        mimeType: mime, videoBitsPerSecond: h >= 1080 ? 8_000_000 : 5_000_000, audioBitsPerSecond: 192_000,
      });
      this.recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      this.recorder.start(1000);
    } else {
      this.worker = new GifWorker();
      this.worker.postMessage({ type: 'start', width: w, height: h });
      const gifTo = from + Math.ceil(GIF_MAX_MS / Math.max(1, gs.msPerDyntick()));
      if (gifTo < to) {
        this.to = gifTo;
        toast('GIFs are kept to 30 seconds: saving the first 30 seconds of the clip.', 4000);
      }
    }
    this.progress(true);
  }

  /** After each rendered frame: takes the frame, and ends the recording at the clip's end. */
  frame(): void {
    const s = this.session;
    if (!s || !this.kind || !this.ctx || !this.out) return;
    const gs = s.gs;
    if (gs.replay !== s) {
      this.cancel();
      return;
    }
    const now = performance.now();
    const dt = now - this.lastNow;
    this.lastNow = now;
    if (s.paused && !s.ended) {
      if (this.recorder?.state === 'recording') this.recorder.pause();
      this.progress();
      return;
    }
    if (this.recorder?.state === 'paused') this.recorder.resume();
    this.elapsed += dt;

    if (gs.sc.isArena()) {
      const vp = this.host.viewport();
      const c = this.host.canvas;
      this.ctx.drawImage(c, vp.x, c.height - vp.y - vp.h, vp.w, vp.h, 0, 0, this.out.width, this.out.height);
      if (this.kind === 'video') {
        this.track?.requestFrame();
      } else if (this.elapsed >= this.nextGifFrame && this.worker) {
        const img = this.ctx.getImageData(0, 0, this.out.width, this.out.height);
        this.worker.postMessage({ type: 'frame', data: img.data.buffer, time: this.elapsed }, [img.data.buffer]);
        while (this.nextGifFrame <= this.elapsed) this.nextGifFrame += GIF_FRAME_MS;
      }
    }
    this.progress();
    if (gs.tick >= this.to || s.ended || !gs.sc.isArena()) this.finish();
  }

  /** Stops without saving (ESC). */
  cancel(): void {
    if (!this.kind) return;
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
      if (this.recorder.state !== 'inactive') this.recorder.stop();
    }
    this.worker?.terminate();
    toast('Clip not saved.');
    this.end();
  }

  private progress(force = false): void {
    const s = this.session!;
    const now = performance.now();
    if (!force && now - this.lastToast < 400) return;
    this.lastToast = now;
    const what = this.kind === 'gif' ? 'GIF' : 'video';
    const t = Math.min(s.gs.tick, this.to);
    const at = `${formatTicks(Math.max(0, t - (s.markIn >= 0 ? s.markIn : 0)), s.gs.speed)}`;
    const state = s.paused ? 'paused (SPACE goes on)' : 'SPACE pauses';
    toast(`● Recording ${what} ${at}  —  ${state}, ESC cancels`, 1500);
  }

  private finish(): void {
    const s = this.session!;
    s.setPaused(true);
    const name = this.name;
    if (this.kind === 'video' && this.recorder) {
      const rec = this.recorder;
      const mime = this.mime;
      const chunks = this.chunks;
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: mime.split(';')[0] });
        saved(saveFile(name, blob), blob.size);
      };
      if (rec.state !== 'inactive') rec.stop();
    } else if (this.worker) {
      const worker = this.worker;
      toast('Saving the GIF…', 10000);
      worker.onmessage = (e: MessageEvent) => {
        const m = e.data as { type: string; data?: ArrayBuffer; message?: string };
        worker.terminate();
        if (m.type === 'done' && m.data) {
          saved(saveFile(name, new Uint8Array(m.data), 'image/gif'), m.data.byteLength);
        } else {
          toast('The GIF could not be made.', 4000);
          console.warn('[clip] GIF failed:', m.message);
        }
      };
      worker.postMessage({ type: 'finish', time: this.elapsed });
    }
    this.end();
  }

  /** Back to watching: the replay's speed and controls come back. */
  private end(): void {
    const s = this.session;
    if (s) {
      s.speed = this.saved.speed;
      s.hud = this.saved.hud;
      s.exporting = null;
    }
    this.host.releaseAudio();
    this.session = null;
    this.kind = null;
    this.recorder = null;
    this.track = null;
    this.worker = null;
    this.out = null;
    this.ctx = null;
  }
}
