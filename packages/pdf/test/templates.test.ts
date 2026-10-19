import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { comparePages, formatReport, extractPages } from "@highwater/pdf-compare";
import { describe, expect, it } from "vitest";
import { GRAPHIC_NOVEL, STAGE_PLAY } from "../src/index.ts";
import { renderHighland } from "./helpers.ts";

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
