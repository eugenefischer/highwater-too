import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(fileURLToPath(new URL("../language-configuration.json", import.meta.url)), "utf8")) as { wordPattern: { pattern: string; flags: string } };

describe("language configuration", () => {
  // VS Code builds the word pattern without flags unless told; without "u", \\p{L} means the letters
  // p, {, L and }, so "CAMPBELL" was only a word at its last L (and completion waited for it).
  it("compiles its word pattern as Unicode, so names are whole words", () => {
    expect(config.wordPattern.flags).toContain("u");
    const re = new RegExp(config.wordPattern.pattern, `${config.wordPattern.flags}g`);
    expect("CAMPBELL Doña O’Brien Jean-Luc 1917".match(re)).toEqual(["CAMPBELL", "Doña", "O’Brien", "Jean-Luc", "1917"]);
  });
});
