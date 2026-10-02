// Builds the remastered typeface's glyph atlas away from the game (typeface.ts does the work; main.ts starts it).
// Message: { url, family, fonts } -> the GlyphAtlas, or null when the font cannot be loaded or drawn here.
import type { BitmapFont } from '../../formats/misc';
import { buildGlyphAtlas, loadTypeface } from './typeface';

self.onmessage = async (e: MessageEvent) => {
  const m = e.data as { url: string; family: string; fonts: { small: BitmapFont; big: BitmapFont } };
  try {
    const atlas = (await loadTypeface(m.url, m.family)) ? buildGlyphAtlas(m.family, m.fonts) : null;
    if (atlas) self.postMessage(atlas, { transfer: [atlas.data.buffer] });
    else self.postMessage(null);
  } catch {
    self.postMessage(null);
  }
};
