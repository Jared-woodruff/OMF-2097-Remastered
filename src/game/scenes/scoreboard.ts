// Scoreboard: the high score table (one page per round type) with name entry for a new single player high score
// (port of the reference scoreboard scene). Uses MAIN.BK with a darkened palette.
import { modPilot } from '../../mods/registry';
import { isDown } from '../../controller/input';
import type { CtrlEvent } from '../../controller/controller';
import { vga } from '../../video/vga';
import { ACT_ESC, ACT_KICK, ACT_LEFT, ACT_PUNCH, ACT_RIGHT, CtrlType, HAR_NAMES, PILOT_NAMES, ROUND_TYPE_NAMES, SceneId } from '../constants';
import { registerScene, type GameState } from '../gameState';
import { FontSize, HAlign, Text } from '../gui/text';
import { TextInput } from '../gui/textinput';
import { GuiFrame, type GuiTheme } from '../gui/widgets';
import { createScoreboard, emptyScoreEntry, SCORE_ENTRIES, scoresClear, scoresRead, scoresWrite, type ScoreEntry, type Scoreboard } from '../scores';
import { scoreFormat } from '../score';
import { Scene } from '../scene';
import { settings } from '../settings';

const MAX_PAGES = ROUND_TYPE_NAMES.length - 1;
const SCORE_COUNT = 20;
const DIALOG_BORDER_COLOR = 0xfe;
const TEXT_PRIMARY_COLOR = 0xfd;
const TEXT_SECONDARY_COLOR = 0xfe;
const TEXT_DISABLED_COLOR = 0xc0;
const TEXT_ACTIVE_COLOR = 0xff;
const TEXT_INACTIVE_COLOR = 0xfe;
const TEXT_SHADOW_COLOR = 0xc0;

function padRight(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}

function padLeft(s: string, w: number): string {
  return s.length >= w ? s : ' '.repeat(w - s.length) + s;
}

function harName(id: number): string {
  return HAR_NAMES[id] ?? '(null)';
}

function pilotName(id: number): string {
  // (a mod pilot while its mod is on)
  return PILOT_NAMES[id] ?? modPilot(id)?.info.name.toUpperCase() ?? '(null)';
}

/** printf("%-18.16s%-9s%-9s%11s", ...) */
export function scoreRow(name: string, har: string, pilot: string, score: string): string {
  return padRight(name.slice(0, 16), 18) + padRight(har, 9) + padRight(pilot, 9) + padLeft(score, 11);
}

export class ScoreboardScene extends Scene {
  data: Scoreboard = createScoreboard();
  pendingData: ScoreEntry = emptyScoreEntry();
  hasPendingData = false;
  page: number;
  newScoreSlot = -1;
  ti: TextInput | null = null;
  frame: GuiFrame | null = null;
  title: Text;
  subtitle: Text;
  scores: Text[] = [];
  /** The same event object is only handled once (defensive: several dispatchers may forward it). */
  private lastKeyEvent: KeyboardEvent | null = null;

  constructor(gs: GameState) {
    super(gs, SceneId.SCOREBOARD);
    // (clamped: the page indexes the table, and settings come from storage)
    this.page = Math.max(0, Math.min(MAX_PAGES, Math.trunc(settings().gameplay.rounds) || 0));
    vga.mulBasePalette(0, 0xef, 0.25);
    const theme: GuiTheme = {
      borderColor: DIALOG_BORDER_COLOR,
      font: FontSize.BIG,
      primaryColor: TEXT_PRIMARY_COLOR,
      secondaryColor: TEXT_SECONDARY_COLOR,
      disabledColor: TEXT_DISABLED_COLOR,
      activeColor: TEXT_ACTIVE_COLOR,
      inactiveColor: TEXT_INACTIVE_COLOR,
      shadowColor: TEXT_SHADOW_COLOR,
    };
    if (scoresRead(this.data) === 1) scoresClear(this.data); // no score data yet: empty table

    if (this.foundPendingScore()) {
      const player = gs.getPlayer(0);
      const score = player.score.score;
      if (this.scoreFitsScoreboard(score)) {
        this.hasPendingData = true;
        this.pendingData = { score, harId: player.pilot.harId, pilotId: player.pilot.pilotId, name: '' };
      }
      player.score.reset(true);
    }
    if (this.hasPendingData) {
      for (let r = 0; r < SCORE_COUNT; r++) {
        if (this.data.entries[this.page][r].score < this.pendingData.score) {
          this.newScoreSlot = r;
          break;
        }
      }
    }
    if (this.newScoreSlot > -1) {
      this.frame = new GuiFrame(theme, 20, 30 + this.newScoreSlot * 8, 96, 10);
      const ti = new TextInput(15, '', '');
      ti.setFont(FontSize.SMALL);
      ti.enableBackground(false);
      ti.setHorizontalAlign(HAlign.LEFT);
      ti.setWheelCharset(' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
      ti.setEditByDefault(true);
      this.ti = ti;
      this.frame.setRoot(ti);
      this.frame.layout();
      ti.selected = true;
    } else {
      // The new score does not fit into the top 20: no name entry.
      this.hasPendingData = false;
    }

    this.title = new Text(FontSize.BIG, 320, 6).setColor(TEXT_PRIMARY_COLOR).setHAlign(HAlign.CENTER);
    this.setTitle();
    this.subtitle = new Text(FontSize.SMALL, 290, 6).setColor(TEXT_PRIMARY_COLOR);
    this.setSubtitle();
    for (let i = 0; i < SCORE_COUNT; i++) this.scores.push(new Text(FontSize.SMALL, 290, 6).setColor(TEXT_PRIMARY_COLOR));
    this.setScores();
  }

  private setTitle(): void {
    this.title.set(`SCOREBOARD - ${ROUND_TYPE_NAMES[this.page]}`);
  }

  private setSubtitle(): void {
    this.subtitle.set(scoreRow('PLAYER NAME', 'ROBOT', 'PILOT', 'SCORE'));
  }

  private setScores(): void {
    const page = this.data.entries[this.page];
    let entry = 0;
    for (let r = 0; r < SCORE_COUNT; r++) {
      let row = '';
      if (this.hasPendingData && r === this.newScoreSlot) {
        const p = this.pendingData;
        row = scoreRow('', harName(p.harId), pilotName(p.pilotId), scoreFormat(p.score));
      } else {
        const e = page[entry];
        if (e && e.score > 0) row = scoreRow(e.name, harName(e.harId), pilotName(e.pilotId), scoreFormat(e.score));
        entry++;
      }
      this.scores[r].set(row);
    }
  }

  private refresh(): void {
    this.setTitle();
    this.setScores();
  }

  private handleScoreboardSave(): void {
    const slot = this.newScoreSlot;
    const name = this.ti ? this.ti.value() : '';
    if (!name.length) return;
    this.pendingData.name = name.slice(0, 15);
    const page = this.data.entries[this.page];
    page.splice(slot, 0, { ...this.pendingData });
    page.length = SCORE_ENTRIES;
    scoresWrite(this.data);
  }

  private foundPendingScore(): boolean {
    const gs = this.gs;
    // (OMF Studio's test of an ending is not the player's game: no high score)
    if (gs.modTest) return false;
    return gs.getPlayer(1).ctrl != null && gs.getPlayer(1).ctrl.type === CtrlType.AI && gs.getPlayer(0).score.score > 0;
  }

  private scoreFitsScoreboard(score: number): boolean {
    for (let i = 0; i < SCORE_COUNT; i++) {
      if (score > this.data.entries[this.page][i].score) return true;
    }
    return false;
  }

  /**
   * Our menu polling also maps Space to punch (the reference only uses Return); while a name is being typed a
   * space is text, not "OK".
   */
  private isTypedSpace(action: number): boolean {
    return action === ACT_PUNCH && isDown('Space') && !isDown('Enter') && !isDown('NumpadEnter');
  }

  private processEvent(e: CtrlEvent): void {
    if (e.type !== 'action') return;
    const pressedOk = e.action === ACT_KICK || e.action === ACT_PUNCH;
    if (this.hasPendingData) {
      if (this.isTypedSpace(e.action)) return;
      if (pressedOk) {
        this.handleScoreboardSave();
        this.hasPendingData = false;
        this.setScores();
      } else {
        this.frame?.action(e.action, e.source);
      }
    } else if (e.action === ACT_ESC || pressedOk) {
      this.gs.setNext(this.gs.nextNextId);
    } else if (e.action === ACT_LEFT) {
      this.page = this.page > 0 ? this.page - 1 : 0;
      this.refresh();
    } else if (e.action === ACT_RIGHT) {
      this.page = this.page < MAX_PAGES ? this.page + 1 : MAX_PAGES;
      this.refresh();
    }
  }

  override startup(id: number): [boolean, boolean] {
    switch (id) {
      case 10:
      case 11:
        return [true, true];
    }
    return [false, false];
  }

  /** Raw key events (forwarded by the host) for the name entry (reference scoreboard_event). */
  override keyEvent(code: string, e: KeyboardEvent): boolean {
    if (e === this.lastKeyEvent) return true;
    this.lastKeyEvent = e;
    if (this.hasPendingData && this.frame) return this.frame.keyEvent(code, e);
    return false;
  }

  override staticTick(_paused: boolean): void {
    if (this.hasPendingData) this.frame?.tick();
  }

  override inputPoll(): void {
    const ev: CtrlEvent[] = [];
    this.gs.menuPoll(ev);
    for (const e of ev) this.processEvent(e);
  }

  override renderOverlay(): void {
    this.title.draw(0, 5);
    this.subtitle.draw(20, 20);
    for (let i = 0; i < SCORE_COUNT; i++) this.scores[i].draw(20, 30 + i * 8);
    if (this.hasPendingData) this.frame?.render();
  }

  override free(): void {
    this.frame?.free();
  }
}

registerScene(SceneId.SCOREBOARD, (gs) => new ScoreboardScene(gs));
