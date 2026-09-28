// Victory screen (not in the original game; GAMEPLAY > NEW CONTENT > VICTORY SCREENS): after a one or two player fight,
// or a fight of the arcade, survival and time attack modes, the winner's portrait and robot on the VS screen's backdrop
// with a line of theirs. Any button (or a few seconds) goes on to what comes next.
import type { CtrlEvent } from '../../controller/controller';
import { harPicture, bkGetInfo } from '../../resources/resources';
import { RSprite } from '../../resources/animation';
import { MOVE } from '../../gen/fighter/moveset';
import { globalRandom } from '../../util/random';
import { TAG_MENU, video } from '../../video/draw';
import { ACT_ESC, ACT_KICK, ACT_PUNCH, CtrlType, ORIGINAL_HAR_TYPES, RENDER_LAYER_MIDDLE, RENDER_LAYER_TOP, SceneId } from '../constants';
import { registerScene, type GameState } from '../gameState';
import { FontSize, GLYPH_SHADOW_BOTTOM, GLYPH_SHADOW_RIGHT, HAlign, Text, VAlign } from '../gui/text';
import { GameObject } from '../object';
import { menuShade } from '../gui/widgets';
import { paletteLoadPlayerColors } from '../pilotColors';
import { Scene } from '../scene';

const COLOR_YELLOW = 0xcf;
const COLOR_GREEN = 0xa7;
/** Ticks until the screen goes on by itself. */
const WAIT_TICKS = 700;

/** Three lines for each of the eleven pilots (after their biographies), and some for anybody else. */
export const WIN_QUOTES: string[][] = [
  ['I did not come this far to lose to you.', 'Every win brings me closer to the truth.', 'Get up. I have fought worse on my own.'],
  ['Young? Sure. Slow? Never.', 'Did you think the kid would be easy?', 'Tell the veterans I am coming for them next.'],
  ['Too slow. Way too slow.', 'One, two, down. That is kickboxing.', 'You blinked. I did not.'],
  ['Sorry about your robot. And your pride.', 'Attack, attack, attack. It never fails.', 'Smile for the cameras. They came to see me.'],
  ['Ha! These old bones still have some fight in them.', 'Power comes with patience, young one.', 'Come back after a few more birthdays.'],
  ['Everything went exactly as I planned.', 'You fought fair. That was your mistake.', 'I knew every move before you made it.'],
  ['A good fight. Learn from it, and come back stronger.', 'Endurance wins the long race, my friend.', 'Rest now. We train again tomorrow.'],
  ['...', 'You will not remember my name. Only the defeat.', 'Leave me be.'],
  ['The arena took my legs. It will not take my wins.', 'Careful fighters live longer. Remember that.', 'Hope was your first mistake.'],
  ['Crawl back to wherever you came from.', 'Kreissack sends his regards.', 'That was not a fight. That was a lesson.'],
  ['The future belongs to WAR.', 'Flesh is weak. Steel endures.', 'You were never a threat. Only a test.'],
];
const ANYONE = ['Victory!', 'Another one for the record books.', 'Next!', 'Is that all you had?'];

export function winQuote(pilotId: number): string {
  const q = WIN_QUOTES[pilotId] ?? ANYONE;
  return q[globalRandom.int(q.length)];
}

export class VictoryScene extends Scene {
  private title: Text;
  private quote: Text;
  private hint: Text;
  private ticks = 0;
  private shade = menuShade(152, 102);

  constructor(gs: GameState) {
    super(gs, SceneId.VICTORY);
    const winnerId = Math.max(0, gs.fightStats.winner);
    const winner = gs.getPlayer(winnerId);
    const pilot = winner.pilot;
    paletteLoadPlayerColors(pilot.palette, 0);

    // The winner's robot (the VS screen's pictures; the remaster's robots bring theirs), then the portrait.
    const ani = bkGetInfo(this.bk, 5)!.ani;
    if (pilot.harId >= ORIGINAL_HAR_TYPES) {
      const pic = harPicture(pilot.harId, MOVE.PORTRAIT_VS);
      if (pic) {
        while (ani.sprites.length < pilot.harId) ani.sprites.push(new RSprite(ani.sprites.length, 0, 0, null));
        ani.sprites[pilot.harId] = new RSprite(pilot.harId, -(pic.surface.w + 12), 152 - pic.surface.h, pic.surface);
      }
    }
    // The left half of the backdrop mirrored onto the right, as on the VS screen (on a copy: loadBk shares pixels).
    const bg = this.bk.background.clone();
    bg.blit(this.bk.background, 160, 0, 0, 0, 160, 200, true);
    bg.source = { kind: 'background', key: `${this.bk.file}/bg#mirror` };
    this.bk.background = bg;
    const har = new GameObject(gs, 160, 0);
    har.setAnimation(ani);
    har.selectSprite(pilot.harId);
    har.setHalt(1);
    gs.addObject(har, RENDER_LAYER_MIDDLE, false, false);
    if (pilot.pilotId >= 0 && pilot.pilotId <= 10) {
      const portrait = new GameObject(gs, -10, 150);
      portrait.setAnimation(bkGetInfo(this.bk, 4)!.ani);
      portrait.selectSprite(pilot.pilotId);
      portrait.setHalt(1);
      gs.addObject(portrait, RENDER_LAYER_TOP, false, false);
    }

    const name = (pilot.name || `PLAYER ${winnerId + 1}`).toUpperCase();
    this.title = new Text(FontSize.BIG, 320, 10, `${name} WINS!`).setHAlign(HAlign.CENTER).setColor(COLOR_YELLOW)
      .setShadowColor(202).setShadow(GLYPH_SHADOW_RIGHT | GLYPH_SHADOW_BOTTOM);
    this.quote = new Text(FontSize.SMALL, 140, 90, `"${winQuote(pilot.pilotId)}"`).setHAlign(HAlign.CENTER).setVAlign(VAlign.MIDDLE)
      .setColor(COLOR_YELLOW).setShadowColor(202).setShadow(GLYPH_SHADOW_RIGHT | GLYPH_SHADOW_BOTTOM);
    this.hint = new Text(FontSize.SMALL, 150, 8, 'PRESS A BUTTON').setHAlign(HAlign.CENTER).setColor(COLOR_GREEN);
  }

  private next(): void {
    this.gs.setNext(this.gs.victoryNext ?? SceneId.MENU);
  }

  override dynamicTick(_paused: boolean): void {
    if (++this.ticks === WAIT_TICKS) this.next();
  }

  override inputPoll(): void {
    const gs = this.gs;
    const ev: CtrlEvent[] = [];
    gs.menuPoll(ev, { playerScene: true });
    for (const p of gs.players) if (p.ctrl.type !== CtrlType.AI) p.ctrl.poll(ev);
    // A moment first, so a button still held from the fight does not skip the screen.
    if (this.ticks < 40) return;
    if (ev.some((e) => e.type === 'action' && e.action & (ACT_PUNCH | ACT_KICK | ACT_ESC))) this.next();
  }

  override render(): void {
    video.setTag(TAG_MENU);
    this.title.draw(0, 4);
    video.drawRemap(this.shade, 166, 34, 4, 1, 0);
    this.quote.draw(172, 40);
    if (this.ticks > 40) this.hint.draw(168, 186);
  }
}

registerScene(SceneId.VICTORY, (gs) => new VictoryScene(gs));
