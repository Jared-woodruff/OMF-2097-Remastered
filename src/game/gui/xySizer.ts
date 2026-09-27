// Sizer that places every child at its position/size hints (port of the reference gui/xysizer.c).
import type { CtrlType } from '../constants';
import { Sizer } from './sizer';
import type { Component } from './widgets';

export class XYSizer extends Sizer {
  userdata: unknown = null;

  /** xysizer_attach(): sets the child's size and position hints and attaches it. */
  attachAt(nc: Component, x: number, y: number, w: number, h: number): void {
    nc.setSizeHints(w, h);
    nc.setPosHints(x, y);
    this.attach(nc);
  }

  override layout(x: number, y: number, w: number, h: number): void {
    super.layout(x, y, w, h);
    for (const c of this.objs) {
      // Position and size from the component hints (a zero size hides the component)
      const mx = c.xHint < x ? x : c.xHint;
      const my = c.yHint < y ? y : c.yHint;
      const mw = c.wHint < 0 ? 0 : c.wHint;
      const mh = c.hHint < 0 ? 0 : c.hHint;
      c.layout(mx, my, mw, mh);
    }
  }

  override render(): void {
    for (const c of this.objs) c.render();
  }

  /** Passes the action to the children until one handles it. */
  override action(action: number, source: CtrlType): number {
    for (const c of this.objs) {
      if (c.action(action, source) === 0) return 0;
    }
    return 1;
  }

  /** Raw key events (xysizer_event): passed to the children until one handles it. */
  override keyEvent(code: string, e: KeyboardEvent): boolean {
    for (const c of this.objs) {
      if (c.keyEvent(code, e)) return true;
    }
    return false;
  }
}
