// The credits' animated space backdrop (EXTRAS > CREDITS: the title and the end titles, see creditsView.ts), drawn on
// a canvas: stars, a drifting nebula, a neon grid floor running toward the viewer, rising sparks, shooting stars,
// bursts and shockwaves, with the grid, the horizon and the sparks moving to the music (bass, level, beats).

interface Star { x: number; y: number; z: number; t: number; warm: boolean }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; sprite: HTMLCanvasElement; g: number }
interface Streak { x: number; y: number; vx: number; vy: number; life: number }
interface Ring { x: number; y: number; r: number; life: number }

const SPARK_COLORS = ['#33e6ff', '#ff9a3d', '#ff3df2', '#ffd84a', '#7f95ff'];

/** A soft round light of a color (drawn additively). */
function glowSprite(color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.18, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

export class Backdrop {
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  /** Canvas pixels per CSS pixel. */
  k = 1;
  private stars: Star[] = [];
  private sparks: Spark[] = [];
  private streaks: Streak[] = [];
  private rings: Ring[] = [];
  private sprites = SPARK_COLORS.map(glowSprite);
  private nebula: HTMLCanvasElement;
  private spawn = 0;
  private nextStreak = 2;
  /** Pointer position (-1..1) for a little parallax. */
  px = 0;
  py = 0;
  /** The music's low end and overall level (0..1), for the grid, the horizon and the sparks. */
  bass = 0;
  level = 0;

  constructor(private canvas: HTMLCanvasElement, private calm: boolean) {
    this.ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 420; i++) {
      this.stars.push({ x: Math.random(), y: Math.random(), z: 0.15 + Math.random() * 0.85, t: Math.random() * 10, warm: Math.random() < 0.12 });
    }
    this.nebula = this.makeNebula();
    this.resize();
  }

  /** The nebula, painted once small (it is soft) and drawn stretched. */
  private makeNebula(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = 300;
    const g = c.getContext('2d')!;
    g.fillStyle = '#02030a';
    g.fillRect(0, 0, 480, 300);
    g.globalCompositeOperation = 'lighter';
    const blobs: [number, number, number, string][] = [
      [110, 90, 170, 'rgba(70,20,140,.55)'], [330, 70, 190, 'rgba(20,50,170,.5)'], [250, 170, 150, 'rgba(120,20,110,.35)'],
      [420, 200, 140, 'rgba(10,90,140,.35)'], [60, 220, 130, 'rgba(30,40,150,.35)'], [240, 40, 110, 'rgba(160,60,200,.22)'],
    ];
    for (const [x, y, r, col] of blobs) {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, col);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 480, 300);
    }
    return c;
  }

  resize(): void {
    // (soft content: at most 1.5 canvas pixels per CSS pixel, and not beyond 2560 wide)
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.k = Math.min(dpr, 2560 / Math.max(1, window.innerWidth));
    this.w = this.canvas.width = Math.max(1, Math.round(window.innerWidth * this.k));
    this.h = this.canvas.height = Math.max(1, Math.round(window.innerHeight * this.k));
  }

  /** Sparks flying out of a point (CSS pixels). */
  burst(x: number, y: number, n: number): void {
    if (this.calm) return;
    const k = this.k;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (90 + Math.random() * 320) * k;
      const max = 0.7 + Math.random() * 0.9;
      this.sparks.push({
        x: x * k, y: y * k, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60 * k, life: max, max, size: (10 + Math.random() * 16) * k,
        sprite: this.sprites[Math.floor(Math.random() * this.sprites.length)], g: 260 * k,
      });
    }
  }

  /** A beat of the music: sparks fly up from along the horizon. */
  beat(strength: number): void {
    if (this.calm) return;
    const k = this.k, horizon = this.h * 0.72;
    const n = Math.round(10 + strength * 26);
    for (let i = 0; i < n; i++) {
      const max = 0.6 + Math.random() * 0.9;
      this.sparks.push({
        x: Math.random() * this.w, y: horizon + Math.random() * 6 * k, vx: (Math.random() - 0.5) * 120 * k,
        vy: -(160 + Math.random() * 320) * k * (0.6 + strength), life: max, max, size: (8 + Math.random() * 14) * k,
        sprite: this.sprites[Math.floor(Math.random() * this.sprites.length)], g: 380 * k,
      });
    }
  }

  /** A shockwave ring from a point (CSS pixels). */
  shock(x: number, y: number): void {
    if (!this.calm) this.rings.push({ x: x * this.k, y: y * this.k, r: 0, life: 1 });
  }

  frame(dt: number, t: number, scroll: number): void {
    const { ctx, w, h, k } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // The nebula, drifting and a little behind the titles.
    const drift = Math.sin(t * 0.03) * 0.04;
    const ny = -(scroll * k * 0.04) % (h * 0.5);
    ctx.drawImage(this.nebula, -w * (0.1 + drift) + this.px * 14 * k, -h * 0.1 + ny + this.py * 10 * k, w * 1.25, h * 1.35);
    // Stars: deeper ones move less with the titles and the pointer; they twinkle.
    const horizon = h * 0.72;
    for (const s of this.stars) {
      const y = ((s.y * h * 1.4 - scroll * k * s.z * 0.35 - t * 4 * k * s.z) % (h * 1.4) + h * 1.4) % (h * 1.4) + this.py * 16 * k * s.z;
      if (y > horizon + 4 * k || y < -4 * k) continue;
      const x = s.x * w + this.px * 22 * k * s.z;
      const a = 0.35 + 0.65 * s.z * (0.55 + 0.45 * Math.sin(t * (1.5 + s.z * 3) + s.t));
      const r = (0.45 + s.z * 1.35) * k;
      ctx.globalAlpha = a;
      ctx.fillStyle = s.warm ? '#ffe2b0' : '#dfe8ff';
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    // Shooting stars.
    this.nextStreak -= dt;
    if (this.nextStreak <= 0 && !this.calm) {
      this.nextStreak = 2.5 + Math.random() * 4.5;
      this.streaks.push({ x: w * (0.2 + Math.random() * 0.9), y: horizon * Math.random() * 0.5, vx: -(700 + Math.random() * 500) * k, vy: (220 + Math.random() * 200) * k, life: 1 });
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const st of this.streaks) {
      st.x += st.vx * dt;
      st.y += st.vy * dt;
      st.life -= dt * 1.1;
      const tail = 0.14;
      const grad = ctx.createLinearGradient(st.x, st.y, st.x - st.vx * tail, st.y - st.vy * tail);
      grad.addColorStop(0, `rgba(220,235,255,${Math.max(0, st.life)})`);
      grad.addColorStop(1, 'rgba(120,160,255,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      ctx.moveTo(st.x, st.y);
      ctx.lineTo(st.x - st.vx * tail, st.y - st.vy * tail);
      ctx.stroke();
    }
    this.streaks = this.streaks.filter((s) => s.life > 0 && s.y < horizon);
    ctx.globalCompositeOperation = 'source-over';
    // The floor: dark, under a neon grid running toward the viewer, and a glowing horizon.
    const floor = ctx.createLinearGradient(0, horizon, 0, h);
    floor.addColorStop(0, '#060a26');
    floor.addColorStop(1, '#010208');
    ctx.fillStyle = floor;
    ctx.fillRect(0, horizon, w, h - horizon);
    const haze = ctx.createLinearGradient(0, horizon - h * 0.16, 0, horizon);
    haze.addColorStop(0, 'rgba(255,60,220,0)');
    haze.addColorStop(1, `rgba(255,60,220,${0.22 + this.bass * 0.3})`);
    ctx.fillStyle = haze;
    ctx.fillRect(0, horizon - h * 0.16, w, h * 0.16);
    const cx = w / 2 + this.px * 30 * k;
    const phase = (t * 0.45) % 1;
    ctx.globalCompositeOperation = 'lighter';
    for (let pass = 0; pass < 2; pass++) {
      ctx.lineWidth = (pass ? 1.3 : 5) * k;
      for (let i = 0; i < 26; i++) {
        const z = i + 1 - phase;
        const y = horizon + ((h - horizon) * 0.9) / z;
        if (y > h + 10) continue;
        const a = Math.min(1, 1.3 / z) * (pass ? 0.8 : 0.14) * (1 + this.bass * 0.9);
        ctx.strokeStyle = `rgba(60,100,255,${a})`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      for (let j = -16; j <= 16; j++) {
        const x0 = cx + j * w * 0.025, x1 = cx + j * w * 0.34;
        ctx.strokeStyle = `rgba(60,100,255,${(pass ? 0.5 : 0.1) * (1 + this.bass * 0.8)})`;
        ctx.beginPath();
        ctx.moveTo(x0, horizon);
        ctx.lineTo(x1, h);
        ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(120,240,255,.9)';
    ctx.fillRect(0, horizon - 1 * k, w, 2 * k);
    const glow = ctx.createLinearGradient(0, horizon - 14 * k, 0, horizon + 14 * k);
    glow.addColorStop(0, 'rgba(51,230,255,0)');
    glow.addColorStop(0.5, `rgba(51,230,255,${0.35 + this.bass * 0.45})`);
    glow.addColorStop(1, 'rgba(51,230,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, horizon - 14 * k, w, 28 * k);
    // Sparks rising from the floor, and the bursts.
    if (!this.calm) {
      this.spawn += dt * (24 + this.level * 60);
      while (this.spawn >= 1) {
        this.spawn--;
        const y = horizon + Math.random() * (h - horizon);
        const depth = (y - horizon) / (h - horizon);
        const max = 2 + Math.random() * 2.5;
        this.sparks.push({
          x: Math.random() * w, y, vx: (Math.random() - 0.5) * 30 * k, vy: -(30 + Math.random() * 90) * k * (0.4 + depth), life: max, max,
          size: (5 + depth * 14) * k, sprite: this.sprites[Math.floor(Math.random() * this.sprites.length)], g: -10 * k,
        });
      }
    }
    for (const p of this.sparks) {
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      const f = Math.max(0, p.life / p.max);
      ctx.globalAlpha = Math.min(1, f * 1.6);
      const s = p.size * (0.5 + f * 0.5);
      ctx.drawImage(p.sprite, p.x - s / 2, p.y - s / 2, s, s);
    }
    this.sparks = this.sparks.filter((p) => p.life > 0);
    for (const r of this.rings) {
      r.r += dt * 900 * k;
      r.life -= dt * 1.4;
      ctx.globalAlpha = Math.max(0, r.life);
      ctx.strokeStyle = 'rgba(120,220,255,.9)';
      ctx.lineWidth = 3 * k * Math.max(0.2, r.life);
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.rings = this.rings.filter((r) => r.life > 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
