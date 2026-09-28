// Progress bars: the original surfaces stay in the draw list (classic graphics), described once more for the
// remastered renderer's vector bars, with a trail of recent damage on health bars.
import { beforeEach, describe, expect, it } from 'vitest';
import { PROGRESSBAR_LEFT, PROGRESSBAR_RIGHT, ProgressBar, THEME_ENDURANCE, THEME_HEALTH, THEME_MELEE } from '../game/gui/progressbar';
import { drawList } from '../video/draw';

function frame(bar: ProgressBar): void {
  drawList.begin();
  bar.render();
}

describe('HUD bars', () => {
  beforeEach(() => drawList.begin());

  it('describes the commands that draw them', () => {
    const b = new ProgressBar(THEME_HEALTH, PROGRESSBAR_RIGHT, 100);
    b.layout(4, 4, 100, 8);
    frame(b);
    // Background and fill block, as in the original.
    expect(drawList.count).toBe(2);
    expect(drawList.barCount).toBe(1);
    expect(drawList.cmds[0].bar).toBe(0);
    expect(drawList.cmds[1].bar).toBe(-2);
    expect(drawList.bars[0]).toMatchObject({ x: 4, y: 4, w: 100, h: 8, value: 1, trail: 1, dir: 1, clearTrack: false, flash: 0, low: 0 });
    expect(drawList.bars[0].colors).toEqual([0xb9, 0xbe, 0xf9, 0xf9, 0xb7, 0xb4, 0xf6]);
    // Other draws are not part of a bar.
    drawList.begin();
    drawList.push(drawList.cmds[0].surf, 0, 0, 10, 10, 0, 0, 0, 255, 255, 0, 0);
    expect(drawList.cmds[0].bar).toBe(-1);
  });

  it('keeps the damage just taken as a trail on health bars', () => {
    const b = new ProgressBar(THEME_HEALTH, PROGRESSBAR_RIGHT, 100);
    b.layout(4, 4, 100, 8);
    b.damageTrail = true;
    b.setProgress(60, true);
    frame(b);
    expect(drawList.bars[0].value).toBeCloseTo(0.6);
    expect(drawList.bars[0].trail).toBe(1);
    // It holds for a moment, then drains to the value.
    for (let i = 0; i < 20; i++) b.tick();
    frame(b);
    expect(drawList.bars[0].trail).toBe(1);
    for (let i = 0; i < 60; i++) b.tick();
    frame(b);
    expect(drawList.bars[0].trail).toBeCloseTo(0.6);
    // Refills and unanimated changes (warp speed) move the trail along.
    b.setProgress(90, true);
    frame(b);
    expect(drawList.bars[0].trail).toBeCloseTo(0.9);
    b.setProgress(10, false);
    frame(b);
    expect(drawList.bars[0].trail).toBeCloseTo(0.1);
  });

  it('shows no trail on other bars, and pulses the warnings smoothly', () => {
    const e = new ProgressBar(THEME_ENDURANCE, PROGRESSBAR_LEFT, 100);
    e.layout(216, 13, 100, 4);
    e.setProgress(40, true);
    e.setFlashing(true, 8);
    frame(e);
    expect(drawList.bars[0]).toMatchObject({ trail: 0.4, dir: 0, flash: 0 });
    const flashes: number[] = [];
    for (let i = 0; i < 18; i++) {
      e.tick();
      frame(e);
      flashes.push(drawList.bars[0].flash);
    }
    expect(Math.max(...flashes)).toBeGreaterThan(0.95);
    expect(Math.min(...flashes)).toBeLessThan(0.05);

    const h = new ProgressBar(THEME_HEALTH, PROGRESSBAR_RIGHT, 100);
    h.layout(4, 4, 100, 8);
    h.warnBelow = 25;
    h.setProgress(20, true);
    const lows: number[] = [];
    for (let i = 0; i < 40; i++) {
      h.tick();
      frame(h);
      lows.push(drawList.bars[0].low);
    }
    expect(Math.max(...lows)).toBeGreaterThan(0.95);
    h.setProgress(0, true);
    frame(h);
    expect(drawList.bars[0].low).toBe(0);
  });

  it('marks see-through tracks and highlights', () => {
    const s = new ProgressBar(THEME_MELEE, PROGRESSBAR_LEFT, 50);
    s.layout(74, 12, 80, 8);
    s.highlight = true;
    frame(s);
    expect(drawList.bars[0]).toMatchObject({ clearTrack: true, palOffset: 1, value: 0.5 });
  });
});
