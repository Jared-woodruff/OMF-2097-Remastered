// In-fight scoring: points, combo/consecutive-hit bonuses sliding into the score counter.
import { NATIVE_W } from '../video/draw';
import { OBJECT_FACE_LEFT, OBJECT_FACE_RIGHT } from './constants';
import { HAlign, hudText, type Text } from './gui/text';

const SLIDER_DISTANCE = 50;
const SLIDER_HANG_TIME = 25;
const SCRAP = 100000;
const DESTRUCTION = 200000;

const STD_MULTIPLIERS = [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4];
const TOURNAMENT_MULTIPLIERS = [0.0, 0.0, 0.5, 0.0, 1.0, 1.5, 2.0];

export function scoreFormat(n: number): string {
  const neg = n < 0;
  const abs = Math.abs(Math.trunc(n));
  const s = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + s;
}

interface ScoreText {
  text: Text;
  position: number;
  startX: number;
  startY: number;
  points: number;
  age: number;
}

export class ChrScore {
  score = 0;
  rounds = 0;
  wins = 0;
  health = 0;
  x = 0;
  y = 0;
  direction = OBJECT_FACE_RIGHT;
  difficulty = 0;
  texts: ScoreText[] = [];
  total: Text = hudText('0', 0xe7, 0xf8, 155, 6);
  consecutiveHits = 0;
  consecutiveHitScore = 0;
  comboHits = 0;
  comboHitScore = 0;
  multipliers = STD_MULTIPLIERS;
  done = false;
  scrap = false;
  destruction = false;

  constructor() {
    this.reset(true);
    this.wins = 0;
  }

  setDifficulty(d: number): void {
    this.difficulty = d;
  }

  setTournamentMode(t: boolean): void {
    this.multipliers = t ? TOURNAMENT_MULTIPLIERS : STD_MULTIPLIERS;
  }

  reset(wipe: boolean): void {
    if (wipe) {
      this.score = 0;
      this.total.set('0');
    }
    this.rounds = 0;
    this.consecutiveHits = 0;
    this.consecutiveHitScore = 0;
    this.comboHits = 0;
    this.comboHitScore = 0;
    this.done = false;
    this.scrap = false;
    this.destruction = false;
    this.texts = [];
  }

  resetWins(): void {
    this.wins = 0;
  }

  setPos(x: number, y: number, direction: number): void {
    this.x = x;
    this.y = y;
    this.direction = direction;
    if (direction === OBJECT_FACE_LEFT) this.total.setHAlign(HAlign.RIGHT);
  }

  onscreen(): boolean {
    return this.texts.length > 0;
  }

  multiplier(): number {
    return this.multipliers[this.difficulty] ?? 1;
  }

  tick(): void {
    let refresh = false;
    let lastage = -1;
    for (let i = 0; i < this.texts.length; ) {
      const t = this.texts[i];
      if (lastage > 0 && lastage - t.age < SLIDER_DISTANCE) break;
      if (t.age > SLIDER_HANG_TIME) t.position -= 0.01;
      lastage = t.age++;
      if (t.position < 0) {
        this.score += t.points;
        refresh = true;
        this.texts.splice(i, 1);
        continue;
      }
      i++;
    }
    if (refresh) this.total.set(scoreFormat(this.score));
  }

  render(renderTotal: boolean): void {
    if (renderTotal) {
      const xc = this.direction === OBJECT_FACE_LEFT ? 155 : 0;
      this.total.draw(this.x - xc, this.y);
    }
    let lastage = -1;
    for (const t of this.texts) {
      if (lastage > 0 && lastage - t.age < SLIDER_DISTANCE) break;
      const sx = this.direction === OBJECT_FACE_RIGHT ? this.x : this.x - t.text.width();
      const px = Math.trunc(sx + (t.startX - sx) * t.position);
      const py = Math.trunc(this.y + (t.startY - this.y) * t.position);
      t.text.draw(px, py);
      lastage = t.age;
    }
  }

  private add(str: string, points: number, x: number, y: number, position: number): void {
    const text = hudText(str, 0xe7, 0xf8, 155, 6);
    // Centered over the robot, but kept on screen (the reference lets it run off the edge near the walls).
    const w = text.width();
    const startX = Math.max(2, Math.min(NATIVE_W - 2 - w, x - Math.trunc(w / 2)));
    this.texts.push({ text, points, startX, startY: y, position, age: 0 });
  }

  hit(points: number): void {
    points = Math.trunc(points * this.multiplier());
    this.score += points;
    this.consecutiveHits++;
    this.consecutiveHitScore += points;
    this.comboHits++;
    this.comboHitScore += points;
    this.total.set(scoreFormat(this.score));
  }

  victory(health: number): void {
    this.wins++;
    this.health = health;
    if (health === 100) {
      const points = Math.trunc(DESTRUCTION * this.multiplier());
      this.add(`perfect round ${scoreFormat(points)}`, points, 160, 100, 1.0);
    }
    const points = Math.trunc(DESTRUCTION * this.multiplier() * (health / 100));
    this.add(`vitality ${scoreFormat(points)}`, points, 160, 100, 1.0);
  }

  setScrap(): void {
    this.scrap = true;
  }

  setDestruction(): void {
    this.destruction = true;
  }

  setDone(): void {
    if (this.done) return;
    this.done = true;
    if (this.destruction) {
      const points = Math.trunc(DESTRUCTION * this.multiplier());
      this.add(`destruction bonus ${scoreFormat(points)}`, points, 160, 100, 1.0);
      this.destruction = false;
    } else if (this.scrap) {
      const points = Math.trunc(SCRAP * this.multiplier());
      this.add(`scrap bonus ${scoreFormat(points)}`, points, 160, 100, 1.0);
      this.scrap = false;
    }
  }

  clearDone(): void {
    this.done = false;
  }

  interrupt(x: number): boolean {
    let ret = false;
    if (this.consecutiveHits > 3) {
      ret = true;
      let s = `${this.consecutiveHits} consecutive hits`;
      if (this.consecutiveHitScore > 0) s += ` ${scoreFormat(this.consecutiveHitScore)}`;
      this.add(s, this.consecutiveHitScore, x, 130, 1.0);
    }
    this.consecutiveHits = 0;
    this.consecutiveHitScore = 0;
    return ret;
  }

  endCombo(x: number): boolean {
    let ret = false;
    if (this.comboHits > 1) {
      ret = true;
      let s = `${this.comboHits} hit combo`;
      if (this.comboHitScore > 0) s += ` ${scoreFormat(this.comboHitScore * 4)}`;
      this.add(s, this.comboHitScore * 4, x, 130, 1.0);
    }
    this.comboHits = 0;
    this.comboHitScore = 0;
    return ret;
  }
}
