/**
 * What a word is, everywhere in Highwater Too: letters, combining marks and digits, with an
 * apostrophe (' or ’) inside a word joining it ("don’t", "O'BRIEN"), as on a Mac. A hyphen or dash
 * separates words, and so does an apostrophe at a word's edge (a quotation mark). Double-click,
 * word moves (⌥← ⌥→) and word deletion in the Highwater Editor, Upper and Lower Case with nothing
 * selected, spelling, and VS Code's word pattern (language-configuration.json) all use this one rule.
 */
export const WORD_SOURCE = "[\\p{L}\\p{M}\\p{N}]+(?:['’][\\p{L}\\p{M}\\p{N}]+)*";

const LETTER = /[\p{L}\p{M}\p{N}]/u;

/** The whole character (a surrogate pair together) at or around UTF-16 offset `i`. */
function charAround(text: string, i: number): string {
  const c = text.charCodeAt(i);
  if (c >= 0xdc00 && c <= 0xdfff && i > 0) return String.fromCodePoint(text.codePointAt(i - 1)!);
  return String.fromCodePoint(text.codePointAt(i)!);
}

/**
 * Whether the character at UTF-16 offset `i` is part of a word by the rule above: a letter, mark or
 * digit, or an apostrophe with one of those on both sides. (The same as being inside a match of
 * `wordRegExp()`.)
 */
export function wordCharAt(text: string, i: number): boolean {
  if (i < 0 || i >= text.length) return false;
  const c = text[i]!;
  if (c === "'" || c === "’") return i > 0 && i + 1 < text.length && LETTER.test(charAround(text, i - 1)) && LETTER.test(charAround(text, i + 1));
  return LETTER.test(charAround(text, i));
}

/** Every word, in order (the "g" and "u" flags). */
export function wordRegExp(): RegExp {
  return new RegExp(WORD_SOURCE, "gu");
}

/**
 * The word containing or touching `pos` in `text` (a word just before `pos` counts when none
 * starts there), or null.
 */
export function wordAt(text: string, pos: number): { from: number; to: number } | null {
  let touching: { from: number; to: number } | null = null;
  for (const m of text.matchAll(wordRegExp())) {
    const from = m.index;
    const to = from + m[0].length;
    if (from > pos) break;
    if (pos < to) return { from, to };
    if (pos === to) touching = { from, to };
  }
  return touching;
}

/** The words of `text`, by offset. */
export function wordsOf(text: string): { from: number; to: number; text: string }[] {
  return [...text.matchAll(wordRegExp())].map((m) => ({ from: m.index, to: m.index + m[0].length, text: m[0] }));
}
