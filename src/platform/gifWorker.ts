// Encodes a replay clip as an animated GIF away from the game (clipExport.ts sends the frames; gif.ts does the work).
// Messages: { type: 'start', width, height }, { type: 'frame', data: RGBA ArrayBuffer, time: ms },
// { type: 'finish', time: ms } -> { type: 'done', data: ArrayBuffer } (or { type: 'error', message }).
import { GifEncoder } from './gif';

let encoder: GifEncoder | null = null;

self.onmessage = (e: MessageEvent) => {
  const m = e.data as { type: string; width?: number; height?: number; data?: ArrayBuffer; time?: number };
  try {
    if (m.type === 'start') {
      encoder = new GifEncoder(m.width!, m.height!);
    } else if (m.type === 'frame') {
      encoder?.addFrame(new Uint8Array(m.data!), m.time!);
    } else if (m.type === 'finish' && encoder) {
      const bytes = encoder.finish(m.time!);
      encoder = null;
      self.postMessage({ type: 'done', data: bytes.buffer }, { transfer: [bytes.buffer] });
    }
  } catch (err) {
    encoder = null;
    self.postMessage({ type: 'error', message: String(err) });
  }
};
