import { describe, expect, it } from "vitest";
import { wrapRuns, type Run } from "../src/index.ts";

const wrap = (text: string, width: number) => wrapRuns([{ text, style: {} }], width).map((line) => line.map((r) => r.text).join(""));

describe("wrapping (Highland's rules)", () => {
  it("breaks at the last space that fits", () => {
    expect(wrap("one two three four", 9)).toEqual(["one two", "three", "four"]);
  });

  it("can break after a hyphen", () => {
    expect(wrap("a blood-chilling tale", 12)).toEqual(["a blood-", "chilling", "tale"]);
  });

  it("breaks between quotes like any other space (current Highland; the 2024 export did not)", () => {
    expect(wrap("you thought about Ada Lovelace’s “Analytical Engine” notes.", 34)).toEqual(["you thought about Ada Lovelace’s", "“Analytical Engine” notes."]);
  });

  it("splits a word longer than the line, and honours hard line breaks", () => {
    expect(wrap("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrap("one\ntwo", 20)).toEqual(["one", "two"]);
  });

  it("keeps styles across the break", () => {
    const runs: Run[] = [
      { text: "plain ", style: {} },
      { text: "bold words here", style: { bold: true } },
    ];
    const lines = wrapRuns(runs, 11);
    expect(lines).toEqual([
      [
        { text: "plain ", style: {} },
        { text: "bold", style: { bold: true } },
      ],
      [{ text: "words here", style: { bold: true } }],
    ]);
  });
});
