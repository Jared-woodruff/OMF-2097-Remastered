// OMF Studio's pixel editor: one sprite, drawn in the game's palette with the entries it may use, in the robot's own
// coordinates (0, 0 is where it stands; the floor line shows it), with the frame before it faint underneath (onion
// skin) and its hit points (the points of an attack that hit). The picture is trimmed to what is drawn when it is
// kept, and its position moves with the trim, so it stays exactly where it was drawn.
import type { Palette } from '../formats/palette';
import { cssColor, toRgba } from './colors';
import { h, modal, pickFiles, toast } from './dom';
import { spriteFits, } from './checks';
import { pngToPixels, trim } from './sprites';
import { encodeIndexedPng } from '../util/png';
import { saveFile } from '../platform/files';

export interface PixelPicture {
  pixels: Uint8Array;
  w: number;
  h: number;
  /** Where its top left corner is, from the point the robot stands on. */
  posX: number;
  posY: number;
}

export interface PixelEditOptions {
  title: string;
  picture: PixelPicture;
  palette: Palette;
  /** The palette entries it may be drawn with (0, see-through, always). */
  entries: number[];
  /** How the palette panel groups the entries: ramps of 16 (a robot's colors) and the rest. */
  groups: { label: string; entries: number[] }[];
  /** A picture of a fixed size (the select screen's cell): not trimmed, `background` its see-through color. */
  fixed?: { background: number };
  /** Shown faintly under the picture. */
  onion?: PixelPicture | null;
  /** The picture's hit points (from the point the robot stands on); null when it has none to edit. */
  hitPoints?: { x: number; y: number }[] | null;
  /** Where the floor is (null: no floor line). */
  floorY?: number | null;
  /** File name for exporting it. */
  fileName: string;
}

export interface PixelEditResult extends PixelPicture {
  hitPoints: { x: number; y: number }[] | null;
}

type Tool = 'pencil' | 'eraser' | 'fill' | 'line' | 'rect' | 'pick' | 'move' | 'hit';

const TOOLS: [Tool, string, string, string][] = [
  ['pencil', '✎', 'Pencil (B)', 'KeyB'],
  ['eraser', '⌫', 'Eraser (E)', 'KeyE'],
  ['fill', '▧', 'Fill (G)', 'KeyG'],
  ['line', '╱', 'Line (L)', 'KeyL'],
  ['rect', '▭', 'Rectangle (R)', 'KeyR'],
  ['pick', '⊕', 'Pick a color (I)', 'KeyI'],
  ['move', '✥', 'Move the drawing (M)', 'KeyM'],
  ['hit', '✖', 'Hit points (H): click to add, drag to move, right click to remove', 'KeyH'],
];

/** Opens the editor; resolves with the edited picture, or null when cancelled. */
export function editPixels(o: PixelEditOptions): Promise<PixelEditResult | null> {
  return modal<PixelEditResult>((close) => new PixelEditor(o, close).el);
}

class PixelEditor {
  el: HTMLElement;
  private rx: number;
  private ry: number;
  private rw: number;
  private rh: number;
  private buf: Uint8Array;
  private hits: { x: number; y: number }[] | null;
  private undo: { buf: Uint8Array; hits: string }[] = [];
  private redo: { buf: Uint8Array; hits: string }[] = [];
  private tool: Tool = 'pencil';
  private color: number;
  private zoom = 6;
  private panX = 0;
  private panY = 0;
  private showGrid = true;
  private showOnion = true;
  private canvas: HTMLCanvasElement;
  private image: HTMLCanvasElement;
  private onionImage: HTMLCanvasElement | null = null;
  private drag: { x0: number; y0: number; x: number; y: number; button: number; hit?: number; pan?: [number, number, number, number]; moveBuf?: Uint8Array } | null = null;
  private info = h('span', { class: 'muted' });
  private swatch = h('div', { style: { width: '26px', height: '26px', borderRadius: '4px', border: '1px solid var(--line2)' } });
  private toolButtons = new Map<Tool, HTMLButtonElement>();
  private resizeObs: ResizeObserver;

  constructor(private o: PixelEditOptions, private close: (v: PixelEditResult | null) => void) {
    const p = o.picture;
    // The area that can be drawn in: the picture, the onion skin and room around them (fixed pictures: their size).
    if (o.fixed) {
      this.rx = p.posX;
      this.ry = p.posY;
      this.rw = p.w;
      this.rh = p.h;
    } else {
      const m = 40;
      let x0 = p.posX, y0 = p.posY, x1 = p.posX + p.w, y1 = p.posY + p.h;
      if (o.onion) {
        x0 = Math.min(x0, o.onion.posX);
        y0 = Math.min(y0, o.onion.posY);
        x1 = Math.max(x1, o.onion.posX + o.onion.w);
        y1 = Math.max(y1, o.onion.posY + o.onion.h);
      }
      if (o.floorY !== null && o.floorY !== undefined) y1 = Math.max(y1, o.floorY + 4);
      this.rx = x0 - m;
      this.ry = y0 - m;
      this.rw = Math.min(512, x1 - x0 + 2 * m);
      this.rh = Math.min(400, y1 - y0 + 2 * m);
    }
    this.buf = new Uint8Array(this.rw * this.rh).fill(o.fixed ? o.fixed.background : 0);
    this.blit(p, this.buf);
    this.hits = o.hitPoints ? o.hitPoints.map((q) => ({ ...q })) : null;
    this.color = this.firstUsedColor();
    this.image = document.createElement('canvas');
    this.image.width = this.rw;
    this.image.height = this.rh;
    if (o.onion) {
      const b = new Uint8Array(this.rw * this.rh);
      this.blit(o.onion, b);
      this.onionImage = document.createElement('canvas');
      this.onionImage.width = this.rw;
      this.onionImage.height = this.rh;
      this.onionImage.getContext('2d')!.putImageData(new ImageData(toRgba(b, o.palette), this.rw, this.rh), 0, 0);
    }
    this.canvas = h('canvas', { class: 'pix', style: { display: 'block', width: '100%', height: '100%', cursor: 'crosshair', background: '#05070d' } });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    const stage = h('div', { style: { position: 'relative', flex: '1', minHeight: '0', border: '1px solid var(--line)', borderRadius: '6px', overflow: 'hidden' } }, this.canvas);
    this.resizeObs = new ResizeObserver(() => this.draw());
    this.resizeObs.observe(stage);
    const onKey = (e: KeyboardEvent) => this.key(e);
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKey);
    const finish = (v: PixelEditResult | null) => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', onKey);
      this.resizeObs.disconnect();
      close(v);
    };
    this.close = finish;
    const toolbar = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, TOOLS.map(([t, icon, title]) => {
      if (t === 'hit' && !this.hits) return null;
      const b = h('button', { class: 'btn icon', title, onclick: () => this.setTool(t) }, icon);
      this.toolButtons.set(t, b);
      return b;
    }));
    this.el = h('div', { class: 'modal', style: { width: 'min(96vw, 1240px)', height: 'min(92vh, 860px)', display: 'flex', flexDirection: 'column', gap: '10px' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
        h('h2', { style: { margin: '0', flex: '1' } }, o.title),
        h('button', { class: 'btn small', onclick: () => this.doUndo(), title: 'Undo (Ctrl+Z)' }, 'Undo'),
        h('button', { class: 'btn small', onclick: () => this.doRedo(), title: 'Redo (Ctrl+Y)' }, 'Redo'),
        h('button', { class: 'btn small', onclick: () => this.flip(), title: 'Mirror the drawing left to right' }, 'Mirror'),
        h('button', { class: 'btn small', onclick: () => void this.importPng(), title: 'Draw a PNG picture in (matched to the palette)' }, 'Import PNG'),
        h('button', { class: 'btn small', onclick: () => void this.exportPng(), title: 'Save the picture as a PNG with the game\'s palette' }, 'Export PNG'),
        h('label', { class: 'muted', style: { display: 'flex', gap: '4px', alignItems: 'center' } },
          h('input', { type: 'checkbox', checked: this.showGrid, onchange: (e: Event) => ((this.showGrid = (e.target as HTMLInputElement).checked), this.draw()) }), 'Grid'),
        o.onion ? h('label', { class: 'muted', style: { display: 'flex', gap: '4px', alignItems: 'center' } },
          h('input', { type: 'checkbox', checked: this.showOnion, onchange: (e: Event) => ((this.showOnion = (e.target as HTMLInputElement).checked), this.draw()) }), 'Onion skin') : null),
      h('div', { style: { display: 'flex', gap: '10px', flex: '1', minHeight: '0' } }, toolbar, stage, this.palettePanel()),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
        this.info,
        h('span', { style: { flex: '1' } }),
        h('span', { class: 'faint' }, 'Wheel: zoom · right drag or Space: move the view · right click: see-through'),
        h('button', { class: 'btn', onclick: () => this.close(null) }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => this.finish() }, 'Keep')));
    this.setTool(this.hits && o.hitPoints && !p.w ? 'hit' : 'pencil');
    this.render();
    requestAnimationFrame(() => this.fitView());
  }

  // ---- the picture ----------------------------------------------------------------------------------------------

  private blit(p: PixelPicture, into: Uint8Array): void {
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const v = p.pixels[y * p.w + x];
        if (!v) continue;
        const tx = p.posX - this.rx + x, ty = p.posY - this.ry + y;
        if (tx >= 0 && ty >= 0 && tx < this.rw && ty < this.rh) into[ty * this.rw + tx] = v;
      }
    }
  }

  private firstUsedColor(): number {
    const counts = new Map<number, number>();
    for (const v of this.buf) if (v && v !== this.o.fixed?.background) counts.set(v, (counts.get(v) ?? 0) + 1);
    let best = this.o.entries[Math.min(10, this.o.entries.length - 1)] ?? 1, n = 0;
    for (const [v, c] of counts) if (c > n && this.o.entries.includes(v)) (best = v), (n = c);
    return best;
  }

  private get blank(): number {
    return this.o.fixed ? this.o.fixed.background : 0;
  }

  private render(): void {
    this.image.getContext('2d')!.putImageData(new ImageData(toRgba(this.buf, this.o.palette, !!this.o.fixed), this.rw, this.rh), 0, 0);
    this.draw();
  }

  private fitView(): void {
    const r = this.canvas.getBoundingClientRect();
    this.zoom = Math.max(1, Math.min(24, Math.floor(Math.min(r.width / this.rw, r.height / this.rh))));
    this.panX = Math.round((r.width - this.rw * this.zoom) / 2);
    this.panY = Math.round((r.height - this.rh * this.zoom) / 2);
    this.draw();
  }

  private draw(): void {
    const c = this.canvas;
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(r.width * dpr));
    c.height = Math.max(1, Math.round(r.height * dpr));
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#05070d';
    g.fillRect(0, 0, r.width, r.height);
    const z = this.zoom, ox = this.panX, oy = this.panY;
    // The drawing area, checkered where it is see-through.
    g.fillStyle = '#10151f';
    g.fillRect(ox, oy, this.rw * z, this.rh * z);
    g.fillStyle = '#161d2b';
    const cell = Math.max(z, 8);
    for (let y = 0; y < this.rh * z; y += cell) {
      for (let x = (Math.floor(y / cell) % 2) * cell; x < this.rw * z; x += cell * 2) g.fillRect(ox + x, oy + y, Math.min(cell, this.rw * z - x), Math.min(cell, this.rh * z - y));
    }
    if (this.onionImage && this.showOnion) {
      g.globalAlpha = 0.3;
      g.drawImage(this.onionImage, ox, oy, this.rw * z, this.rh * z);
      g.globalAlpha = 1;
    }
    g.drawImage(this.image, ox, oy, this.rw * z, this.rh * z);
    // Line and rectangle being drawn.
    const d = this.drag;
    if (d && (this.tool === 'line' || this.tool === 'rect') && d.button !== 2) {
      g.fillStyle = cssColor(this.o.palette, d.button === 0 ? this.color : 0);
      for (const [x, y] of this.tool === 'line' ? linePoints(d.x0, d.y0, d.x, d.y) : rectPoints(d.x0, d.y0, d.x, d.y)) g.fillRect(ox + x * z, oy + y * z, z, z);
    }
    if (this.showGrid && z >= 6) {
      g.strokeStyle = 'rgba(120, 150, 220, .12)';
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x <= this.rw; x++) {
        g.moveTo(ox + x * z + 0.5, oy);
        g.lineTo(ox + x * z + 0.5, oy + this.rh * z);
      }
      for (let y = 0; y <= this.rh; y++) {
        g.moveTo(ox, oy + y * z + 0.5);
        g.lineTo(ox + this.rw * z, oy + y * z + 0.5);
      }
      g.stroke();
    }
    // Where the robot stands, and the floor.
    const sx = ox + (0 - this.rx) * z, sy = oy + (0 - this.ry) * z;
    if (this.o.floorY !== null && this.o.floorY !== undefined) {
      const fy = oy + (this.o.floorY - this.ry) * z;
      g.strokeStyle = 'rgba(255, 183, 64, .6)';
      g.setLineDash([6, 4]);
      g.beginPath();
      g.moveTo(ox, fy + 0.5);
      g.lineTo(ox + this.rw * z, fy + 0.5);
      g.stroke();
      g.setLineDash([]);
    }
    if (!this.o.fixed) {
      g.strokeStyle = 'rgba(60, 195, 255, .8)';
      g.beginPath();
      g.moveTo(sx - 8, sy + 0.5);
      g.lineTo(sx + 8, sy + 0.5);
      g.moveTo(sx + 0.5, sy - 8);
      g.lineTo(sx + 0.5, sy + 8);
      g.stroke();
    }
    // Hit points.
    if (this.hits) {
      for (const p of this.hits) {
        const px = ox + (p.x - this.rx) * z + z / 2, py = oy + (p.y - this.ry) * z + z / 2;
        g.fillStyle = 'rgba(255, 70, 60, .9)';
        g.beginPath();
        g.arc(px, py, Math.max(3, z * 0.45), 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#fff';
        g.stroke();
      }
    }
    g.strokeStyle = 'rgba(60, 195, 255, .35)';
    g.strokeRect(ox - 0.5, oy - 0.5, this.rw * z + 1, this.rh * z + 1);
  }

  // ---- palette ---------------------------------------------------------------------------------------------------

  private palettePanel(): HTMLElement {
    const pal = this.o.palette;
    const chip = (i: number) => {
      const el = h('div', {
        title: i === 0 ? 'See-through' : `Color ${i} (0x${i.toString(16).toUpperCase()})`,
        style: {
          width: '16px', height: '16px', cursor: 'pointer', borderRadius: '2px', background: i === 0 ? 'repeating-conic-gradient(#333 0 25%, #555 0 50%) 0 0 / 8px 8px' : cssColor(pal, i),
          outline: '1px solid rgba(0,0,0,.4)',
        },
        onclick: () => this.setColor(i),
      });
      el.dataset.entry = String(i);
      return el;
    };
    const groups = this.o.groups.map((grp) => h('div', null,
      h('div', { class: 'faint', style: { fontSize: '11px', margin: '6px 0 3px' } }, grp.label),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(16, 16px)', gap: '2px' } }, grp.entries.map(chip))));
    this.updateSwatch();
    return h('div', { style: { width: '310px', overflow: 'auto', display: 'flex', flexDirection: 'column' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, this.swatch, h('span', { class: 'muted' }, 'Left click draws this color, right click see-through'),
        h('div', { style: { marginLeft: 'auto' } }, chip(0))),
      groups);
  }

  private setColor(i: number): void {
    this.color = i;
    this.updateSwatch();
    if (this.tool === 'eraser' || this.tool === 'pick' || this.tool === 'hit' || this.tool === 'move') this.setTool('pencil');
  }

  private updateSwatch(): void {
    this.swatch.style.background = this.color === 0 ? 'repeating-conic-gradient(#333 0 25%, #555 0 50%) 0 0 / 8px 8px' : cssColor(this.o.palette, this.color);
    this.swatch.title = `Color ${this.color}`;
  }

  private setTool(t: Tool): void {
    this.tool = t;
    for (const [k, b] of this.toolButtons) b.classList.toggle('active', k === t);
  }

  // ---- input -----------------------------------------------------------------------------------------------------

  private at(e: PointerEvent | WheelEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left - this.panX) / this.zoom), Math.floor((e.clientY - r.top - this.panY) / this.zoom)];
  }

  private inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.rw && y < this.rh;
  }

  private remember(): void {
    this.undo.push({ buf: this.buf.slice(), hits: JSON.stringify(this.hits) });
    if (this.undo.length > 200) this.undo.shift();
    this.redo = [];
  }

  private spaceDown = false;

  private down(e: PointerEvent): void {
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // (a pointer the browser does not know: nothing to capture)
    }
    const [x, y] = this.at(e);
    if (e.button === 1 || (e.button === 2 && this.tool !== 'hit' && this.tool !== 'pencil' && this.tool !== 'line' && this.tool !== 'rect' && this.tool !== 'fill') || this.spaceDown) {
      this.drag = { x0: x, y0: y, x, y, button: 1, pan: [e.clientX, e.clientY, this.panX, this.panY] };
      return;
    }
    const button = e.button === 2 ? 2 : 0;
    const paint = button === 2 ? this.blank : this.tool === 'eraser' ? this.blank : this.color;
    this.drag = { x0: x, y0: y, x, y, button };
    switch (this.tool) {
      case 'pencil':
      case 'eraser':
        this.remember();
        this.plot(x, y, paint);
        this.render();
        break;
      case 'fill':
        if (!this.inside(x, y)) return;
        this.remember();
        this.floodFill(x, y, paint);
        this.render();
        break;
      case 'pick':
        if (this.inside(x, y)) this.setColor(this.buf[y * this.rw + x]);
        break;
      case 'move':
        this.remember();
        this.drag.moveBuf = this.buf.slice();
        break;
      case 'hit': {
        if (!this.hits) return;
        const ox = x + this.rx, oy = y + this.ry;
        const near = this.hits.findIndex((p) => Math.abs(p.x - ox) <= 1 && Math.abs(p.y - oy) <= 1);
        if (e.button === 2) {
          if (near >= 0) {
            this.remember();
            this.hits.splice(near, 1);
            this.draw();
          }
          this.drag = null;
          return;
        }
        this.remember();
        if (near >= 0) this.drag.hit = near;
        else {
          this.hits.push({ x: ox, y: oy });
          this.drag.hit = this.hits.length - 1;
        }
        this.draw();
        break;
      }
      default:
        this.remember();
    }
  }

  private move(e: PointerEvent): void {
    const [x, y] = this.at(e);
    this.info.textContent = this.inside(x, y) ? `x ${x + this.rx}, y ${y + this.ry}  ·  color ${this.buf[y * this.rw + x]}  ·  zoom ${this.zoom}×` : `zoom ${this.zoom}×`;
    const d = this.drag;
    if (!d) return;
    if (d.pan) {
      this.panX = d.pan[2] + (e.clientX - d.pan[0]);
      this.panY = d.pan[3] + (e.clientY - d.pan[1]);
      this.draw();
      return;
    }
    const px = d.x, py = d.y;
    d.x = x;
    d.y = y;
    const paint = d.button === 2 ? this.blank : this.tool === 'eraser' ? this.blank : this.color;
    switch (this.tool) {
      case 'pencil':
      case 'eraser':
        for (const [lx, ly] of linePoints(px, py, x, y)) this.plot(lx, ly, paint);
        this.render();
        break;
      case 'line':
      case 'rect':
        this.draw();
        break;
      case 'move': {
        const src = d.moveBuf!, dx = x - d.x0, dy = y - d.y0;
        this.buf.fill(this.blank);
        for (let yy = 0; yy < this.rh; yy++) {
          for (let xx = 0; xx < this.rw; xx++) {
            const v = src[yy * this.rw + xx];
            if (v === this.blank) continue;
            const tx = xx + dx, ty = yy + dy;
            if (this.inside(tx, ty)) this.buf[ty * this.rw + tx] = v;
          }
        }
        this.render();
        break;
      }
      case 'hit':
        if (this.hits && d.hit !== undefined) {
          this.hits[d.hit] = { x: x + this.rx, y: y + this.ry };
          this.draw();
        }
        break;
    }
  }

  private up(_e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d || d.pan) return;
    const paint = d.button === 2 ? this.blank : this.color;
    if (this.tool === 'line') for (const [x, y] of linePoints(d.x0, d.y0, d.x, d.y)) this.plot(x, y, paint);
    else if (this.tool === 'rect') for (const [x, y] of rectPoints(d.x0, d.y0, d.x, d.y)) this.plot(x, y, paint);
    this.render();
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const old = this.zoom;
    this.zoom = Math.max(1, Math.min(32, this.zoom + (e.deltaY < 0 ? 1 : -1) * Math.max(1, Math.round(this.zoom / 6))));
    // (zoom around the pointer)
    this.panX = Math.round(mx - ((mx - this.panX) * this.zoom) / old);
    this.panY = Math.round(my - ((my - this.panY) * this.zoom) / old);
    this.draw();
  }

  private key(e: KeyboardEvent): void {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.code === 'Space') {
      this.spaceDown = e.type === 'keydown';
      e.preventDefault();
      return;
    }
    if (e.type !== 'keydown') return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) this.doRedo();
      else this.doUndo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
      e.preventDefault();
      this.doRedo();
      return;
    }
    const t = TOOLS.find(([, , , code]) => code === e.code);
    if (t && !e.ctrlKey && (t[0] !== 'hit' || this.hits)) this.setTool(t[0]);
    if (e.code === 'Enter') this.finish();
  }

  // ---- drawing ---------------------------------------------------------------------------------------------------

  private plot(x: number, y: number, v: number): void {
    if (this.inside(x, y)) this.buf[y * this.rw + x] = v;
  }

  private floodFill(x: number, y: number, v: number): void {
    const target = this.buf[y * this.rw + x];
    if (target === v) return;
    const stack = [y * this.rw + x];
    while (stack.length) {
      const i = stack.pop()!;
      if (this.buf[i] !== target) continue;
      this.buf[i] = v;
      const cx = i % this.rw, cy = (i / this.rw) | 0;
      if (cx > 0) stack.push(i - 1);
      if (cx < this.rw - 1) stack.push(i + 1);
      if (cy > 0) stack.push(i - this.rw);
      if (cy < this.rh - 1) stack.push(i + this.rw);
    }
  }

  private flip(): void {
    this.remember();
    // Mirrored around the point the robot stands on (x 0), like the game turns robots around.
    const out = new Uint8Array(this.buf.length).fill(this.blank);
    for (let y = 0; y < this.rh; y++) {
      for (let x = 0; x < this.rw; x++) {
        const v = this.buf[y * this.rw + x];
        if (v === this.blank) continue;
        const tx = this.o.fixed ? this.rw - 1 - x : -(x + this.rx) - 1 - this.rx;
        if (this.inside(tx, y)) out[y * this.rw + tx] = v;
      }
    }
    this.buf = out;
    if (this.hits && !this.o.fixed) this.hits = this.hits.map((p) => ({ x: -p.x, y: p.y }));
    this.render();
  }

  private doUndo(): void {
    const s = this.undo.pop();
    if (!s) return;
    this.redo.push({ buf: this.buf.slice(), hits: JSON.stringify(this.hits) });
    this.buf = s.buf;
    this.hits = JSON.parse(s.hits);
    this.render();
  }

  private doRedo(): void {
    const s = this.redo.pop();
    if (!s) return;
    this.undo.push({ buf: this.buf.slice(), hits: JSON.stringify(this.hits) });
    this.buf = s.buf;
    this.hits = JSON.parse(s.hits);
    this.render();
  }

  private async importPng(): Promise<void> {
    const [f] = await pickFiles('.png,image/png');
    if (!f) return;
    try {
      const img = await pngToPixels(new Uint8Array(await f.arrayBuffer()), this.o.palette, this.o.entries);
      this.remember();
      // Placed where the picture was (its top left corner), or the drawing area's when it does not fit there.
      const p = this.o.picture;
      const ox = Math.max(0, Math.min(this.rw - img.w, p.posX - this.rx)), oy = Math.max(0, Math.min(this.rh - img.h, p.posY - this.ry));
      this.buf.fill(this.blank);
      for (let y = 0; y < img.h; y++) {
        for (let x = 0; x < img.w; x++) {
          const v = img.pixels[y * img.w + x];
          if (v && this.inside(ox + x, oy + y)) this.buf[(oy + y) * this.rw + ox + x] = v;
        }
      }
      this.render();
      toast(img.exact ? 'Imported with its colors as they were.' : 'Imported: its colors were matched to the palette.');
    } catch (err) {
      toast(`The picture could not be imported: ${(err as Error)?.message ?? err}`, true);
    }
  }

  private async exportPng(): Promise<void> {
    const [px, w, h] = this.o.fixed ? [this.buf, this.rw, this.rh] : trim(this.buf, this.rw, this.rh);
    const png = await encodeIndexedPng(w, h, px, this.o.palette.colors, this.o.fixed ? -1 : 0);
    try {
      await saveFile(this.o.fileName, png, 'image/png');
      toast(`Saved ${this.o.fileName}`);
    } catch {
      toast('The picture could not be saved.', true);
    }
  }

  private finish(): void {
    let pixels = this.buf, w = this.rw, h = this.rh, posX = this.rx, posY = this.ry;
    if (!this.o.fixed) {
      const [px, tw, th, dx, dy] = trim(this.buf, this.rw, this.rh);
      pixels = px;
      w = tw;
      h = th;
      posX = this.rx + dx;
      posY = this.ry + dy;
    }
    if (!spriteFits(pixels, w, h)) {
      toast('The picture is too big for the game\'s files: draw less.', true, 5000);
      return;
    }
    this.close({ pixels, w, h, posX, posY, hitPoints: this.hits });
  }
}

/** Pixels of a straight line (Bresenham). */
function linePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  for (let n = 0; n < 4096; n++) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

/** Pixels of a rectangle's outline. */
function rectPoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  const [a, b] = [Math.min(x0, x1), Math.max(x0, x1)], [c, d] = [Math.min(y0, y1), Math.max(y0, y1)];
  for (let x = a; x <= b; x++) out.push([x, c], [x, d]);
  for (let y = c + 1; y < d; y++) out.push([a, y], [b, y]);
  return out;
}
