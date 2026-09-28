// The controls bar shown while watching a replay: play / pause, speed, the timeline with the clip marks, and the keys.
// Keys (and the pad through the menu controls): SPACE / ENTER / A pause, LEFT / RIGHT step one tick while paused (skip
// five seconds while playing), UP / DOWN speed, R restart, H / X hide the bar, I / O clip marks, V video, G GIF,
// K keep, ESC / B leave. The timeline takes clicks to jump.
import type { PointerKind } from '../../controller/mouse';
import { video } from '../../video/draw';
import { MS_PER_OMF_TICK_SLOWEST } from '../constants';
import { PROGRESSBAR_LEFT, ProgressBar, THEME_ENDURANCE } from '../gui/progressbar';
import { FontSize, GLYPH_SHADOW_BOTTOM, GLYPH_SHADOW_RIGHT, HAlign, Text } from '../gui/text';
import { menuShade } from '../gui/widgets';
import type { ReplaySession } from './playback';

const TEXT = 0xe7;
const SHADOW = 0xf8;
const HINT = 0xbe;
const MARK = 0xb7;

const BAR_X = 8, BAR_Y = 186, BAR_W = 304, BAR_H = 4;

function text(font = FontSize.SMALL, color = TEXT): Text {
  return new Text(font, BAR_W, 7, '').setColor(color).setShadowColor(SHADOW).setShadow(GLYPH_SHADOW_RIGHT | GLYPH_SHADOW_BOTTOM).setWordWrap(false);
}

/** Game ticks as minutes and seconds at the game speed's tick length. */
export function formatTicks(ticks: number, speed: number): string {
  const ms = Math.trunc(8 + MS_PER_OMF_TICK_SLOWEST - (speed / 15) * MS_PER_OMF_TICK_SLOWEST);
  const s = Math.floor((ticks * ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class ReplayHud {
  private shade = menuShade(312, 26);
  private bar = new ProgressBar(THEME_ENDURANCE, PROGRESSBAR_LEFT, 0);
  private status = text();
  private time = text().setHAlign(HAlign.RIGHT);
  private hint = text(FontSize.SMALL, HINT).setHAlign(HAlign.CENTER);
  private marks = text(FontSize.SMALL, MARK);
  /** A short message (e.g. "KEPT") and the frames left to show it. */
  private note = '';
  private noteFrames = 0;
  private frames = 0;

  constructor(private s: ReplaySession) {
    this.bar.layout(BAR_X, BAR_Y, BAR_W, BAR_H);
  }

  flash(note: string): void {
    this.note = note;
    this.noteFrames = 120;
  }

  render(): void {
    const s = this.s;
    const gs = s.gs;
    if (!s.hud) return;
    video.drawRemap(this.shade, 4, 173, 4, 1, 0);
    const state = s.ended ? 'END' : s.paused ? 'PAUSED' : 'PLAY';
    const speed = s.speed === 1 ? '' : `  ${s.speed < 1 ? `1/${1 / s.speed}` : s.speed}X`;
    const clip = s.markIn >= 0 || s.markOut >= 0
      ? `   CLIP ${s.markIn >= 0 ? formatTicks(s.markIn, gs.speed) : 'START'}-${s.markOut >= 0 ? formatTicks(s.markOut, gs.speed) : 'END'}`
      : '';
    this.status.set(`REPLAY  ${state}${speed}${clip}${this.noteFrames > 0 ? `   ${this.note}` : ''}`);
    this.status.draw(BAR_X, 177);
    if (this.noteFrames > 0) this.noteFrames--;
    this.time.set(`${formatTicks(Math.min(gs.tick, s.endTick), gs.speed)} / ${formatTicks(s.endTick, gs.speed)}`);
    this.time.draw(BAR_X, 177);
    this.bar.setProgress(s.endTick > 0 ? (Math.min(gs.tick, s.endTick) * 100) / s.endTick : 0, false);
    this.bar.render();
    for (const m of [s.markIn, s.markOut]) {
      if (m < 0) continue;
      this.marks.set('|');
      this.marks.draw(Math.round(BAR_X + (m / Math.max(1, s.endTick)) * BAR_W) - 1, BAR_Y - 2);
    }
    // Two sets of keys, taking turns.
    this.frames++;
    this.hint.set(Math.floor(this.frames / 240) % 2 === 0
      ? 'SPACE PAUSE  < > STEP  UP/DOWN SPEED  R RESTART'
      : 'I O CLIP  V VIDEO  G GIF  K KEEP  H HIDE  ESC EXIT');
    this.hint.draw(BAR_X, 191);
  }

  /** A click on the timeline jumps there. */
  pointer(x: number, y: number, kind: PointerKind): boolean {
    const s = this.s;
    if (kind !== 'click' || !s.hud) return false;
    if (y >= BAR_Y - 3 && y <= BAR_Y + BAR_H + 3 && x >= BAR_X && x <= BAR_X + BAR_W) {
      s.seek(Math.round(((x - BAR_X) / BAR_W) * s.endTick));
      return true;
    }
    return false;
  }
}
