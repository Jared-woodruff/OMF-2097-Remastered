// Mouse / touch pointer input for the menus (the original game is keyboard and joystick only): pointer events on the
// canvas, converted to native 320x200 coordinates and queued until the next frame dispatches them.

export type PointerKind = 'move' | 'click' | 'rclick' | 'wheelUp' | 'wheelDown';

export interface PointerInput {
  kind: PointerKind;
  /** Native coordinates (the widescreen sides are outside 0..320). */
  x: number;
  y: number;
}

let queue: PointerInput[] = [];

/**
 * Starts listening on the canvas. `toNative` maps canvas pixel coordinates to native coordinates (it depends on the
 * renderer's current viewport).
 */
export function initMouse(canvas: HTMLCanvasElement, toNative: (px: number, py: number) => [number, number]): void {
  const pos = (e: MouseEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    const sx = r.width > 0 ? canvas.width / r.width : 1;
    const sy = r.height > 0 ? canvas.height / r.height : 1;
    return toNative((e.clientX - r.left) * sx, (e.clientY - r.top) * sy);
  };
  const push = (kind: PointerKind, e: MouseEvent) => {
    const [x, y] = pos(e);
    // Only the latest position matters for hovering.
    if (kind === 'move' && queue.length > 0 && queue[queue.length - 1].kind === 'move') queue.pop();
    queue.push({ kind, x, y });
    if (queue.length > 32) queue = queue.slice(-32);
  };
  canvas.addEventListener('pointermove', (e) => push('move', e));
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0) push('click', e);
    else if (e.button === 2) push('rclick', e);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    if (e.deltaY !== 0) push(e.deltaY < 0 ? 'wheelUp' : 'wheelDown', e);
  }, { passive: true });
}

/** Queues pointer input directly in native coordinates (tests and the debug API). */
export function pushPointer(kind: PointerKind, x: number, y: number): void {
  queue.push({ kind, x, y });
}

/** Takes the queued pointer input. */
export function drainPointer(): PointerInput[] {
  const out = queue;
  queue = [];
  return out;
}
