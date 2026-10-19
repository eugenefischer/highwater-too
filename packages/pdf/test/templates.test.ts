import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { comparePages, formatReport, extractPages } from "@highwater/pdf-compare";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HighlandBundle } from "@highwater/bundle";
import { GRAPHIC_NOVEL, layoutPlainText, MULTI_CAM, STAGE_PLAY } from "../src/index.ts";
import { bodyOnly, extractLayout, renderHighland } from "./helpers.ts";

const templates = fileURLToPath(new URL("../../../fixtures/generated/templates/", import.meta.url));

// M10 probes (tools/scripts/gen-template-probes.ts), exported by EJ from Highland 2 (2026-10-19).
describe("script templates match Highland's PDFs", () => {
  it.each([
    ["GraphicNovelProbe", GRAPHIC_NOVEL],
    ["StagePlayProbe", STAGE_PLAY],
  ] as const)("%s matches line for line", async (name, template) => {
    const r = comparePages(await extractPages(join(templates, `${name}.pdf`)), await renderHighland(join(templates, `${name}.highland`), { template }));
    expect(r.diffs, formatReport(r)).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

// Highland 2 does not split Multi-Cam's double-spaced speeches again once split: on its pages 8
// and 10 the rest of a speech runs off the page (y 939, 1419) and is lost in print. We split them
// as on any other page, so those sections differ (and our page numbers after them); the pages
// before them, and every section after them, match.
describe("Multi-Cam matches Highland's PDF, but for Highland's lost text", () => {
  it("matches line for line before the width probes and from the capacity pages on", async () => {
    const expected = await extractPages(join(templates, "MultiCamProbe.pdf"));
    const actual = await renderHighland(join(templates, "MultiCamProbe.highland"), { template: MULTI_CAM });
    const before = comparePages(expected.slice(0, 7), actual.slice(0, 7));
    expect(before.diffs, formatReport(before)).toEqual([]);
    const from = (pages: typeof expected) => pages.findIndex((p) => p.lines.some((l) => l.text === "INT. CAPACITY - DAY"));
    const after = comparePages(bodyOnly(expected.slice(from(expected))), bodyOnly(actual.slice(from(actual))));
    expect(after.diffs, formatReport(after)).toEqual([]);
  });

  it("splits the speeches Highland lets run off the page, so nothing goes below the last line", async () => {
    const actual = await renderHighland(join(templates, "MultiCamProbe.highland"), { template: MULTI_CAM });
    for (const page of actual) for (const line of page.lines) expect(line.y).toBeLessThanOrEqual(747);
  });
});

describe("Plain Text matches Highland's PDF", () => {
  it("prints the text as typed, line for line", async () => {
    const text = HighlandBundle.fromZip(new Uint8Array(readFileSync(join(templates, "PlainTextProbe.highland")))).text;
    const r = comparePages(await extractPages(join(templates, "PlainTextProbe.pdf")), await extractLayout(layoutPlainText(text)));
    expect(r.diffs, formatReport(r)).toEqual([]);
    expect(r.ok).toBe(true);
  });
});
