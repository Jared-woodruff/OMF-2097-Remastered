// A few DOM helpers for OMF Studio's plain TypeScript UI.

type Child = Node | string | number | null | undefined | false | Child[];

/** Clickable rows, tabs and choices: reached with Tab, chosen with Enter or Space (see StudioApp's keys). */
const CLICKABLE = /(^|\s)(item|tab|choice|home-item)(\s|$)/;

/** Work that changes the project over a while (a batch of pictures brought in), else null: undo, redo and leaving wait. */
let busyWork: string | null = null;

/** Runs `fn` as such work (`what`: what it is doing, for the messages). */
export async function busyWith<T>(what: string, fn: () => Promise<T>): Promise<T> {
  busyWork = what;
  try {
    return await fn();
  } finally {
    busyWork = null;
  }
}

/** What work is running (see busyWith), else null. */
export function busyNow(): string | null {
  return busyWork;
}

/** An element with attributes, properties, event handlers (onclick...) and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  if (tag === 'div' && typeof attrs?.onclick === 'function' && CLICKABLE.test(el.className)) {
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
  }
  append(el, children);
  return el;
}

const ICONS = {
  plus: 'M12 5v14M5 12h14',
  folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z',
  sample: 'M11 3.5l2 5.5 5.5 2-5.5 2-2 5.5-2-5.5-5.5-2 5.5-2zM18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
  check: 'M4.5 12.5l5 5L19.5 7',
  alert: 'M12 3.5L2.5 20h19zM12 10v4.5M12 17.4v.2',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.6v.2',
  robot: 'M8.5 3h7v5.5h-7zM10.6 5.7h.1M13.3 5.7h.1M12 8.5v2M6 10.5h12v7H6zM8.5 17.5V21M15.5 17.5V21M3.5 11.5v4.5M20.5 11.5v4.5',
  arena: 'M3 5h18v14H3zM3 15.5l5-5 4 4 3-3 6 6M16 8.8h.1',
  pilot: 'M12 12.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5a7.5 7.5 0 0 1 15 0',
  home: 'M3.5 11L12 4l8.5 7M6 9.5V20h12V9.5M10 20v-5h4v5',
  box: 'M20.5 7.5L12 3 3.5 7.5v9L12 21l8.5-4.5zM3.5 7.5L12 12l8.5-4.5M12 12v9',
  install: 'M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5M4 15.5v3A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-3',
  export: 'M12 14.5v-11M7.5 8L12 3.5 16.5 8M4 15.5v3A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-3',
  trash: 'M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5',
  chevron: 'M9 5.5l6.5 6.5L9 18.5',
  close: 'M6 6l12 12M18 6L6 18',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  // the ways to test
  fight: 'M4 4l10.5 10.5M12.5 16.5l4-4M16 16l3.5 3.5M20 4L9.5 14.5M7.5 12.5l4 4M8 16l-3.5 3.5',
  watch: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  vs: 'M3.5 4.5h10v7H8l-4.5 3.5zM16 8.5h4.5v8.5l-3.5-2.5H11v-3',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5.5A2.5 2.5 0 0 0 8 9.5M16 6h2.5A2.5 2.5 0 0 1 16 9.5M12 13v4M10 17h4v3.5h-4zM8 20.5h8',
  // the pixel editor's tools
  pencil: 'M4 20l4.5-1L19 8.5 15.5 5 5 15.5zM13.5 7l3.5 3.5',
  eraser: 'M7.5 20H20M4.6 15.4L14 6l5 5-9.4 9.4H7zM9.5 10.5l5 5',
  fill: 'M5 11.5l6.5-6.5 7 7-6.5 6.5a2 2 0 0 1-2.8 0L5 14.3a2 2 0 0 1 0-2.8zM5.5 12.5h13M20.5 15.5s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3z',
  line: 'M5 19L19 5',
  rect: 'M4.5 6.5h15v11h-15z',
  pick: 'M15 3.5l5.5 5.5-2.5 2.5-5.5-5.5zM13.5 8.5L5.5 16.5V19h2.5l8-8',
  move: 'M12 3v18M3 12h18M9.5 5.5L12 3l2.5 2.5M9.5 18.5L12 21l2.5-2.5M5.5 9.5L3 12l2.5 2.5M18.5 9.5L21 12l-2.5 2.5',
  hit: 'M12 19.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22',
  play: '',
} as const;

export type IconName = keyof typeof ICONS;

/** A line icon in the text's color. */
export function icon(name: IconName): HTMLSpanElement {
  const el = h('span', { class: 'icon', 'aria-hidden': 'true' });
  el.innerHTML = name === 'play'
    ? '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>'
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name]}"/></svg>`;
  return el;
}

function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

/** Replaces an element's children. */
export function fill(el: Element, ...children: Child[]): void {
  el.replaceChildren();
  append(el, children);
}

/** A labelled field around an input, with a hint under it. */
export function field(label: string, input: HTMLElement, hint = ''): HTMLLabelElement {
  return h('label', { class: 'field' }, h('span', null, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
}

/** A text input bound to a getter / setter. */
export function textInput(get: () => string, set: (v: string) => void, attrs: Record<string, unknown> = {}): HTMLInputElement {
  const el = h('input', { type: 'text', value: get(), ...attrs });
  el.addEventListener('input', () => set(el.value));
  return el;
}

/** A number input bound to a getter / setter (clamped to min..max, whole numbers unless `step` says otherwise). */
export function numberInput(get: () => number, set: (v: number) => void, min: number, max: number, step = 1): HTMLInputElement {
  // (fractions shown to three places: the files store speeds in 256ths)
  const shown = (v: number) => String(step === 1 ? v : Number(v.toFixed(3)));
  const el = h('input', { type: 'number', value: shown(get()), min, max, step });
  el.addEventListener('change', () => {
    let v = Number(el.value);
    if (!Number.isFinite(v)) v = get();
    v = Math.max(min, Math.min(max, step === 1 ? Math.round(v) : v));
    el.value = shown(v);
    set(v);
  });
  return el;
}

/** A select bound to a getter / setter. */
export function select<T extends string | number>(options: [T, string][], get: () => T, set: (v: T) => void): HTMLSelectElement {
  const el = h('select', null, options.map(([v, label]) => h('option', { value: String(v) }, label)));
  el.value = String(get());
  el.addEventListener('change', () => {
    const found = options.find(([v]) => String(v) === el.value);
    if (found) set(found[0]);
  });
  return el;
}

let toastEl: HTMLDivElement | null = null;
let toastTimer = 0;

/** A short notice at the bottom of the window. */
export function toast(text: string, bad = false, ms = 3500): void {
  toastEl?.remove();
  toastEl = h('div', { class: `toast${bad ? ' bad' : ''}`, role: 'status' }, icon(bad ? 'alert' : 'check'), h('span', null, text));
  document.body.append(toastEl);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.remove(), ms);
}

/**
 * A modal dialog; resolves with what `build` hands to `close` (null: ESC, or a click beside it, unless `dismiss` says
 * no). The page behind it is inert while it is up (no clicks, no focus: ENTER cannot press the button that opened it
 * again), the focus goes into it (a field, else its button marked `data-focus`, else its main button) and back where
 * it was after. `onClose` runs however it closes.
 */
export function modal<T>(build: (close: (v: T | null) => void) => HTMLElement, onClose?: () => void,
  dismiss?: () => boolean | Promise<boolean>): Promise<T | null> {
  return new Promise((resolve) => {
    const back = h('div', { class: 'modal-back' });
    const opener = document.activeElement as HTMLElement | null;
    const quieted = [...document.body.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el !== back && !el.inert);
    let closed = false;
    const close = (v: T | null) => {
      if (closed) return;
      closed = true;
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      for (const el of quieted) el.inert = false;
      onClose?.();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      resolve(v);
    };
    // (ESC and a click beside it close only the dialog on top: one opened over it makes it inert)
    let asking = false;
    const leave = async () => {
      if (asking || closed || back.inert) return;
      asking = true;
      const ok = !dismiss || (await dismiss());
      asking = false;
      if (ok) close(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !back.inert) {
        e.stopPropagation();
        void leave();
      }
    };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('mousedown', (e) => {
      if (e.target === back) void leave();
    });
    back.append(build(close));
    for (const el of quieted) el.inert = true;
    document.body.append(back);
    const first = back.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), textarea, select') ??
      back.querySelector<HTMLElement>('[data-focus]') ?? back.querySelector<HTMLElement>('.btn.primary, .btn.danger') ??
      back.querySelector<HTMLElement>('button');
    first?.focus({ preventScroll: true });
  });
}

/** A yes / no question (a dangerous one has the focus on Cancel: ENTER does not say yes to it by accident). */
export function confirmDialog(title: string, text: string, yes = 'OK', danger = false): Promise<boolean> {
  return modal<boolean>((close) =>
    h('div', { class: 'modal', style: { width: '460px' } },
      h('h2', null, title),
      h('p', { class: 'muted' }, text),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => close(false), ...(danger ? { 'data-focus': '' } : {}) }, 'Cancel'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => close(true) }, yes)))).then((v) => v === true);
}

/** Opens the file picker; resolves with the chosen files. */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple });
    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}
