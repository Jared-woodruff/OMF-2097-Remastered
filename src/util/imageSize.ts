// The type and size of a PNG or WebP image from its header, without decoding it (mod packages' HD pictures are
// checked this way: the game decodes them with the browser when it draws them).

export interface ImageSize {
  type: 'png' | 'webp';
  w: number;
  h: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function ascii(b: Uint8Array, at: number, n: number): string {
  return String.fromCharCode(...b.subarray(at, at + n));
}

/** The image's type and size, or null when it is neither a PNG nor a WebP image (or its header is cut short). */
export function imageSize(b: Uint8Array): ImageSize | null {
  if (b.length >= 24 && PNG_SIGNATURE.every((v, i) => b[i] === v) && ascii(b, 12, 4) === 'IHDR') {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { type: 'png', w: v.getUint32(16), h: v.getUint32(20) };
  }
  if (b.length >= 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4);
    const le = (at: number, n: number) => {
      let x = 0;
      for (let i = n - 1; i >= 0; i--) x = x * 256 + b[at + i];
      return x;
    };
    // Extended: the canvas size (24 bits each, minus one).
    if (chunk === 'VP8X') return { type: 'webp', w: le(24, 3) + 1, h: le(27, 3) + 1 };
    // Lossy: a key frame's start code, then 14 bits each.
    if (chunk === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return { type: 'webp', w: le(26, 2) & 0x3fff, h: le(28, 2) & 0x3fff };
    }
    // Lossless: a signature byte, then 14 bits each (minus one).
    if (chunk === 'VP8L' && b[20] === 0x2f) {
      const bits = le(21, 4);
      return { type: 'webp', w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}
