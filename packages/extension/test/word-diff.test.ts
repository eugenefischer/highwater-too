import { describe, expect, it } from "vitest";
import { wordDiff } from "../src/highland-editor/word-diff.ts";

/** Applies the changes in reverse to the text now, to get the text then. */
function undo(after: string, changes: { from: number; to: number; deleted: string }[]): string {
  let s = after;
  for (const c of [...changes].reverse()) s = s.slice(0, c.from) + c.deleted + s.slice(c.to);
  return s;
}

describe("wordDiff", () => {
  it("finds one changed word in a long paragraph", () => {
    const before = "Tom sips his coffee slowly while the rain falls.\n\nShe waits.\n";
    const after = "Tom sips his tea slowly while the rain falls.\n\nShe waits.\n";
    const c = wordDiff(before, after);
    expect(c).toEqual([{ from: 13, to: 16, deleted: "coffee" }]);
    expect(after.slice(13, 16)).toBe("tea");
  });
  it("finds added and removed words and lines, and undoes back to the save", () => {
    const before = "INT. KITCHEN - NIGHT\n\nMaya slams the fridge shut. She waits. The light flickers.\n\nMAYA\nYou said you'd fix it.\n";
    const after = "INT. KITCHEN - NIGHT\n\nMaya slams the fridge shut. The light flickers, then dies.\n\nMAYA\nYou promised you'd fix it.\n\nA new line.\n";
    const c = wordDiff(before, after);
    expect(undo(after, c)).toBe(before);
    expect(c.length).toBeGreaterThanOrEqual(3);
    expect(c.map((x) => after.slice(x.from, x.to)).join("|")).toContain("promised");
  });
  it("gives nothing for the same text, and one change for an empty save", () => {
    expect(wordDiff("Same.\n", "Same.\n")).toEqual([]);
    expect(wordDiff("", "All new.\n")).toEqual([{ from: 0, to: 9, deleted: "" }]);
  });
  it("stays quick on a long document with a few edits", () => {
    const para = (i: number) => `Paragraph ${i} has some words in it, and then some more words after a comma.\n\n`;
    const before = Array.from({ length: 3000 }, (_, i) => para(i)).join("");
    const after = before.replace("Paragraph 1500 has", "Paragraph 1500 now has").replace("Paragraph 20 has some", "Paragraph 20 has");
    const t = Date.now();
    const c = wordDiff(before, after);
    expect(Date.now() - t).toBeLessThan(1500);
    expect(undo(after, c)).toBe(before);
    expect(c.length).toBe(2);
  });

  it("finds removed whitespace at the start, and blank lines removed or added, as just that", () => {
    expect(wordDiff("\n\n  Tom waits.\n\nHe goes.\n", "Tom waits.\n\nHe goes.\n")).toEqual([{ from: 0, to: 0, deleted: "\n\n  " }]);
    const removed = wordDiff("Tom waits.\n\n\n\nHe goes.\n", "Tom waits.\n\nHe goes.\n");
    expect(removed).toHaveLength(1);
    expect(removed[0]!.deleted).toBe("\n\n");
    const added = wordDiff("Tom waits.\n\nHe goes.\n", "Tom waits.\n\n\n\nHe goes.\n");
    expect(added).toHaveLength(1);
    expect(added[0]!.deleted).toBe("");
    expect(added[0]!.to - added[0]!.from).toBe(2);
  });
  it("still finds the changes in a rewrite too big to compare word by word", () => {
    const words = (seed: number) => Array.from({ length: 4000 }, (_, i) => `w${(i * seed) % 997}`).join(" ");
    const before = `${words(7)}\n\nSame ending.\n`;
    const after = `${words(13)}\n\nSame ending.\n`;
    const t = Date.now();
    const c = wordDiff(before, after);
    expect(Date.now() - t).toBeLessThan(3000);
    expect(undo(after, c)).toBe(before);
  });
});
