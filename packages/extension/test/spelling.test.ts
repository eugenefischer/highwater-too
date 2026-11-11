import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { parse } from "@highwater/parser";
import nspell from "nspell";
import { describe, expect, it } from "vitest";
import { key, matchCase, rankGuesses, spellContext, wordsToCheck } from "../src/highland-editor/spell-words.ts";

const words = (text: string, mode: "fountain" | "markdown" = "fountain") => {
  const doc = parse(text, { mode });
  return wordsToCheck(text, 0, spellContext(doc)).map((w) => w.text);
};

describe("words to check", () => {
  it("skips cues and the characters' names, scene prefixes, directives, addresses and omitted text", () => {
    const text = [
      "Title: Astounding",
      "",
      "INT. TARRANT HOUSE - NIGHT",
      "",
      "Tarrant's hat. {{SERIES}} See https://example.com/xyzzy /* omittted */ Mara waves.",
      "",
      "TARRANT",
      "Hellllo.",
      "",
      "MARA (V.O.)",
      "Tarrants agin.",
    ].join("\n");
    expect(words(text)).toEqual(["Astounding", "HOUSE", "NIGHT", "hat", "See", "waves", "Hellllo", "Tarrants", "agin"]);
  });

  it("keeps contractions whole, skips numbers and single letters", () => {
    expect(words("I won’t take 3rd place, x.")).toEqual(["won’t", "take", "place"]);
  });

  it("skips link targets in Markdown", () => {
    expect(words("A [link](https://example.com/zzz) here.\n\n[ref]: http://qqq", "markdown")).toEqual(["link", "here"]);
  });
});

describe("suggestions keep the word's case and apostrophe", () => {
  it.each([
    ["Teh", "the", "The"],
    ["TEH", "the", "THE"],
    ["dont’", "don't", "don’t"],
    ["teh", "the", "the"],
  ])("%s → %s", (original, suggestion, expected) => expect(matchCase(original, suggestion)).toBe(expected));
});

describe("the bundled dictionary (en_US)", () => {
  const dir = dirname(createRequire(import.meta.url).resolve("dictionary-en"));
  const spell = nspell(readFileSync(join(dir, "index.aff"), "utf8"), readFileSync(join(dir, "index.dic"), "utf8"));
  it("knows American spelling, contractions and capitalised words", () => {
    for (const w of ["color", "realize", "won't", key("you’ve"), "Catholics", "Monday", "NIGHT", "Manhattan"]) expect(spell.correct(w), w).toBe(true);
    for (const w of ["colour", "agin", "Hellllo", "fingernials"]) expect(spell.correct(w), w).toBe(false);
  });
  it("suggests, closest first (a swap of two letters counts half)", () => {
    expect(spell.suggest("fingernials")).toContain("fingernails");
    expect(rankGuesses("teh", spell.suggest("teh"))[0]).toBe("the");
    expect(rankGuesses("hte", spell.suggest("hte"))[0]).toBe("the");
    expect(rankGuesses("recieve", spell.suggest("recieve"))[0]).toBe("receive");
  });
});
