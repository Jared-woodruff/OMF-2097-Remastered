// Palette-independent fingerprint of an indexed image (size + palette indices). The HD asset importer records it for
// every remastered image; the renderer computes it for the surfaces it draws to find their HD versions.

function fnv1a(data: ArrayLike<number>, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i], 0x01000193);
  return h >>> 0;
}

/** 64-bit (two 32-bit FNV-1a lanes) hex fingerprint of `w` x `h` palette indices. */
export function pixelHash(w: number, h: number, pixels: ArrayLike<number>): string {
  const head = [w & 255, (w >> 8) & 255, h & 255, (h >> 8) & 255];
  const a = fnv1a(pixels, fnv1a(head, 0x811c9dc5));
  // Second lane: different seed and byte order so the two lanes are independent.
  let b = (0x9747b28c ^ Math.imul(w, 0x85ebca6b) ^ Math.imul(h, 0xc2b2ae35)) >>> 0;
  for (let i = pixels.length - 1; i >= 0; i--) b = Math.imul(b ^ pixels[i], 0x01000193);
  return a.toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
