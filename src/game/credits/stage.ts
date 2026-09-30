// The credits' stage: the main menu's painted city (public/hd/menu: the sky, the city, the two towers, the statue of a
// robot and the statue in the spotlight, two rows of crowd, see video/stage/parallax.ts) as pictures in the page, under a
// camera that rises and sinks through their depths, graded from night (the title) to dawn (the end titles). Canvases
// hold the light: behind the city, the stars, lightning in the clouds (the intro's own bolts) and searchlights; over it,
// the spotlight on the statue with its dust and rising embers; in front of everything (the titles, and the game in the
// fights), sparks and shockwaves. Positions are in the game's native pixels (320 x 200 on the screen, as the menu draws
// the layers).
import { clamp01, lerp } from './motion';

interface LayerInfo {
  name: string;
  file: string;
  /** Native rectangle (x, y, w, h). */
  rect: [number, number, number, number];
  /** Parallax depth: 0 = infinitely far, 1 = the nearest layer. */
  depth: number;
  litOf?: string;
}

export interface StageLook {
  /** Native pixels the camera is raised (the near layers sink by lift x depth), moved right, and its zoom. */
  lift: number;
  pan: number;
  zoom: number;
  /** 0 = night, 1 = dawn. */
  dawn: number;
  /** The statue in the spotlight (0..1). */
  lit: number;
  /** A dark veil over the city (0..1). */
  veil: number;
  /** Camera shake (native pixels). */
  shake: number;
  /** Searchlights behind the city, the stars (0..1). */
  searchlights: number;
  stars: number;
}

interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: number; g: number }
interface Ring { x: number; y: number; r: number; life: number; color: string }
interface Bolt { img: number; x: number; y: number; w: number; h: number; life: number; flip: boolean }
interface Star { x: number; y: number; z: number; p: number }

const MANIFEST = 'hd/menu/layers.json';
const COLORS = ['#ffffff', '#ffe7b0', '#9fe9ff', '#ff9ad8', '#ffd84a'];
/** The intro's lightning (its big strike: the other bolts end in a digit), drawn in the clouds. */
const BOLTS = ['credits/title/strike.webp'];
/** Where the spotlight hangs (off the screen, top left) and the statue's chest (native). */
const SPOT_SOURCE: [number, number] = [-150, -90];
const STATUE: [number, number] = [108, 96];

function glow(color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.2, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

export class Stage {
  readonly el: HTMLDivElement;
  private world: HTMLDivElement;
  private layers: { info: LayerInfo; img: HTMLImageElement; filter: string }[] = [];
  private horizon: HTMLDivElement;
  private back: HTMLCanvasElement;
  private mid: HTMLCanvasElement;
  /** The light in front of everything (the titles, and the game in the fights: sparks, rings), placed by the view. */
  readonly front: HTMLCanvasElement;
  private bctx: CanvasRenderingContext2D;
  private mctx: CanvasRenderingContext2D;
  private fctx: CanvasRenderingContext2D;
  private sprites = COLORS.map(glow);
  private bolts: HTMLImageElement[];
  private sparks: Spark[] = [];
  private rings: Ring[] = [];
  private skyBolts: Bolt[] = [];
  private stars: Star[] = [];
  private w = 1;
  private h = 1;
  /** Canvas pixels per CSS pixel; CSS pixels per native pixel, across and down. */
  private k = 1;
  private ux = 1;
  private uy = 1;
  private look: StageLook = { lift: 0, pan: 0, zoom: 1, dawn: 0, lit: 0, veil: 0, shake: 0, searchlights: 0, stars: 0 };
  private time = 0;
  private embers: Spark[] = [];
  private emberCount = 0;
  ready = false;

  constructor(private calm: boolean) {
    this.el = document.createElement('div');
    this.el.className = 'omfs';
    this.world = document.createElement('div');
    this.world.className = 'omfs-world';
    this.back = document.createElement('canvas');
    this.back.className = 'omfs-back';
    this.mid = document.createElement('canvas');
    this.mid.className = 'omfs-mid';
    this.front = document.createElement('canvas');
    this.front.className = 'omfs-front';
    this.horizon = document.createElement('div');
    this.horizon.className = 'omfs-horizon';
    this.el.append(this.world);
    this.bctx = this.back.getContext('2d')!;
    this.mctx = this.mid.getContext('2d')!;
    this.fctx = this.front.getContext('2d')!;
    this.bolts = BOLTS.map((src) => {
      const img = new Image();
      img.src = src;
      return img;
    });
    for (let i = 0; i < 260; i++) this.stars.push({ x: Math.random() * 608 - 144, y: Math.random() * 120 - 6, z: Math.random(), p: Math.random() * 6.28 });
    void this.load();
    this.resize();
  }

  private async load(): Promise<void> {
    try {
      const m = (await (await fetch(MANIFEST)).json()) as { layers: LayerInfo[] };
      for (const info of m.layers) {
        const img = new Image();
        img.className = `omfs-layer omfs-${info.name}`;
        img.alt = '';
        img.draggable = false;
        img.src = `hd/menu/${info.file}`;
        this.layers.push({ info, img, filter: '' });
        this.world.appendChild(img);
        // (the light behind the city goes over the sky: between it and the city)
        if (info.name === 'sky') this.world.append(this.back, this.horizon);
      }
      this.world.append(this.mid);
      this.ready = true;
      this.resize();
    } catch {
      // (no painted city: the stage stays a night sky with its lights)
      this.world.append(this.back, this.mid);
      this.ready = true;
    }
  }

  resize(): void {
    const W = window.innerWidth, H = window.innerHeight;
    this.k = Math.min(window.devicePixelRatio || 1, 1.5, 2560 / Math.max(1, W));
    for (const c of [this.back, this.mid, this.front]) {
      c.width = Math.max(1, Math.round(W * this.k));
      c.height = Math.max(1, Math.round(H * this.k));
    }
    this.w = W;
    this.h = H;
    // (the picture fills the screen: 200 native rows down, a little more for the camera's shake)
    this.uy = (H / 200) * 1.04;
    this.ux = this.uy / 1.2;
    if (320 * this.ux > W * 1.04) {
      this.ux = (W / 320) * 1.04;
      this.uy = this.ux * 1.2;
    }
    for (const { info, img } of this.layers) {
      img.style.width = `${info.rect[2] * this.ux}px`;
      img.style.height = `${info.rect[3] * this.uy}px`;
    }
  }

  /** A native point of a layer at `depth` on the screen (CSS pixels), with the camera as it is. */
  toScreen(x: number, y: number, depth = 1): [number, number] {
    const L = this.look;
    const z = 1 + (L.zoom - 1) * (0.35 + 0.65 * depth);
    const cx = 160 + L.pan * depth, cy = 100 - L.lift * depth;
    return [this.w / 2 + (x - cx) * this.ux * z, this.h / 2 + (y - cy) * this.uy * z];
  }

  /** Sparks flying out of a point (CSS pixels). */
  burst(x: number, y: number, n: number, speed = 1): void {
    if (this.calm) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (80 + Math.random() * 360) * speed;
      const max = 0.6 + Math.random() * 0.9;
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: max, max, size: 8 + Math.random() * 18,
        color: Math.floor(Math.random() * COLORS.length), g: 260 });
    }
  }

  /** A shockwave ring from a point (CSS pixels). */
  shock(x: number, y: number, color = 'rgba(150,225,255,.95)'): void {
    if (!this.calm) this.rings.push({ x, y, r: 0, life: 1, color });
  }

  /** Lightning in the clouds: the intro's strike at a native point of the sky (its tip), `size` its height. */
  lightning(x: number, y: number, size = 120): void {
    const i = 0;
    const b = this.bolts[i];
    const aspect = b.naturalWidth && b.naturalHeight ? (b.naturalWidth / 5) / (b.naturalHeight / 6) : 1;
    this.skyBolts.push({ img: i, x, y, w: size * aspect, h: size, life: 1, flip: Math.random() < 0.5 });
  }

  update(look: StageLook, t: number, dt: number, level: number): void {
    this.look = look;
    this.time = t;
    const jx = (Math.sin(t * 91) + Math.sin(t * 57)) * 0.5 * look.shake, jy = (Math.sin(t * 73) + Math.cos(t * 49)) * 0.5 * look.shake;
    // The layers, each at its depth.
    for (const layer of this.layers) {
      const { info, img } = layer;
      const d = info.depth;
      const [x, y] = this.toScreen(info.rect[0] + jx * d, info.rect[1] + jy * d, d);
      const z = 1 + (look.zoom - 1) * (0.35 + 0.65 * d);
      img.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${z.toFixed(4)})`;
      if (info.litOf) img.style.opacity = look.lit.toFixed(3);
      const filter = this.grade(info.name, look);
      if (filter !== layer.filter) img.style.filter = layer.filter = filter;
    }
    // The dawn's glow on the horizon (just behind the city's skyline).
    const [, hy] = this.toScreen(0, 118, 0.12);
    this.horizon.style.transform = `translateY(${(hy - this.h).toFixed(1)}px)`;
    this.horizon.style.opacity = clamp01(look.dawn * 1.2).toFixed(3);
    this.el.style.setProperty('--veil', look.veil.toFixed(3));
    this.drawBack(dt);
    this.drawMid(dt, level);
    this.drawFront(dt);
  }

  /** The layers' colors at night and at dawn. */
  private grade(name: string, L: StageLook): string {
    const d = Math.round(L.dawn * 40) / 40;
    if (name === 'sky') {
      return `sepia(${(d * 0.55).toFixed(3)}) saturate(${(1 + d * 1.6).toFixed(3)}) hue-rotate(${(-d * 42).toFixed(1)}deg) ` +
        `brightness(${lerp(0.92, 1.28, d).toFixed(3)})`;
    }
    if (name === 'crowd_back' || name === 'crowd_front') return `brightness(${lerp(1, 0.75, d).toFixed(3)})`;
    if (name === 'robot' || name === 'robot_lit') return `brightness(${lerp(1, 0.9, d).toFixed(3)}) sepia(${(d * 0.18).toFixed(3)})`;
    return `brightness(${lerp(1, 0.86, d).toFixed(3)}) sepia(${(d * 0.28).toFixed(3)}) saturate(${lerp(1, 1.25, d).toFixed(3)})`;
  }

  private drawBack(dt: number): void {
    const { bctx: c, k, look: L } = this;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.back.width, this.back.height);
    c.setTransform(k, 0, 0, k, 0, 0);
    c.globalCompositeOperation = 'lighter';
    // Stars (at the sky's depth).
    if (L.stars > 0.01) {
      for (const s of this.stars) {
        const [x, y] = this.toScreen(s.x, s.y, 0.06);
        if (y < -4 || y > this.h) continue;
        const a = L.stars * (0.25 + 0.75 * s.z) * (0.55 + 0.45 * Math.sin(this.time * (1.3 + s.z * 2.7) + s.p));
        const r = 0.5 + s.z * 1.3;
        c.globalAlpha = clamp01(a);
        c.fillStyle = s.z > 0.85 ? '#ffe9c0' : '#e2ebff';
        c.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    // Searchlights behind the city, sweeping.
    if (L.searchlights > 0.01 && !this.calm) {
      for (let i = 0; i < 3; i++) {
        const [bx, by] = this.toScreen(20 + i * 130, 112, 0.14);
        const a = -Math.PI / 2 + Math.sin(this.time * (0.21 + i * 0.07) + i * 2.1) * 0.55;
        const len = this.h * 1.3;
        const spread = 0.05;
        const x1 = bx + Math.cos(a - spread) * len, y1 = by + Math.sin(a - spread) * len;
        const x2 = bx + Math.cos(a + spread) * len, y2 = by + Math.sin(a + spread) * len;
        const grad = c.createLinearGradient(bx, by, bx + Math.cos(a) * len, by + Math.sin(a) * len);
        grad.addColorStop(0, `rgba(150,190,255,${(0.2 * L.searchlights).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(150,190,255,0)');
        c.globalAlpha = 1;
        c.fillStyle = grad;
        c.beginPath();
        c.moveTo(bx, by);
        c.lineTo(x1, y1);
        c.lineTo(x2, y2);
        c.closePath();
        c.fill();
      }
    }
    // Lightning in the clouds: the bolt, the cloud lit around it.
    for (const b of this.skyBolts) {
      b.life -= dt * 3.2;
      if (b.life <= 0) continue;
      const img = this.bolts[b.img];
      const [x, y] = this.toScreen(b.x, b.y, 0.05);
      const w = b.w * this.ux, h = b.h * this.uy;
      const f = b.life * (0.6 + 0.4 * Math.sin(b.life * 40));
      const r = h * 1.8;
      const grad = c.createRadialGradient(x, y - h * 0.5, 0, x, y - h * 0.5, r);
      grad.addColorStop(0, `rgba(185,215,255,${(0.5 * f).toFixed(3)})`);
      grad.addColorStop(0.35, `rgba(120,160,255,${(0.18 * f).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(120,160,255,0)');
      c.globalAlpha = 1;
      c.fillStyle = grad;
      c.fillRect(x - r, y - h * 0.5 - r, r * 2, r * 2);
      if (img.complete && img.naturalWidth) {
        c.globalAlpha = clamp01(f * 1.3);
        c.save();
        c.translate(x, y - h);
        if (b.flip) c.scale(-1, 1);
        c.drawImage(img, -w / 2, 0, w, h);
        c.restore();
      }
    }
    this.skyBolts = this.skyBolts.filter((b) => b.life > 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  private drawMid(dt: number, level: number): void {
    const { mctx: c, k, look: L } = this;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.mid.width, this.mid.height);
    c.setTransform(k, 0, 0, k, 0, 0);
    c.globalCompositeOperation = 'lighter';
    // The spotlight on the statue: a cone of light from the top left, dust hanging in it.
    if (L.lit > 0.01) {
      const [sx, sy] = this.toScreen(SPOT_SOURCE[0], SPOT_SOURCE[1], 0.5);
      const [tx, ty] = this.toScreen(STATUE[0], STATUE[1], 0.5);
      const a = Math.atan2(ty - sy, tx - sx), len = Math.hypot(tx - sx, ty - sy) * 1.35;
      const spread = 0.11;
      const grad = c.createLinearGradient(sx, sy, sx + Math.cos(a) * len, sy + Math.sin(a) * len);
      grad.addColorStop(0, `rgba(255,244,220,${(0.03 * L.lit).toFixed(3)})`);
      grad.addColorStop(0.7, `rgba(255,244,220,${(0.16 * L.lit).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255,244,220,0)');
      c.fillStyle = grad;
      c.beginPath();
      c.moveTo(sx, sy);
      c.lineTo(sx + Math.cos(a - spread) * len, sy + Math.sin(a - spread) * len);
      c.lineTo(sx + Math.cos(a + spread) * len, sy + Math.sin(a + spread) * len);
      c.closePath();
      c.fill();
      const pool = c.createRadialGradient(tx, ty, 0, tx, ty, this.uy * 70);
      pool.addColorStop(0, `rgba(255,236,200,${(0.22 * L.lit).toFixed(3)})`);
      pool.addColorStop(1, 'rgba(255,236,200,0)');
      c.fillStyle = pool;
      c.fillRect(tx - this.uy * 70, ty - this.uy * 70, this.uy * 140, this.uy * 140);
      if (!this.calm) {
        for (let i = 0; i < 40; i++) {
          const u = ((i * 0.618 + this.time * 0.013 * (1 + (i % 5))) % 1), v = ((i * 0.37) % 1) * 2 - 1;
          const px = sx + Math.cos(a) * len * (0.35 + u * 0.6) + Math.cos(a + Math.PI / 2) * v * len * spread * (0.35 + u * 0.6);
          const py = sy + Math.sin(a) * len * (0.35 + u * 0.6) + Math.sin(a + Math.PI / 2) * v * len * spread * (0.35 + u * 0.6);
          c.globalAlpha = 0.35 * L.lit * (0.5 + 0.5 * Math.sin(this.time * 2 + i));
          c.drawImage(this.sprites[1], px - 3, py - 3, 6, 6);
        }
        c.globalAlpha = 1;
      }
    }
    // Embers rising from the crowd with the music.
    if (!this.calm && L.veil < 0.9) {
      this.emberCount += dt * (8 + level * 40);
      while (this.emberCount >= 1) {
        this.emberCount--;
        const max = 2.5 + Math.random() * 2.5;
        this.embers.push({ x: Math.random() * this.w, y: this.h * (0.8 + Math.random() * 0.25), vx: (Math.random() - 0.5) * 20,
          vy: -(20 + Math.random() * 70), life: max, max, size: 4 + Math.random() * 9, color: 1 + Math.floor(Math.random() * 4), g: -6 });
      }
    }
    this.embers = this.particles(c, this.embers, dt);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  private particles(c: CanvasRenderingContext2D, list: Spark[], dt: number): Spark[] {
    for (const p of list) {
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      const f = Math.max(0, p.life / p.max);
      c.globalAlpha = Math.min(1, f * 1.6);
      const s = p.size * (0.5 + f * 0.5);
      c.drawImage(this.sprites[p.color], p.x - s / 2, p.y - s / 2, s, s);
    }
    return list.filter((p) => p.life > 0);
  }

  private drawFront(dt: number): void {
    const { fctx: c, k } = this;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.front.width, this.front.height);
    c.setTransform(k, 0, 0, k, 0, 0);
    c.globalCompositeOperation = 'lighter';
    for (const p of this.sparks) {
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      const f = Math.max(0, p.life / p.max);
      c.globalAlpha = Math.min(1, f * 1.6);
      const s = p.size * (0.5 + f * 0.5);
      c.drawImage(this.sprites[p.color], p.x - s / 2, p.y - s / 2, s, s);
    }
    this.sparks = this.sparks.filter((p) => p.life > 0);
    for (const r of this.rings) {
      r.r += dt * 1100;
      r.life -= dt * 1.5;
      c.globalAlpha = Math.max(0, r.life);
      c.strokeStyle = r.color;
      c.lineWidth = 4 * Math.max(0.15, r.life);
      c.beginPath();
      c.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      c.stroke();
    }
    this.rings = this.rings.filter((r) => r.life > 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }
}
