// A tiny rasterizer for generated interface graphics (the controls screen's keyboard and controller): filled shapes in
// palette indices on an indexed surface. Shapes are drawn at several times the native resolution and the surface is
// drawn scaled down, so the remastered renderer shows them sharp; the classic renderer samples them to native pixels.
import { Surface } from '../../video/surface';

export class Painter {
  readonly data: Uint8Array;

  constructor(readonly w: number, readonly h: number) {
    this.data = new Uint8Array(w * h);
  }

  /** Fills every pixel whose center satisfies `inside(x, y)` within the bounding box. */
  private fill(x0: number, y0: number, x1: number, y1: number, color: number, inside: (x: number, y: number) => boolean): void {
    const ax = Math.max(0, Math.floor(x0)), ay = Math.max(0, Math.floor(y0));
    const bx = Math.min(this.w, Math.ceil(x1)), by = Math.min(this.h, Math.ceil(y1));
    for (let y = ay; y < by; y++) {
      for (let x = ax; x < bx; x++) if (inside(x + 0.5, y + 0.5)) this.data[y * this.w + x] = color;
    }
  }

  rect(x: number, y: number, w: number, h: number, color: number): void {
    this.fill(x, y, x + w, y + h, color, () => true);
  }

  roundRect(x: number, y: number, w: number, h: number, r: number, color: number): void {
    const rr = Math.min(r, w / 2, h / 2);
    this.fill(x, y, x + w, y + h, color, (px, py) => {
      const dx = Math.max(x + rr - px, 0, px - (x + w - rr));
      const dy = Math.max(y + rr - py, 0, py - (y + h - rr));
      return dx * dx + dy * dy <= rr * rr;
    });
  }

  circle(cx: number, cy: number, r: number, color: number): void {
    this.fill(cx - r, cy - r, cx + r, cy + r, color, (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r);
  }

  ring(cx: number, cy: number, r: number, width: number, color: number): void {
    const ri = r - width;
    this.fill(cx - r, cy - r, cx + r, cy + r, color, (px, py) => {
      const d = (px - cx) ** 2 + (py - cy) ** 2;
      return d <= r * r && d >= ri * ri;
    });
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, color: number): void {
    this.fill(cx - rx, cy - ry, cx + rx, cy + ry, color, (px, py) => ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1);
  }

  /** A thick line with round ends. */
  capsule(x0: number, y0: number, x1: number, y1: number, r: number, color: number): void {
    const vx = x1 - x0, vy = y1 - y0;
    const len2 = vx * vx + vy * vy || 1;
    this.fill(Math.min(x0, x1) - r, Math.min(y0, y1) - r, Math.max(x0, x1) + r, Math.max(y0, y1) + r, color, (px, py) => {
      const t = Math.max(0, Math.min(1, ((px - x0) * vx + (py - y0) * vy) / len2));
      return (px - x0 - vx * t) ** 2 + (py - y0 - vy * t) ** 2 <= r * r;
    });
  }

  /** A convex or concave polygon (even-odd rule), filled row by row (fast for large shapes with many points). */
  polygon(points: [number, number][], color: number): void {
    const ys = points.map((p) => p[1]);
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(this.h, Math.ceil(Math.max(...ys)));
    const xs: number[] = [];
    for (let y = y0; y < y1; y++) {
      const py = y + 0.5;
      xs.length = 0;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i], [xj, yj] = points[j];
        if (yi > py !== yj > py) xs.push(((xj - xi) * (py - yi)) / (yj - yi) + xi);
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        // (pixels whose centers are inside the span)
        const a = Math.max(0, Math.ceil(xs[k] - 0.5)), b = Math.min(this.w, Math.ceil(xs[k + 1] - 0.5));
        this.data.fill(color, y * this.w + a, y * this.w + Math.max(a, b));
      }
    }
  }

  /** A closed smooth shape through the given points (a Catmull-Rom curve, `steps` points per segment). */
  smoothShape(points: [number, number][], color: number, steps = 12): void {
    const n = points.length;
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
      for (let s = 0; s < steps; s++) {
        const t = s / steps, t2 = t * t, t3 = t2 * t;
        const f = (a: number, b: number, c: number, d: number) =>
          0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    this.polygon(out, color);
  }

  /** Replaces `from` with `to` where the pixel is within `width` pixels of a different color (an inner outline). */
  outline(from: number[], to: number, width: number): void {
    const src = this.data.slice();
    const isFrom = new Uint8Array(256);
    for (const c of from) isFrom[c] = 1;
    const inSet = (x: number, y: number) => x >= 0 && y >= 0 && x < this.w && y < this.h && isFrom[src[y * this.w + x]] === 1;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (!inSet(x, y)) continue;
        let edge = false;
        for (let d = 1; d <= width && !edge; d++) edge = !inSet(x - d, y) || !inSet(x + d, y) || !inSet(x, y - d) || !inSet(x, y + d);
        if (edge) this.data[y * this.w + x] = to;
      }
    }
  }

  toSurface(key: string): Surface {
    const s = new Surface(this.w, this.h, this.data, 0);
    s.source = { kind: 'generated', key };
    return s;
  }
}
