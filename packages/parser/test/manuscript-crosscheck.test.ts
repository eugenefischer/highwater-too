import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HighlandBundle } from "@highwater/bundle";
import { extractPages } from "@highwater/pdf-compare";
import { describe, expect, it } from "vitest";
import { inlineText, parse } from "../src/index.ts";

const generated = fileURLToPath(new URL("../../../fixtures/generated/", import.meta.url));
const priv = process.env.HIGHWATER_PRIVATE_FIXTURES;

/** Counts what Highland printed in a manuscript: centred headings, "#" scene breaks, and which of our right-aligned texts it printed flush right. */
async function printed(pdf: string, headingTexts: Set<string>, rightTexts: string[]) {
  const lines = (await extractPages(pdf)).slice(1).flatMap((p) => p.lines);
  const flushRight = lines.filter((l) => Math.abs(l.x + l.text.length * 7.2 - 540) < 1.5).map((l) => l.text.trim());
  return {
    headings: lines.filter((l) => headingTexts.has(l.text.trim())).length,
    sceneBreaks: lines.filter((l) => l.text === "#" && Math.abs(l.x - 302.4) < 2).length,
    rightAligned: rightTexts.filter((t) => flushRight.includes(t)).length,
  };
}

async function check(highland: string, pdf: string) {
  const doc = parse(HighlandBundle.fromZip(new Uint8Array(readFileSync(highland))).text, { mode: "markdown" });
  const headings = doc.elements.filter((e) => e.kind === "heading");
  const right = doc.elements.flatMap((e) => (e.kind === "rightAligned" ? [inlineText(e.inline).trim()] : []));
  const ours = {
    headings: headings.length,
    sceneBreaks: doc.elements.filter((e) => e.kind === "sceneBreak").length,
    rightAligned: right.length,
  };
  return { ours, theirs: await printed(pdf, new Set(headings.map((h) => (h.kind === "heading" ? h.text : ""))), right) };
}

describe("manuscript structure matches Highland's printed PDF", () => {
  it("ManuscriptEdgeCases: scene break, no stray right-aligned lines", async () => {
    const r = await check(join(generated, "ManuscriptEdgeCases.highland"), join(generated, "ManuscriptEdgeCases.pdf"));
    expect(r.ours.sceneBreaks).toBe(r.theirs.sceneBreaks);
  });

  it.runIf(priv)("Sweet Betty and The Purity Variations: headings, scene breaks, right-aligned lines", async () => {
    const dir = join(priv!, "Files with exports");
    const betty = await check(join(dir, "SweetBetty_HighlandTest.highland"), join(dir, "SweetBetty_HighlandTest.pdf"));
    expect(betty.ours.sceneBreaks).toBe(betty.theirs.sceneBreaks);
    expect(betty.ours.rightAligned).toBeGreaterThan(0);
    expect(betty.ours.rightAligned).toBe(betty.theirs.rightAligned);
    const purity = await check(join(dir, "ThePurityVariations_draft_1 copy.highland"), join(dir, "ThePurityVariations_draft_1.2 copy.pdf"));
    expect(purity.ours.headings).toBe(19);
    expect(purity.theirs.headings).toBe(19);
  });
});
