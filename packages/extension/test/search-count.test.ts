import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";
import { MAX, countLabel, matchesOf } from "../src/highland-editor/search-count.ts";

const state = EditorState.create({ doc: "The cat sat. The hat. the end." });

describe("the Find box's match count", () => {
  it("finds every match, case-insensitively unless asked", () => {
    expect(matchesOf(state, new SearchQuery({ search: "the" })).map((m) => m.from)).toEqual([0, 13, 22]);
    expect(matchesOf(state, new SearchQuery({ search: "the", caseSensitive: true })).map((m) => m.from)).toEqual([22]);
    expect(matchesOf(state, new SearchQuery({ search: "" }))).toEqual([]);
    expect(matchesOf(state, new SearchQuery({ search: "(", regexp: true }))).toEqual([]);
  });

  it("says which match is selected, how many there are, or that there are none", () => {
    const m = matchesOf(state, new SearchQuery({ search: "the" }));
    expect(countLabel(m, { from: 13, to: 16 })).toBe("2 of 3");
    expect(countLabel(m, { from: 5, to: 5 })).toBe("3 matches");
    expect(countLabel(m.slice(0, 1), { from: 5, to: 5 })).toBe("1 match");
    expect(countLabel([], { from: 0, to: 0 })).toBe("No results");
  });

  it("stops counting past the limit", () => {
    const big = EditorState.create({ doc: "a".repeat(MAX + 50) });
    const m = matchesOf(big, new SearchQuery({ search: "a" }));
    expect(m.length).toBe(MAX + 1);
    expect(countLabel(m, { from: 0, to: 1 })).toBe(`1 of ${MAX}+`);
    expect(countLabel(m, { from: 0, to: 0 })).toBe(`${MAX}+ matches`);
  });
});
