// A few DOM helpers for OMF Studio's plain TypeScript UI.

type Child = Node | string | number | null | undefined | false | Child[];

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
  append(el, children);
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
  toastEl = h('div', { class: `toast${bad ? ' bad' : ''}` }, text);
  document.body.append(toastEl);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.remove(), ms);
}

/** A modal dialog; resolves with what `build` hands to `close`. */
export function modal<T>(build: (close: (v: T | null) => void) => HTMLElement): Promise<T | null> {
  return new Promise((resolve) => {
    const back = h('div', { class: 'modal-back' });
    const close = (v: T | null) => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(null);
      }
    };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('mousedown', (e) => {
      if (e.target === back) close(null);
    });
    back.append(build(close));
    document.body.append(back);
  });
}

/** A yes / no question. */
export function confirmDialog(title: string, text: string, yes = 'OK', danger = false): Promise<boolean> {
  return modal<boolean>((close) =>
    h('div', { class: 'modal', style: { width: '460px' } },
      h('h2', null, title),
      h('p', { class: 'muted' }, text),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
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
