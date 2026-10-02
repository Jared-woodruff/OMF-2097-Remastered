// Sizers: components that own a list of child components (port of the reference gui/sizer.c), plus the component
// helpers of gui/component.c that the sizer-based widgets (xysizer, trnmenu, sprite buttons) rely on.
import { Component, type GuiTheme } from './widgets';

/** A component with a focus callback (reference supports_focus + component focus callback). */
export interface FocusableComponent extends Component {
  supportsFocus: boolean;
  onFocus(focused: boolean): void;
}

function focusable(c: Component): FocusableComponent | null {
  const f = c as Partial<FocusableComponent>;
  return f.supportsFocus === true ? (c as FocusableComponent) : null;
}

/** component_focus(): sets the focus flag and always runs the focus callback (when focus is supported). */
export function componentFocus(c: Component, focused: boolean): void {
  const f = focusable(c);
  if (!f) return;
  f.focused = focused;
  f.onFocus(focused);
}

/** component_select() */
export function componentSelect(c: Component, selected: boolean): void {
  if (!c.supportsSelect) return;
  c.selected = selected;
}

/** component_disable() */
export function componentDisable(c: Component, disabled: boolean): void {
  if (!c.supportsDisable) return;
  c.disabled = disabled;
}

/** component_is_disabled() */
export function componentIsDisabled(c: Component): boolean {
  return c.supportsDisable ? c.disabled : false;
}

/** component_is_selectable(): only checks supports_select (unlike Component.isSelectable, disabled ones count). */
export function componentIsSelectable(c: Component): boolean {
  return c.supportsSelect;
}

/** component_free(): a focused component is unfocused first (running its focus callback). */
export function componentFree(c: Component): void {
  if (c.focused) componentFocus(c, false);
  c.free();
}

/**
 * Base sizer (sizer_create). Sizers do not support select/disable/focus. Ticks run the specialization first and
 * then every child; init runs the specialization then the children; free frees the children first.
 */
export class Sizer extends Component {
  objs: Component[] = [];
  /** Sizers may fade their contents (the tournament menu tracks it; the reference never draws with it). */
  opacity = 0;

  constructor() {
    super();
    this.supportsSelect = false;
    this.supportsDisable = false;
  }

  /** sizer_attach() */
  attach(nc: Component): void {
    nc.parent = this;
    this.objs.push(nc);
  }

  /** sizer_get() */
  get(item: number): Component | null {
    return this.objs[item] ?? null;
  }

  /** sizer_size() */
  size(): number {
    return this.objs.length;
  }

  getOpacity(): number {
    return this.opacity;
  }

  setOpacity(opacity: number): void {
    this.opacity = opacity;
  }

  // ---- specialization hooks (sizer_set_*_cb) ---------------------------------------------------------------
  protected sizerTick(): void {}
  protected sizerInit(_theme: GuiTheme): void {}
  protected sizerFree(): void {}

  override tick(): void {
    this.sizerTick();
    for (const c of this.objs) c.tick();
  }

  override init(theme: GuiTheme): void {
    super.init(theme);
    this.sizerInit(theme);
    for (const c of this.objs) c.init(theme);
  }

  override free(): void {
    for (const c of this.objs) componentFree(c);
    this.sizerFree();
  }

  override find(id: number): Component | null {
    for (const c of this.objs) {
      const out = c.find(id);
      if (out) return out;
    }
    return null;
  }
}
