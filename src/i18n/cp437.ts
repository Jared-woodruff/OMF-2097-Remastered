// DOS code page 437: the original game's texts and fonts (bytes 0x80..0xFF are the German texts' umlauts and ß, box
// drawing, Greek letters...). The game works with Unicode text; the files are decoded when they are read.

/** The upper half of code page 437 in Unicode. */
export const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

const HIGH_CODE = new Map([...CP437_HIGH].map((ch, i) => [ch, 0x80 + i]));

/** A text read byte by byte (each byte a character code) in Unicode. */
export function cp437ToUnicode(s: string): string {
  return /[\x80-\xff]/.test(s) ? s.replace(/[\x80-\xff]/g, (c) => CP437_HIGH[c.charCodeAt(0) - 0x80]) : s;
}

/** A character's code in code page 437 (its byte), or -1. */
export function cp437Code(ch: string): number {
  const c = ch.charCodeAt(0);
  if (ch.length === 1 && c < 0x80) return c;
  return HIGH_CODE.get(ch) ?? -1;
}

/** A text for a file in code page 437, one character code per byte (characters it lacks become '?'). */
export function unicodeToCp437(s: string): string {
  if (!/[^\x00-\x7f]/.test(s)) return s;
  let out = '';
  for (const ch of s) {
    const c = cp437Code(ch);
    out += String.fromCharCode(c < 0 ? 0x3f : c);
  }
  return out;
}
