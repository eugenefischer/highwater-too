import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { comparePages, comparePixels, extractPages, hasPdftoppm } from "../src/index.ts";

const fixture = (name: string) => fileURLToPath(new URL(`../../../fixtures/generated/${name}`, import.meta.url));
const screenplay = fixture("ScreenplayEdgeCases.pdf");
const manuscript = fixture("ManuscriptEdgeCases.pdf");

describe("extractPages", () => {
  it("reads Highland's screenplay layout", async () => {
    const pages = await extractPages(screenplay);
    expect(pages).toHaveLength(12);
    const heading = pages[1]!.lines.find((l) => l.text.includes("INT. TEST KITCHEN - DAY"));
    expect(heading).toBeDefined();
    // Scene number #5# prints in both margins on the heading's baseline, so the line reads "5 INT. … 5".
    expect(heading!.text).toBe("5 INT. TEST KITCHEN - DAY 5");
  });

  it("finds the action margin at 108 pt", async () => {
    const pages = await extractPages(screenplay);
    const action = pages[1]!.lines.find((l) => l.text === "Brenda and Carl stand at the counter.");
    expect(action?.x).toBeCloseTo(108, 0);
  });
});

describe("comparePages", () => {
  it("reports no differences for a PDF against itself", async () => {
    const pages = await extractPages(screenplay);
    const result = comparePages(pages, await extractPages(screenplay));
    expect(result.ok).toBe(true);
    expect(result.diffs).toHaveLength(0);
  });

  it("flags differences between two different exports", async () => {
    const result = comparePages(await extractPages(screenplay), await extractPages(manuscript));
    expect(result.ok).toBe(false);
    expect(result.expectedPages).toBe(12);
    expect(result.actualPages).toBe(6);
    expect(result.diffs.length).toBeGreaterThan(0);
  });

  it("catches a line moved by more than the tolerance", async () => {
    const pages = await extractPages(manuscript);
    const moved = structuredClone(pages);
    moved[1]!.lines[0]!.y += 1.5;
    const result = comparePages(pages, moved);
    expect(result.diffs).toEqual([expect.objectContaining({ kind: "position", page: 2, index: 0 })]);
    expect(comparePages(pages, moved, { tolerance: 2 }).ok).toBe(true);
  });
});

describe.runIf(await hasPdftoppm())("comparePixels", () => {
  it("finds no differing pixels for a PDF against itself", async () => {
    const pages = await comparePixels(manuscript, manuscript);
    expect(pages.every((p) => p.differing === 0)).toBe(true);
  });
});
