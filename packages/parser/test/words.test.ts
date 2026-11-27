import { describe, expect, it } from "vitest";
import { wordAt, wordCharAt, wordRegExp, wordsOf } from "../src/index.ts";

describe("Highwater's one rule for words", () => {
  it("joins letters, marks and digits, and an apostrophe only inside a word", () => {
    const text = "Don’t say O'BRIEN's 'quoted' Jean-Luc 1917 Zoé naïve rock 'n' roll 𝒜b ''";
    expect(wordsOf(text).map((w) => w.text)).toEqual(["Don’t", "say", "O'BRIEN's", "quoted", "Jean", "Luc", "1917", "Zoé", "naïve", "rock", "n", "roll", "𝒜b"]);
  });

  it("says the same, a character at a time, as the whole-word pattern, for every character of many texts", () => {
    const pieces = ["a", "Z", "é", "é", "7", "'", "’", " ", "-", "—", ".", "𝒜", "🎬", "\n", "_", "’’"];
    let seed = 1;
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let n = 0; n < 500; n++) {
      let text = "";
      for (let k = 0; k < 12; k++) text += pieces[Math.floor(rand() * pieces.length)];
      const inWord = new Array<boolean>(text.length).fill(false);
      for (const m of text.matchAll(wordRegExp())) for (let i = m.index; i < m.index + m[0].length; i++) inWord[i] = true;
      for (let i = 0; i < text.length; i++) expect(wordCharAt(text, i), `${JSON.stringify(text)} at ${i}`).toBe(inWord[i]);
    }
  });

  it("finds the word at a place, or the one just before it", () => {
    const text = "say don’t go";
    expect(wordAt(text, 6)).toEqual({ from: 4, to: 9 });
    expect(wordAt(text, 9)).toEqual({ from: 4, to: 9 });
    expect(wordAt(text, 3)).toEqual({ from: 0, to: 3 });
    expect(wordAt("  ", 1)).toBeNull();
  });
});
